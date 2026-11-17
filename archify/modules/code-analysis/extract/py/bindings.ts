// Source binding, separate from parsing and target selection as in Pyright.
// This is Archify's bounded declaration model, not Pyright's type evaluator.
import { ParseNode as Node, ParseNodeType as K } from './upstream/parser/parseNodes.js';
import { children, walk } from './syntax.js';
import { OperatorType as Op } from './upstream/parser/tokenizerTypes.js';
import { bindingNames, body, endOf, moduleName, nameOf } from './facts.js';

export interface Binding {
    name: string; node: Node; at: number; conditional: boolean; loaderConditional: boolean;
    kind: 'function' | 'class' | 'import' | 'module' | 'value' | 'parameter';
    module?: string; level?: number; imported?: string; expr?: Node; annotation?: Node;
    runtime?: boolean;
    attributeWrite?: string;
    source?: 'iteration' | 'context';
    projection?: number[];
    async?: boolean;
}
export class Scope {
    events = new Map<string, Binding[]>();
    declarations = new Map<string, 'global' | 'nonlocal'>();
    constructor(public node: Node, public kind: 'module' | 'function' | 'class', public parent?: Scope) {}
    bind(binding: Binding) {
        const values = this.events.get(binding.name) || [];
        values.push(binding); this.events.set(binding.name, values);
    }
}
const conditionalBlocks = new Set([K.If, K.Try, K.For, K.While, K.Match]);
const defaults = (node: Node): Node[] => ((node.d as any).params || []).flatMap((p: Node) => (p.d as any).defaultValue ? [(p.d as any).defaultValue] : []);
const decorators = (node: Node): Node[] => ((node.d as any).decorators || []).map((d: Node) => (d.d as any).expr);
export const headers = (node: Node): Node[] => node.nodeType === K.Class
    ? [...decorators(node), ...((node.d as any).arguments || []).map((a: Node) => (a.d as any).valueExpr)]
    : [...decorators(node), ...defaults(node)];
export const annotations = (node: Node): Node[] => [
    ...((node.d as any).params || []).flatMap((p: Node) => (p.d as any).annotation ? [(p.d as any).annotation] : []),
    ...((node.d as any).returnAnnotation ? [(node.d as any).returnAnnotation] : []),
];
export const typeParameters = (node: Node): Node[] => (node.d as any).typeParams?.d.params || [];

export function bindModule(tree: Node) {
    const scopes = new Map<Node, Scope>();
    const nodeScopes = new Map<Node, Scope>();
    const suppressed = new Set<Node>();
    const privateCalls = new Set<Node>();
    const mutable = new Set<string>();
    const loaderMutable = new Set<string>();

    // Scan the entire lexical block before resolving any name. A store after a
    // use still makes that name local in Python; branch stores remain uncertain.
    const create = (node: Node, kind: Scope['kind'], nodes: Node[], parent?: Scope, params: Node[] = []) => {
        const scope = new Scope(node, kind, parent); scopes.set(node, scope);
        const add = (name: string, owner: Node, conditional: boolean, loaderConditional: boolean, extra: Partial<Binding> = {}) =>
            scope.bind({ name, node: owner, at: endOf(owner), kind: 'value', conditional, loaderConditional, ...extra });
        const target = (value: Node | undefined, owner: Node, conditional: boolean, loaderConditional: boolean, extra: Partial<Binding> = {}) => {
            if (value?.nodeType === K.Tuple || value?.nodeType === K.List) {
                value.d.items.forEach((item, index) => target(item, owner, conditional, loaderConditional, { ...extra, projection: [...(extra.projection || []), index] }));
                return;
            }
            for (const name of bindingNames(value)) add(name, owner, conditional, loaderConditional, extra);
            if (value?.nodeType === K.TypeAnnotation) value = value.d.valueExpr;
            // Attribute writes invalidate a loader/receiver alias as well.
            if (value?.nodeType === K.MemberAccess && value.d.leftExpr.nodeType === K.Name)
                add(value.d.leftExpr.d.value, owner, conditional, loaderConditional, { ...extra, runtime: true, attributeWrite: value.d.member.d.value });
        };
        const scan = (current: Node, conditional = false, loaderConditional = false): void => {
            const d = current.d as any;
            if ([K.Function, K.Class, K.Lambda].includes(current.nodeType)) {
                if (current.nodeType !== K.Lambda) add(d.name.d.value, current, conditional, loaderConditional,
                    { kind: current.nodeType === K.Class ? 'class' : 'function' });
                for (const child of headers(current)) scan(child, conditional, loaderConditional);
                return;
            }
            if (current.nodeType === K.Comprehension) {
                for (const part of walk(current)) if (part.nodeType === K.AssignmentExpression)
                    target(part.d.name, part, conditional, loaderConditional, { expr: part.d.rightExpr });
                return;
            }
            if ([K.Global, K.Nonlocal].includes(current.nodeType)) {
                for (const value of d.targets) { scope.declarations.set(value.d.value, current.nodeType === K.Global ? 'global' : 'nonlocal'); mutable.add(value.d.value); }
                return;
            }
            if (current.nodeType === K.Import) {
                for (const item of d.list) add(nameOf(item.d.alias) || moduleName(item.d.module).split('.')[0], current, conditional, loaderConditional,
                    { kind: 'module', module: moduleName(item.d.module), level: 0, imported: item.d.alias ? '*' : moduleName(item.d.module).split('.')[0] });
                return;
            }
            if (current.nodeType === K.ImportFrom) {
                if (d.isWildcardImport) add('*', current, conditional, loaderConditional);
                for (const item of d.imports) add(nameOf(item.d.alias) || nameOf(item.d.name)!, current, conditional, loaderConditional,
                    { kind: 'import', module: moduleName(d.module), level: d.module.d.leadingDots, imported: nameOf(item.d.name) });
                return;
            }
            if ([K.Assignment, K.AugmentedAssignment].includes(current.nodeType)) {
                target(d.leftExpr, current, conditional, loaderConditional, { expr: current.nodeType === K.Assignment ? d.rightExpr : undefined,
                    annotation: d.leftExpr.nodeType === K.TypeAnnotation ? d.leftExpr.d.annotation : undefined });
                scan(d.rightExpr, conditional, loaderConditional); return;
            }
            if (current.nodeType === K.TypeAnnotation) { target(d.valueExpr, current, conditional, loaderConditional, { annotation: d.annotation, runtime: false }); return; }
            if (current.nodeType === K.AssignmentExpression) { target(d.name, current, conditional, loaderConditional, { expr: d.rightExpr }); scan(d.rightExpr, conditional, loaderConditional); return; }
            if (current.nodeType === K.Del) { for (const expr of d.targets) target(expr, current, conditional, loaderConditional); return; }
            if ([K.For, K.ComprehensionFor].includes(current.nodeType)) target(d.targetExpr, current, true, true, { expr: d.iterableExpr, source: 'iteration', async: Boolean(d.isAsync) });
            if (current.nodeType === K.WithItem) target(d.target, current, true, loaderConditional, { expr: d.expr, source: 'context', async: Boolean((current.parent?.d as any).isAsync) });
            if (current.nodeType === K.Except && d.name) target(d.name, current, true, true);
            if ([K.PatternCapture, K.PatternAs, K.PatternMappingExpandEntry].includes(current.nodeType) && d.target && !d.isWildcard)
                target(d.target, current, true, loaderConditional);
            if (current.nodeType === K.TypeAlias) { target(d.name, current, conditional, loaderConditional); return; }
            const guarded = conditionalBlocks.has(current.nodeType);
            for (const child of flatChildren(current, true)) scan(child, conditional || guarded || current.nodeType === K.With, loaderConditional || guarded);
        };
        for (const current of nodes) scan(current);
        for (const param of params) if ((param.d as any).name) add((param.d as any).name.d.value, param, false, false, { kind: 'parameter', annotation: (param.d as any).annotation });
        for (const name of scope.declarations.keys()) if (scope.events.has(name)) loaderMutable.add(name);
        return scope;
    };
    const module = create(tree, 'module', body(tree));
    const visit = (node: Node, scope: Scope, isAnnotation = false, inClass = false): void => {
        nodeScopes.set(node, scope);
        const d = node.d as any;
        if (isAnnotation) suppressed.add(node);
        if (inClass && node.nodeType === K.Call) privateCalls.add(node);
        if ([K.Function, K.Lambda].includes(node.nodeType)) {
            for (const value of headers(node)) visit(value, scope, isAnnotation, inClass);
            for (const value of [...annotations(node), ...typeParameters(node)]) visit(value, scope, true, inClass);
            let parent = scope;
            while (parent.kind === 'class' && parent.parent) parent = parent.parent;
            const nodes = node.nodeType === K.Lambda ? [d.expr] : body(node);
            const own = create(node, 'function', nodes, parent, d.params);
            // PEP 695 parameters shadow same-spelled outer values.
            for (const param of typeParameters(node)) own.bind({ name: (param.d as any).name.d.value, node: param, at: param.start, kind: 'parameter', conditional: false, loaderConditional: false });
            for (const value of nodes) visit(value, own, isAnnotation, inClass);
            return;
        }
        if (node.nodeType === K.Class) {
            for (const value of decorators(node)) visit(value, scope, isAnnotation, inClass);
            const generic = typeParameters(node).length > 0;
            for (const arg of d.arguments || []) visit(arg.d.valueExpr, scope, isAnnotation || generic, inClass);
            for (const param of typeParameters(node)) visit(param, scope, true, inClass);
            const own = create(node, 'class', body(node), scope);
            for (const param of typeParameters(node)) own.bind({ name: (param.d as any).name.d.value, node: param, at: param.start, kind: 'parameter', conditional: false, loaderConditional: false });
            for (const value of body(node)) visit(value, own, isAnnotation, true);
            return;
        }
        if (node.nodeType === K.Comprehension) {
            const first = d.forIfNodes[0];
            visit(first.d.iterableExpr, scope, isAnnotation, inClass);
            const nodes: Node[] = [first.d.targetExpr, ...d.forIfNodes.slice(1), d.expr];
            let parent = scope;
            while (parent.kind === 'class' && parent.parent) parent = parent.parent;
            const own = create(node, 'function', nodes, parent);
            for (const name of bindingNames(first.d.targetExpr)) own.bind({ name, node: first, at: first.start, kind: 'parameter', conditional: false, loaderConditional: false });
            for (const value of nodes) visit(value, own, isAnnotation, inClass);
            return;
        }
        if (node.nodeType === K.TypeAnnotation) { visit(d.valueExpr, scope, isAnnotation, inClass); visit(d.annotation, scope, true, inClass); return; }
        if (node.nodeType === K.TypeAlias) { for (const child of children(node)) visit(child, scope, true, inClass); return; }
        for (const child of flatChildren(node, true)) visit(child, scope, isAnnotation, inClass);
    };
    visit(tree, module);
    const unique = (scope: Scope, name: string) => {
        const values = scope.events.get(name)?.filter(value => !value.attributeWrite);
        return values?.length === 1 && !values[0].conditional ? values[0] : undefined;
    };
    const lookup = (scope: Scope, name: string, at: number, origin = scope): Binding | undefined => {
        if (scope.declarations.has(name) || scope.events.has('*') || name === '__class__') return;
        if (scope.kind === 'module') return mutable.has(name) ? undefined : unique(scope, name);
        if (scope.events.has(name)) {
            const value = unique(scope, name);
            // Preserve the existing local-import execution guard. Value/parameter
            // types are handled separately, never mistaken for callable defs.
            return scope === origin && scope.kind === 'function' && value?.kind === 'import' && value.at <= at ? value : undefined;
        }
        return scope.parent ? lookup(scope.parent, name, at, origin) : undefined;
    };
    const loader = (scope: Scope, name: string, at: number, deferred = false): string | undefined => {
        if (scope.events.has('*')) return;
        const events = scope.events.get(name);
        let value: Binding | undefined;
        if (events) {
            if (deferred) {
                if (events.length === 1 && !loaderMutable.has(name) && !events[0].loaderConditional) value = events[0];
            } else value = events.filter(event => event.at <= at && event.runtime !== false).at(-1);
            if (value?.kind === 'module' && value.module === 'importlib' && !value.loaderConditional) return 'importlib';
            if (value?.kind === 'import' && !value.level && value.module === 'importlib' && value.imported === 'import_module' && !value.loaderConditional) return 'loader';
            if (value || deferred || scope.kind === 'function') return;
        }
        if (scope.parent) {
            let parent = scope.parent;
            if (scope.declarations.get(name) === 'global') while (parent.parent) parent = parent.parent;
            return loader(parent, name, at, deferred || scope.kind === 'function');
        }
        return name === '__import__' && !loaderMutable.has(name) ? 'loader' : undefined;
    };
    return { module, scopes, nodeScopes, suppressed, privateCalls, mutable, unique, lookup, loader };
}
export type Bindings = ReturnType<typeof bindModule>;

// Flatten long arithmetic chains. Binding scans may also flatten booleans;
// the import visitor retains their conditional evaluation guards.
export function flatChildren(node: Node, flattenBooleans = false): Node[] {
    const out: Node[] = [], pending = children(node).reverse();
    while (pending.length) {
        const child = pending.pop()!;
        if (child.nodeType === K.BinaryOperation && (flattenBooleans || ![Op.And, Op.Or].includes((child.d as any).operator))) {
            pending.push(...children(child).reverse());
        } else out.push(child);
    }
    return out;
}
