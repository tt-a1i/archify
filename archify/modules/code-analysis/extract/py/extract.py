"""Python import extractor for Bauify.

Reads a JSON document on stdin: {"root": "<abs dir>", "files": ["rel/path.py", ...]}
Writes a JSON document on stdout:
  {"files": [{"path", "loc", "imports": [...], "symbols": [...], "error"?}], "python": "3.x.y"}
Each symbol is a module-scope binding: {"name", "kind": "function"|"class"|"variable"|"import", "line"}
  (the line where the name becomes bound; what a `from m import name` elsewhere
  needs to have executed already when `m` is only partially initialised).
Each import: {"line", "kind": "static"|"dynamic", "level", "module", "names"}
  - `import a.b as c`       -> level 0, module "a.b",  names ["*"]
  - `from a.b import x, y`  -> level 0, module "a.b",  names ["x", "y"]
  - `from . import x`       -> level 1, module "",     names ["x"]
  - `from ..p import *`     -> level 2, module "p",    names ["*"]
  - importlib.import_module("a.b") / __import__("a.b") with a literal -> kind "dynamic"
Resolution against the file set happens in Node so both adapters share one policy.
Standard library only; no third-party imports.
"""
import ast
import json
import platform
import sys


def line_count(text):
    if not text:
        return 0
    lines = text.splitlines()
    return len(lines)


def literal_module(node):
    if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
        return node.args[0].value
    return None


def collect(tree):
    """Keep lexical scope separate from execution guarantees.

    A function body is deferred, but its defaults/decorators are evaluated in
    the enclosing scope. A deferred function may itself be called during
    module initialization; `lazy` is deliberately not a proof of safety.
    """
    # Recognize typing aliases only when they have one unambiguous binding.
    # Reassignment or shadowing anywhere makes this conservative: retain the
    # possible runtime edge instead of incorrectly erasing it as type-only.
    bindings = {}
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names = [node.id]
        elif isinstance(node, ast.Attribute) and isinstance(node.ctx, (ast.Store, ast.Del)) and isinstance(node.value, ast.Name):
            names = [node.value.id]
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names = [node.name]
        elif isinstance(node, ast.arg):
            names = [node.arg]
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names = [node.name]
        elif isinstance(node, ast.Import):
            names = [a.asname or a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [a.asname or a.name for a in node.names]
        for name in names:
            bindings[name] = bindings.get(name, 0) + 1
    typing_names, type_checks = {}, {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                name = a.asname or a.name
                if a.name == "typing" and bindings.get(name) == 1:
                    typing_names[name] = node.lineno
        elif isinstance(node, ast.ImportFrom) and node.module == "typing" and not node.level:
            for a in node.names:
                name = a.asname or a.name
                if a.name == "TYPE_CHECKING" and bindings.get(name) == 1:
                    type_checks[name] = node.lineno

    class Collector(ast.NodeVisitor):
        def __init__(self):
            self.found = []
            self.flags = {}

        def under(self, flags, nodes):
            previous = self.flags
            self.flags = {**previous, **flags}
            for node in nodes:
                self.visit(node)
            self.flags = previous

        def emit(self, node, **fields):
            self.found.append({"line": node.lineno, "column": node.col_offset, **fields, **self.flags})

        def visit_FunctionDef(self, node):
            self.under({"lazy": True}, getattr(node, "type_params", []))
            # Only the body is lazy, not default expressions or decorators.
            for expr in node.decorator_list + node.args.defaults + [d for d in node.args.kw_defaults if d]:
                self.visit(expr)
            # Annotation evaluation varies with future annotations and Python
            # versions. Keep imports in them as conditional evidence.
            args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
            args += [a for a in (node.args.vararg, node.args.kwarg) if a]
            annotations = [a.annotation for a in args if a.annotation]
            if node.returns:
                annotations.append(node.returns)
            self.under({"conditional": True}, annotations)
            self.under({"lazy": True}, node.body)

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, node):
            # Bounds are lazy; bases, decorators and the class body retain outer scope.
            self.under({"lazy": True}, getattr(node, "type_params", []))
            for expr in node.decorator_list + node.bases + node.keywords + node.body:
                self.visit(expr)

        def visit_TypeAlias(self, node):
            # PEP 695 alias values and parameter bounds evaluate on demand.
            self.under({"lazy": True}, getattr(node, "type_params", []) + [node.value])

        def visit_Lambda(self, node):
            for expr in node.args.defaults + [d for d in node.args.kw_defaults if d]:
                self.visit(expr)
            self.under({"lazy": True}, [node.body])

        def visit_If(self, node):
            test = node.test
            negated = isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not)
            check = test.operand if negated else test
            is_type_check = (
                isinstance(check, ast.Name) and type_checks.get(check.id, float("inf")) < node.lineno
            ) or (
                isinstance(check, ast.Attribute) and check.attr == "TYPE_CHECKING"
                and isinstance(check.value, ast.Name)
                and typing_names.get(check.value.id, float("inf")) < node.lineno
            )
            self.visit(test)
            if is_type_check:
                self.under({"typeOnly": True}, node.orelse if negated else node.body)
                self.under({}, node.body if negated else node.orelse)
            else:
                self.under({"conditional": True}, node.body + node.orelse)

        def visit_Try(self, node):
            self.under({"conditional": True}, node.body + node.handlers + node.orelse)
            self.under({}, node.finalbody)

        visit_TryStar = visit_Try

        def visit_For(self, node):
            self.visit(node.iter)
            self.under({"conditional": True}, [node.target] + node.body + node.orelse)

        visit_AsyncFor = visit_For

        def visit_While(self, node):
            self.visit(node.test)
            self.under({"conditional": True}, node.body + node.orelse)

        def visit_IfExp(self, node):
            self.visit(node.test)
            self.under({"conditional": True}, [node.body, node.orelse])

        def visit_BoolOp(self, node):
            self.visit(node.values[0])
            self.under({"conditional": True}, node.values[1:])

        def comprehension(self, node, values, lazy=False):
            # Python evaluates the outer iterable when constructing even a
            # generator. Everything after it depends on iteration and filters.
            self.visit(node.generators[0].iter)
            body = []
            for index, generator in enumerate(node.generators):
                if index:
                    body.append(generator.iter)
                body.extend([generator.target, *generator.ifs])
            self.under({"conditional": True, **({"lazy": True} if lazy else {})}, body + values)

        def visit_GeneratorExp(self, node):
            self.comprehension(node, [node.elt], lazy=True)

        def visit_ListComp(self, node):
            self.comprehension(node, [node.elt])

        visit_SetComp = visit_ListComp

        def visit_DictComp(self, node):
            self.comprehension(node, [node.key, node.value])

        def visit_Import(self, node):
            for alias in node.names:
                self.emit(node, kind="static", level=0, module=alias.name, names=["*"])

        def visit_ImportFrom(self, node):
            self.emit(node, kind="static", level=node.level or 0, module=node.module or "",
                      names=sorted(alias.name for alias in node.names))

        def visit_Call(self, node):
            func = node.func
            is_loader = (isinstance(func, ast.Attribute) and func.attr == "import_module"
                         and isinstance(func.value, ast.Name) and func.value.id == "importlib") \
                or (isinstance(func, ast.Name) and func.id == "__import__")
            if is_loader:
                target = literal_module(node)
                self.emit(node, kind="dynamic", level=0, module=target or "<computed>",
                          names=[], **({"opaque": True} if target is None else {}))
            self.generic_visit(node)

    collector = Collector()
    collector.visit(tree)
    return sorted(collector.found, key=lambda i: (i["line"], i["module"]))


def module_bindings(tree):
    """Module-scope names in the order they are bound. Walks into if/try/with
    blocks at module level (still executed at import time) but not into
    function or class bodies. Later re-bindings keep the first line: the name
    exists from then on."""
    seen = {}
    def bind(name, kind, line):
        if name not in seen:
            seen[name] = {"name": name, "kind": kind, "line": line}
    def targets(node):
        if isinstance(node, ast.Name):
            return [node.id]
        if isinstance(node, (ast.Tuple, ast.List)):
            return [n for elt in node.elts for n in targets(elt)]
        return []
    def walk(body):
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                bind(node.name, "function", node.lineno)
            elif isinstance(node, ast.ClassDef):
                bind(node.name, "class", node.lineno)
            elif isinstance(node, ast.Assign):
                for t in node.targets:
                    for name in targets(t):
                        bind(name, "variable", node.lineno)
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign)) and node.value is not None:
                for name in targets(node.target):
                    bind(name, "variable", node.lineno)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    bind(alias.asname or alias.name.split(".")[0], "import", node.lineno)
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name != "*":
                        bind(alias.asname or alias.name, "import", node.lineno)
            elif isinstance(node, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
                for attr in ("body", "orelse", "finalbody", "handlers"):
                    for child in getattr(node, attr, []) or []:
                        if isinstance(child, ast.ExceptHandler):
                            walk(child.body)
                        else:
                            walk([child])
    walk(tree.body)
    return sorted(seen.values(), key=lambda b: (b["line"], b["name"]))


def main():
    request = json.load(sys.stdin)
    root = request["root"]
    out = []
    for rel in request["files"]:
        path = root + "/" + rel
        with open(path, "rb") as handle:
            raw = handle.read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        record = {"path": rel, "loc": line_count(text), "imports": [], "symbols": []}
        try:
            tree = ast.parse(text, filename=rel)
            record["imports"] = collect(tree)
            record["symbols"] = module_bindings(tree)
        except SyntaxError as error:
            record["error"] = "%s (line %s)" % (error.msg, error.lineno)
        out.append(record)
    json.dump({"files": out, "python": platform.python_version()}, sys.stdout)


if __name__ == "__main__":
    main()
