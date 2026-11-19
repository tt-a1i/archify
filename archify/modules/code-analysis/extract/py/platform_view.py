"""Select proven standard-library platform conditions in Jedi's source view."""

import ast

from calls import events, source_lines


PLATFORMS = {"Darwin": "darwin", "Linux": "linux", "Windows": "win32", "Android": "android", "iOS": "ios"}


def platform_view(text, tree, platform):
    if platform not in PLATFORMS:
        return text
    bindings, _ = events(tree.body)
    if "*" in bindings:
        return text
    values = {"sys": PLATFORMS[platform], "os": "nt" if platform == "Windows" else "posix"}
    imports, constants = {}, {}
    assigned = {(node.value.id, node.attr) for node in ast.walk(tree) if isinstance(node, ast.Attribute)
                and isinstance(node.ctx, (ast.Store, ast.Del)) and isinstance(node.value, ast.Name)}

    def platform_attribute(node):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and (node.value.id, node.attr) not in assigned:
            module = imports.get(node.value.id)
            if (module, node.attr) in (("sys", "platform"), ("os", "name")):
                return module
        return None

    def platform_dependent(node):
        return any(platform_attribute(part) or (isinstance(part, ast.Name) and part.id in constants) for part in ast.walk(node))

    def value(node):
        if isinstance(node, ast.Constant) and type(node.value) in (str, bool):
            return node.value
        if isinstance(node, ast.Name):
            return constants.get(node.id)
        if module := platform_attribute(node):
            return values[module]
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left, right = value(node.left), value(node.comparators[0])
            if left is not None and right is not None and isinstance(node.ops[0], (ast.Eq, ast.NotEq)):
                return (left == right) == isinstance(node.ops[0], ast.Eq)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "startswith" and len(node.args) == 1 and not node.keywords:
            base, prefix = value(node.func.value), value(node.args[0])
            if isinstance(base, str) and isinstance(prefix, str):
                return base.startswith(prefix)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not) and isinstance(test := value(node.operand), bool):
            return not test
        if isinstance(node, ast.BoolOp):
            tests = [value(test) for test in node.values]
            if all(isinstance(test, bool) for test in tests):
                return all(tests) if isinstance(node.op, ast.And) else any(tests)
        return None

    lines, offsets = source_lines(text)
    edits = []

    def edit(first, last, replacement):
        line = first.lineno
        if decorators := getattr(first, "decorator_list", ()):
            # The decorator expression can start after its @, even on a later line.
            line = decorators[0].lineno
            while not lines[line - 1].lstrip(" \t\f").startswith("@"):
                line -= 1
            column = lines[line - 1].index("@")
        else:
            column = len(lines[line - 1].encode("utf-8")[:first.col_offset].decode("utf-8"))
        start = offsets[line - 1] + column
        stop = offsets[last.end_lineno - 1] + len(lines[last.end_lineno - 1].encode("utf-8")[:last.end_col_offset].decode("utf-8"))
        span = text[start:stop]
        multiline_test = isinstance(first, ast.expr) and first.lineno != first.end_lineno
        if multiline_test:
            replacement = "(" + replacement
        if len(span.splitlines()[0]) < len(replacement):
            return False
        spacer = "".join(c if c in "\r\n" else " " for c in span[len(replacement):])
        if multiline_test:
            spacer = spacer[:-1] + ")"
        edits.append((start, stop, replacement + spacer))
        return True

    def visit(nodes):
        for node in nodes:
            if isinstance(node, ast.If) and platform_dependent(node.test) and isinstance(test := value(node.test), bool):
                active, skipped = (node.body, node.orelse) if test else (node.orelse, node.body)
                before = len(edits)
                if edit(node.test, node.test, str(test)) and (not skipped or edit(skipped[0], skipped[-1], "pass")):
                    visit(active)
                else:
                    del edits[before:]
            elif isinstance(node, ast.Assert) and platform_dependent(node.test) and isinstance(test := value(node.test), bool):
                edit(node.test, node.test, str(test))
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname or alias.name
                    if alias.name in values and len(bindings.get(name, [])) == 1:
                        imports[name] = alias.name
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                name = node.targets[0].id
                if len(bindings.get(name, [])) == 1 and platform_dependent(node.value) and (evaluated := value(node.value)) is not None:
                    constants[name] = evaluated

    visit(tree.body)
    if not edits:
        return text
    rewritten = text
    for start, stop, replacement in sorted(edits, reverse=True):
        rewritten = rewritten[:start] + replacement + rewritten[stop:]
    try:
        ast.parse(rewritten)
    except SyntaxError:
        return text
    return rewritten
