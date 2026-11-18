import { ParseNode as Node, ParseNodeType as K } from './upstream/parser/parseNodes.js';
import { OperatorType as Op } from './upstream/parser/tokenizerTypes.js';
import { parsePython, walk } from './syntax.js';
import { Bindings, annotations, bindModule, flatChildren, headers, typeParameters } from './bindings.js';
import { CallFact, ImportFact, SourceContext, body, decodePython, endOf, functionFacts, literalString, moduleBindings, moduleName, nameOf, sourceContext } from './facts.js';

export function collectImports(tree: Node, context: SourceContext, bindings: Bindings) {
    const found: ImportFact[] = [];
    type Flags = { lazy?: boolean; conditional?: boolean; typeOnly?: boolean };
    const counts = new Map<string, number>();
    for (const scope of bindings.scopes.values()) for (const [name, values] of scope.events) counts.set(name, (counts.get(name) || 0) + values.length);
    const checks = new Map<string, number>(), typing = new Map<string, number>();
    for (const [name, events] of bindings.module.events) {
        const value = events[0];
        if (events.length !== 1 || counts.get(name) !== 1 || value.conditional || value.level || value.module !== 'typing') continue;
        if (value.kind === 'module') typing.set(name, value.at);
        if (value.kind === 'import' && value.imported === 'TYPE_CHECKING') checks.set(name, value.at);
    }
    const emit = (node: Node, flags: Flags, fields: Omit<ImportFact, 'line' | 'column'>) => found.push({ ...context.point(node.start), ...fields, ...flags });
    const many = (nodes: (Node | undefined)[], flags: Flags) => { for (const node of nodes) if (node) visit(node, flags); };
    const visit = (node: Node, flags: Flags): void => {
        const d = node.d as any;
        if ([K.Function, K.Lambda].includes(node.nodeType)) {
            many(typeParameters(node), { ...flags, lazy: true });
            many(headers(node), flags); many(annotations(node), { ...flags, conditional: true });
            many(node.nodeType === K.Lambda ? [d.expr] : body(node), { ...flags, lazy: true }); return;
        }
        if (node.nodeType === K.Class) {
            many(typeParameters(node), { ...flags, lazy: true }); many([...headers(node), ...body(node)], flags); return;
        }
        if (node.nodeType === K.TypeAlias) { many([...typeParameters(node), d.expr], { ...flags, lazy: true }); return; }
        if (node.nodeType === K.If) {
            let check = d.testExpr, negated = check.nodeType === K.UnaryOperation && check.d.operator === Op.Not;
            if (negated) check = check.d.expr;
            const typeCheck = check.nodeType === K.Name ? (checks.get(check.d.value) ?? Infinity) < node.start
                : check.nodeType === K.MemberAccess && check.d.member.d.value === 'TYPE_CHECKING'
                    && (typing.get(nameOf(check.d.leftExpr) || '') ?? Infinity) < node.start;
            visit(d.testExpr, flags);
            many([d.ifSuite], { ...flags, ...(typeCheck ? (negated ? {} : { typeOnly: true }) : { conditional: true }) });
            many([d.elseSuite], { ...flags, ...(typeCheck ? (negated ? { typeOnly: true } : {}) : { conditional: true }) }); return;
        }
        if (node.nodeType === K.Try) {
            many([d.trySuite, ...d.exceptClauses, d.elseSuite], { ...flags, conditional: true }); many([d.finallySuite], flags); return;
        }
        if (node.nodeType === K.For) {
            visit(d.iterableExpr, flags); many([d.targetExpr, d.forSuite, d.elseSuite], { ...flags, conditional: true }); return;
        }
        if (node.nodeType === K.While) { visit(d.testExpr, flags); many([d.whileSuite, d.elseSuite], { ...flags, conditional: true }); return; }
        if (node.nodeType === K.Match) { visit(d.expr, flags); many(d.cases, { ...flags, conditional: true }); return; }
        if (node.nodeType === K.Ternary) { visit(d.testExpr, flags); many([d.ifExpr, d.elseExpr], { ...flags, conditional: true }); return; }
        if (node.nodeType === K.BinaryOperation && [Op.And, Op.Or].includes(d.operator)) {
            const pending = [{ node, flags }];
            while (pending.length) {
                const item = pending.pop()!, value = item.node.d as any;
                if (item.node.nodeType === K.BinaryOperation && [Op.And, Op.Or].includes(value.operator)) {
                    pending.push({ node: value.rightExpr, flags: { ...item.flags, conditional: true } }, { node: value.leftExpr, flags: item.flags });
                } else visit(item.node, item.flags);
            }
            return;
        }
        if (node.nodeType === K.Comprehension) {
            const first = d.forIfNodes[0]; visit(first.d.iterableExpr, flags);
            many([first.d.targetExpr, ...d.forIfNodes.slice(1), d.expr], { ...flags, conditional: true, ...(d.isGenerator ? { lazy: true } : {}) }); return;
        }
        if (node.nodeType === K.Import) {
            for (const item of d.list) emit(node, flags, { kind: 'static', level: 0, module: moduleName(item.d.module), names: ['*'] }); return;
        }
        if (node.nodeType === K.ImportFrom) {
            emit(node, flags, { kind: 'static', level: d.module.d.leadingDots, module: moduleName(d.module),
                names: d.isWildcardImport ? ['*'] : d.imports.map((item: Node) => nameOf((item.d as any).name)!).sort() }); return;
        }
        if (node.nodeType === K.Call) {
            const scope = bindings.nodeScopes.get(node)!;
            const callee = d.leftExpr;
            const loader = callee.nodeType === K.Name ? bindings.loader(scope, callee.d.value, node.start) === 'loader'
                : callee.nodeType === K.MemberAccess && callee.d.member.d.value === 'import_module'
                    && bindings.loader(scope, nameOf(callee.d.leftExpr) || '', node.start) === 'importlib';
            if (loader) {
                const target = literalString(d.args[0]?.d.valueExpr);
                emit(node, flags, { kind: 'dynamic', level: 0, module: target ?? '<computed>', names: [], ...(target === null ? { opaque: true } : {}) });
            }
        }
        many(flatChildren(node), flags);
    };
    visit(tree, {});
    return found.sort((a, b) => a.line - b.line || a.module.localeCompare(b.module));
}

export function analyzeFile(path: string, bytes: Uint8Array, targetVersion = '3.14', declarationsOnly = false) {
    const record = { path, loc: 0, sourceText: '', imports: [] as ImportFact[], symbols: [] as ReturnType<typeof moduleBindings>,
        functions: [] as ReturnType<typeof functionFacts>['facts'], calls: [] as CallFact[],
        definitions: Object.create(null) as Record<string, unknown>, importBindings: Object.create(null) as Record<string, unknown>, error: undefined as string | undefined };
    let text: string;
    try { text = decodePython(bytes); } catch (error) { record.error = (error as Error).message; return { record }; }
    record.sourceText = text;
    record.loc = text ? text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).length - (/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/.test(text) ? 1 : 0) : 0;
    const parsed = parsePython(text, targetVersion), context = sourceContext(text, parsed);
    if (parsed.errors.length) {
        record.error = parsed.errors.map(error => `${error.message} (line ${error.range.start.line + 1})`).join('; ');
        return { record };
    }
    const tree = parsed.parserOutput.parseTree;
    const bindings = bindModule(tree);
    record.imports = collectImports(tree, context, bindings);
    if (declarationsOnly) return { record, tree, bindings, context };
    const measured = functionFacts(tree, context);
    record.functions = measured.facts; record.symbols = moduleBindings(tree, context);
    const eligible = (binding: ReturnType<Bindings['lookup']>) => binding?.kind === 'function'
        && !(binding.node.d as any).decorators.length ? measured.byNode.get(binding.node) : undefined;
    for (const name of bindings.module.events.keys()) {
        const candidate = bindings.lookup(bindings.module, name, Infinity), fn = eligible(candidate);
        if (fn) record.definitions[name] = { name: fn.name, ...fn.sourceRange };
        if (candidate?.kind === 'import') record.importBindings[name] = { module: candidate.module, level: candidate.level, name: candidate.imported };
    }
    for (const node of walk(tree)) {
        if (node.nodeType !== K.Call) continue;
        const callee = node.d.leftExpr;
        const call: CallFact = { ...context.range(node.start, endOf(node)), resolution: 'unresolved',
            reason: callee.nodeType === K.Name ? 'no-local-function-binding' : 'unsupported-callee' };
        const name = nameOf(callee);
        const privateName = name && bindings.privateCalls.has(node) && name.startsWith('__') && !name.endsWith('__');
        if (name && !privateName && !bindings.suppressed.has(node)) {
            const candidate = bindings.lookup(bindings.nodeScopes.get(node)!, name, node.start), fn = eligible(candidate);
            if (fn) { call.resolution = 'same-file-function'; delete call.reason; call.target = { name: fn.name, line: fn.line, column: fn.sourceRange.column }; }
            else if (candidate?.kind === 'import') call._import = { module: candidate.module, level: candidate.level, name: candidate.imported };
        }
        record.calls.push(call);
    }
    record.calls.sort((a, b) => a.line - b.line || a.column - b.column || a.endLine - b.endLine || a.endColumn - b.endColumn);
    return { record, tree, bindings, measured, context };
}
export type Analysis = ReturnType<typeof analyzeFile>;
