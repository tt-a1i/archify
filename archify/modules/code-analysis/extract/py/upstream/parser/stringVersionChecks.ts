/*
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Adapted from analyzer/checker.ts, visitStringList, Pyright 1.1.414.
 * Only syntax/version checks are retained; diagnostics do not require a type
 * evaluator. Archify supplies the parser's diagnostic sink and raw children.
 */
import { DiagnosticSink } from '../common/diagnosticSink.js';
import { convertOffsetsToRange } from '../common/positionUtils.js';
import { TextRange } from '../common/textRange.js';
import { TextRangeCollection } from '../common/textRangeCollection.js';
import { FormatStringNode, ParseNode, ParseNodeType } from './parseNodes.js';
import { StringTokenFlags, TokenType } from './tokenizerTypes.js';

export function validateStringVersion(node: ParseNode, lines: TextRangeCollection<TextRange>, sink: DiagnosticSink) {
    if (node.nodeType !== ParseNodeType.StringList) return;
    const containers: FormatStringNode[] = [];
    for (let current: ParseNode | undefined = node; current; current = current.parent)
        if (current.nodeType === ParseNodeType.FormatString) containers.push(current);
    if (!containers.length) return;
    for (const string of node.d.strings) {
        const tokens = string.nodeType === ParseNodeType.String ? [string.d.token] : string.d.middleTokens;
        for (const token of tokens) {
            if (token.escapedValue.includes('\\')) {
                const start = token.start + (token.type === TokenType.String ? token.prefixLength + token.quoteMarkLength : 0);
                sink.addError('An f-string expression cannot include a backslash before Python 3.12', convertOffsetsToRange(start, start + 1, lines));
            }
        }
        const mask = StringTokenFlags.SingleQuote | StringTokenFlags.DoubleQuote | StringTokenFlags.Triplicate;
        if (containers.some(container => (container.d.token.flags & mask) === (string.d.token.flags & mask)))
            sink.addError('An f-string expression cannot reuse the enclosing quote before Python 3.12', convertOffsetsToRange(string.start, string.start + string.length, lines));
    }
}
