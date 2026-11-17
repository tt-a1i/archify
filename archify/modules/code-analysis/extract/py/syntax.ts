import { ParseOptions, Parser } from './upstream/parser/parser.js';
import { ParseNode, ParseNodeType } from './upstream/parser/parseNodes.js';
import { DiagnosticSink } from './upstream/common/diagnosticSink.js';
import { DiagnosticCategory } from './upstream/common/diagnostic.js';
import { PythonVersion } from './upstream/common/pythonVersion.js';
import { validateStringVersion } from './upstream/parser/stringVersionChecks.js';

export function parsePython(text: string, targetVersion = '3.14') {
    if (!/^3\.(?:[8-9]|1[0-4])$/.test(targetVersion)) throw new Error(`Unsupported target Python version: ${targetVersion}`);
    const options = new ParseOptions();
    options.pythonVersion = PythonVersion.create(...targetVersion.split('.').map(Number) as [number, number]);
    const sink = new DiagnosticSink();
    const parsed = new Parser().parseSourceFile(text, options, sink);
    if (Number(targetVersion.split('.')[1]) < 12)
        for (const node of walk(parsed.parserOutput.parseTree)) validateStringVersion(node, parsed.tokenizerOutput.lines, sink);
    const errors = sink.fetchAndClear().filter(error => error.category === DiagnosticCategory.Error);
    return { ...parsed, errors };
}

// Raw parser children only. Quoted annotations are strings, not extra executed
// syntax, and parent/analyzer metadata never participates in this traversal.
export function children(node: ParseNode): ParseNode[] {
    const out: ParseNode[] = [];
    const append = (value: unknown): void => {
        if (Array.isArray(value)) { for (const child of value) append(child); }
        else if (value && typeof value === 'object' && 'nodeType' in value && 'start' in value) out.push(value as ParseNode);
    };
    for (const [key, value] of Object.entries(node.d))
        if (!['annotationComment', 'chainedAnnotationComment', 'funcAnnotationComment'].includes(key)) append(value);
    return out;
}

export function* walk(node: ParseNode): Generator<ParseNode> {
    const pending = [node];
    while (pending.length) {
        const current = pending.pop()!;
        yield current;
        const next = children(current);
        for (let i = next.length - 1; i >= 0; i--) pending.push(next[i]);
    }
}
