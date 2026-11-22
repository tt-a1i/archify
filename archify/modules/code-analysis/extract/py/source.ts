// Declaration-oriented receiver analysis. Like Pyright, resolve names in their
// declaration modules and keep syntax, binding, member lookup and type shapes
// separate. Only a unique captured declaration becomes a navigation target.
// No target import, runtime dispatch, third-party type evaluator or stub engine.
import { ArgCategory, ArgumentNode, FunctionNode, ParamCategory, ParameterNode, ParseNode as Node, ParseNodeType as K, TypeParamKind } from './upstream/parser/parseNodes.js';
import { OperatorType as Op, KeywordType } from './upstream/parser/tokenizerTypes.js';
import { Analysis } from './collect.js';
import { Binding, Scope, typeParameters } from './bindings.js';
import { endOf, literalString, nameOf } from './facts.js';
import { parsePython, walk } from './syntax.js';
import { reachingBindings } from './flow.js';

type File = Analysis & Required<Pick<Analysis, 'tree' | 'bindings' | 'context'>>;
type Shape = { kind: 'module'; file: File } | { kind: 'class'; file: File; node: Node; instance: boolean; args: Map<string, Shape> }
    | { kind: 'function'; file: File; node: Node; args: Map<string, Shape>; receiver?: ClassShape; overloads?: FunctionNode[]; platformAlternative?: true }
    | { kind: 'scalar'; type: 'str' | 'bool'; literal?: string | boolean }
    | { kind: 'sequence'; item?: Shape; async?: boolean; send?: Shape; generator?: boolean; mutable?: boolean }
    | { kind: 'tuple'; items: (Shape | undefined)[] }
    | { kind: 'mapping'; key?: Shape; value?: Shape }
    | { kind: 'awaitable'; item?: Shape } | { kind: 'context'; item?: Shape; async?: boolean }
    | { kind: 'contextVar' | 'weakRef'; item?: Shape }
    | { kind: 'union'; items: Shape[] }
    | { kind: 'none' | 'unknown' };
type ClassShape = Extract<Shape, { kind: 'class' }>;
type FunctionShape = Extract<Shape, { kind: 'function' }>;
type Locate = (from: string, module: string, level: number, name?: string) => { file: string; module: boolean } | undefined;
const callableDecorators = ['contextmanager', 'asynccontextmanager', 'cache', 'lru_cache', 'singledispatch'];

export function resolveSourceCalls(analyses: Analysis[], locate: Locate, declarations: Analysis[] = []) {
    const captured = new Set(analyses.map(analysis => analysis.record.path));
    const files = new Map([...analyses, ...declarations].filter(analysis => analysis.tree).map(analysis => [analysis.record.path, analysis as File]));
    const classOf = (file: File, node: Node, instance = false, args = new Map<string, Shape>()): ClassShape => ({ kind: 'class', file, node, instance, args });
    const same = (a?: Shape, b?: Shape, depth = 0): boolean => {
        if (!a || !b) return a === b;
        if (a.kind !== b.kind || depth > 16) return false;
        if (a.kind === 'scalar' && b.kind === 'scalar') return a.type === b.type && a.literal === b.literal;
        if (a.kind === 'class' && b.kind === 'class' && a.instance !== b.instance) return false;
        if ('file' in a && 'file' in b) return a.file === b.file && ('node' in a && 'node' in b ? a.node === b.node
            && a.args.size === b.args.size && [...a.args].every(([name, value]) => same(value, b.args.get(name), depth + 1)) : a.kind === 'module');
        if ('items' in a && 'items' in b) return a.items.length === b.items.length && a.items.every((value, i) => same(value, b.items[i], depth + 1));
        if (a.kind === 'mapping' && b.kind === 'mapping') return same(a.key, b.key, depth + 1) && same(a.value, b.value, depth + 1);
        if (a.kind === 'sequence' && b.kind === 'sequence') return Boolean(a.async) === Boolean(b.async) && Boolean(a.generator) === Boolean(b.generator) && Boolean(a.mutable) === Boolean(b.mutable) && same(a.item, b.item, depth + 1) && same(a.send, b.send, depth + 1);
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
    const scopeOf = (file: File, node: Node) => {
        // Flattened operator nodes share their enclosing expression's scope.
        for (let current: Node | undefined = node; current; current = current.parent) {
            const scope = file.bindings.nodeScopes.get(current);
            if (scope) return scope;
        }
        return file.bindings.module;
    };
    const emptyList = (node: Node) => node.nodeType === K.List && !node.d.items.length;
    const typeBinding = (file: File, scope: Scope, name: string) => {
        const ordinary = scope.unique(name);
        if (ordinary) return ordinary;
        const values = scope.events.get(name)?.filter(value => !value.attributeWrite);
        if (values?.length !== 1 || !['import', 'module'].includes(values[0].kind) || locate(file.record.path, 'typing', 0)) return;
        const point = file.context.point(values[0].node.start);
        return file.record.imports.some(item => item.line === point.line && item.column === point.column && item.typeOnly && !item.conditional) ? values[0] : undefined;
    };
    const unshadowed = (scope: Scope, name: string) => {
        for (let current: Scope | undefined = scope; current; current = current.parent)
            if (current.events.has(name) || current.declarations.has(name) || current.events.has('*')) return false;
        return true;
    };
    const activeFields: { owner: ClassShape; name: string; value?: Shape }[] = [];
    const reachingValue = (scope: Scope, name: string, at: number) => {
        const { values } = reachingBindings(scope, name, at);
        return values.length === 1 ? values[0] : undefined;
    };
    function localCallable(scope: Scope, name: string, at: number) {
        for (let block: Scope | undefined = scope; block?.kind === 'function'; block = block.parent) {
            if (block.declarations.has(name) || block.events.has('*')) return;
            if (!block.events.has(name)) continue;
            const value = block.unique(name);
            if (value?.kind === 'function' && value.at <= at) return value;
            // An ordinary import keeps its existing imported-function evidence.
            const writes = block.events.get(name)!;
            if (block === scope && writes.length === 1 && ['function', 'import'].includes(writes[0].kind) && writes[0].conditional
                && reachingValue(block, name, at) === writes[0]) return writes[0];
            return;
        }
    }
    function nullableFunction(file: File, scope: Scope, name: string, at: number): FunctionShape | undefined {
        for (let block: Scope | undefined = scope; block; block = block.parent) {
            if (block.declarations.has(name) || block.events.has('*') || file.bindings.mutable.has(name)) return;
            const values = block.events.get(name);
            if (!values) continue;
            if (block.kind !== 'module' || values.length < 2 || values.some(value => !value.conditional)) return;
            const functions = values.filter(value => value.kind === 'function' && !(value.node.d as any).decorators.length);
            if (functions.length === 1 && (scope.kind !== 'module' || reachingBindings(block, name, at).values.includes(functions[0]))
                && values.every(value => value === functions[0] || value.expr?.nodeType === K.Constant && value.expr.d.constType === KeywordType.None))
                return { kind: 'function', file, node: functions[0].node, args: new Map() };
            return;
        }
    }
    const symbol = (file: File, scope: Scope, name: string, at: number, seen: Set<Node>, substitutions: Map<string, Shape>, types = false, importsLeft = 2, origin = scope): Shape | undefined => {
        if (substitutions.has(name)) return substitutions.get(name);
        if (scope.declarations.has(name) || file.bindings.mutable.has(name) || name === '__class__') return;
        const wildcard = scope.events.get('*')?.at(-1);
        if (wildcard && scope.kind !== 'module') return;
        const values = scope.events.get(name)?.filter(value => !value.attributeWrite);
        if (values?.length) {
            const local = scope.kind === 'function' && scope === origin;
            const value = types ? typeBinding(file, scope, name) : scope.unique(name)
                ?? (local && values.length === 1 ? reachingValue(scope, name, at) : undefined);
            if (wildcard && (!value || value.conditional || value.at <= wildcard.at)) return;
            if (scope.kind === 'function' && values.every(value => ['value', 'parameter'].includes(value.kind))) {
                if (!local && values.some(value => value.at > at)) return;
                if (values.some(value => value.annotation && standard(file, scopeOf(file, value.annotation), value.annotation, true) === 'typing.Any')) return;
                return union(reachingBindings(scope, name, at).values.map(value => value && bindingShape(file, scope, value, at, seen, substitutions)));
            }
            if (!value) return !types && scope.kind === 'module'
                ? overloadGroup(file, scope, values) ?? platformDeclaration(file, scope, values, at) : undefined;
            if (value.kind === 'class') return !(value.node.d as any).decorators.length || knownDecorators(file, value.node, ['dataclass']) ? classOf(file, value.node) : undefined;
            if (value.kind === 'function') {
                if (scope.kind !== 'module' && value.at > at) return;
                if (!(value.node.d as any).decorators.length || knownDecorators(file, value.node, callableDecorators) || signatureDecorators(file, value.node, seen))
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
                return symbol(other, other.bindings.module, value.imported!, Infinity, new Set([...seen, value.node]), new Map(), types, importsLeft - 1);
            }
            return bindingShape(file, scope, value, at, seen, substitutions);
        }
        return scope.parent ? symbol(file, scope.parent, name, at, seen, substitutions, types, importsLeft, origin) : undefined;
    };
    function bindingShape(file: File, scope: Scope, value: Binding, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
            if (seen.has(value.node)) return;
            const next = new Set([...seen, value.node]);
            if (value.annotation) return annotation(file, scopeOf(file, value.annotation), value.annotation, value.at, next, substitutions);
            if (value.kind === 'parameter') {
                if (scope.node.nodeType === K.Lambda)
                    return callbackParameter(file, scope, value.node, at, next, substitutions);
                const method = scope.node;
                const parameters = (method.d as any).params || [];
                if (parameters[0] === value.node) {
                    let owner = method.parent;
                    while (owner && ![K.Function, K.Class].includes(owner.nodeType)) owner = owner.parent;
                    if (owner?.nodeType === K.Class && (!(method.d as any).decorators.length || knownDecorators(file, method, ['property', 'cached_property', 'classmethod', 'contextmanager', 'asynccontextmanager']) || abstractMethod(file, method) || propertyAccessor(file, method) || signatureDecorators(file, method, seen)))
                        return classOf(file, owner, !knownDecorators(file, method, ['classmethod']));
                }
                return;
            }
            if (!value.expr) return;
            let shape = expression(file, scopeOf(file, value.expr), value.expr, value.expr.start, next, substitutions);
            if (value.source === 'iteration') shape = element(shape, Boolean(value.async));
            if (value.source === 'context') {
                if (shape?.kind === 'class') {
                    const enter = member(shape, value.async ? '__aenter__' : '__enter__', at, next);
                    shape = enter?.kind === 'function' ? returns(enter, at, next) : undefined;
                    if (value.async && shape?.kind === 'awaitable') shape = shape.item;
                } else shape = shape?.kind === 'context' && Boolean(shape.async) === Boolean(value.async) ? shape.item : undefined;
            }
            for (const index of value.projection || []) shape = shape?.kind === 'tuple' ? shape.items[index] : undefined;
            return shape;
    }
    function standard(file: File, scope: Scope, node: Node, types = false): string | undefined {
        if (node.nodeType === K.Name) {
            const name = node.d.value;
            for (let current: Scope | undefined = scope; current; current = current.parent) {
                if (current.declarations.has(name) || current.events.has('*') || file.bindings.mutable.has(name)) return;
                if (!current.events.has(name)) continue;
                const value = types ? typeBinding(file, current, name) : current.unique(name);
                if (!value || current.kind !== 'module' && value.at > node.start || value.level || !value.module) return;
                if (/^(?:typing|typing_extensions|collections|contextlib|contextvars|weakref|builtins|dataclasses|functools|abc|werkzeug|sys)(?:\.|$)/.test(value.module)
                    && (locate(file.record.path, value.module, 0) || current.events.get(name)?.some(event => event.attributeWrite))) return;
                if (value.kind === 'import') return `${value.module}.${value.imported}`;
                if (value.kind === 'module') return value.imported === '*' ? value.module : value.imported;
                return;
            }
            return unshadowed(scope, name) ? `builtins.${name}` : undefined;
        }
        if (node.nodeType === K.MemberAccess) {
            const left = standard(file, scope, node.d.leftExpr, types);
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
            return Boolean(name && allowed.includes(name) && ['builtins.classmethod', 'builtins.staticmethod', 'builtins.property',
                'contextlib.contextmanager', 'contextlib.asynccontextmanager', 'dataclasses.dataclass',
                'functools.cache', 'functools.lru_cache', 'functools.singledispatch', 'functools.cached_property',
                'abc.abstractmethod', 'werkzeug.utils.cached_property'].includes(full!));
        });
    }
    function abstractMethod(file: File, node: Node) {
        return (node.d as any).decorators.length === 1 && knownDecorators(file, node, ['abstractmethod']);
    }
    function overloadGroup(file: File, scope: Scope, bindings: Binding[]): FunctionShape | undefined {
        if (bindings.length < 3 || bindings.some(binding => binding.conditional || binding.kind !== 'function')) return;
        const declarations = bindings.map(binding => binding.node as FunctionNode);
        const node = declarations.pop()!;
        if (node.d.decorators.length || node.d.isAsync || declarations.some(declaration => declaration.d.isAsync
            || declaration.d.decorators.length !== 1 || !['typing.overload', 'typing_extensions.overload'].includes(
                standard(file, scope, declaration.d.decorators[0].d.expr)!))) return;
        return { kind: 'function', file, node, args: new Map(), overloads: declarations };
    }
    function platformGuard(file: File, scope: Scope, test: Node) {
        const platform = (node: Node) => {
            const alias = nameOf(node.nodeType === K.MemberAccess ? node.d.leftExpr : node);
            const imported = alias && scope.unique(alias);
            return imported && imported.at < node.start && standard(file, scope, node) === 'sys.platform';
        };
        const clause = (node: Node) => {
            if (node.nodeType === K.Name) {
                const binding = scope.unique(node.d.value);
                if (!binding?.expr || binding.at > node.start || file.bindings.mutable.has(node.d.value)) return false;
                node = binding.expr;
            }
            if (node.nodeType === K.BinaryOperation)
                return [Op.Equals, Op.NotEquals].includes(node.d.operator) && platform(node.d.leftExpr) && literalString(node.d.rightExpr) !== null;
            if (node.nodeType !== K.Call || node.d.leftExpr.nodeType !== K.MemberAccess || node.d.leftExpr.d.member.d.value !== 'startswith') return false;
            const [part] = node.d.args;
            return node.d.args.length === 1 && part.d.argCategory === ArgCategory.Simple && !part.d.name
                && platform(node.d.leftExpr.d.leftExpr) && literalString(part.d.valueExpr) !== null;
        };
        return test.nodeType === K.BinaryOperation && test.d.operator === Op.And ? clause(test.d.leftExpr) && clause(test.d.rightExpr) : clause(test);
    }
    // Under Pyright's All platform, navigation uses the later typed declaration
    // for these paired same-signature branches. No platform branch is executed.
    function platformDeclaration(file: File, scope: Scope, bindings: Binding[], at: number): FunctionShape | undefined {
        if (bindings.length !== 2 || bindings.some(binding => binding.kind !== 'function' || !binding.conditional)) return;
        const [first, last] = bindings.map(binding => binding.node as FunctionNode);
        const branch = first.parent?.parent;
        if (branch?.nodeType !== K.If || branch.parent !== scope.node || branch.d.ifSuite !== first.parent
            || branch.d.elseSuite !== last.parent || endOf(branch) >= at || !platformGuard(file, scope, branch.d.testExpr)) return;
        const text = (node: Node) => file.record.sourceText.slice(node.start, endOf(node));
        if ([first, last].some(fn => fn.d.isAsync || fn.d.params.length || fn.d.typeParams || !fn.d.returnAnnotation
            || fn.d.decorators.length && (fn.d.decorators.length !== 1 || !knownDecorators(file, fn, ['contextmanager'])))) return;
        if (first.d.decorators.length !== last.d.decorators.length || text(first.d.returnAnnotation!) !== text(last.d.returnAnnotation!)) return;
        return { kind: 'function', file, node: last, args: new Map(), platformAlternative: true };
    }
    function scalarLiteral(node?: Node): Extract<Shape, { kind: 'scalar' }> | undefined {
        const text = literalString(node);
        if (text !== null) return { kind: 'scalar', type: 'str', literal: text };
        if (node?.nodeType === K.Constant && [KeywordType.True, KeywordType.False].includes(node.d.constType))
            return { kind: 'scalar', type: 'bool', literal: node.d.constType === KeywordType.True };
        return;
    }
    function typeVariable(file: File, scope: Scope, name: string, fn?: Node): { node: Node; bound?: Node; scope: Scope } | undefined {
        const generic = fn && typeParameters(fn).find(param => (param.d as any).name.d.value === name);
        if (generic?.nodeType === K.TypeParameter) return generic.d.typeParamKind === TypeParamKind.TypeVar ? { node: generic, bound: generic.d.boundExpr, scope } : undefined;
        if (file.bindings.mutable.has(name)) return;
        for (let current: Scope | undefined = scope; current; current = current.parent) {
            if (!current.events.has(name)) continue;
            const value = current.unique(name);
            if (value?.expr?.nodeType !== K.Call || standard(file, current, value.expr.d.leftExpr) !== 'typing.TypeVar') return;
            const [label, ...options] = value.expr.d.args;
            if (label?.d.argCategory !== ArgCategory.Simple || label.d.name || literalString(label.d.valueExpr) !== name
                || options.some(arg => arg.d.argCategory !== ArgCategory.Simple || !arg.d.name)) return;
            const bounds = options.filter(arg => nameOf(arg.d.name) === 'bound');
            if (bounds.length > 1) return;
            return { node: value.node, bound: bounds[0]?.d.valueExpr, scope: current };
        }
        return;
    }
    // A captured F -> F contract with F bound to Callable preserves the static
    // callable signature. It says nothing about the wrapper's runtime identity.
    function signatureDecorators(file: File, node: Node, seen: Set<Node>): boolean {
        const decorators: Node[] = (node.d as any).decorators || [];
        if (!decorators.length || seen.has(node) || seen.size > 64) return false;
        const next = new Set([...seen, node]);
        return decorators.every(decorator => {
            const expr = (decorator.d as any).expr;
            if (![K.Name, K.MemberAccess].includes(expr.nodeType)) return false;
            const scope = scopeOf(file, node);
            let base = expr as Node;
            while (base.nodeType === K.MemberAccess) base = base.d.leftExpr;
            const baseName = nameOf(base);
            if (!baseName) return false;
            for (let current: Scope | undefined = scope; current; current = current.parent) {
                const events = current.events.get(baseName);
                if (!events) continue;
                const binding = current.unique(baseName);
                if (!binding || binding.at > node.start || events.some(event => event.attributeWrite)) return false;
                break;
            }
            const value = expression(file, scope, expr, node.start, next, new Map());
            if (value?.kind !== 'function' || (value.node.d as any).decorators.length || value.file === file && value.node.start > node.start) return false;
            const d = value.node.d as any, params: Node[] = d.params || [], name = nameOf(d.returnAnnotation);
            if (d.isAsync || params.length !== 1 || (params[0].d as any).category !== ParamCategory.Simple || nameOf((params[0].d as any).annotation) !== name || !name) return false;
            const variable = typeVariable(value.file, scopeOf(value.file, value.node), name, value.node), bound = variable?.bound;
            const contract = bound?.nodeType === K.Index ? standard(value.file, variable!.scope, bound.d.leftExpr) : undefined;
            return contract === 'typing.Callable' || contract === 'collections.abc.Callable';
        });
    }
    function annotation(file: File, scope: Scope, node: Node | undefined, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
        if (!node) return;
        if (node.nodeType === K.StringList && node.d.strings.every(part => part.nodeType === K.String)) {
            const text = node.d.strings.map(part => (part.d as any).value).join('');
            const parsed = parsePython(`_annotation: ${text}`);
            const statement = (parsed.parseTree.d.statements[0] as any)?.d.statements?.[0];
            return !parsed.errors.length && statement?.nodeType === K.TypeAnnotation ? annotation(file, scope, statement.d.annotation, at, seen, substitutions) : undefined;
        }
        if (node.nodeType === K.Name && substitutions.has(node.d.value)) return substitutions.get(node.d.value);
        if (node.nodeType === K.Index) {
            const type = standard(file, scope, node.d.leftExpr, true), short = type?.split('.').at(-1);
            const args = () => node.d.items.map(item => annotation(file, scope, item.d.valueExpr, at, seen, substitutions));
            if (['typing.Literal', 'typing_extensions.Literal'].includes(type!) && node.d.items.length === 1)
                return scalarLiteral(node.d.items[0].d.valueExpr);
            if (type === 'contextvars.ContextVar' && node.d.items.length === 1) return { kind: 'contextVar', item: args()[0] };
            if (type === 'typing.Type' || type === 'builtins.type') {
                if (node.d.items.length !== 1) return;
                const value = args()[0];
                return value?.kind === 'class' ? { ...value, instance: false } : undefined;
            }
            const namespace = type?.slice(0, type.lastIndexOf('.'));
            const protocol = namespace === 'typing' || namespace === 'builtins' && ['list', 'dict', 'tuple', 'set', 'frozenset'].includes(short!)
                || namespace === 'collections.abc' && ['Sequence', 'MutableSequence', 'Iterable', 'Iterator', 'Generator', 'AsyncIterable', 'AsyncIterator', 'AsyncGenerator', 'Mapping', 'MutableMapping', 'Awaitable', 'Coroutine'].includes(short!)
                || namespace === 'contextlib' && ['AbstractContextManager', 'AbstractAsyncContextManager'].includes(short!);
            if (protocol) {
                if (short === 'Optional') return union([args()[0], { kind: 'none' }]);
                if (short === 'Union') return union(args());
                if (short === 'Annotated') return args()[0];
                if (['list', 'List', 'Sequence', 'MutableSequence', 'Iterable', 'Iterator', 'Generator', 'AsyncIterable', 'AsyncIterator', 'AsyncGenerator', 'set', 'Set', 'frozenset', 'FrozenSet'].includes(short!)) {
                    const values = args(); return { kind: 'sequence', item: values[0], send: short!.endsWith('Generator') ? values[1] : undefined, generator: short!.endsWith('Generator'), async: short!.startsWith('Async'), mutable: ['list', 'List', 'MutableSequence'].includes(short!) };
                }
                if (['dict', 'Dict', 'Mapping', 'MutableMapping'].includes(short!)) { const values = args(); return { kind: 'mapping', key: values[0], value: values[1] }; }
                if (['tuple', 'Tuple'].includes(short!)) return { kind: 'tuple', items: args() };
                if (['Awaitable', 'Coroutine'].includes(short!)) return { kind: 'awaitable', item: args().at(-1) };
                if (['ContextManager', 'AsyncContextManager', 'AbstractContextManager', 'AbstractAsyncContextManager'].includes(short!)) return { kind: 'context', item: args()[0], async: short!.includes('Async') };
            }
            const base = expression(file, scope, node.d.leftExpr, at, seen, substitutions, true);
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
            const variable = typeVariable(file, scope, node.d.value);
            if (variable) return variable.bound && !seen.has(variable.node) ? annotation(file, variable.scope, variable.bound, at, new Set([...seen, variable.node]), substitutions) : undefined;
        }
        const qualified = standard(file, scope, node, true);
        if (qualified === 'builtins.str' || qualified === 'builtins.bool') return { kind: 'scalar', type: qualified === 'builtins.str' ? 'str' : 'bool' };
        if (['typing.Self', 'typing_extensions.Self'].includes(qualified!)) {
            let owner: Node | undefined = scope.node;
            while (owner && owner.nodeType !== K.Class) owner = owner.parent;
            return owner && classOf(file, owner, true);
        }
        const value = expression(file, scope, node, at, seen, substitutions, true);
        return value?.kind === 'class' ? { ...value, instance: true } : value;
    }
    function bases(owner: ClassShape, seen: Set<Node>): ClassShape[] | undefined {
        const out: ClassShape[] = [];
        const scope = scopeOf(owner.file, owner.node);
        const arguments_ = (owner.node.d as any).arguments || [];
        for (const [index, arg] of arguments_.entries()) {
            if (arg.d.name) return; // custom metaclass / class keywords
            let expr = arg.d.valueExpr;
            if (expr.nodeType === K.Index) expr = expr.d.leftExpr;
            const standardBase = standard(owner.file, scope, expr, true);
            if (standardBase === 'builtins.object') {
                // An explicit object base must follow every other direct base.
                if (index !== arguments_.length - 1 || expr !== arg.d.valueExpr) return;
                continue;
            }
            if (['typing.Generic', 'abc.ABC'].includes(standardBase!)) continue;
            const base = expression(owner.file, scope, expr, owner.node.start, seen, owner.args);
            if (base?.kind === 'class') out.push(base);
            else return;
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
    function member(owner: ClassShape, name: string, at: number, seen: Set<Node>, lookup?: 'callee', skipOwn = false, lineage = new Set<Node>()): Shape | undefined {
        if (name.startsWith('__') && !name.endsWith('__') || lineage.has(owner.node) || lineage.size > 32) return;
        if (!skipOwn) { const own = fileMember(owner, name, at, seen, lookup); if (own.present) return own.value; }
        // A declaration directly in the first base precedes all later bases in
        // every consistent C3 order. Its own external bases need not be loaded.
        const arguments_ = (owner.node.d as any).arguments || [];
        if (arguments_.length && arguments_.every((arg: Node) => !(arg.d as any).name)) {
            let expr = arguments_[0].d.valueExpr;
            if (expr.nodeType === K.Index) expr = expr.d.leftExpr;
            const base = expression(owner.file, scopeOf(owner.file, owner.node), expr, owner.node.start, seen, owner.args);
            if (base?.kind === 'class') {
                if (arguments_.length === 1)
                    return member({ ...base, instance: owner.instance }, name, at, seen, lookup, false, new Set([...lineage, owner.node]));
                const value = fileMember({ ...base, instance: owner.instance }, name, at, seen, lookup);
                if (value.present) return value.value;
            }
        }
        const hierarchy = mro(owner);
        if (!hierarchy) return;
        for (const base of hierarchy.slice(1)) { const value = fileMember({ ...base, instance: owner.instance }, name, at, seen, lookup); if (value.present) return value.value; }
        return;
    }
    function fileMember(owner: ClassShape, name: string, at: number, seen: Set<Node>, lookup?: 'callee'): { present: boolean; value?: Shape } {
        const active = activeFields.find(field => field.name === name && same(field.owner, owner));
        if (active) return { present: true, value: active.value };
        if (activeFields.length > 32) return { present: true };
        const file = owner.file, scope = file.bindings.scopes.get(owner.node)!;
        const writes: Binding[] = [];
        // Instance assignments override a method declaration. A same-spelled
        // assignment in another class has no effect on this receiver.
        for (const candidate of captured.has(file.record.path) ? file.bindings.scopes.values() : []) {
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
        const value = propertyGroup(file, scope, name) || scope.unique(name);
        if (!value) return { present: true };
        if (value.kind === 'function') {
            const decorators = (value.node.d as any).decorators;
            if (decorators.length && !knownDecorators(file, value.node, ['property', 'cached_property', 'classmethod', 'staticmethod', 'contextmanager', 'asynccontextmanager']) && !abstractMethod(file, value.node) && !signatureDecorators(file, value.node, seen)) return { present: true };
            const fn: FunctionShape = { kind: 'function', file, node: value.node, args: owner.args, receiver: owner };
            if (knownDecorators(file, value.node, ['property', 'cached_property'])) {
                // A callsite navigates to the attribute's declaration while
                // ordinary receiver analysis still uses the getter's return type.
                return { present: true, value: owner.instance ? lookup === 'callee' ? fn : returns(fn, at, seen) : undefined };
            }
            return { present: true, value: fn };
        }
        return { present: true, value: value.annotation ? annotation(file, scope, value.annotation, at, seen, owner.args)
            : value.expr ? expression(file, scope, value.expr, at, seen, owner.args) : undefined };
    }
    const callParameters = (fn: FunctionShape): ParameterNode[] => {
        const boundReceiver = fn.receiver && !knownDecorators(fn.file, fn.node, ['staticmethod'])
            && (fn.receiver.instance || knownDecorators(fn.file, fn.node, ['classmethod']));
        return (fn.node.d as any).params.slice(boundReceiver ? 1 : 0);
    };
    function bindArguments(params: ParameterNode[], args: ArgumentNode[]) {
        if (params.some(param => !param.d.name || param.d.category !== ParamCategory.Simple)) return;
        const supplied = new Map<number, Node>();
        let position = 0;
        for (const arg of args) {
            if (arg.d.argCategory !== ArgCategory.Simple) return;
            const index = arg.d.name ? params.findIndex(param => param.d.name?.d.value === arg.d.name!.d.value) : position++;
            if (index < 0 || index >= params.length || supplied.has(index)) return;
            supplied.set(index, arg.d.valueExpr);
        }
        if (params.some((param, index) => !supplied.has(index) && !param.d.defaultValue)) return;
        return supplied;
    }
    function callbackParameter(file: File, scope: Scope, parameter: Node, at: number, seen: Set<Node>, substitutions: Map<string, Shape>): Shape | undefined {
        const lambda = scope.node;
        if (lambda.nodeType !== K.Lambda || lambda.d.params.some(param => !param.d.name || param.d.category !== ParamCategory.Simple)) return;
        const argument = lambda.parent, call = argument?.parent;
        if (argument?.nodeType !== K.Argument || argument.d.valueExpr !== lambda || call?.nodeType !== K.Call) return;
        const fn = expression(file, scopeOf(file, call), call.d.leftExpr, call.start, seen, substitutions);
        if (fn?.kind !== 'function' || fn.overloads) return;
        const params = callParameters(fn);
        const index = [...bindArguments(params, call.d.args) || []].find(([, supplied]) => supplied === lambda)?.[0];
        if (index === undefined) return;
        let expected: Node | undefined = params[index].d.annotation;
        let declaredIn = scopeOf(fn.file, fn.node);
        // A simple, uniquely bound alias can name the Callable parameter list.
        if (expected?.nodeType === K.Name && !fn.file.bindings.mutable.has(expected.d.value)) {
            const name = expected.d.value;
            for (let current: Scope | undefined = declaredIn; current; current = current.parent) {
                if (current.events.has('*') || current.declarations.has(name)) return;
                if (!current.events.has(name)) continue;
                expected = current.unique(name)?.expr;
                declaredIn = current;
                break;
            }
        }
        if (expected?.nodeType !== K.Index || expected.d.items.length !== 2
            || !['typing.Callable', 'collections.abc.Callable'].includes(standard(fn.file, declaredIn, expected.d.leftExpr, true)!)) return;
        const types = expected.d.items[0].d.valueExpr;
        if (types.nodeType !== K.List || types.d.items.length !== lambda.d.params.length) return;
        const position = lambda.d.params.findIndex(param => param === parameter);
        return annotation(fn.file, declaredIn, types.d.items[position], at, seen, fn.args);
    }
    function inferTypeArguments(fn: FunctionShape, scope: Scope, args: ArgumentNode[], shapeOf: (node: Node) => Shape | undefined) {
        const params = callParameters(fn), supplied = bindArguments(params, args);
        if (!supplied) return;

        const substitutions = new Map<string, (Shape | undefined)[]>();
        for (const [index, argument] of supplied) {
            const type = params[index].d.annotation;
            const classType = type?.nodeType === K.Index && type.d.items.length === 1
                && ['typing.Type', 'builtins.type'].includes(standard(fn.file, scope, type.d.leftExpr, true)!);
            const name = nameOf(classType && type?.nodeType === K.Index ? type.d.items[0].d.valueExpr : type);
            if (!name) continue;
            const variable = typeVariable(fn.file, scope, name, fn.node);
            if (!variable || !classType && variable.node.nodeType !== K.TypeParameter) continue;
            const shape = shapeOf(argument);
            const actual = classType ? shape?.kind === 'class' && !shape.instance ? { ...shape, instance: true } : undefined : shape;
            const values = substitutions.get(name) || [];
            values.push(actual);
            substitutions.set(name, values);
        }
        return substitutions;
    }
    function overloadReturn(fn: FunctionShape, scope: Scope, args: ArgumentNode[], shapeOf: (node: Node) => Shape | undefined, at: number, seen: Set<Node>) {
        for (const declaration of fn.overloads!) {
            const params = declaration.d.params, supplied = bindArguments(params, args);
            if (!supplied) continue;
            const matches = params.map((param, index) => {
                const expected = annotation(fn.file, scope, param.d.annotation, at, seen, fn.args);
                const actual = supplied.has(index) ? shapeOf(supplied.get(index)!) : scalarLiteral(param.d.defaultValue);
                if (expected?.kind !== 'scalar' || actual?.kind !== 'scalar') return;
                return expected.type === actual.type && (expected.literal === undefined || expected.literal === actual.literal);
            });
            if (matches.includes(false)) continue;
            if (matches.includes(undefined)) return;
            return annotation(fn.file, scope, declaration.d.returnAnnotation, at, seen, fn.args);
        }
    }
    function returns(fn: FunctionShape, at: number, seen: Set<Node>, args: ArgumentNode[] = [], shapeOf?: (node: Node) => Shape | undefined): Shape | undefined {
        const d = fn.node.d as any;
        const scope = scopeOf(fn.file, fn.node), substitutions = new Map(fn.args);
        if (fn.overloads) return shapeOf && overloadReturn(fn, scope, args, shapeOf, at, seen);
        if (!d.returnAnnotation) return;
        if (shapeOf && args.length) {
            for (const [name, values] of inferTypeArguments(fn, scope, args, shapeOf) || []) substitutions.set(name, union(values)!);
        }
        const value = annotation(fn.file, scope, d.returnAnnotation, at, seen, substitutions);
        if (knownDecorators(fn.file, fn.node, ['contextmanager', 'asynccontextmanager'])) return value?.kind === 'sequence' ? { kind: 'context', item: value.item, async: knownDecorators(fn.file, fn.node, ['asynccontextmanager']) } : undefined;
        if (!d.isAsync) return value;
        const ownScope = fn.file.bindings.scopes.get(fn.node);
        const generator = [...walk(fn.node)].some(node => [K.Yield, K.YieldFrom].includes(node.nodeType) && scopeOf(fn.file, node) === ownScope);
        return generator ? value : { kind: 'awaitable', item: value };
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
        const guards: ReturnType<typeof reachingBindings>['guards'] = [];
        for (let child = node, parent = node.parent; parent && scopeOf(file, parent) === scope; child = parent, parent = parent.parent) {
            if (parent.nodeType !== K.Ternary || child === parent.d.testExpr) continue;
            const test = parent.d.testExpr;
            if (test.nodeType === K.BinaryOperation && [Op.Is, Op.IsNot].includes(test.d.operator)
                && test.d.rightExpr.nodeType === K.Constant && test.d.rightExpr.d.constType === KeywordType.None)
                guards.push({ test, positive: child === parent.d.ifExpr });
        }
        guards.push(...[...reachingBindings(scope, name, at).guards].reverse());
        while (guards.length) {
            const guard = guards.pop()!;
            let test = guard.test, positive = guard.positive;
            while (test.nodeType === K.UnaryOperation && test.d.operator === Op.Not) { positive = !positive; test = test.d.expr; }
            if (path.includes('.') && (scope.events.get(name) || []).some(event => event.attributeWrite === path.split('.')[1] && event.at > endOf(guard.test) && event.at <= at)) continue;
            if (test.nodeType === K.BinaryOperation && test.d.operator === (positive ? Op.And : Op.Or)) {
                guards.push({ test: test.d.rightExpr, positive }, { test: test.d.leftExpr, positive });
                continue;
            }
            if (test.nodeType === K.Call && nameOf(test.d.leftExpr) === 'isinstance' && unshadowed(scope, 'isinstance')
                && test.d.args.length === 2 && test.d.args.every(arg => !arg.d.name && arg.d.argCategory === 0) && reference(test.d.args[0].d.valueExpr) === path) {
                if (!positive && value?.kind === 'union' && standard(file, scope, test.d.args[1].d.valueExpr) === 'builtins.str') {
                    value = union(value.items.filter(item => item.kind !== 'scalar' || item.type !== 'str'));
                    continue;
                }
                const type = expression(file, scope, test.d.args[1].d.valueExpr, test.start, seen, substitutions);
                if (type?.kind === 'class' && !type.instance) {
                    const instance = { ...type, instance: true };
                    if (positive) {
                        const items = (value?.kind === 'union' ? value.items : [value]).filter(item => item?.kind !== 'none');
                        value = items.length ? union(items.map(item => item?.kind === 'class' && item.instance
                            && (item.node === type.node || mro(item)?.some(base => base.node === type.node)) ? item : instance)) : instance;
                    } else if (value?.kind === 'union') value = union(value.items.filter(item => !same(item, instance)));
                }
            }
            if (test.nodeType === K.BinaryOperation && [Op.Is, Op.IsNot].includes(test.d.operator) && reference(test.d.leftExpr) === path
                && test.d.rightExpr.nodeType === K.Constant && test.d.rightExpr.d.constType === KeywordType.None) {
                const isNone = positive === (test.d.operator === Op.Is);
                if (value?.kind === 'union') value = union(value.items.filter(item => (item.kind === 'none') === isNone));
            }
            if (positive && reference(test) === path && value?.kind === 'union') value = union(value.items.filter(item => item.kind !== 'none'));
        }
        return value;
    }
    function expression(file: File, scope: Scope, node: Node, at: number, seen: Set<Node>, substitutions: Map<string, Shape>, types = false, lookup?: 'callee'): Shape | undefined {
        if (seen.has(node) || seen.size > 64) return;
        seen = new Set([...seen, node]);
        const d = node.d as any;
        if (node.nodeType === K.Name) {
            const value = symbol(file, scope, d.value, at, seen, substitutions, types);
            return types ? value : narrowed(file, scope, node, at, value, seen, substitutions);
        }
        if (node.nodeType === K.Constant && d.constType === KeywordType.None) return { kind: 'none' };
        if (node.nodeType === K.StringList || node.nodeType === K.Constant) return scalarLiteral(node);
        if (node.nodeType === K.Assignment) return expression(file, scope, node.d.rightExpr, at, seen, substitutions);
        if (node.nodeType === K.Tuple) return { kind: 'tuple', items: d.items.map((item: Node) => expression(file, scope, item, at, seen, substitutions)) };
        if (node.nodeType === K.List) {
            if (node.d.items.length === 1 && node.d.items[0].nodeType === K.Comprehension)
                return expression(file, scope, node.d.items[0], at, seen, substitutions);
            return { kind: 'sequence', mutable: true, item: union(d.items.map((item: Node) => expression(file, scope, item, at, seen, substitutions))) };
        }
        if (node.nodeType === K.Comprehension && (node.d.isGenerator || node.parent?.nodeType === K.List)) {
            const item = node.d.expr;
            return { kind: 'sequence', mutable: !node.d.isGenerator, item: expression(file, scopeOf(file, item), item, item.start, seen, substitutions) };
        }
        if (node.nodeType === K.Ternary) {
            const yes = expression(file, scope, node.d.ifExpr, at, seen, substitutions);
            const no = expression(file, scope, node.d.elseExpr, at, seen, substitutions);
            if (emptyList(node.d.ifExpr) && no?.kind === 'sequence' && no.mutable) return no;
            if (emptyList(node.d.elseExpr) && yes?.kind === 'sequence' && yes.mutable) return yes;
            return union([yes, no]);
        }
        if (node.nodeType === K.BinaryOperation && node.d.operator === Op.Or && emptyList(node.d.rightExpr)) {
            const left = expression(file, scope, node.d.leftExpr, at, seen, substitutions);
            if (left?.kind === 'sequence' && left.mutable) return left;
        }
        if (node.nodeType === K.Await) { const value = expression(file, scope, d.expr, at, seen, substitutions); return value?.kind === 'awaitable' ? value.item : undefined; }
        if (node.nodeType === K.Yield) {
            if (scope.node.nodeType !== K.Function) return;
            const result = annotation(file, scopeOf(file, scope.node), (scope.node.d as any).returnAnnotation, at, seen, substitutions);
            return result?.kind === 'sequence' ? result.send : undefined;
        }
        if (node.nodeType === K.Index) {
            const { leftExpr, items, trailingComma } = node.d;
            const value = expression(file, scope, leftExpr, at, seen, substitutions);
            if (value?.kind === 'mapping') return items.some(item => item.d.valueExpr.nodeType === K.Slice) ? undefined : value.value;
            if (items.length !== 1 || trailingComma) return;
            const index = items[0].d.valueExpr;
            if (index.nodeType === K.Slice) return value?.kind === 'sequence' ? value : undefined;
            if (value?.kind === 'sequence' && !value.async) return value.item;
            if (value?.kind === 'tuple' && index.nodeType === K.Number) return value.items[Number(index.d.value)];
            return;
        }
        if (node.nodeType === K.MemberAccess) {
            if (d.leftExpr.nodeType === K.Call && nameOf(d.leftExpr.d.leftExpr) === 'super' && !d.leftExpr.d.args.length && unshadowed(scope, 'super') && scope.node.nodeType === K.Function) {
                const owner = scopeOf(file, scope.node);
                const first = (scope.node.d as any).params[0];
                if (owner.kind !== 'class' || !first?.d.name) return;
                const receiver = symbol(file, scope, first.d.name.d.value, at, seen, substitutions);
                return receiver?.kind === 'class' && receiver.node === owner.node ? member(receiver, d.member.d.value, at, seen, lookup, true) : undefined;
            }
            const left = expression(file, scope, d.leftExpr, at, seen, substitutions, types);
            if (left?.kind === 'module') {
                const value = symbol(left.file, left.file.bindings.module, d.member.d.value, Infinity, seen, new Map(), types);
                if (value || left.file.bindings.module.events.has(d.member.d.value) || !/__init__\.pyi?$/.test(left.file.record.path)) return value;
                const target = locate(left.file.record.path, '', 1, d.member.d.value), other = target && files.get(target.file);
                return target?.module && other ? { kind: 'module', file: other } : undefined;
            }
            const declaration = (owner: Shape | undefined) => owner?.kind === 'class'
                ? d.member.d.value === '__class__' && owner.instance ? { ...owner, instance: false } : member(owner, d.member.d.value, at, seen, lookup)
                : undefined;
            let value = declaration(left);
            if (left?.kind === 'union') {
                const candidates = left.items.map(declaration);
                if (candidates.every(candidate => same(candidate, candidates[0]))) value = candidates[0];
                else if (!lookup && candidates.every(candidate => candidate?.kind === 'function')) value = union(candidates);
            }
            return types ? value : narrowed(file, scope, node, at, value, seen, substitutions);
        }
        if (node.nodeType === K.Call) {
            const builtin = standard(file, scope, d.leftExpr);
            const first = d.args[0]?.d.valueExpr;
            const positional = d.args.every((arg: ArgumentNode) => arg.d.argCategory === ArgCategory.Simple && !arg.d.name);
            if (first && builtin === 'typing.cast' && positional && d.args.length === 2)
                return annotation(file, scope, first, at, seen, substitutions);
            if (first && positional && builtin === 'weakref.ref' && d.args.length === 1)
                return { kind: 'weakRef', item: expression(file, scope, first, at, seen, substitutions) };
            if (first && positional && builtin === 'builtins.enumerate' && d.args.length <= 2) {
                const item = element(expression(file, scope, first, at, seen, substitutions));
                return { kind: 'sequence', item: { kind: 'tuple', items: [undefined, item] } };
            }
            if (first && positional && builtin === 'builtins.map' && d.args.length === 2) {
                const factory = expression(file, scope, first, at, seen, substitutions);
                if (factory?.kind === 'class' && !factory.instance)
                    return { kind: 'sequence', item: { ...factory, instance: true } };
            }
            if (first && positional
                && (d.args.length === 1 || builtin === 'builtins.next' && d.args.length === 2)
                && ['builtins.next', 'builtins.iter', 'builtins.aiter', 'builtins.reversed', 'builtins.list', 'builtins.tuple', 'builtins.sorted', 'builtins.dict', 'builtins.frozenset'].includes(builtin!)) {
                const input = expression(file, scope, first, at, seen, substitutions);
                if (builtin === 'builtins.next') return d.args.length === 1 ? element(input) : union([element(input), expression(file, scope, d.args[1].d.valueExpr, at, seen, substitutions)]);
                if (builtin === 'builtins.dict') { const item = element(input); return item?.kind === 'tuple' ? { kind: 'mapping', key: item.items[0], value: item.items[1] } : input?.kind === 'mapping' ? input : undefined; }
                return { kind: 'sequence', item: element(input, builtin === 'builtins.aiter'), async: builtin === 'builtins.aiter', mutable: builtin === 'builtins.list' || builtin === 'builtins.sorted' };
            }
            if (d.leftExpr.nodeType === K.MemberAccess) {
                const left = expression(file, scope, d.leftExpr.d.leftExpr, at, seen, substitutions), name = d.leftExpr.d.member.d.value;
                if (left?.kind === 'scalar' && left.type === 'str' && name === 'partition' && positional && d.args.length === 1) {
                    const separator = expression(file, scope, first, at, seen, substitutions);
                    if (separator?.kind !== 'scalar' || separator.type !== 'str') return;
                    const part: Shape = { kind: 'scalar', type: 'str' };
                    return { kind: 'tuple', items: [part, part, part] };
                }
                if (left?.kind === 'contextVar' && name === 'get' && positional && d.args.length <= 1)
                    return first ? union([left.item, expression(file, scope, first, at, seen, substitutions)]) : left.item;
                if (left?.kind === 'mapping' && name === 'get' && positional && first && d.args.length <= 2)
                    return union([left.value, d.args[1] ? expression(file, scope, d.args[1].d.valueExpr, at, seen, substitutions) : { kind: 'none' }]);
                if (left?.kind === 'sequence' && left.mutable && name === 'pop' && positional && d.args.length <= 1) return left.item;
                if (left?.kind === 'sequence' && left.generator && name === 'send' && !left.async) return left.item;
                if (left?.kind === 'sequence' && left.generator && name === 'asend' && left.async) return { kind: 'awaitable', item: left.item };
                if (left?.kind === 'mapping' && !d.args.length && ['items', 'keys', 'values'].includes(name)) return { kind: 'sequence', item: name === 'items' ? { kind: 'tuple', items: [left.key, left.value] } : name === 'keys' ? left.key : left.value };
            }
            const callee = expression(file, scope, d.leftExpr, at, seen, substitutions);
            if (callee?.kind === 'weakRef' && !d.args.length) {
                // On immediate member access, only the live referent has a declaration.
                return node.parent?.nodeType === K.MemberAccess && node.parent.d.leftExpr === node
                    ? callee.item : union([callee.item, { kind: 'none' }]);
            }
            if (callee?.kind === 'class' && !callee.instance) return { ...callee, instance: true };
            const result = (fn: FunctionShape) => returns(fn, at, seen, d.args, argument => expression(file, scope, argument, at, seen, substitutions));
            if (callee?.kind === 'function') return result(callee);
            if (callee?.kind === 'union' && callee.items.every(item => item.kind === 'function')) return union(callee.items.map(result));
        }
        return;
    }
    for (const analysis of analyses) {
        if (!analysis.tree) continue;
        const file = analysis as File;
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
            let requireDecorator = false;
            let ordinaryBinding = false;
            let known: FunctionShape | undefined;
            if (callee.nodeType === K.Name) {
                const name = callee.d.value;
                if (file.bindings.privateCalls.has(node) && name.startsWith('__') && !name.endsWith('__')) continue;
                known = nullableFunction(file, scope, name, node.start);
                requireDecorator = !known && !localCallable(scope, name, node.start);
                if (requireDecorator) {
                    const value = file.bindings.lookup(scope, name, node.start);
                    ordinaryBinding = Boolean(value && ['function', 'import'].includes(value.kind));
                    if (!ordinaryBinding && !scope.events.has(name) && !file.bindings.module.events.has(name)) continue;
                }
            }
            const target = known ?? expression(file, scope, callee, node.start, new Set(), new Map(), false, 'callee');
            if (target?.kind !== 'function' || target.overloads || !captured.has(target.file.record.path)) continue;
            if (requireDecorator && !target.platformAlternative && (!ordinaryBinding || !knownDecorators(target.file, target.node, callableDecorators)
                && !signatureDecorators(target.file, target.node, new Set()))) continue;
            const fn = target.file.measured?.byNode.get(target.node);
            if (!fn) continue;
            fact.resolution = 'python-source-declaration'; delete fact.reason; delete fact._import;
            fact.target = { file: target.file.record.path, name: fn.name, line: fn.line, column: fn.sourceRange.column };
        }
    }
}
