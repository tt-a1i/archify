"""Python source call inventory and deliberately bounded lexical targets.

No target code is imported. Binding events cover a complete block before lookup;
only unique direct module definitions/from-imports can supply targets.
"""
import ast
from ast_walk import AnalysisVisitor
import hashlib
import functools
import re


@functools.lru_cache(maxsize=1)
def source_lines(text):
    parts = re.split(r'(\r\n|\r|\n)', text)
    lines = [parts[i] + (parts[i + 1] if i + 1 < len(parts) else '') for i in range(0, len(parts), 2)]
    offsets, at = [], 0
    for line in lines:
        offsets.append(at)
        at += len(line)
    return lines, offsets


def source_range(node, text, digest=True):
    lines, offsets = source_lines(text)
    def prefix(line, byte):
        return lines[line - 1].encode('utf-8')[:byte].decode('utf-8')
    start = prefix(node.lineno, node.col_offset)
    end = prefix(node.end_lineno, node.end_col_offset)
    a = offsets[node.lineno - 1] + len(start)
    b = offsets[node.end_lineno - 1] + len(end)
    result = {'line': node.lineno, 'column': len(start.encode('utf-16-le')) // 2 + 1,
              'endLine': node.end_lineno, 'endColumn': len(end.encode('utf-16-le')) // 2 + 1}
    if digest:
        result['sha256'] = hashlib.sha256(text[a:b].encode('utf-8')).hexdigest()
    return result


def events(nodes, module=False):
    found, declarations = {}, set()
    class Scan(AnalysisVisitor):
        conditional = False
        def bind(self, name, value=None):
            found.setdefault(name, []).append(None if self.conditional else value)
        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                self.bind(node.id)
        def visit_FunctionDef(self, node):
            self.bind(node.name, {'kind': 'local', 'node': node} if module and not node.decorator_list else None)
            for value in node.decorator_list + node.args.defaults + [x for x in node.args.kw_defaults if x]:
                self.visit(value)
        visit_AsyncFunctionDef = visit_FunctionDef
        def visit_ClassDef(self, node):
            self.bind(node.name)
            for value in node.decorator_list + node.bases + node.keywords:
                self.visit(value)
        def visit_Lambda(self, node):
            for value in node.args.defaults + [x for x in node.args.kw_defaults if x]:
                self.visit(value)
        def visit_Import(self, node):
            for alias in node.names:
                self.bind(alias.asname or alias.name.split('.')[0])
        def visit_ImportFrom(self, node):
            for alias in node.names:
                value = {'kind': 'import', 'module': node.module or '', 'level': node.level,
                         'name': alias.name, 'line': node.lineno} if module and alias.name != '*' else None
                self.bind(alias.asname or alias.name, value)
        def visit_Global(self, node):
            declarations.update(node.names)
        visit_Nonlocal = visit_Global
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
        def conditional_block(self, node):
            previous = self.conditional
            self.conditional = True
            self.generic_visit(node)
            self.conditional = previous
        visit_If = conditional_block
        visit_Try = conditional_block
        visit_TryStar = conditional_block
        visit_For = conditional_block
        visit_AsyncFor = conditional_block
        visit_While = conditional_block
        visit_With = conditional_block
        visit_AsyncWith = conditional_block
        visit_Match = conditional_block
        def comprehension(self, node):
            # Only assignment expressions escape the comprehension's local block.
            for child in ast.walk(node):
                if isinstance(child, ast.NamedExpr):
                    self.visit(child.target)
        visit_ListComp = comprehension
        visit_SetComp = comprehension
        visit_DictComp = comprehension
        visit_GeneratorExp = comprehension
    scan = Scan()
    for node in nodes:
        scan.visit(node)
    return found, declarations


def collect_calls(tree, text):
    module_events, _ = events(tree.body, module=True)
    # Explicit global/nonlocal names stay outside this model, including class writers.
    mutable = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            mutable.update(node.names)
    candidates = {name: values[0] for name, values in module_events.items()
                  if len(values) == 1 and values[0] and name not in mutable and name != '__class__'}
    if '*' in module_events:
        candidates = {}
    definitions = {}
    for name, candidate in candidates.items():
        if candidate['kind'] == 'local':
            node = candidate['node']
            definitions[name] = {'name': name, **source_range(node, text)}

    class Scope:
        def __init__(self, nodes, parent=None, params=(), kind='function', unsupported=False):
            self.events, self.declarations = events(nodes)
            self.names = set(self.events).union(params)
            self.parent, self.kind, self.unsupported = parent, kind, unsupported
        def lookup(self, name):
            if self.unsupported or name in self.declarations or '*' in self.events:
                return None
            if self.kind == 'module':
                return candidates.get(name)
            if name in self.names:
                return None
            return self.parent.lookup(name) if self.parent else None

    bindings = {}
    class Visit(AnalysisVisitor):
        scope = Scope(tree.body, kind='module')
        suppressed = False
        private = False
        def body(self, nodes, scope):
            previous = self.scope
            self.scope = scope
            for node in nodes:
                self.visit(node)
            self.scope = previous
        def annotations(self, nodes):
            previous = self.suppressed
            self.suppressed = True
            for node in nodes:
                self.visit(node)
            self.suppressed = previous
        def function(self, node, body):
            for value in getattr(node, 'decorator_list', []) + node.args.defaults + [x for x in node.args.kw_defaults if x]:
                self.visit(value)
            args = node.args.posonlyargs + node.args.args + node.args.kwonlyargs
            args += [x for x in (node.args.vararg, node.args.kwarg) if x]
            self.annotations([x.annotation for x in args if x.annotation] + ([node.returns] if getattr(node, 'returns', None) else []) + getattr(node, 'type_params', []))
            parent = self.scope
            unsupported = bool(getattr(node, 'type_params', []))
            while parent and parent.kind == 'class':
                unsupported = unsupported or parent.unsupported
                parent = parent.parent
            self.body(body, Scope(body, parent, [a.arg for a in args], unsupported=unsupported))
        def visit_FunctionDef(self, node):
            self.function(node, node.body)
        visit_AsyncFunctionDef = visit_FunctionDef
        def visit_Lambda(self, node):
            self.function(node, [node.body])
        def visit_ClassDef(self, node):
            for value in node.decorator_list:
                self.visit(value)
            if getattr(node, 'type_params', []):
                # PEP 695 bases/keywords see the class type parameters, while
                # decorators still evaluate in the containing scope.
                self.annotations(node.bases + node.keywords + node.type_params)
            else:
                for value in node.bases + node.keywords:
                    self.visit(value)
            previous = self.private
            self.private = True
            self.body(node.body, Scope(node.body, self.scope, kind='class', unsupported=bool(getattr(node, 'type_params', []))))
            self.private = previous
        def visit_AnnAssign(self, node):
            self.annotations([node.annotation])
            if node.value:
                self.visit(node.value)
            self.visit(node.target)
        def visit_TypeAlias(self, node):
            self.annotations([node.value] + getattr(node, 'type_params', []))
        def comprehension(self, node):
            self.visit(node.generators[0].iter)
            parts = [part for g in node.generators for part in [g.target, *g.ifs]]
            parts += [g.iter for g in node.generators[1:]]
            parts += [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
            parent = self.scope
            unsupported = False
            while parent and parent.kind == 'class':
                unsupported = unsupported or parent.unsupported
                parent = parent.parent
            self.body(parts, Scope(parts, parent, unsupported=unsupported))
        visit_ListComp = comprehension
        visit_SetComp = comprehension
        visit_DictComp = comprehension
        visit_GeneratorExp = comprehension
        def visit_Call(self, node):
            mangled = isinstance(node.func, ast.Name) and self.private and node.func.id.startswith('__') and not node.func.id.endswith('__')
            if isinstance(node.func, ast.Name) and not self.suppressed and not mangled:
                bindings[id(node)] = self.scope.lookup(node.func.id)
            self.generic_visit(node)
    Visit().visit(tree)
    records = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        span = source_range(node, text, digest=False)
        record = {**span, 'resolution': 'unresolved', 'reason': 'unsupported-callee' if not isinstance(node.func, ast.Name) else 'no-local-function-binding'}
        candidate = bindings.get(id(node))
        if candidate:
            if candidate['kind'] == 'local':
                target = definitions[node.func.id]
                record = {**span, 'resolution': 'same-file-function', 'target': {k: target[k] for k in ('name', 'line', 'column')}}
            else:
                record['_import'] = candidate
        records.append(record)
    return sorted(records, key=lambda x: (x['line'], x['column'], x['endLine'], x['endColumn'])), definitions
