// Archify facts over the transplanted Pyright syntax tree. These measurements
// keep Archify's source ranges and McCabe/nesting policy, not Pyright's internal
// type-analysis complexity factor.
import { createHash } from 'node:crypto';
import { decodeSource } from '../../core/source-decoding.mjs';
import { ParseNode as Node, ParseNodeType as K, FunctionNode, ModuleNode } from './upstream/parser/parseNodes.js';
import { OperatorType as Op, StringTokenFlags } from './upstream/parser/tokenizerTypes.js';
import { parsePython, children } from './syntax.js';

export interface Point { line: number; column: number }
export interface SourceRange extends Point { endLine: number; endColumn: number; sha256?: string }
export interface ImportFact { line: number; column: number; kind: string; level: number; module: string; names: string[]; lazy?: boolean; conditional?: boolean; typeOnly?: boolean; opaque?: boolean }
export interface FunctionFact { name: string; qualname: string; line: number; endLine: number; sourceRange: SourceRange; definition: { kind: string; sourceRange: SourceRange }; complexity: number; nesting: number; deepestLine: number }
export interface CallFact extends SourceRange { resolution: string; reason?: string; target?: { file?: string; name: string; line: number; column: number }; _import?: unknown }

export const body = (node: Node): Node[] => (node.d as any).statements || ((node.d as any).suite ? body((node.d as any).suite) : []);
export const nameOf = (node?: Node): string | undefined => node?.nodeType === K.Name ? node.d.value : undefined;
export const moduleName = (node: Node): string => ((node.d as any).nameParts || []).map((part: Node) => nameOf(part)).join('.');
export const endOf = (node: Node) => node.start + node.length;

export function sourceContext(text: string, parsed: ReturnType<typeof parsePython>) {
    const starts = [0];
    for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
    const point = (offset: number): Point => {
        let low = 0, high = starts.length;
        while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle; }
        return { line: low + 1, column: offset - starts[low] + 1 };
    };
    const range = (start: number, end: number, digest = false): SourceRange => ({ ...point(start),
        endLine: point(end).line, endColumn: point(end).column,
        ...(digest ? { sha256: createHash('sha256').update(text.slice(start, end)).digest('hex') } : {}) });
    const tokenIndex = new Map<number, number>();
    const tokens = parsed.tokenizerOutput.tokens;
    for (let index = 0; index < tokens.count; index++) tokenIndex.set(tokens.getItemAt(index).start, index);
    const functionStart = (node: FunctionNode) => {
        const index = tokenIndex.get(node.d.firstToken.start)!;
        return node.d.isAsync && index > 0 ? tokens.getItemAt(index - 1).start : node.d.firstToken.start;
    };
    return { text, point, range, functionStart };
}
export type SourceContext = ReturnType<typeof sourceContext>;

function irrefutable(pattern: Node): boolean {
    const d = pattern.d as any;
    if (pattern.nodeType === K.PatternCapture) return true;
    if (pattern.nodeType === K.PatternAs) return !d.target && d.orPatterns?.length === 1 && irrefutable(d.orPatterns[0]);
    return false;
}

export function measureFunction(node: FunctionNode, context: SourceContext) {
    let complexity = 1, nesting = 0, deepestLine = context.point(context.functionStart(node)).line;
    const pending = body(node).map(current => ({ current, depth: 0, parent: node.d.suite as Node })).reverse();
    while (pending.length) {
        const { current, depth, parent } = pending.pop()!;
        if ([K.Function, K.Class].includes(current.nodeType)) continue;
        const d = current.d as any;
        if ([K.If, K.For, K.While, K.Except, K.Ternary, K.ComprehensionFor, K.ComprehensionIf].includes(current.nodeType)) complexity++;
        if (current.nodeType === K.BinaryOperation && [Op.And, Op.Or].includes(d.operator)) complexity++;
        if (current.nodeType === K.Case && (d.guardExpr || !irrefutable(d.pattern))) complexity++;
        let nextDepth = depth;
        if ([K.If, K.For, K.While, K.With, K.Try, K.Match].includes(current.nodeType)) {
            const elif = current.nodeType === K.If && parent?.nodeType === K.If && (parent.d as any).elseSuite === current;
            nextDepth = elif ? depth : depth + 1;
            if (nextDepth > nesting) { nesting = nextDepth; deepestLine = context.point(current.start).line; }
        }
        for (const child of children(current).reverse()) pending.push({ current: child, depth: nextDepth, parent: current });
    }
    return { complexity, nesting, deepestLine };
}

export function functionFacts(tree: ModuleNode, context: SourceContext) {
    const facts: FunctionFact[] = [];
    const byNode = new Map<Node, FunctionFact>();
    const pending = [{ node: tree as Node, prefix: '' }];
    while (pending.length) {
        const { node, prefix } = pending.pop()!;
        const d = node.d as any;
        if (node.nodeType === K.Function) {
            const fn = node as FunctionNode;
            const start = context.functionStart(fn), end = endOf(node);
            const sourceRange = context.range(start, end, true);
            const fact = { name: d.name.d.value, qualname: prefix + d.name.d.value,
                line: sourceRange.line, endLine: sourceRange.endLine, sourceRange,
                definition: { kind: d.isAsync ? 'AsyncFunctionDef' : 'FunctionDef', sourceRange: context.range(node.start, end, true) },
                ...measureFunction(fn, context) };
            facts.push(fact); byNode.set(node, fact);
            for (const child of [...body(node)].reverse()) pending.push({ node: child, prefix: fact.qualname + '.<locals>.' });
            continue;
        }
        if (node.nodeType === K.Lambda) continue;
        const next = node.nodeType === K.Class ? prefix + d.name.d.value + '.' : prefix;
        for (const child of children(node).reverse()) pending.push({ node: child, prefix: next });
    }
    facts.sort((a, b) => a.line - b.line || compareText(a.qualname, b.qualname));
    return { facts, byNode };
}

export function bindingNames(target: Node | undefined): string[] {
    if (!target) return [];
    const d = target.d as any;
    if (target.nodeType === K.Name) return [d.value];
    if (target.nodeType === K.TypeAnnotation) return bindingNames(d.valueExpr);
    if ([K.Tuple, K.List].includes(target.nodeType)) return d.items.flatMap(bindingNames);
    if (target.nodeType === K.Unpack) return bindingNames(d.expr);
    return [];
}

export function moduleBindings(tree: ModuleNode, context: SourceContext) {
    const seen = new Map<string, { name: string; kind: string; line: number }>();
    const bind = (name: string, kind: string, node: Node) => {
        const start = node.nodeType === K.Function ? context.functionStart(node) : node.nodeType === K.Class ? node.d.firstToken.start : node.start;
        if (!seen.has(name)) seen.set(name, { name, kind, line: context.point(start).line });
    };
    const visit = (node: Node) => {
        const d = node.d as any;
        if ([K.Function, K.Class].includes(node.nodeType)) { bind(d.name.d.value, node.nodeType === K.Class ? 'class' : 'function', node); return; }
        if (node.nodeType === K.Assignment) { for (const name of bindingNames(d.leftExpr)) bind(name, 'variable', node); visit(d.rightExpr); return; }
        if (node.nodeType === K.AugmentedAssignment) { for (const name of bindingNames(d.leftExpr)) bind(name, 'variable', node); return; }
        if (node.nodeType === K.Import) { for (const item of d.list) bind(nameOf(item.d.alias) || moduleName(item.d.module).split('.')[0], 'import', node); return; }
        if (node.nodeType === K.ImportFrom) { for (const item of d.imports) bind(nameOf(item.d.alias) || nameOf(item.d.name)!, 'import', node); return; }
        if (node.nodeType === K.Try) { for (const child of [d.trySuite, d.elseSuite, d.finallySuite, ...d.exceptClauses]) if (child) visit(child); return; }
        if ([K.Module, K.Suite, K.StatementList, K.If, K.Try, K.Except, K.With, K.For, K.While].includes(node.nodeType)) {
            for (const child of children(node)) visit(child);
        }
    };
    visit(tree);
    return [...seen.values()].sort((a, b) => a.line - b.line || compareText(a.name, b.name));
}

export const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function decodePython(bytes: Uint8Array): string {
    return decodeSource(Buffer.from(bytes), 'source.py', { strict: true });
}

export function literalString(node?: Node): string | null {
    if (node?.nodeType !== K.StringList) return null;
    const values = node.d.strings;
    if (values.some(part => part.nodeType !== K.String || (part.d.token.flags & StringTokenFlags.Bytes))) return null;
    return values.map(part => (part.d as any).value).join('');
}
