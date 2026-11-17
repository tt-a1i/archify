/* Derived from microsoft/pyright 1.1.414, MIT, Copyright Microsoft Corporation.
 * Parser-only diagnostic values; editor actions, URIs and serialization removed.
 */
import { appendArray } from './collectionUtils.js';
import { Range, TextRange } from './textRange.js';
const defaultMaxDiagnosticDepth = 5;
const defaultMaxDiagnosticLineCount = 8;
const maxRecursionCount = 64;
export const enum DiagnosticCategory { Error, Warning, Information }
export class Diagnostic {
    constructor(readonly category: DiagnosticCategory, readonly message: string, readonly range: Range) {}
}
export class DiagnosticAddendum {
    private _messages: string[] = [];
    private _childAddenda: DiagnosticAddendum[] = [];

    // The nest level is accurate only for the common case where all
    // addendum are created using createAddendum. This is an upper bound.
    // The actual nest level may be smaller.
    private _nestLevel: number | undefined;

    // Addenda normally don't have their own ranges, but there are cases
    // where we want to track ranges that can influence the range of the
    // diagnostic.
    private _range: TextRange | undefined;

    addMessage(message: string) {
        this._messages.push(message);
    }

    addMessageMultiline(message: string) {
        message.split('\n').forEach((line) => {
            this._messages.push(line);
        });
    }

    addTextRange(range: TextRange) {
        this._range = range;
    }

    // Create a new (nested) addendum to which messages can be added.
    createAddendum() {
        const newAddendum = new DiagnosticAddendum();
        newAddendum._nestLevel = (this._nestLevel ?? 0) + 1;
        this.addAddendum(newAddendum);
        return newAddendum;
    }

    getString(maxDepth = defaultMaxDiagnosticDepth, maxLineCount = defaultMaxDiagnosticLineCount): string {
        let lines = this._getLinesRecursive(maxDepth, maxLineCount);

        if (lines.length > maxLineCount) {
            lines = lines.slice(0, maxLineCount);
            lines.push('  ...');
        }

        const text = lines.join('\n');
        if (text.length > 0) {
            return '\n' + text;
        }

        return '';
    }

    isEmpty() {
        return this._getMessageCount() === 0;
    }

    addAddendum(addendum: DiagnosticAddendum) {
        this._childAddenda.push(addendum);
    }

    getChildren() {
        return this._childAddenda;
    }

    getMessages() {
        return this._messages;
    }

    getNestLevel() {
        return this._nestLevel ?? 0;
    }

    // Returns undefined if no range is associated with this addendum
    // or its children. Returns a non-empty range if there is a single range
    // associated.
    getEffectiveTextRange(): TextRange | undefined {
        const range = this._getTextRangeRecursive();

        // If we received an empty range, it means that there were multiple
        // non-overlapping ranges associated with this addendum.
        if (range?.length === 0) {
            return undefined;
        }

        return range;
    }

    private _getTextRangeRecursive(recursionCount = 0): TextRange | undefined {
        if (recursionCount > maxRecursionCount) {
            return undefined;
        }
        recursionCount++;

        const childRanges = this._childAddenda
            .map((child) => child._getTextRangeRecursive(recursionCount))
            .filter((r) => !!r);

        if (childRanges.length > 1) {
            return { start: 0, length: 0 };
        }

        if (childRanges.length === 1) {
            return childRanges[0];
        }

        if (this._range) {
            return this._range;
        }

        return undefined;
    }

    private _getMessageCount(recursionCount = 0) {
        if (recursionCount > maxRecursionCount) {
            return 0;
        }

        // Get the nested message count.
        let messageCount = this._messages.length;

        for (const diag of this._childAddenda) {
            messageCount += diag._getMessageCount(recursionCount + 1);
        }

        return messageCount;
    }

    private _getLinesRecursive(maxDepth: number, maxLineCount: number, recursionCount = 0): string[] {
        if (maxDepth <= 0 || recursionCount > maxRecursionCount) {
            return [];
        }

        let childLines: string[] = [];
        for (const addendum of this._childAddenda) {
            const maxDepthRemaining = this._messages.length > 0 ? maxDepth - 1 : maxDepth;
            appendArray(childLines, addendum._getLinesRecursive(maxDepthRemaining, maxLineCount, recursionCount + 1));

            // If the number of lines exceeds our max line count, don't bother adding more.
            if (childLines.length >= maxLineCount) {
                childLines = childLines.slice(0, maxLineCount);
                break;
            }
        }

        // Prepend indentation for readability. Skip if there are no
        // messages at this level.
        const extraSpace = this._messages.length > 0 ? '  ' : '';
        return this._messages.concat(childLines).map((line) => extraSpace + line);
    }
}
