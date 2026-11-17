// Declaration-oriented receiver analysis. Like Pyright, resolve names in their
// declaration modules and keep syntax, binding, member lookup and type shapes
// separate. Only a unique captured declaration becomes a navigation target.
// No target import, runtime dispatch, third-party type evaluator or stub engine.
import { ParseNode as Node, ParseNodeType as K } from './upstream/parser/parseNodes.js';
import { OperatorType as Op, KeywordType } from './upstream/parser/tokenizerTypes.js';
import { Analysis } from './collect.js';
import { Binding, Scope, typeParameters } from './bindings.js';
import { endOf, nameOf } from './facts.js';
import { parsePython, walk } from './syntax.js';
import { reachingBindings } from './flow.js';

type File = Analysis & Required<Pick<Analysis, 'tree' | 'bindings' | 'measured' | 'context'>>;
type Shape = { kind: 'module'; file: File } | { kind: 'class'; file: File; node: Node; instance: boolean; args: Map<string, Shape> }
    | { kind: 'function'; file: File; node: Node; args: Map<string, Shape>; receiver?: ClassShape }
    | { kind: 'sequence'; item?: Shape; async?: boolean; send?: Shape; generator?: boolean }
    | { kind: 'tuple'; items: (Shape | undefined)[] }
    | { kind: 'mapping'; key?: Shape; value?: Shape }
    | { kind: 'awaitable'; item?: Shape } | { kind: 'context'; item?: Shape; async?: boolean }
    | { kind: 'union'; items: Shape[] }
    | { kind: 'none' | 'unknown' };
type ClassShape = Extract<Shape, { kind: 'class' }>;
type FunctionShape = Extract<Shape, { kind: 'function' }>;
type Locate = (from: string, module: string, level: number, name?: string) => { file: string; module: boolean } | undefined;

export function resolveSourceCalls(analyses: Analysis[], locate: Locate) {
    const files = new Map(analyses.filter(analysis => analysis.tree).map(analysis => [analysis.record.path, analysis as File]));
    const classOf = (file: File, node: Node, instance = false, args = new Map<string, Shape>()): ClassShape => ({ kind: 'class', file, node, instance, args });
    const same = (a?: Shape, b?: Shape, depth = 0): boolean => {
        if (!a || !b) return a === b;
        if (a.kind !== b.kind || depth > 16) return false;
        if ('file' in a && 'file' in b) return a.file === b.file && ('node' in a && 'node' in b ? a.node === b.node
            && a.args.size === b.args.size && [...a.args].every(([name, value]) => same(value, b.args.get(name), depth + 1)) : a.kind === 'module');
        if ('items' in a && 'items' in b) return a.items.length === b.items.length && a.items.every((value, i) => same(value, b.items[i], depth + 1));
        if (a.kind === 'mapping' && b.kind === 'mapping') return same(a.key, b.key, depth + 1) && same(a.value, b.value, depth + 1);
        if (a.kind === 'sequence' && b.kind === 'sequence') return Boolean(a.async) === Boolean(b.async) && Boolean(a.generator) === Boolean(b.generator) && same(a.item, b.item, depth + 1) && same(a.send, b.send, depth + 1);
        if (a.kind === 'context' && b.kind === 'context') return Boolean(a.async) === Boolean(b.async) && same(a.item, b.item, depth + 1);
        if ('item' in a && 'item' in b) return same(a.item, b.item, depth + 1);
        return a.kind === 'none' || a.kind === 'unknown';
    };
    const union = (values: (Shape | undefined)[]): Shape | undefined => {
        const items: Shape[] = [];
        for (const value of values) for (const item of value?.kind === 'union' ? value.items : [value || { kind: 'unknown' } as Shape])
            if (!items.some(other => same(item, other))) items.push(item);
        return items.length === 1 ? items[0] : items.length ? { kind: 'union', items } : undefined;
    };
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
    const activeFields: { owner: ClassShape; name: string; value?: Shape }[] = [];
    const symbol = (file: File, scope: Scope, name: string, at: number, seen: Set<Node>, substitutions: Map<string, Shape>, importsLeft = 2, origin = scope): Shape | undefined => {
        if (substitutions.has(name)) return substitutions.get(name);
        if (scope.declarations.has(name) || scope.events.has('*') || file.bindings.mutable.has(name) || name === '__class__') return;
        const values = scope.events.get(name)?.filter(value => !value.attributeWrite);
        if (values?.length) {
            const value = unique(scope, name);
            if (scope.kind === 'function' && scope === origin && values.every(value => ['value', 'parameter'].includes(value.kind))) {
                return union(reachingBindings(scope, name, at).values.map(value => value && bindingShape(file, scope, value, at, seen, substitutions)));
            }
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
                if (scope.kind !== 'module' && (scope !== origin || scope.kind !== 'function' || value.at > at)) return;
                const module = value.kind === 'module' && value.imported !== '*' ? value.imported! : value.module!;
                const target = locate(file.record.path, module, value.level || 0, value.kind === 'import' ? value.imported : undefined);
                const other = target && files.get(target.file);
                if (!target || !other || seen.has(value.node)) return;
                if (target.module) return { kind: 'module', file: other };
                return symbol(other, other.bindings.module, value.imported!, Infinity, new Set([...seen, value.node]), new Map(), importsLeft - 1);
            }
            return bindingShape(file, scope, value, at, seen, substitutions);
        }
        return scope.parent ? symbol(file, scope.parent, name, at, seen, substitutions, importsLeft, origin) : undefined;
    };
    function bindingShape(file: File, scope: Scope, value: Binding, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
            if (seen.has(value.node)) return;
            const next = new Set([...seen, value.node]);
            if (value.annotation) return annotation(file, scope, value.annotation, value.at, next, substitutions);
            if (value.kind === 'parameter') {
                const method = scope.node;
                const parameters = (method.d as any).params || [];
                if (parameters[0] === value.node) {
                    let owner = method.parent;
                    while (owner && ![K.Function, K.Class].includes(owner.nodeType)) owner = owner.parent;
                    if (owner?.nodeType === K.Class && (!(method.d as any).decorators.length || knownDecorators(file, method, ['property', 'classmethod', 'contextmanager', 'asynccontextmanager']) || propertyAccessor(file, method)))
                        return classOf(file, owner, !knownDecorators(file, method, ['classmethod']));
                }
                return;
            }
            if (!value.expr) return;
            let shape = expression(file, scope, value.expr, value.expr.start, next, substitutions);
            if (value.source === 'iteration') shape = element(shape, Boolean(value.async));
            if (value.source === 'context') {
                if (shape?.kind === 'class') {
                    const enter = member(shape, value.async ? '__aenter__' : '__enter__', at, next);
                    shape = enter?.kind === 'function' ? returns(enter, [], at, next) : undefined;
                    if (value.async && shape?.kind === 'awaitable') shape = shape.item;
                } else shape = shape?.kind === 'context' && Boolean(shape.async) === Boolean(value.async) ? shape.item : undefined;
            }
            for (const index of value.projection || []) shape = shape?.kind === 'tuple' ? shape.items[index] : undefined;
            return shape;
    }
    function standard(file: File, scope: Scope, node: Node): string | undefined {
        if (node.nodeType === K.Name) {
            const name = node.d.value;
            for (let current: Scope | undefined = scope; current; current = current.parent) {
                if (current.declarations.has(name) || current.events.has('*') || file.bindings.mutable.has(name)) return;
                if (!current.events.has(name)) continue;
                const value = unique(current, name);
                return value && (current.kind === 'module' || value.at <= node.start) && !value.level && ['import', 'module'].includes(value.kind) ? value.kind === 'import' ? `${value.module}.${value.imported}` : value.imported === '*' ? value.module : value.imported : undefined;
            }
            return unshadowed(scope, name) ? `builtins.${name}` : undefined;
        }
        if (node.nodeType === K.MemberAccess) {
            const left = standard(file, scope, node.d.leftExpr);
            return left && `${left}.${node.d.member.d.value}`;
        }
        return;
    }
    function propertyGroup(file: File, scope: Scope, name: string) {
        const entries = scope.events.get(name) || [];
        const getter = entries[0];
        if (!getter || getter.kind !== 'function' || getter.conditional || !knownDecorators(file, getter.node, ['property'])) return;
        const accessors = new Set<string>();
        for (const entry of entries.slice(1)) {
            const decorators = (entry.node.d as any).decorators || [], expr = decorators[0]?.d.expr;
            if (entry.kind !== 'function' || entry.conditional || decorators.length !== 1 || expr?.nodeType !== K.MemberAccess
                || nameOf(expr.d.leftExpr) !== name || !['setter', 'deleter'].includes(expr.d.member.d.value) || accessors.has(expr.d.member.d.value)) return;
            accessors.add(expr.d.member.d.value);
        }
        return getter;
    }
    function propertyAccessor(file: File, method: Node) {
        const scope = scopeOf(file, method);
        return scope.kind === 'class' && Boolean(propertyGroup(file, scope, (method.d as any).name.d.value));
    }
    function knownDecorators(file: File, node: Node, allowed: string[]) {
        const decorators: Node[] = (node.d as any).decorators || [];
        return decorators.length > 0 && decorators.every(decorator => {
            const expr = (decorator.d as any).expr;
            const full = standard(file, scopeOf(file, node), expr), name = full?.split('.').at(-1);
            return Boolean(name && allowed.includes(name) && [`builtins.classmethod`, `builtins.staticmethod`, `builtins.property`, 'contextlib.contextmanager', 'contextlib.asynccontextmanager', 'dataclasses.dataclass'].includes(full!));
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
            const type = standard(file, scope, node.d.leftExpr), short = type?.split('.').at(-1);
            const args = () => node.d.items.map(item => annotation(file, scope, item.d.valueExpr, at, seen, substitutions));
            const namespace = type?.slice(0, type.lastIndexOf('.'));
            const protocol = namespace === 'typing' || namespace === 'builtins' && ['list', 'dict', 'tuple', 'set', 'frozenset'].includes(short!)
                || namespace === 'collections.abc' && ['Sequence', 'MutableSequence', 'Iterable', 'Iterator', 'Generator', 'AsyncIterable', 'AsyncIterator', 'AsyncGenerator', 'Mapping', 'MutableMapping', 'Awaitable', 'Coroutine'].includes(short!)
                || namespace === 'contextlib' && ['AbstractContextManager', 'AbstractAsyncContextManager'].includes(short!);
            if (protocol) {
                if (short === 'Optional') return union([args()[0], { kind: 'none' }]);
                if (short === 'Union') return union(args());
                if (short === 'Annotated') return args()[0];
                if (['list', 'List', 'Sequence', 'MutableSequence', 'Iterable', 'Iterator', 'Generator', 'AsyncIterable', 'AsyncIterator', 'AsyncGenerator', 'set', 'Set', 'frozenset', 'FrozenSet'].includes(short!)) {
                    const values = args(); return { kind: 'sequence', item: values[0], send: short!.endsWith('Generator') ? values[1] : undefined, generator: short!.endsWith('Generator'), async: short!.startsWith('Async') };
                }
                if (['dict', 'Dict', 'Mapping', 'MutableMapping'].includes(short!)) { const values = args(); return { kind: 'mapping', key: values[0], value: values[1] }; }
                if (['tuple', 'Tuple'].includes(short!)) return { kind: 'tuple', items: args() };
                if (['Awaitable', 'Coroutine'].includes(short!)) return { kind: 'awaitable', item: args().at(-1) };
                if (['ContextManager', 'AsyncContextManager', 'AbstractContextManager', 'AbstractAsyncContextManager'].includes(short!)) return { kind: 'context', item: args()[0], async: short!.includes('Async') };
            }
            const base = expression(file, scope, node.d.leftExpr, at, seen, substitutions);
            if (base?.kind !== 'class') return;
            const mapped = new Map(base.args);
            const params = typeParameters(base.node);
            for (let i = 0; i < params.length; i++) {
                const value = node.d.items[i] && annotation(file, scope, node.d.items[i].d.valueExpr, at, seen, substitutions);
                if (value) mapped.set((params[i].d as any).name.d.value, value);
            }
            return { ...base, instance: true, args: mapped };
        }
        if (node.nodeType === K.BinaryOperation && node.d.operator === Op.BitwiseOr)
            return union([annotation(file, scope, node.d.leftExpr, at, seen, substitutions), annotation(file, scope, node.d.rightExpr, at, seen, substitutions)]);
        if (node.nodeType === K.Constant && node.d.constType === KeywordType.None) return { kind: 'none' };
        if (node.nodeType === K.Name && !substitutions.has(node.d.value)) {
            for (let current: Scope | undefined = scope; current; current = current.parent) {
                const value = unique(current, node.d.value);
                if (!value) { if (current.events.has(node.d.value)) break; continue; }
                if (value.expr?.nodeType === K.Call && standard(file, current, value.expr.d.leftExpr) === 'typing.TypeVar' && !seen.has(value.node)) {
                    const bound = value.expr.d.args.find(arg => nameOf(arg.d.name) === 'bound');
                    return bound ? annotation(file, current, bound.d.valueExpr, at, new Set([...seen, value.node]), substitutions) : undefined;
                }
                break;
            }
        }
        if (standard(file, scope, node) === 'typing.Self') {
            let owner: Node | undefined = scope.node;
            while (owner && owner.nodeType !== K.Class) owner = owner.parent;
            return owner && classOf(file, owner, true);
        }
        const value = expression(file, scope, node, at, seen, substitutions);
        return value?.kind === 'class' ? { ...value, instance: true } : value;
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
    function member(owner: ClassShape, name: string, at: number, seen: Set<Node>, skipOwn = false): Shape | undefined {
        if (name.startsWith('__') && !name.endsWith('__')) return;
        if (!skipOwn) { const own = fileMember(owner, name, at, seen); if (own.present) return own.value; }
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
        const active = activeFields.find(field => field.name === name && same(field.owner, owner));
        if (active) return { present: true, value: active.value };
        if (activeFields.length > 32) return { present: true };
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
            if (entries.some(entry => entry.kind === 'function')) return { present: true };
            const declared = [...entries, ...writes].filter(value => value.annotation);
            const values = declared.length ? declared : writes;
            // All inferred writes must agree. A written field annotation is the
            // static declaration contract, rather than a runtime dispatch claim.
            const pending = { owner, name, value: undefined as Shape | undefined };
            activeFields.push(pending);
            try {
                const infer = () => values.map(value => bindingShape(file, scopeOf(file, value.node), value, value.at, new Set(), owner.args));
                const first = infer();
                // Seed recursive copies from independently typed writes, then
                // recheck every write. An unrelated unknown or conflicting
                // assignment still blocks a unique receiver shape.
                pending.value = union(first.filter(value => value && value.kind !== 'unknown' && value.kind !== 'union'));
                return { present: true, value: union(pending.value ? infer() : first) };
            } finally { activeFields.pop(); }
        }
        if (!entries.length) return { present: false };
        const value = propertyGroup(file, scope, name) || unique(scope, name);
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
        if (d.returnAnnotation) {
            const value = annotation(fn.file, scopeOf(fn.file, fn.node), d.returnAnnotation, at, seen, substitutions);
            if (knownDecorators(fn.file, fn.node, ['contextmanager', 'asynccontextmanager'])) return value?.kind === 'sequence' ? { kind: 'context', item: value.item, async: knownDecorators(fn.file, fn.node, ['asynccontextmanager']) } : undefined;
            const ownScope = fn.file.bindings.scopes.get(fn.node);
            const generator = [...walk(fn.node)].some(node => [K.Yield, K.YieldFrom].includes(node.nodeType) && scopeOf(fn.file, node) === ownScope);
            return d.isAsync && !generator ? { kind: 'awaitable', item: value } : value;
        }
        return;
    }
    function element(value: Shape | undefined, async = false): Shape | undefined {
        if (value?.kind === 'sequence' && Boolean(value.async) === async) return value.item;
        if (!async && value?.kind === 'tuple') return union(value.items);
        if (!async && value?.kind === 'mapping') return value.key;
        return;
    }
    const reference = (node: Node): string | undefined => node.nodeType === K.Name ? node.d.value : node.nodeType === K.MemberAccess
        ? reference(node.d.leftExpr) && `${reference(node.d.leftExpr)}.${node.d.member.d.value}` : undefined;
    function narrowed(file: File, scope: Scope, node: Node, at: number, value: Shape | undefined, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
        const path = reference(node); if (!path || scope.kind !== 'function') return value;
        const name = path.split('.')[0];
        const guards = reachingBindings(scope, name, at).guards;
        for (const guard of guards) {
            let test = guard.test, positive = guard.positive;
            while (test.nodeType === K.UnaryOperation && test.d.operator === Op.Not) { positive = !positive; test = test.d.expr; }
            if (path.includes('.') && (scope.events.get(name) || []).some(event => event.attributeWrite === path.split('.')[1] && event.at > endOf(guard.test) && event.at <= at)) continue;
            if (test.nodeType === K.Call && nameOf(test.d.leftExpr) === 'isinstance' && unshadowed(scope, 'isinstance')
                && test.d.args.length === 2 && test.d.args.every(arg => !arg.d.name && arg.d.argCategory === 0) && reference(test.d.args[0].d.valueExpr) === path) {
                const type = annotation(file, scope, test.d.args[1].d.valueExpr, test.start, seen, substitutions);
                if (positive && type?.kind === 'class') value = type;
                else if (!positive && value?.kind === 'union' && type?.kind === 'class') value = union(value.items.filter(item => !same(item, type)));
            }
            if (test.nodeType === K.BinaryOperation && [Op.Is, Op.IsNot].includes(test.d.operator) && reference(test.d.leftExpr) === path
                && test.d.rightExpr.nodeType === K.Constant && test.d.rightExpr.d.constType === KeywordType.None) {
                const isNone = positive === (test.d.operator === Op.Is);
                if (value?.kind === 'union') value = union(value.items.filter(item => (item.kind === 'none') === isNone));
            }
        }
        return value;
    }
    function expression(file: File, scope: Scope, node: Node, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
        if (seen.has(node) || seen.size > 64) return;
        seen = new Set([...seen, node]);
        const d = node.d as any;
        if (node.nodeType === K.Name) {
            return narrowed(file, scope, node, at, symbol(file, scope, d.value, at, seen, substitutions), seen, substitutions);
        }
        if (node.nodeType === K.Constant && d.constType === KeywordType.None) return { kind: 'none' };
        if (node.nodeType === K.Tuple) return { kind: 'tuple', items: d.items.map((item: Node) => expression(file, scope, item, at, seen, substitutions)) };
        if (node.nodeType === K.List) return { kind: 'sequence', item: union(d.items.map((item: Node) => expression(file, scope, item, at, seen, substitutions))) };
        if (node.nodeType === K.Ternary) return union([expression(file, scope, d.ifExpr, at, seen, substitutions), expression(file, scope, d.elseExpr, at, seen, substitutions)]);
        if (node.nodeType === K.Await) { const value = expression(file, scope, d.expr, at, seen, substitutions); return value?.kind === 'awaitable' ? value.item : undefined; }
        if (node.nodeType === K.Yield) {
            if (scope.node.nodeType !== K.Function) return;
            const result = annotation(file, scopeOf(file, scope.node), (scope.node.d as any).returnAnnotation, at, seen, substitutions);
            return result?.kind === 'sequence' ? result.send : undefined;
        }
        if (node.nodeType === K.Index) {
            const value = expression(file, scope, d.leftExpr, at, seen, substitutions);
            if (d.items.some((item: Node) => (item.d as any).valueExpr.nodeType === K.Slice)) return value?.kind === 'sequence' ? value : undefined;
            if (value?.kind === 'mapping') return value.value;
            if (value?.kind === 'sequence' && !value.async) return value.item;
            if (value?.kind === 'tuple' && d.items.length === 1 && d.items[0].d.valueExpr.nodeType === K.Number) return value.items[Number(d.items[0].d.valueExpr.d.value)];
            return;
        }
        if (node.nodeType === K.MemberAccess) {
            if (d.leftExpr.nodeType === K.Call && nameOf(d.leftExpr.d.leftExpr) === 'super' && !d.leftExpr.d.args.length && unshadowed(scope, 'super') && scope.node.nodeType === K.Function) {
                const owner = scopeOf(file, scope.node);
                const first = (scope.node.d as any).params[0];
                if (owner.kind !== 'class' || !first?.d.name) return;
                const receiver = symbol(file, scope, first.d.name.d.value, at, seen, substitutions);
                return receiver?.kind === 'class' && receiver.node === owner.node ? member(receiver, d.member.d.value, at, seen, true) : undefined;
            }
            const left = expression(file, scope, d.leftExpr, at, seen, substitutions);
            if (left?.kind === 'module') {
                const value = symbol(left.file, left.file.bindings.module, d.member.d.value, Infinity, seen, new Map());
                if (value || left.file.bindings.module.events.has(d.member.d.value) || !left.file.record.path.endsWith('__init__.py')) return value;
                const target = locate(left.file.record.path, '', 1, d.member.d.value), other = target && files.get(target.file);
                return target?.module && other ? { kind: 'module', file: other } : undefined;
            }
            const value = left?.kind === 'class' ? d.member.d.value === '__class__' && left.instance ? { ...left, instance: false } : member(left, d.member.d.value, at, seen) : undefined;
            return narrowed(file, scope, node, at, value, seen, substitutions);
        }
        if (node.nodeType === K.Call) {
            const builtin = standard(file, scope, d.leftExpr);
            const first = d.args[0]?.d.valueExpr;
            if (first && d.args.every((arg: Node) => (arg.d as any).argCategory === 0 && !(arg.d as any).name)
                && (d.args.length === 1 || builtin === 'builtins.next' && d.args.length === 2)
                && ['builtins.next', 'builtins.iter', 'builtins.aiter', 'builtins.reversed', 'builtins.list', 'builtins.tuple', 'builtins.sorted', 'builtins.dict'].includes(builtin!)) {
                const input = expression(file, scope, first, at, seen, substitutions);
                if (builtin === 'builtins.next') return d.args.length === 1 ? element(input) : union([element(input), expression(file, scope, d.args[1].d.valueExpr, at, seen, substitutions)]);
                if (builtin === 'builtins.dict') { const item = element(input); return item?.kind === 'tuple' ? { kind: 'mapping', key: item.items[0], value: item.items[1] } : input?.kind === 'mapping' ? input : undefined; }
                return { kind: 'sequence', item: element(input, builtin === 'builtins.aiter'), async: builtin === 'builtins.aiter' };
            }
            if (d.leftExpr.nodeType === K.MemberAccess) {
                const left = expression(file, scope, d.leftExpr.d.leftExpr, at, seen, substitutions), name = d.leftExpr.d.member.d.value;
                if (left?.kind === 'sequence' && left.generator && name === 'send' && !left.async) return left.item;
                if (left?.kind === 'sequence' && left.generator && name === 'asend' && left.async) return { kind: 'awaitable', item: left.item };
                if (left?.kind === 'mapping' && !d.args.length && ['items', 'keys', 'values'].includes(name)) return { kind: 'sequence', item: name === 'items' ? { kind: 'tuple', items: [left.key, left.value] } : name === 'keys' ? left.key : left.value };
            }
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
            if (callee.nodeType === K.Name && !(unique(scope, callee.d.value)?.kind === 'function' && scope.kind === 'function')) {
                const value = file.bindings.lookup(scope, callee.d.value, node.start);
                if (!value || !['function', 'import'].includes(value.kind)) continue;
                const target = symbol(file, scope, callee.d.value, node.start, new Set(), new Map());
                if (target?.kind !== 'function' || !knownDecorators(target.file, target.node, ['contextmanager', 'asynccontextmanager'])) continue;
            }
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
