"""Conservative lexical bindings for Python's standard dynamic import loaders."""
import ast


def binding_events(nodes):
    events = {}
    declarations = {}

    class Scan(ast.NodeVisitor):
        conditional = False

        def bind(self, name, value=None):
            events.setdefault(name, []).append(None if self.conditional else value)

        def visit_If(self, node):
            previous = self.conditional
            self.conditional = True
            self.generic_visit(node)
            self.conditional = previous

        visit_Try = visit_If
        visit_TryStar = visit_If
        visit_For = visit_If
        visit_AsyncFor = visit_If
        visit_While = visit_If

        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                self.bind(node.id)

        def visit_Attribute(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)) and isinstance(node.value, ast.Name):
                self.bind(node.value.id)
            self.generic_visit(node)

        def visit_Import(self, node):
            for alias in node.names:
                self.bind(alias.asname or alias.name.split('.')[0],
                          'importlib' if alias.name == 'importlib' else None)

        def visit_ImportFrom(self, node):
            for alias in node.names:
                self.bind(alias.asname or alias.name,
                          'loader' if node.module == 'importlib' and not node.level and alias.name == 'import_module' else None)

        def visit_FunctionDef(self, node):
            self.bind(node.name)

        visit_AsyncFunctionDef = visit_FunctionDef
        visit_ClassDef = visit_FunctionDef

        def visit_Lambda(self, node):
            pass

        visit_ListComp = visit_Lambda
        visit_SetComp = visit_Lambda
        visit_DictComp = visit_Lambda
        visit_GeneratorExp = visit_Lambda

        def visit_Global(self, node):
            declarations.update((name, 'global') for name in node.names)

        def visit_Nonlocal(self, node):
            declarations.update((name, 'nonlocal') for name in node.names)

        def visit_ExceptHandler(self, node):
            if node.name:
                self.bind(node.name)
            self.generic_visit(node)

        def visit_MatchAs(self, node):
            if node.name:
                self.bind(node.name)
            self.generic_visit(node)

        visit_MatchStar = visit_MatchAs

        def visit_MatchMapping(self, node):
            if node.rest:
                self.bind(node.rest)
            self.generic_visit(node)

    scan = Scan()
    for node in nodes:
        scan.visit(node)
    return events, declarations


def standard_loader_calls(tree):
    """Recognize only known loader bindings; uncertainty must not invent edges.

    Eager module/class statements use binding order. Deferred bodies see only
    stable enclosing bindings, since their eventual call time is unknown.
    """
    found = set()
    # A nested global/nonlocal writer may run before a deferred loader call.
    mutable = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            events, declarations = binding_events(node.body)
            mutable.update(set(declarations).intersection(events))

    class Scope:
        def __init__(self, nodes, parent=None, parameters=(), function=False):
            self.parent = parent
            self.function = function
            self.events, self.declarations = binding_events(nodes)
            self.current = {name: None for name in self.events} if function else {}
            self.current.update({name: None for name in parameters})
            self.stable = {name: values[0] if len(values) == 1 else None
                           for name, values in self.events.items()}
            self.stable.update({name: None for name in parameters})

        def lookup(self, name, deferred=False):
            if '*' in self.events:
                return None
            values = self.stable if deferred else self.current
            if name in values:
                return None if deferred and name in mutable else values[name]
            if self.parent:
                if self.declarations.get(name) == 'global':
                    parent = self.parent
                    while parent.parent:
                        parent = parent.parent
                    return parent.lookup(name, True)
                return self.parent.lookup(name, deferred or self.function)
            return 'loader' if name == '__import__' and name not in mutable else None

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.scope = Scope(tree.body)
            self.conditional = False

        def bind(self, name, value=None):
            self.scope.current[name] = None if self.conditional else value

        def body(self, nodes, scope):
            previous, conditional = self.scope, self.conditional
            self.scope, self.conditional = scope, False
            for node in nodes:
                self.visit(node)
            self.scope, self.conditional = previous, conditional

        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                self.bind(node.id)

        def visit_Attribute(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)) and isinstance(node.value, ast.Name):
                self.bind(node.value.id)
            self.generic_visit(node)

        def visit_Import(self, node):
            for alias in node.names:
                self.bind(alias.asname or alias.name.split('.')[0],
                          'importlib' if alias.name == 'importlib' else None)

        def visit_ImportFrom(self, node):
            for alias in node.names:
                self.bind(alias.asname or alias.name,
                          'loader' if node.module == 'importlib' and not node.level and alias.name == 'import_module' else None)

        def visit_Assign(self, node):
            self.visit(node.value)
            for target in node.targets:
                self.visit(target)

        def visit_AnnAssign(self, node):
            if node.value:
                self.visit(node.value)
                self.visit(node.target)

        def visit_NamedExpr(self, node):
            self.visit(node.value)
            self.visit(node.target)

        def function(self, node, body):
            for parameter in getattr(node, 'type_params', []):
                self.visit(parameter)
            for value in node.args.defaults + [d for d in node.args.kw_defaults if d] + getattr(node, 'decorator_list', []):
                self.visit(value)
            args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
            args += [a for a in (node.args.vararg, node.args.kwarg) if a]
            for annotation in [a.annotation for a in args if a.annotation] + ([node.returns] if getattr(node, 'returns', None) else []):
                self.visit(annotation)
            if hasattr(node, 'name'):
                self.bind(node.name)
            parent = self.scope
            # Methods do not close over their class namespace.
            if getattr(parent, 'is_class', False):
                parent = parent.parent
            self.body(body, Scope(body, parent, [a.arg for a in args], function=True))

        def visit_FunctionDef(self, node):
            self.function(node, node.body)

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Lambda(self, node):
            self.function(node, [node.body])

        def visit_ClassDef(self, node):
            for parameter in getattr(node, 'type_params', []):
                self.visit(parameter)
            for value in node.decorator_list + node.bases + node.keywords:
                self.visit(value)
            scope = Scope(node.body, self.scope)
            scope.is_class = True
            self.body(node.body, scope)
            self.bind(node.name)

        def visit_If(self, node):
            self.visit(node.test)
            previous = self.conditional
            self.conditional = True
            for child in node.body + node.orelse:
                self.visit(child)
            self.conditional = previous

        def visit_Try(self, node):
            previous = self.conditional
            self.conditional = True
            self.generic_visit(node)
            self.conditional = previous

        visit_TryStar = visit_Try
        visit_For = visit_Try
        visit_AsyncFor = visit_Try
        visit_While = visit_Try

        def visit_ExceptHandler(self, node):
            if node.name:
                self.bind(node.name)
            self.generic_visit(node)

        def visit_MatchAs(self, node):
            if node.name:
                self.bind(node.name)
            self.generic_visit(node)

        visit_MatchStar = visit_MatchAs

        def visit_MatchMapping(self, node):
            if node.rest:
                self.bind(node.rest)
            self.generic_visit(node)

        def comprehension(self, node):
            self.visit(node.generators[0].iter)
            nodes = [part for g in node.generators for part in [g.target, *g.ifs]]
            nodes += [g.iter for g in node.generators[1:]]
            nodes += [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
            self.body(nodes, Scope(nodes, self.scope, function=True))

        visit_ListComp = comprehension
        visit_SetComp = comprehension
        visit_DictComp = comprehension
        visit_GeneratorExp = comprehension

        def visit_Call(self, node):
            func = node.func
            if (isinstance(func, ast.Name) and self.scope.lookup(func.id) == 'loader') or (
                isinstance(func, ast.Attribute) and func.attr == 'import_module'
                and isinstance(func.value, ast.Name) and self.scope.lookup(func.value.id) == 'importlib'
            ):
                found.add(id(node))
            self.generic_visit(node)

    Visitor().visit(tree)
    return found
