"""Bounded receiver proofs from the same CPython tree used for call inventory."""

import ast
from functools import cache

from calls import events, source_range


FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
SCOPES = (*FUNCTIONS, ast.Lambda, ast.Module)
TYPE_ALIAS = getattr(ast, "TypeAlias", ())


def args(node):
    return [*node.args.posonlyargs, *node.args.args]


def all_args(node):
    return [*args(node), *node.args.kwonlyargs, *(n for n in (node.args.vararg, node.args.kwarg) if n)]


def receiver_path(node):
    if isinstance(node, ast.Name):
        return (node.id,)
    if isinstance(node, ast.Attribute) and (parent := receiver_path(node.value)):
        return (*parent, node.attr)
    return ()


class Source:
    def __init__(self, tree, record):
        self.tree = tree
        self.record = record
        self.parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        self.classes = {(node.lineno, node.name): node for node in self.parents if isinstance(node, ast.ClassDef)}
        self.owners = {(node.lineno, node.name): parent for node, parent in self.parents.items()
                       if isinstance(node, FUNCTIONS) and isinstance(parent, ast.ClassDef)}
        self.functions = {(node.lineno, node.name): node for node in self.parents if isinstance(node, FUNCTIONS)}
        self.module_types = {node.name if isinstance(node, ast.ClassDef) else node.name.id: node
                             for node in tree.body if isinstance(node, ast.ClassDef) or isinstance(node, TYPE_ALIAS)}
        self.assignments = {stmt.targets[0].id: stmt.value for stmt in tree.body
                            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name)}
        self.module_events = events(tree.body, module=True)
        self.global_names = {name for node in self.parents if isinstance(node, ast.Global) for name in node.names}
        self.targets = {}

    def ancestors(self, node):
        while node in self.parents:
            node = self.parents[node]
            yield node

    def scope(self, node):
        return next((n for n in self.ancestors(node) if isinstance(n, SCOPES)), self.tree)

    def before(self, node, scope):
        for parent in self.ancestors(node):
            for field in ("body", "orelse", "finalbody"):
                body = getattr(parent, field, None)
                if isinstance(body, list) and node in body:
                    yield from reversed(body[:body.index(node)])
                    break
            if parent is scope:
                break
            node = parent

    @cache
    def bindings(self, scope):
        if scope is self.tree:
            return self.module_events
        body = getattr(scope, "body", [])
        return events(body if isinstance(body, list) else [body])

    def module_binding(self, name, scope):
        while scope is not self.tree:
            writes, declarations = self.bindings(scope)
            if name in writes or name in declarations or any(arg.arg == name for arg in all_args(scope)):
                return None
            scope = self.scope(scope)
        bindings, declarations = self.module_events
        values = bindings.get(name, [])
        if "*" not in bindings and len(values) == 1 and name not in declarations and name not in self.global_names:
            return values
        return None

    def local_type(self, name, scope):
        if self.module_binding(name, scope):
            return self.module_types.get(name)
        return None

    def builtin(self, name, scope):
        for owner in (scope, *self.ancestors(scope)):
            if not isinstance(owner, SCOPES):
                continue
            writes, declarations = self.bindings(owner)
            if name in writes or name in declarations or "*" in writes:
                return False
            if hasattr(owner, "args") and any(a.arg == name for a in all_args(owner)):
                return False
        return True

    @cache
    def member(self, cls, name):
        writes, _ = self.bindings(cls)
        if cls.decorator_list or cls.keywords or len(writes.get(name, [])) != 1:
            return None
        return next((n for n in cls.body if isinstance(n, FUNCTIONS) and n.name == name), None)

    def target(self, fn):
        span = source_range(fn, self.record["sourceText"], digest=False)
        return {"file": self.record["path"], "name": fn.name,
                "line": span["line"], "column": span["column"]}

    @cache
    def field(self, cls, name):
        init = self.member(cls, "__init__")
        if not init or init.decorator_list or not args(init) or name in self.bindings(cls)[0]:
            return None
        receiver = args(init)[0].arg
        writes = [n for n in ast.walk(cls) if isinstance(n, ast.Attribute)
                  and isinstance(n.ctx, (ast.Store, ast.Del)) and n.attr == name]
        if len(writes) == 1 and receiver_path(writes[0]) == (receiver, name):
            stmt = self.parents[writes[0]]
            if stmt in init.body and isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                return init, stmt
        return None

    @cache
    def writes(self, scope):
        writes = []
        for node in ast.walk(scope):
            if isinstance(node, (ast.Name, ast.Attribute)) and isinstance(node.ctx, (ast.Store, ast.Del)):
                bound = receiver_path(node)
            elif isinstance(node, ast.alias):
                bound = (node.asname or node.name.split(".")[0],)
            elif isinstance(node, (*FUNCTIONS, ast.ClassDef, ast.ExceptHandler)):
                bound = (node.name,) if node is not scope and node.name else ()
            elif isinstance(node, (ast.MatchAs, ast.MatchStar)):
                bound = (node.name,) if node.name else ()
            elif isinstance(node, ast.MatchMapping):
                bound = (node.rest,) if node.rest else ()
            else:
                continue
            if bound:
                writes.append(((node.lineno, node.col_offset), bound))
        return writes


def typing_subscription(expr, source, *types):
    if not isinstance(expr, ast.Subscript):
        return None
    head = expr.value
    name = head.id if isinstance(head, ast.Name) else head.attr if isinstance(head, ast.Attribute) else None
    if name not in types:
        return None
    scope = source.scope(expr)
    # Annotations are evaluated outside the annotated callable's local block.
    visible = source.scope(scope) if scope is not source.tree else scope
    path = head.value.id if isinstance(head, ast.Attribute) and isinstance(head.value, ast.Name) else name
    for node in source.tree.body:
        if isinstance(head, ast.Attribute) and path != name and isinstance(node, ast.Import):
            matched = any(a.name == "typing" and (a.asname or a.name) == path for a in node.names)
        elif isinstance(head, ast.Name) and isinstance(node, ast.ImportFrom):
            matched = node.level == 0 and node.module in ("typing", "collections.abc") and any(
                a.name == name and (a.asname or a.name) == path for a in node.names)
        else:
            continue
        writes, _ = source.bindings(source.tree)
        if matched and len(writes.get(path, [])) == 1 and "*" not in writes:
            if visible is source.tree or path not in source.bindings(visible)[0]:
                return expr.slice.elts if isinstance(expr.slice, ast.Tuple) else [expr.slice]
    return None


class ReceiverTypes:
    def __init__(self, source, lookup_class, lookup_function):
        self.source = source
        self.lookup_class = lookup_class
        self.lookup_function = lookup_function

    def annotation(self, source, node, scope, depth=0):
        if depth > 4 or node is None:
            return None
        head = node.value if isinstance(node, ast.Subscript) else node
        name = head.id if isinstance(head, ast.Name) else head.value if isinstance(head, ast.Constant) and isinstance(head.value, str) else None
        declared = source.local_type(name, scope) if name else None
        if isinstance(declared, TYPE_ALIAS):
            return self.annotation(source, declared.value, source.tree, depth + 1)
        owner = (source, declared) if isinstance(declared, ast.ClassDef) else self.lookup_class(source, head, scope)
        if owner is None:
            return None
        parameters = []
        if isinstance(node, ast.Subscript):
            arguments = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
            parameters = [self.annotation(source, a, scope, depth + 1) for a in arguments]
        return (*owner, parameters)

    def guard(self, test, expr, scope):
        if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.And):
            return next((t for part in test.values if (t := self.guard(part, expr, scope))), None)
        if not (isinstance(test, ast.Call) and isinstance(test.func, ast.Name) and test.func.id == "isinstance"
                and len(test.args) == 2 and not test.keywords and receiver_path(expr)
                and receiver_path(expr)[0] != "isinstance"
                and receiver_path(test.args[0]) == receiver_path(expr)
                and self.source.builtin("isinstance", scope)):
            return None
        annotation = test.args[1]
        if isinstance(annotation, ast.Attribute) and annotation.attr == "__class__":
            return self.instance(annotation.value, scope, annotation, 1)
        return self.annotation(self.source, annotation, scope)

    def narrowed(self, expr, scope, use):
        if narrowed := self.comprehension_type(expr, scope, use):
            return narrowed
        previous = use
        for parent in self.source.ancestors(use):
            if parent is scope or isinstance(parent, (ast.Lambda, ast.GeneratorExp, ast.ListComp)):
                break
            if isinstance(parent, ast.If) and previous in parent.body:
                if candidate := self.guard(parent.test, expr, scope):
                    if not self.reassigned(expr, parent, use, parent.test):
                        return candidate
            previous = parent
        for stmt in self.source.before(use, scope):
            if (isinstance(stmt, ast.If) and isinstance(stmt.test, ast.UnaryOp) and isinstance(stmt.test.op, ast.Not)
                    and not stmt.orelse and len(stmt.body) == 1 and isinstance(stmt.body[0], (ast.Raise, ast.Return))):
                if candidate := self.guard(stmt.test.operand, expr, scope):
                    if not self.reassigned(expr, scope, use, stmt):
                        return candidate
        return None

    def comprehension_type(self, expr, scope, use):
        if not isinstance(expr, ast.Name) or not isinstance(scope, FUNCTIONS):
            return None
        comp = next((n for n in self.source.ancestors(use) if isinstance(n, (ast.ListComp, ast.GeneratorExp))), None)
        if (not comp or len(comp.generators) != 1 or use not in ast.walk(comp.elt)
                or receiver_path(comp.generators[0].target) != (expr.id,)):
            return None
        loop = comp.generators[0]
        if narrowed := next((t for test in loop.ifs if (t := self.guard(test, expr, scope))), None):
            return narrowed
        if not isinstance(loop.iter, ast.Name):
            return None
        name = loop.iter.id
        if len(self.source.bindings(scope)[0].get(name, [])) != 1:
            return None
        # Keep the narrowed element type only for a filtered list whose uses
        # are confined to iteration. A call or alias can mutate its contents.
        for node in ast.walk(scope):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id == name:
                parent = self.source.parents[node]
                if not isinstance(parent, ast.comprehension) or parent.iter is not node:
                    return None
        for stmt in self.source.before(use, scope):
            if (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and receiver_path(stmt.targets[0]) == (name,)
                    and isinstance(stmt.value, ast.ListComp) and len(stmt.value.generators) == 1):
                producer = stmt.value.generators[0]
                if isinstance(stmt.value.elt, ast.Name) and receiver_path(producer.target) == receiver_path(stmt.value.elt):
                    return next((t for test in producer.ifs if (t := self.guard(test, stmt.value.elt, scope))), None)
        return None

    def reassigned(self, expr, block, use, after):
        path = receiver_path(expr)
        return any((after.end_lineno, after.end_col_offset) < position < (use.lineno, use.col_offset)
                   and (path[:len(written)] == written or written == ("*",))
                   for position, written in self.source.writes(block))

    def implicit_self(self, expr, scope):
        if isinstance(scope, FUNCTIONS) and args(scope) and args(scope)[0].arg == expr.id:
            owner = self.source.parents.get(scope)
            if isinstance(owner, ast.ClassDef) and not scope.decorator_list:
                return self.source, owner, []
        return None

    def parameter(self, expr, scope):
        params = args(scope) if hasattr(scope, "args") else []
        writes, declarations = self.source.bindings(scope)
        if expr.id in writes or expr.id in declarations:
            return None
        index = next((i for i, arg in enumerate(params) if arg.arg == expr.id), None)
        if index is None:
            return None
        if isinstance(scope, ast.Lambda):
            call = self.source.parents.get(scope)
            if isinstance(call, ast.Call) and scope in call.args and isinstance(call.func, ast.Attribute):
                if declared := self.lookup_function(self.source, call):
                    source, member = declared
                    position = call.args.index(scope) + 1
                    if (member.lineno, member.name) in source.owners and position < len(args(member)):
                        annotation = args(member)[position].annotation
                        if isinstance(annotation, ast.Name) and source.module_binding(annotation.id, source.scope(member)):
                            annotation = source.assignments.get(annotation.id, annotation)
                        signature = typing_subscription(annotation, source, "Callable")
                        if signature and isinstance(signature[0], ast.List) and index < len(signature[0].elts):
                            return self.annotation(source, signature[0].elts[index], source.tree)
            return None
        return self.annotation(self.source, params[index].annotation, self.source.scope(scope)) or self.implicit_self(expr, scope)

    def non_none(self, expr, scope, use):
        for stmt in self.source.before(use, scope):
            negative_exit = (isinstance(stmt, ast.If) and not stmt.orelse and len(stmt.body) == 1
                             and isinstance(stmt.body[0], (ast.Raise, ast.Return)))
            if not negative_exit and not isinstance(stmt, ast.Assert):
                continue
            test = stmt.test
            op = ast.Is if negative_exit else ast.IsNot
            if (isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], op)
                    and receiver_path(test.left) == (expr.id,) and isinstance(test.comparators[0], ast.Constant)
                    and test.comparators[0].value is None and not self.reassigned(expr, scope, use, stmt)):
                return True
        return False

    def tuple_member(self, expr, scope, use, call, index):
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)):
            return None
        declared = self.lookup_function(self.source, call)
        if not declared and (owner := self.narrowed(call.func.value, scope, call)):
            source, cls, _ = owner
            if member := source.member(cls, call.func.attr):
                declared = source, member
        if not declared:
            return None
        source, method = declared
        annotation = method.returns
        if not (isinstance(annotation, ast.Subscript) and isinstance(annotation.value, ast.Name)
                and annotation.value.id == "tuple" and source.builtin("tuple", source.scope(method))
                and isinstance(annotation.slice, ast.Tuple) and index < len(annotation.slice.elts)):
            return None
        item = annotation.slice.elts[index]
        if isinstance(item, ast.BinOp) and isinstance(item.op, ast.BitOr) and self.non_none(expr, scope, use):
            if isinstance(item.right, ast.Constant) and item.right.value is None:
                item = item.left
        return self.annotation(source, item, source.scope(method))

    def local_assignment(self, expr, scope, use, depth):
        if not isinstance(scope, FUNCTIONS) or expr.id in self.source.bindings(scope)[1]:
            return None
        for stmt in self.source.before(use, scope):
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], (ast.Tuple, ast.List)):
                parts = stmt.targets[0].elts
                indices = [i for i, part in enumerate(parts) if receiver_path(part) == (expr.id,)]
                if len(indices) == 1 and not any(isinstance(part, ast.Starred) for part in parts):
                    if not self.reassigned(expr, scope, use, stmt):
                        return self.tuple_member(expr, scope, use, stmt.value, indices[0])
                    return None
            if isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == expr.id for t in stmt.targets):
                if self.reassigned(expr, scope, use, stmt):
                    return None
                if isinstance(stmt.value, ast.Yield):
                    types = typing_subscription(scope.returns, self.source, "Generator", "AsyncGenerator")
                    return self.annotation(self.source, types[1], self.source.scope(scope)) if types and len(types) >= 2 else None
                return self.instance(stmt.value, scope, stmt, depth + 1)
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.target.id == expr.id:
                return None if self.reassigned(expr, scope, use, stmt) else self.annotation(self.source, stmt.annotation, scope)
        return None

    def instance(self, expr, scope, use, depth=0):
        if depth > 5:
            return None
        if isinstance(expr, ast.Name):
            return self.parameter(expr, scope) or self.local_assignment(expr, scope, use, depth)
        if isinstance(expr, ast.Attribute) and (owner := self.instance(expr.value, scope, use, depth + 1)):
            source, cls, _ = owner
            if field := source.field(cls, expr.attr):
                constructor, stmt = field
                if isinstance(stmt, ast.AnnAssign):
                    return self.annotation(source, stmt.annotation, source.scope(constructor))
                return ReceiverTypes(source, self.lookup_class, self.lookup_function).instance(stmt.value, constructor, stmt, depth + 1)
        if isinstance(expr, ast.Call):
            if direct := self.annotation(self.source, expr.func, scope):
                return direct
            if isinstance(expr.func, ast.Attribute):
                origin = self.instance(expr.func.value, scope, use, depth + 1)
                if origin:
                    source, cls, types = origin
                    method = source.member(cls, expr.func.attr)
                    if method and not method.decorator_list:
                        if types and isinstance(method.returns, ast.Name):
                            names = [p.name for p in getattr(cls, "type_params", [])]
                            if method.returns.id in names and len(names) == len(types) and not getattr(method, "type_params", []):
                                return types[names.index(method.returns.id)]
                        return self.annotation(source, method.returns, source.tree)
        return None

    def target(self, callee, previous):
        scope = self.source.scope(callee)
        proven = self.narrowed(callee.value, scope, callee)
        inferred = self.instance(callee.value, scope, callee) if previous is None else None
        if proven and (inferred is None or not self.derives_from(inferred, proven[1])):
            inferred = proven
        if inferred:
            source, cls, _ = inferred
            if member := source.member(cls, callee.attr):
                return source.target(member), inferred if proven else None
        return None, None

    def derives_from(self, receiver, owner, seen=None):
        source, cls, _ = receiver
        seen = set() if seen is None else seen
        if cls in seen:
            return False
        seen.add(cls)
        for base in cls.bases:
            resolved = self.annotation(source, base, source.scope(cls))
            if resolved is not None and (resolved[1] is owner or self.derives_from(resolved, owner, seen)):
                return True
        return False
