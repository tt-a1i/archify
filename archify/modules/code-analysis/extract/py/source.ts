// Declaration-oriented receiver analysis. Like Pyright, resolve names in their
// declaration modules and keep syntax, binding, member lookup and type shapes
// separate. Only a unique captured declaration becomes a navigation target.
// No target import, runtime dispatch, third-party type evaluator or stub engine.
import { ParseNode as Node, ParseNodeType as K } from './upstream/parser/parseNodes.js';
import { OperatorType as Op } from './upstream/parser/tokenizerTypes.js';
import { Analysis } from './collect.js';
import { Binding, Scope, typeParameters } from './bindings.js';
import { body, endOf, nameOf } from './facts.js';
import { parsePython, walk } from './syntax.js';

type File = Analysis & Required<Pick<Analysis, 'tree' | 'bindings' | 'measured' | 'context'>>;
type Shape = { kind: 'module'; file: File } | { kind: 'class'; file: File; node: Node; instance: boolean; args: Map<string, Shape> }
    | { kind: 'function'; file: File; node: Node; args: Map<string, Shape>; receiver?: Extract<Shape, { kind: 'class' }> };
type ClassShape = Extract<Shape, { kind: 'class' }>;
type FunctionShape = Extract<Shape, { kind: 'function' }>;
type Locate = (from: string, module: string, level: number, name?: string) => { file: string; module: boolean } | undefined;

export function resolveSourceCalls(analyses: Analysis[], locate: Locate) {
    const files = new Map(analyses.filter(analysis => analysis.tree).map(analysis => [analysis.record.path, analysis as File]));
    const classOf = (file: File, node: Node, instance = false, args = new Map<string, Shape>()): ClassShape => ({ kind: 'class', file, node, instance, args });
    const same = (a?: Shape, b?: Shape) => a && b && a.kind === b.kind && a.file === b.file && ('node' in a && 'node' in b ? a.node === b.node : a.kind === 'module');
    const scopeOf = (file: File, node: Node) => file.bindings.nodeScopes.get(node) || file.bindings.module;
    const unique = (scope: Scope, name: string) => {
        const values = scope.events.get(name)?.filter(value => !value.attributeWrite);
        return values?.length === 1 && !values[0].conditional ? values[0] : undefined;
    };
    const unshadowed = (scope: Scope, name: string) => {
        for (let current: Scope | undefined = scope; current; current = current.parent)
            if (current.events.has(name) || current.declarations.has(name) || current.events.has('*')) return false;
        return true;
    };
    const symbol = (file: File, scope: Scope, name: string, at: number, seen: Set<Node>, substitutions: Map<string, Shape>, importsLeft = 2): Shape | undefined => {
        if (substitutions.has(name)) return substitutions.get(name);
        if (scope.declarations.has(name) || scope.events.has('*') || file.bindings.mutable.has(name) || name === '__class__') return;
        const values = scope.events.get(name)?.filter(value => !value.attributeWrite);
        if (values?.length) {
            const value = unique(scope, name);
            if (!value) return;
            if (value.kind === 'class') return !(value.node.d as any).decorators.length || knownDecorators(file, value.node, ['dataclass']) ? classOf(file, value.node) : undefined;
            if (value.kind === 'function') {
                if (scope.kind !== 'module' && value.at > at) return;
                if (!(value.node.d as any).decorators.length || knownDecorators(file, value.node, ['contextmanager', 'asynccontextmanager']))
                    return { kind: 'function', file, node: value.node, args: substitutions };
                return;
            }
            if (value.kind === 'import' || value.kind === 'module') {
                if (value.kind === 'import' && !importsLeft) return;
                if (scope.kind !== 'module' && (scope.kind !== 'function' || value.at > at)) return;
                const module = value.kind === 'module' && value.imported !== '*' ? value.imported! : value.module!;
                const target = locate(file.record.path, module, value.level || 0, value.kind === 'import' ? value.imported : undefined);
                const other = target && files.get(target.file);
                if (!target || !other || seen.has(value.node)) return;
                if (target.module) return { kind: 'module', file: other };
                return symbol(other, other.bindings.module, value.imported!, Infinity, new Set([...seen, value.node]), new Map(), importsLeft - 1);
            }
            if (value.annotation) return annotation(file, scope, value.annotation, at, seen, substitutions);
            if (value.kind === 'parameter') {
                const method = scope.node;
                const parameters = (method.d as any).params || [];
                if (parameters[0] === value.node) {
                    let owner = method.parent;
                    while (owner && ![K.Function, K.Class].includes(owner.nodeType)) owner = owner.parent;
                    if (owner?.nodeType === K.Class && (!(method.d as any).decorators.length || knownDecorators(file, method, ['classmethod', 'contextmanager', 'asynccontextmanager'])))
                        return classOf(file, owner, !knownDecorators(file, method, ['classmethod']));
                }
                return;
            }
            if (value.expr && value.at <= at && !seen.has(value.node)) return expression(file, scope, value.expr, at, new Set([...seen, value.node]), substitutions);
            return;
        }
        return scope.parent ? symbol(file, scope.parent, name, at, seen, substitutions, importsLeft) : undefined;
    };
    function knownDecorators(file: File, node: Node, allowed: string[]) {
        const decorators: Node[] = (node.d as any).decorators || [];
        return decorators.length > 0 && decorators.every(decorator => {
            const expr = (decorator.d as any).expr;
            if (expr.nodeType !== K.Name) return false;
            const name = expr.d.value, scope = scopeOf(file, node);
            const binding = file.bindings.lookup(scope, name, node.start);
            if (['classmethod', 'staticmethod', 'property'].includes(name) && allowed.includes(name))
                return unshadowed(scope, name);
            return binding?.kind === 'import' && !binding.level && allowed.includes(binding.imported!)
                && ((binding.module === 'contextlib' && ['contextmanager', 'asynccontextmanager'].includes(binding.imported!))
                    || (binding.module === 'dataclasses' && binding.imported === 'dataclass'));
        });
    }
    function annotation(file: File, scope: Scope, node: Node | undefined, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
        if (!node) return;
        if (node.nodeType === K.StringList && node.d.strings.every(part => part.nodeType === K.String)) {
            const text = node.d.strings.map(part => (part.d as any).value).join('');
            const parsed = parsePython(`_annotation: ${text}`);
            const statement = (parsed.parserOutput.parseTree.d.statements[0] as any)?.d.statements?.[0];
            return !parsed.errors.length && statement?.nodeType === K.TypeAnnotation ? annotation(file, scope, statement.d.annotation, at, seen, substitutions) : undefined;
        }
        if (node.nodeType === K.Index) {
            const base = expression(file, scope, node.d.leftExpr, at, seen, substitutions);
            if (base?.kind !== 'class') return;
            const args = new Map(base.args);
            const params = typeParameters(base.node);
            for (let i = 0; i < params.length; i++) {
                const value = node.d.items[i] && annotation(file, scope, node.d.items[i].d.valueExpr, at, seen, substitutions);
                if (value) args.set((params[i].d as any).name.d.value, value);
            }
            return { ...base, instance: true, args };
        }
        if (node.nodeType === K.BinaryOperation && node.d.operator === Op.BitwiseOr) return; // ambiguous union
        const value = expression(file, scope, node, at, seen, substitutions);
        return value?.kind === 'class' ? { ...value, instance: true } : undefined;
    }
    function bases(owner: ClassShape, seen: Set<Node>): ClassShape[] | undefined {
        const out: ClassShape[] = [];
        for (const arg of (owner.node.d as any).arguments || []) {
            if (arg.d.name) return; // custom metaclass / class keywords
            let expr = arg.d.valueExpr;
            if (expr.nodeType === K.Index) expr = expr.d.leftExpr;
            const base = expression(owner.file, scopeOf(owner.file, owner.node), expr, owner.node.start, seen, owner.args);
            if (base?.kind === 'class') out.push(base);
            else if (!(expr.nodeType === K.Name && expr.d.value === 'object' && !owner.file.bindings.module.events.has('object'))) return;
        }
        return out;
    }
    // C3 merge: an unresolved/cyclic/inconsistent hierarchy is unknown. Do not
    // pick the first matching base and silently invent an inherited target.
    function mro(owner: ClassShape, active = new Set<Node>()): ClassShape[] | undefined {
        if (active.has(owner.node) || active.size > 32) return;
        const direct = bases(owner, new Set([...active, owner.node]));
        if (!direct) return;
        const lists: ClassShape[][] = [];
        for (const base of direct) { const order = mro(base, new Set([...active, owner.node])); if (!order) return; lists.push(order); }
        lists.push([...direct]); const result = [owner];
        while (lists.some(list => list.length)) {
            const head = lists.map(list => list[0]).find(candidate => candidate && !lists.some(list => list.slice(1).some(other => same(candidate, other))));
            if (!head) return;
            result.push(head); for (const list of lists) if (same(list[0], head)) list.shift();
        }
        return result;
    }
    function member(owner: ClassShape, name: string, at: number, seen: Set<Node>): Shape | undefined {
        if (name.startsWith('__') && !name.endsWith('__')) return;
        const own = fileMember(owner, name, at, seen);
        if (own.present) return own.value;
        // A declaration directly in the first base precedes all later bases in
        // every consistent C3 order. Its own external bases need not be loaded.
        const arguments_ = (owner.node.d as any).arguments || [];
        if (arguments_.length && arguments_.every((arg: Node) => !(arg.d as any).name)) {
            let expr = arguments_[0].d.valueExpr;
            if (expr.nodeType === K.Index) expr = expr.d.leftExpr;
            const base = expression(owner.file, scopeOf(owner.file, owner.node), expr, owner.node.start, seen, owner.args);
            if (base?.kind === 'class') {
                const value = fileMember({ ...base, instance: owner.instance }, name, at, seen);
                if (value.present) return value.value;
            }
        }
        const hierarchy = mro(owner);
        if (!hierarchy) return;
        for (const base of hierarchy.slice(1)) { const value = fileMember({ ...base, instance: owner.instance }, name, at, seen); if (value.present) return value.value; }
        return;
    }
    function fileMember(owner: ClassShape, name: string, at: number, seen: Set<Node>): { present: boolean; value?: Shape } {
        const file = owner.file, scope = file.bindings.scopes.get(owner.node)!;
        const writes: Binding[] = [];
        // Instance assignments override a method declaration. A same-spelled
        // assignment in another class has no effect on this receiver.
        for (const candidate of file.bindings.scopes.values()) {
            let parent = candidate.node.parent;
            while (parent && ![K.Function, K.Class].includes(parent.nodeType)) parent = parent.parent;
            if (parent !== owner.node) continue;
            const first = (candidate.node.d as any).params?.[0]?.d.name?.d.value;
            for (const event of candidate.events.get(first) || []) if (event.attributeWrite === name) writes.push(event);
        }
        const entries = scope.events.get(name)?.filter(value => !value.attributeWrite) || [];
        if (writes.length) {
            if (entries.some(entry => entry.kind === 'function') || writes.length !== 1 || writes[0].conditional) return { present: true };
            const assignment = writes[0].node;
            if (assignment.nodeType !== K.Assignment) return { present: true };
            const expr = (assignment.d as any).rightExpr;
            return { present: true, value: writes[0].annotation ? annotation(file, scopeOf(file, assignment), writes[0].annotation, endOf(assignment), seen, owner.args)
                : expr && expression(file, scopeOf(file, assignment), expr, endOf(assignment), seen, owner.args) };
        }
        if (!entries.length) return { present: false };
        const value = unique(scope, name);
        if (!value) return { present: true };
        if (value.kind === 'function') {
            const decorators = (value.node.d as any).decorators;
            if (decorators.length && !knownDecorators(file, value.node, ['property', 'classmethod', 'staticmethod', 'contextmanager', 'asynccontextmanager'])) return { present: true };
            const fn: FunctionShape = { kind: 'function', file, node: value.node, args: owner.args, receiver: owner };
            return { present: true, value: knownDecorators(file, value.node, ['property']) ? returns(fn, [], at, seen) : fn };
        }
        return { present: true, value: value.annotation ? annotation(file, scope, value.annotation, at, seen, owner.args)
            : value.expr ? expression(file, scope, value.expr, at, seen, owner.args) : undefined };
    }
    function returns(fn: FunctionShape, args: Shape[], at: number, seen: Set<Node>): Shape | undefined {
        const d = fn.node.d as any, substitutions = new Map(fn.args);
        const params: Node[] = d.params || [];
        const offset = fn.receiver && !knownDecorators(fn.file, fn.node, ['staticmethod']) ? 1 : 0;
        const names = new Set(typeParameters(fn.node).map(node => (node.d as any).name.d.value));
        for (let i = offset; i < params.length; i++) {
            const param = params[i].d as any, name = nameOf(param.annotation);
            if (name && names.has(name) && args[i - offset]) substitutions.set(name, args[i - offset]);
        }
        if (d.returnAnnotation) return annotation(fn.file, scopeOf(fn.file, fn.node), d.returnAnnotation, at, seen, substitutions);
        return;
    }
    function expression(file: File, scope: Scope, node: Node, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
        if (seen.has(node) || seen.size > 64) return;
        seen = new Set([...seen, node]);
        const d = node.d as any;
        if (node.nodeType === K.Name) {
            // Positive isinstance narrowing only, with an unshadowed builtin
            // and no intervening writes to the narrowed name.
            for (let parent = node.parent; parent; parent = parent.parent) {
                if (parent.nodeType !== K.If || node.start < parent.d.ifSuite.start || endOf(node) > endOf(parent.d.ifSuite)) continue;
                const test = parent.d.testExpr;
                if (test.nodeType === K.Call && nameOf(test.d.leftExpr) === 'isinstance' && nameOf(test.d.args[0]?.d.valueExpr) === d.value
                    && test.d.args.length === 2 && test.d.args.every(arg => !arg.d.name && arg.d.argCategory === 0) && unshadowed(scope, 'isinstance')) {
                    const events = scope.events.get(d.value)?.filter(value => !value.attributeWrite) || [];
                    if (events.length === 1 && events[0].kind === 'parameter') return annotation(file, scope, test.d.args[1]?.d.valueExpr, at, seen, substitutions);
                }
            }
            return symbol(file, scope, d.value, at, seen, substitutions);
        }
        if (node.nodeType === K.Index) return annotation(file, scope, node, at, seen, substitutions);
        if (node.nodeType === K.MemberAccess) {
            const left = expression(file, scope, d.leftExpr, at, seen, substitutions);
            if (left?.kind === 'module') {
                const value = symbol(left.file, left.file.bindings.module, d.member.d.value, Infinity, seen, new Map());
                if (value || left.file.bindings.module.events.has(d.member.d.value) || !left.file.record.path.endsWith('__init__.py')) return value;
                const target = locate(left.file.record.path, '', 1, d.member.d.value), other = target && files.get(target.file);
                return target?.module && other ? { kind: 'module', file: other } : undefined;
            }
            if (left?.kind === 'class') return member(left, d.member.d.value, at, seen);
            return;
        }
        if (node.nodeType === K.Call) {
            const callee = expression(file, scope, d.leftExpr, at, seen, substitutions);
            const args = d.args.map((arg: Node) => expression(file, scope, (arg.d as any).valueExpr, at, seen, substitutions));
            if (callee?.kind === 'class') return { ...callee, instance: true };
            if (callee?.kind === 'function') return returns(callee, args, at, seen);
        }
        return;
    }
    let added = 0;
    for (const file of files.values()) {
        const calls = [...walk(file.tree)].filter(node => node.nodeType === K.Call)
            .sort((a, b) => a.start - b.start || endOf(a) - endOf(b));
        for (let i = 0; i < calls.length; i++) {
            const node = calls[i], fact = file.record.calls[i];
            if (fact.target || file.bindings.suppressed.has(node)) continue;
            const callee = (node.d as any).leftExpr;
            // Ordinary direct/import calls retain their existing evidence and
            // execution guards. Extend only member paths and nested functions.
            if (callee.nodeType !== K.MemberAccess && callee.nodeType !== K.Name) continue;
            const scope = scopeOf(file, node);
            if (callee.nodeType === K.Name && !(unique(scope, callee.d.value)?.kind === 'function' && scope.kind === 'function')) continue;
            const target = expression(file, scope, callee, node.start, new Set(), new Map());
            if (target?.kind !== 'function') continue;
            const fn = target.file.measured.byNode.get(target.node);
            if (!fn) continue;
            fact.resolution = 'python-source-declaration'; delete fact.reason; delete fact._import;
            fact.target = { file: target.file.record.path, name: fn.name, line: fn.line, column: fn.sourceRange.column }; added++;
        }
    }
    return { added };
}
