/*
 * tokenizer.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Based on code from vscode-python repository:
 *  https://github.com/Microsoft/vscode-python
 *
 * Converts a Python program text stream into a stream of tokens.
 */

import { Char } from '../common/charCodes.js';
import { cloneStr } from '../common/core.js';
import { TextRange } from '../common/textRange.js';
import { TextRangeCollection } from '../common/textRangeCollection.js';
import {
    isBinary,
    isDecimal,
    isHex,
    isIdentifierChar,
    isIdentifierStartChar,
    isOctal,
    isSurrogateChar,
} from './characters.js';
import { CharacterStream } from './characterStream.js';
import {
    Comment,
    CommentType,
    DedentToken,
    FStringEndToken,
    FStringMiddleToken,
    FStringStartToken,
    IdentifierToken,
    IndentToken,
    KeywordToken,
    KeywordType,
    NewLineToken,
    NewLineType,
    NumberToken,
    OperatorFlags,
    OperatorToken,
    OperatorType,
    StringToken,
    StringTokenFlags,
    Token,
    TokenType,
} from './tokenizerTypes.js';

// This must be a Map, as operations like {}["constructor"] succeed.
const _keywords: Map<string, KeywordType> = new Map([
    ['and', KeywordType.And],
    ['as', KeywordType.As],
    ['assert', KeywordType.Assert],
    ['async', KeywordType.Async],
    ['await', KeywordType.Await],
    ['break', KeywordType.Break],
    ['case', KeywordType.Case],
    ['class', KeywordType.Class],
    ['continue', KeywordType.Continue],
    ['__debug__', KeywordType.Debug],
    ['def', KeywordType.Def],
    ['del', KeywordType.Del],
    ['elif', KeywordType.Elif],
    ['else', KeywordType.Else],
    ['except', KeywordType.Except],
    ['finally', KeywordType.Finally],
    ['for', KeywordType.For],
    ['from', KeywordType.From],
    ['global', KeywordType.Global],
    ['if', KeywordType.If],
    ['import', KeywordType.Import],
    ['in', KeywordType.In],
    ['is', KeywordType.Is],
    ['lambda', KeywordType.Lambda],
    ['lazy', KeywordType.Lazy],
    ['match', KeywordType.Match],
    ['nonlocal', KeywordType.Nonlocal],
    ['not', KeywordType.Not],
    ['or', KeywordType.Or],
    ['pass', KeywordType.Pass],
    ['raise', KeywordType.Raise],
    ['return', KeywordType.Return],
    ['try', KeywordType.Try],
    ['type', KeywordType.Type],
    ['while', KeywordType.While],
    ['with', KeywordType.With],
    ['yield', KeywordType.Yield],
    ['False', KeywordType.False],
    ['None', KeywordType.None],
    ['True', KeywordType.True],
]);

const _softKeywords = new Set(['match', 'case', 'type', 'lazy']);

// Fast-reject table: keywords are 2–9 chars long and only start with these
// character codes. A 128-entry boolean table indexed by charCodeAt(0) rejects
// most identifiers without touching the _keywords Map.
const _keywordFirstCharTable: boolean[] = (() => {
    const table = new Array<boolean>(128).fill(false);
    for (const kw of _keywords.keys()) {
        const code = kw.charCodeAt(0);
        if (code < 128) {
            table[code] = true;
        }
    }
    return table;
})();

const _keywordMinLen = 2;
const _keywordMaxLen = 9; // __debug__

interface KeywordEntry {
    text: string;
    type: KeywordType;
}

// For keyword-like identifiers, compare directly against the source text slice
// to avoid creating temporary substring objects on the keyword path.
const _keywordEntriesByFirstChar: Array<KeywordEntry[] | undefined> = (() => {
    const entriesByFirstChar: Array<KeywordEntry[] | undefined> = new Array(128);
    for (const [text, type] of _keywords.entries()) {
        const firstCharCode = text.charCodeAt(0);
        if (firstCharCode < 128) {
            const entries = entriesByFirstChar[firstCharCode] ?? (entriesByFirstChar[firstCharCode] = []);
            entries.push({ text, type });
        }
    }
    return entriesByFirstChar;
})();

function getKeywordTypeFromTextSlice(text: string, start: number, length: number): KeywordType | undefined {
    if (length < _keywordMinLen || length > _keywordMaxLen) {
        return undefined;
    }

    const firstCharCode = text.charCodeAt(start);
    if (firstCharCode >= 128 || !_keywordFirstCharTable[firstCharCode]) {
        return undefined;
    }

    const candidates = _keywordEntriesByFirstChar[firstCharCode];
    if (!candidates) {
        return undefined;
    }

    for (const candidate of candidates) {
        if (candidate.text.length === length && text.startsWith(candidate.text, start)) {
            return candidate.type;
        }
    }

    return undefined;
}

const _operatorInfo: { [key: number]: OperatorFlags } = {
    [OperatorType.Add]: OperatorFlags.Unary | OperatorFlags.Binary,
    [OperatorType.AddEqual]: OperatorFlags.Assignment,
    [OperatorType.Assign]: OperatorFlags.Assignment,
    [OperatorType.BitwiseAnd]: OperatorFlags.Binary,
    [OperatorType.BitwiseAndEqual]: OperatorFlags.Assignment,
    [OperatorType.BitwiseInvert]: OperatorFlags.Unary,
    [OperatorType.BitwiseOr]: OperatorFlags.Binary,
    [OperatorType.BitwiseOrEqual]: OperatorFlags.Assignment,
    [OperatorType.BitwiseXor]: OperatorFlags.Binary,
    [OperatorType.BitwiseXorEqual]: OperatorFlags.Assignment,
    [OperatorType.Divide]: OperatorFlags.Binary,
    [OperatorType.DivideEqual]: OperatorFlags.Assignment,
    [OperatorType.Equals]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.FloorDivide]: OperatorFlags.Binary,
    [OperatorType.FloorDivideEqual]: OperatorFlags.Assignment,
    [OperatorType.GreaterThan]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.GreaterThanOrEqual]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.LeftShift]: OperatorFlags.Binary,
    [OperatorType.LeftShiftEqual]: OperatorFlags.Assignment,
    [OperatorType.LessOrGreaterThan]: OperatorFlags.Binary | OperatorFlags.Comparison | OperatorFlags.Deprecated,
    [OperatorType.LessThan]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.LessThanOrEqual]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.MatrixMultiply]: OperatorFlags.Binary,
    [OperatorType.MatrixMultiplyEqual]: OperatorFlags.Assignment,
    [OperatorType.Mod]: OperatorFlags.Binary,
    [OperatorType.ModEqual]: OperatorFlags.Assignment,
    [OperatorType.Multiply]: OperatorFlags.Binary,
    [OperatorType.MultiplyEqual]: OperatorFlags.Assignment,
    [OperatorType.NotEquals]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.Power]: OperatorFlags.Binary,
    [OperatorType.PowerEqual]: OperatorFlags.Assignment,
    [OperatorType.RightShift]: OperatorFlags.Binary,
    [OperatorType.RightShiftEqual]: OperatorFlags.Assignment,
    [OperatorType.Subtract]: OperatorFlags.Binary,
    [OperatorType.SubtractEqual]: OperatorFlags.Assignment,

    [OperatorType.And]: OperatorFlags.Binary,
    [OperatorType.Or]: OperatorFlags.Binary,
    [OperatorType.Not]: OperatorFlags.Unary,
    [OperatorType.Is]: OperatorFlags.Binary,
    [OperatorType.IsNot]: OperatorFlags.Binary,
    [OperatorType.In]: OperatorFlags.Binary,
    [OperatorType.NotIn]: OperatorFlags.Binary,
};

const _unsetSingleCharOperatorType = -1;
const _singleCharOperatorTypeTable: Int16Array = (() => {
    const table = new Int16Array(128);
    table.fill(_unsetSingleCharOperatorType);
    table[Char.Equal] = OperatorType.Assign;
    table[Char.Plus] = OperatorType.Add;
    table[Char.Hyphen] = OperatorType.Subtract;
    table[Char.Asterisk] = OperatorType.Multiply;
    table[Char.Slash] = OperatorType.Divide;
    table[Char.Ampersand] = OperatorType.BitwiseAnd;
    table[Char.Bar] = OperatorType.BitwiseOr;
    table[Char.Caret] = OperatorType.BitwiseXor;
    table[Char.Percent] = OperatorType.Mod;
    table[Char.Tilde] = OperatorType.BitwiseInvert;
    table[Char.At] = OperatorType.MatrixMultiply;
    table[Char.Less] = OperatorType.LessThan;
    table[Char.Greater] = OperatorType.GreaterThan;
    return table;
})();

const _singleCharEqualOperatorTypeTable: Int16Array = (() => {
    const table = new Int16Array(128);
    table.fill(_unsetSingleCharOperatorType);
    table[Char.Plus] = OperatorType.AddEqual;
    table[Char.Hyphen] = OperatorType.SubtractEqual;
    table[Char.Asterisk] = OperatorType.MultiplyEqual;
    table[Char.Slash] = OperatorType.DivideEqual;
    table[Char.Ampersand] = OperatorType.BitwiseAndEqual;
    table[Char.Bar] = OperatorType.BitwiseOrEqual;
    table[Char.Caret] = OperatorType.BitwiseXorEqual;
    table[Char.Percent] = OperatorType.ModEqual;
    table[Char.At] = OperatorType.MatrixMultiplyEqual;
    return table;
})();

function getTwoCharKey(char1: number, char2: number): number {
    return (char1 << 8) | char2;
}

// Two-char operator/token tables: use Map instead of Int16Array(65536).
// With only 5+1 entries, a Map uses ~200 bytes vs 256KB for two Int16Arrays.
const _twoCharOperatorTypeMap = new Map<number, OperatorType>([
    [getTwoCharKey(Char.Equal, Char.Equal), OperatorType.Equals],
    [getTwoCharKey(Char.ExclamationMark, Char.Equal), OperatorType.NotEquals],
    [getTwoCharKey(Char.Less, Char.Equal), OperatorType.LessThanOrEqual],
    [getTwoCharKey(Char.Greater, Char.Equal), OperatorType.GreaterThanOrEqual],
    [getTwoCharKey(Char.Less, Char.Greater), OperatorType.LessOrGreaterThan],
]);

const _twoCharSpecialTokenTypeMap = new Map<number, TokenType>([
    [getTwoCharKey(Char.Hyphen, Char.Greater), TokenType.Arrow],
]);

const _repeatedCharOperatorTypeTable: Int16Array = (() => {
    const table = new Int16Array(128);
    table.fill(_unsetSingleCharOperatorType);
    table[Char.Asterisk] = OperatorType.Power;
    table[Char.Slash] = OperatorType.FloorDivide;
    table[Char.Less] = OperatorType.LeftShift;
    table[Char.Greater] = OperatorType.RightShift;
    return table;
})();

const _repeatedCharEqualOperatorTypeTable: Int16Array = (() => {
    const table = new Int16Array(128);
    table.fill(_unsetSingleCharOperatorType);
    table[Char.Asterisk] = OperatorType.PowerEqual;
    table[Char.Slash] = OperatorType.FloorDivideEqual;
    table[Char.Less] = OperatorType.LeftShiftEqual;
    table[Char.Greater] = OperatorType.RightShiftEqual;
    return table;
})();

const _byteOrderMarker = 0xfeff;

const defaultTabSize = 8;

// Fast-reject table: only these ASCII chars can begin a string literal
// (quote chars or valid string prefix chars f/r/b/u/t and their uppercase).
// Checking this table first avoids calling _getStringPrefixLength() for the
// vast majority of tokens (identifiers, numbers, operators, etc.).
const _canStartString: boolean[] = (() => {
    const table = new Array<boolean>(128).fill(false);
    table[Char.SingleQuote] = true;
    table[Char.DoubleQuote] = true;
    for (const ch of [Char.f, Char.F, Char.r, Char.R, Char.b, Char.B, Char.u, Char.U, Char.t, Char.T]) {
        table[ch] = true;
    }
    return table;
})();

// ASCII identifier-continue table. Indexed by char code < 128; true if the
// char can appear inside an identifier (letter, digit, underscore).
// Building this at module load by querying isIdentifierChar lets the tight
// identifier-swallow loop avoid function-call overhead entirely on the common
// ASCII path. Non-ASCII chars fall back to the generic path.
const _asciiIdentifierContinue: boolean[] = (() => {
    const table = new Array<boolean>(128).fill(false);
    for (let i = 0; i < 128; i++) {
        if (isIdentifierChar(i)) {
            table[i] = true;
        }
    }
    return table;
})();

const _asciiIdentifierStart: boolean[] = (() => {
    const table = new Array<boolean>(128).fill(false);
    for (let i = 0; i < 128; i++) {
        if (isIdentifierStartChar(i)) {
            table[i] = true;
        }
    }
    return table;
})();

// Create a detached copy of a source text range without going through Buffer.
// Each charAt() for ASCII returns a V8-cached single-char string that does not
// reference the parent. The concatenation chain becomes a ConsString independent
// of the source text, avoiding V8 SlicedString memory pinning.
// ~4-9x faster than Buffer.from(str,'utf8').toString('utf8') for typical
// Python identifier lengths (5-20 chars).
function detachSubstring(text: string, start: number, end: number): string {
    let result = '';
    for (let i = start; i < end; i++) {
        result += text.charAt(i);
    }
    return result;
}

// Strip underscore characters from a source text range without first creating
// an intermediate substring.
function removeUnderscoresFromRange(text: string, start: number, end: number): string {
    let firstUnderscoreIndex = -1;
    for (let i = start; i < end; i++) {
        if (text.charCodeAt(i) === Char.Underscore) {
            firstUnderscoreIndex = i;
            break;
        }
    }

    if (firstUnderscoreIndex < 0) {
        return text.slice(start, end);
    }

    let result = text.slice(start, firstUnderscoreIndex);
    for (let i = firstUnderscoreIndex + 1; i < end; i++) {
        if (text.charCodeAt(i) !== Char.Underscore) {
            result += text[i];
        }
    }
    return result;
}

// Manual replacement for magicsRegEx = /\\\s*$/
// Check if a range [start, end) within `text` ends with a backslash followed
// by optional whitespace.
function endsWithBackslashContinuation(text: string, start: number, end: number): boolean {
    let i = end - 1;
    // Skip trailing whitespace
    while (i >= start) {
        const ch = text.charCodeAt(i);
        if (ch === Char.Space || ch === Char.Tab || ch === Char.FormFeed) {
            i--;
        } else {
            break;
        }
    }
    return i >= start && text.charCodeAt(i) === Char.Backslash;
}

// Result structure matching the shape previously extracted from regex match groups.
interface IgnoreDirectiveMatch {
    fullMatch: string; // group 0: full matched text
    prefix: string; // group 1: prefix before directive keyword
    bracketContent?: string; // group 4: content inside [...] if present
    index: number; // match position within the input string
}

// Parses a bracketed rule list starting at `pos` (which must point at '[').
// Returns the bracket content (without brackets) and the position just past ']',
// or undefined if the bracket is malformed (e.g. unclosed, or contains invalid chars
// before a closing bracket is found).
function parseIgnoreBracketContent(
    text: string,
    pos: number,
    rangeEnd: number,
    allowColon: boolean
): { content: string; newPos: number } | undefined {
    pos++; // skip '['
    const bracketStart = pos;
    while (pos < rangeEnd && text.charCodeAt(pos) !== Char.CloseBracket) {
        // Only allow valid bracket content chars: \s, \w, -, ,
        // (plus ':' for type: ignore to support tool-namespaced codes)
        const bc = text.charCodeAt(pos);
        if (
            (bc >= Char.a && bc <= Char.z) ||
            (bc >= Char.A && bc <= Char.Z) ||
            (bc >= Char._0 && bc <= Char._9) ||
            bc === Char.Underscore ||
            bc === Char.Hyphen ||
            bc === Char.Comma ||
            bc === Char.Space ||
            bc === Char.Tab ||
            (allowColon && bc === Char.Colon)
        ) {
            pos++;
        } else {
            break;
        }
    }
    if (pos < rangeEnd && text.charCodeAt(pos) === Char.CloseBracket) {
        return { content: text.slice(bracketStart, pos), newPos: pos + 1 };
    }
    return undefined;
}

// Manual replacement for typeIgnoreCommentRegEx / pyrightIgnoreCommentRegEx.
// Scans `text` within [rangeStart, rangeEnd) for `<directive>: ignore [rules]`
// where directive is 'type' or 'pyright'.
// Returns a match object or undefined. Returned `index` is absolute within `text`.
function matchIgnoreDirective(
    text: string,
    rangeStart: number,
    rangeEnd: number,
    directive: string
): IgnoreDirectiveMatch | undefined {
    // The directive can be preceded by optional `#` and whitespace, or
    // appear at the start of the range with optional whitespace.
    // type: ignore allows tool-namespaced codes (e.g. "ty:rule-name") in brackets;
    // pyright: ignore does not.
    const allowColonInBracket = directive === 'type';
    let searchFrom = rangeStart;

    while (searchFrom < rangeEnd) {
        // Find the next occurrence of the directive keyword, bounded by
        // rangeEnd. A bounded hand-rolled scan is important here: native
        // String.prototype.indexOf has no end bound and, when the keyword is
        // absent from the current comment but present elsewhere in the file,
        // can scan well past rangeEnd — producing O(n) behavior per comment
        // and O(n^2) overall on comment-heavy files.
        const firstCharCode = directive.charCodeAt(0);
        let directiveIdx = -1;
        const scanLimit = rangeEnd - directive.length;
        for (let i = searchFrom; i <= scanLimit; i++) {
            if (text.charCodeAt(i) === firstCharCode) {
                let found = true;
                for (let d = 1; d < directive.length; d++) {
                    if (text.charCodeAt(i + d) !== directive.charCodeAt(d)) {
                        found = false;
                        break;
                    }
                }
                if (found) {
                    directiveIdx = i;
                    break;
                }
            }
        }
        if (directiveIdx < 0) {
            return undefined;
        }

        // Determine the prefix: scan backward from directiveIdx to find
        // the `#` or start-of-range, collecting whitespace.
        let prefixStart = directiveIdx;
        let foundAnchor = false;

        // Walk backward over spaces/tabs
        let j = directiveIdx - 1;
        while (j >= rangeStart && (text.charCodeAt(j) === Char.Space || text.charCodeAt(j) === Char.Tab)) {
            j--;
        }

        if (j < rangeStart) {
            // At start of range
            prefixStart = rangeStart;
            foundAnchor = true;
        } else if (text.charCodeAt(j) === Char.Hash) {
            prefixStart = j;
            foundAnchor = true;
        }

        if (!foundAnchor) {
            searchFrom = directiveIdx + 1;
            continue;
        }

        // After directive keyword, expect ':'
        let pos = directiveIdx + directive.length;
        if (pos >= rangeEnd || text.charCodeAt(pos) !== Char.Colon) {
            searchFrom = directiveIdx + 1;
            continue;
        }
        pos++; // skip ':'

        // Skip optional whitespace after ':'
        while (pos < rangeEnd && (text.charCodeAt(pos) === Char.Space || text.charCodeAt(pos) === Char.Tab)) {
            pos++;
        }

        // Expect 'ignore'
        const ignoreStr = 'ignore';
        if (pos + ignoreStr.length > rangeEnd) {
            searchFrom = directiveIdx + 1;
            continue;
        }

        let matched = true;
        for (let k = 0; k < ignoreStr.length; k++) {
            if (text.charCodeAt(pos + k) !== ignoreStr.charCodeAt(k)) {
                matched = false;
                break;
            }
        }
        if (!matched) {
            searchFrom = directiveIdx + 1;
            continue;
        }
        pos += ignoreStr.length;

        // After 'ignore', expect whitespace, '[', or end-of-range
        let bracketContent: string | undefined;

        if (pos >= rangeEnd) {
            // End of range — valid
        } else {
            const ch = text.charCodeAt(pos);
            if (ch === Char.Space || ch === Char.Tab) {
                // Skip whitespace to check for optional bracket
                while (pos < rangeEnd && (text.charCodeAt(pos) === Char.Space || text.charCodeAt(pos) === Char.Tab)) {
                    pos++;
                }
                if (pos < rangeEnd && text.charCodeAt(pos) === Char.OpenBracket) {
                    const parsed = parseIgnoreBracketContent(text, pos, rangeEnd, allowColonInBracket);
                    if (parsed === undefined) {
                        searchFrom = directiveIdx + 1;
                        continue;
                    }
                    bracketContent = parsed.content;
                    pos = parsed.newPos;
                }
            } else if (ch === Char.OpenBracket) {
                // Bracket immediately after 'ignore'
                const parsed = parseIgnoreBracketContent(text, pos, rangeEnd, allowColonInBracket);
                if (parsed === undefined) {
                    searchFrom = directiveIdx + 1;
                    continue;
                }
                bracketContent = parsed.content;
                pos = parsed.newPos;
            } else {
                // No space, no bracket — not a valid match
                searchFrom = directiveIdx + 1;
                continue;
            }
        }

        const prefix = text.slice(prefixStart, directiveIdx);
        const fullMatch = text.slice(prefixStart, pos);

        return {
            fullMatch,
            prefix,
            bracketContent,
            index: prefixStart,
        };
    }

    return undefined;
}

export interface TokenizerOutput {
    // List of all tokens.
    tokens: TextRangeCollection<Token>;

    // List of ranges that comprise the lines.
    lines: TextRangeCollection<TextRange>;

    // Map of all line numbers that end in a "type: ignore" comment.
    typeIgnoreLines: Map<number, IgnoreComment>;

    // Map of all line numbers that end in a "pyright: ignore" comment.
    pyrightIgnoreLines: Map<number, IgnoreComment>;

    // Program starts with a "type: ignore" comment.
    typeIgnoreAll: IgnoreComment | undefined;

    // Line-end sequence ('/n', '/r', or '/r/n').
    predominantEndOfLineSequence: string;

    // True if the tokenizer was able to identify the file's predominant
    // tab sequence. False if predominantTabSequence is set to our default.
    hasPredominantTabSequence: boolean;

    // Tab sequence ('/t or consecutive spaces).
    predominantTabSequence: string;

    // Does the code mostly use single or double quote
    // characters for string literals?
    predominantSingleQuoteCharacter: string;
}

interface StringScannerOutput {
    escapedValue: string;
    flags: StringTokenFlags;
}

interface IndentInfo {
    tab1Spaces: number;
    tab8Spaces: number;
    isSpacePresent: boolean;
    isTabPresent: boolean;
}

export interface IgnoreCommentRule {
    text: string;
    range: TextRange;
}

export interface IgnoreComment {
    range: TextRange;
    rulesList: IgnoreCommentRule[] | undefined;
}

interface FStringReplacementFieldContext {
    inFormatSpecifier: boolean;
    parenDepth: number;
}

interface FStringContext {
    startToken: FStringStartToken;
    replacementFieldStack: FStringReplacementFieldContext[];
    activeReplacementField?: FStringReplacementFieldContext;
}

enum MagicsKind {
    None,
    Line,
    Cell,
}

export class Tokenizer {
    private _cs = new CharacterStream('');
    private _tokens: Token[] = [];
    private _prevLineStart = 0;
    private _parenDepth = 0;
    private _lineRanges: TextRange[] = [];
    private _indentAmounts: IndentInfo[] = [];
    private _typeIgnoreAll: IgnoreComment | undefined;
    // Cached answer to "are there any non-trivial tokens yet?" Once true it
    // stays true, so the O(n) scan in _handleComment only runs while the token
    // stream consists purely of NewLine / Indent tokens.
    private _hasTokenBeforeIgnoreAll = false;
    private _typeIgnoreLines = new Map<number, IgnoreComment>();
    private _pyrightIgnoreLines = new Map<number, IgnoreComment>();
    private _comments: Comment[] | undefined;
    private _fStringStack: FStringContext[] = [];
    private _activeFString: FStringContext | undefined;

    // Total times CR, CR/LF, and LF are used to terminate
    // lines. Used to determine the predominant line ending.
    private _crCount = 0;
    private _crLfCount = 0;
    private _lfCount = 0;

    // Number of times an indent token is emitted.
    private _indentCount = 0;

    // Number of times an indent token is emitted and a tab character
    // is present (used to determine predominant tab sequence).
    private _indentTabCount = 0;

    // Number of spaces that are added for an indent token
    // (used to determine predominant tab sequence).
    private _indentSpacesTotal = 0;

    // Number of single or double quote string literals found
    // in the code.
    private _singleQuoteCount = 0;
    private _doubleQuoteCount = 0;

    // Assume Jupyter notebook tokenization rules?
    private _useNotebookMode = false;

    // Direct-mapped identifier intern cache. Indexed by a cheap hash of
    // (firstChar, lastChar, length). On a hit (slot defined and string
    // equals the current source range), reuse the cached string instead of
    // re-allocating via detachSubstring. Collisions simply overwrite the
    // slot — no chaining, O(1) lookup, no Map overhead. Sized as a power of
    // two so the mask is a single AND.
    private static readonly _identifierCacheSize = 2048;
    private static readonly _identifierCacheMask = Tokenizer._identifierCacheSize - 1;
    private _identifierCache: Array<string | undefined> = new Array(Tokenizer._identifierCacheSize);

    tokenize(
        text: string,
        start?: number,
        length?: number,
        initialParenDepth = 0,
        useNotebookMode = false
    ): TokenizerOutput {
        if (start === undefined) {
            start = 0;
        } else if (start < 0 || start > text.length) {
            throw new Error(`Invalid range start (start=${start}, text.length=${text.length})`);
        }

        if (length === undefined) {
            length = text.length;
        } else if (length < 0 || start + length > text.length) {
            throw new Error(`Invalid range length (start=${start}, length=${length}, text.length=${text.length})`);
        } else if (start + length < text.length) {
            text = text.slice(0, start + length);
        }

        this._cs = new CharacterStream(text);
        this._cs.position = start;
        this._tokens = [];
        this._prevLineStart = 0;
        this._parenDepth = initialParenDepth;
        this._lineRanges = [];
        this._indentAmounts = [];
        this._useNotebookMode = useNotebookMode;
        // Clear per-source identifier intern cache.
        this._identifierCache.fill(undefined);

        const end = start + length;

        if (start === 0) {
            this._readIndentationAfterNewLine();
        }

        while (!this._cs.isEndOfStream()) {
            this._addNextToken();

            if (this._cs.position >= end) {
                break;
            }
        }

        // Insert any implied FStringEnd tokens.
        while (this._activeFString) {
            this._tokens.push(
                FStringEndToken.create(
                    this._cs.position,
                    0,
                    this._activeFString.startToken.flags | StringTokenFlags.Unterminated
                )
            );
            this._activeFString = this._fStringStack.pop();
        }

        // Insert an implied new line to make parsing easier.
        if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== TokenType.NewLine) {
            if (this._parenDepth === 0) {
                this._tokens.push(NewLineToken.create(this._cs.position, 0, NewLineType.Implied, this._getComments()));
            }
        }

        // Insert any implied dedent tokens.
        this._setIndent(this._cs.position, 0, 0, /* isSpacePresent */ false, /* isTabPresent */ false);

        // Add a final end-of-stream token to make parsing easier.
        this._tokens.push(Token.create(TokenType.EndOfStream, this._cs.position, 0, this._getComments()));

        // Add the final line range.
        this._addLineRange();

        // If the last line ended in a line-end character, add an empty line.
        if (this._lineRanges.length > 0) {
            const lastLine = this._lineRanges[this._lineRanges.length - 1];
            const lastCharOfLastLine = text.charCodeAt(lastLine.start + lastLine.length - 1);
            if (lastCharOfLastLine === Char.CarriageReturn || lastCharOfLastLine === Char.LineFeed) {
                this._lineRanges.push({ start: this._cs.position, length: 0 });
            }
        }

        let predominantEndOfLineSequence = '\n';
        if (this._crCount > this._crLfCount && this._crCount > this._lfCount) {
            predominantEndOfLineSequence = '\r';
        } else if (this._crLfCount > this._crCount && this._crLfCount > this._lfCount) {
            predominantEndOfLineSequence = '\r\n';
        }

        let predominantTabSequence = '    ';
        let hasPredominantTabSequence = false;
        // If more than half of the indents use tab sequences,
        // assume we're using tabs rather than spaces.
        if (this._indentTabCount > this._indentCount / 2) {
            hasPredominantTabSequence = true;
            predominantTabSequence = '\t';
        } else if (this._indentCount > 0) {
            hasPredominantTabSequence = true;
            // Compute the average number of spaces per indent
            // to estimate the predominant tab value.
            let averageSpacePerIndent = Math.round(this._indentSpacesTotal / this._indentCount);
            if (averageSpacePerIndent < 1) {
                averageSpacePerIndent = 1;
            } else if (averageSpacePerIndent > defaultTabSize) {
                averageSpacePerIndent = defaultTabSize;
            }
            predominantTabSequence = '';
            for (let i = 0; i < averageSpacePerIndent; i++) {
                predominantTabSequence += ' ';
            }
        }

        return {
            tokens: new TextRangeCollection(this._tokens),
            lines: new TextRangeCollection(this._lineRanges),
            typeIgnoreLines: this._typeIgnoreLines,
            typeIgnoreAll: this._typeIgnoreAll,
            pyrightIgnoreLines: this._pyrightIgnoreLines,
            predominantEndOfLineSequence,
            hasPredominantTabSequence,
            predominantTabSequence,
            predominantSingleQuoteCharacter: this._singleQuoteCount >= this._doubleQuoteCount ? "'" : '"',
        };
    }

    static getOperatorInfo(operatorType: OperatorType): OperatorFlags {
        return _operatorInfo[operatorType];
    }

    static isWhitespace(token: Token) {
        return token.type === TokenType.NewLine || token.type === TokenType.Indent || token.type === TokenType.Dedent;
    }

    static isPythonKeyword(name: string, includeSoftKeywords = false): boolean {
        const keyword = _keywords.get(name);
        if (!keyword) {
            return false;
        }

        if (includeSoftKeywords) {
            return true;
        }

        return !_softKeywords.has(name);
    }

    static isPythonIdentifier(value: string) {
        for (let i = 0; i < value.length; i++) {
            if (i === 0 ? !isIdentifierStartChar(value.charCodeAt(i)) : !isIdentifierChar(value.charCodeAt(i))) {
                return false;
            }
        }

        return true;
    }

    static isOperatorAssignment(operatorType?: OperatorType): boolean {
        if (operatorType === undefined || _operatorInfo[operatorType] === undefined) {
            return false;
        }
        return (_operatorInfo[operatorType] & OperatorFlags.Assignment) !== 0;
    }

    static isOperatorComparison(operatorType?: OperatorType): boolean {
        if (operatorType === undefined || _operatorInfo[operatorType] === undefined) {
            return false;
        }
        return (_operatorInfo[operatorType] & OperatorFlags.Comparison) !== 0;
    }

    private _addNextToken(): void {
        // Are we in the middle of an f-string but not in a replacement field?
        if (
            this._activeFString &&
            (!this._activeFString.activeReplacementField ||
                this._activeFString.activeReplacementField.inFormatSpecifier)
        ) {
            this._handleFStringMiddle();
        } else {
            this._cs.skipWhitespace();
        }

        if (this._cs.isEndOfStream()) {
            return;
        }

        if (!this._handleCharacter()) {
            this._cs.moveNext();
        }
    }

    // Consumes one or more characters from the character stream and pushes
    // tokens onto the token list. Returns true if the caller should advance
    // to the next character.
    private _handleCharacter(): boolean {
        // f-strings, b-strings, etc — only check if current char can start a string
        const currentChar = this._cs.currentChar;
        if (currentChar < 128 && _canStartString[currentChar]) {
            const stringPrefixLength = this._getStringPrefixLength();

            if (stringPrefixLength >= 0) {
                let stringPrefix = '';
                if (stringPrefixLength > 0) {
                    stringPrefix = this._cs.getText().slice(this._cs.position, this._cs.position + stringPrefixLength);
                    // Indeed a string
                    this._cs.advance(stringPrefixLength);
                }

                const quoteTypeFlags = this._getQuoteTypeFlags(stringPrefix);
                if (quoteTypeFlags !== StringTokenFlags.None) {
                    this._handleString(quoteTypeFlags, stringPrefixLength);
                    return true;
                }
            }
        }

        if (this._cs.currentChar === Char.Hash) {
            this._handleComment();
            return true;
        }

        if (this._useNotebookMode) {
            const kind = this._getIPythonMagicsKind();
            if (kind === MagicsKind.Line) {
                this._handleIPythonMagics(
                    this._cs.currentChar === Char.Percent ? CommentType.IPythonMagic : CommentType.IPythonShellEscape
                );
                return true;
            }

            if (kind === MagicsKind.Cell) {
                this._handleIPythonMagics(
                    this._cs.currentChar === Char.Percent
                        ? CommentType.IPythonCellMagic
                        : CommentType.IPythonCellShellEscape
                );
                return true;
            }
        }

        switch (this._cs.currentChar) {
            case _byteOrderMarker: {
                // Skip the BOM if it's at the start of the file.
                if (this._cs.position === 0) {
                    return false;
                }
                return this._handleInvalid();
            }

            case Char.CarriageReturn: {
                const length = this._cs.nextChar === Char.LineFeed ? 2 : 1;
                const newLineType = length === 2 ? NewLineType.CarriageReturnLineFeed : NewLineType.CarriageReturn;
                this._handleNewLine(length, newLineType);
                return true;
            }

            case Char.LineFeed: {
                this._handleNewLine(1, NewLineType.LineFeed);
                return true;
            }

            case Char.Backslash: {
                if (this._cs.nextChar === Char.CarriageReturn) {
                    const advance = this._cs.lookAhead(2) === Char.LineFeed ? 3 : 2;

                    // If a line continuation (\\ + CR[LF]) appears at EOF, it's an error.
                    if (this._cs.position + advance >= this._cs.length) {
                        return this._handleInvalid();
                    }

                    this._cs.advance(advance);
                    this._addLineRange();

                    if (this._tokens.length > 0 && this._tokens[this._tokens.length - 1].type === TokenType.NewLine) {
                        this._readIndentationAfterNewLine();
                    }
                    return true;
                }

                if (this._cs.nextChar === Char.LineFeed) {
                    const advance = 2;

                    // If a line continuation (\\ + LF) appears at EOF, it's an error.
                    if (this._cs.position + advance >= this._cs.length) {
                        return this._handleInvalid();
                    }

                    this._cs.advance(advance);
                    this._addLineRange();

                    if (this._tokens.length > 0 && this._tokens[this._tokens.length - 1].type === TokenType.NewLine) {
                        this._readIndentationAfterNewLine();
                    }
                    return true;
                }

                return this._handleInvalid();
            }

            case Char.OpenParenthesis: {
                this._parenDepth++;
                this._tokens.push(Token.create(TokenType.OpenParenthesis, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.CloseParenthesis: {
                if (this._parenDepth > 0) {
                    this._parenDepth--;
                }
                this._tokens.push(Token.create(TokenType.CloseParenthesis, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.OpenBracket: {
                this._parenDepth++;
                this._tokens.push(Token.create(TokenType.OpenBracket, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.CloseBracket: {
                if (this._parenDepth > 0) {
                    this._parenDepth--;
                }
                this._tokens.push(Token.create(TokenType.CloseBracket, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.OpenBrace: {
                this._parenDepth++;
                this._tokens.push(Token.create(TokenType.OpenCurlyBrace, this._cs.position, 1, this._getComments()));

                if (this._activeFString) {
                    // Are we starting a new replacement field?
                    if (
                        !this._activeFString.activeReplacementField ||
                        this._activeFString.activeReplacementField.inFormatSpecifier
                    ) {
                        // If there is already an active replacement field, push it
                        // on the stack so we can pop it later.
                        if (this._activeFString.activeReplacementField) {
                            this._activeFString.replacementFieldStack.push(this._activeFString.activeReplacementField);
                        }

                        // Create a new active replacement field context.
                        this._activeFString.activeReplacementField = {
                            inFormatSpecifier: false,
                            parenDepth: this._parenDepth,
                        };
                    }
                }
                break;
            }

            case Char.CloseBrace: {
                if (
                    this._activeFString &&
                    this._activeFString.activeReplacementField?.parenDepth === this._parenDepth
                ) {
                    this._activeFString.activeReplacementField = this._activeFString.replacementFieldStack.pop();
                }

                if (this._parenDepth > 0) {
                    this._parenDepth--;
                }
                this._tokens.push(Token.create(TokenType.CloseCurlyBrace, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Comma: {
                this._tokens.push(Token.create(TokenType.Comma, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Backtick: {
                this._tokens.push(Token.create(TokenType.Backtick, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Semicolon: {
                this._tokens.push(Token.create(TokenType.Semicolon, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Colon: {
                if (this._cs.nextChar === Char.Equal) {
                    if (
                        !this._activeFString ||
                        !this._activeFString.activeReplacementField ||
                        this._activeFString.activeReplacementField.parenDepth !== this._parenDepth
                    ) {
                        this._tokens.push(
                            OperatorToken.create(this._cs.position, 2, OperatorType.Walrus, this._getComments())
                        );
                        this._cs.advance(1);
                        break;
                    }
                }

                this._tokens.push(Token.create(TokenType.Colon, this._cs.position, 1, this._getComments()));

                if (
                    this._activeFString?.activeReplacementField &&
                    this._parenDepth === this._activeFString.activeReplacementField.parenDepth
                ) {
                    this._activeFString.activeReplacementField.inFormatSpecifier = true;
                }
                break;
            }

            default: {
                if (this._isPossibleNumber()) {
                    if (this._tryNumber()) {
                        return true;
                    }
                }

                if (this._cs.currentChar === Char.Period) {
                    if (this._cs.nextChar === Char.Period && this._cs.lookAhead(2) === Char.Period) {
                        this._tokens.push(Token.create(TokenType.Ellipsis, this._cs.position, 3, this._getComments()));
                        this._cs.advance(3);
                        return true;
                    }
                    this._tokens.push(Token.create(TokenType.Dot, this._cs.position, 1, this._getComments()));
                    break;
                }

                if (!this._tryIdentifier()) {
                    if (!this._tryOperator()) {
                        return this._handleInvalid();
                    }
                }
                return true;
            }
        }
        return false;
    }

    private _addLineRange() {
        const lineLength = this._cs.position - this._prevLineStart;
        if (lineLength > 0) {
            this._lineRanges.push({ start: this._prevLineStart, length: lineLength });
        }

        this._prevLineStart = this._cs.position;
    }

    private _handleNewLine(length: number, newLineType: NewLineType) {
        if (this._parenDepth === 0 && newLineType !== NewLineType.Implied) {
            // New lines are ignored within parentheses.
            // We'll also avoid adding multiple newlines in a row to simplify parsing.
            if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== TokenType.NewLine) {
                this._tokens.push(NewLineToken.create(this._cs.position, length, newLineType, this._getComments()));
            }
        }
        if (newLineType === NewLineType.CarriageReturn) {
            this._crCount++;
        } else if (newLineType === NewLineType.CarriageReturnLineFeed) {
            this._crLfCount++;
        } else {
            this._lfCount++;
        }
        this._cs.advance(length);
        this._addLineRange();
        this._readIndentationAfterNewLine();
    }

    private _readIndentationAfterNewLine() {
        let tab1Spaces = 0;
        let tab8Spaces = 0;
        let isTabPresent = false;
        let isSpacePresent = false;

        const startOffset = this._cs.position;

        while (!this._cs.isEndOfStream()) {
            switch (this._cs.currentChar) {
                case Char.Space:
                    tab1Spaces++;
                    tab8Spaces++;
                    isSpacePresent = true;
                    this._cs.moveNext();
                    break;

                case Char.Tab:
                    // Translate tabs into spaces assuming both 1-space
                    // and 8-space tab stops.
                    tab1Spaces++;
                    tab8Spaces += defaultTabSize - (tab8Spaces % defaultTabSize);
                    isTabPresent = true;
                    this._cs.moveNext();
                    break;

                case Char.FormFeed:
                    tab1Spaces = 0;
                    tab8Spaces = 0;
                    isTabPresent = false;
                    isSpacePresent = false;
                    this._cs.moveNext();
                    break;

                case Char.Hash:
                case Char.LineFeed:
                case Char.CarriageReturn:
                    // Blank line -- no need to adjust indentation.
                    return;

                default:
                    // Non-blank line. Set the current indent level.
                    this._setIndent(startOffset, tab1Spaces, tab8Spaces, isSpacePresent, isTabPresent);
                    return;
            }
        }
    }

    // The caller must specify two space count values. The first assumes
    // that tabs are translated into one-space tab stops. The second assumes
    // that tabs are translated into eight-space tab stops.
    private _setIndent(
        startOffset: number,
        tab1Spaces: number,
        tab8Spaces: number,
        isSpacePresent: boolean,
        isTabPresent: boolean
    ) {
        // Indentations are ignored within a parenthesized clause.
        if (this._parenDepth > 0) {
            return;
        }

        // Insert indent or dedent tokens as necessary.
        if (this._indentAmounts.length === 0) {
            if (tab8Spaces > 0) {
                this._indentCount++;
                if (isTabPresent) {
                    this._indentTabCount++;
                }
                this._indentSpacesTotal += tab8Spaces;

                this._indentAmounts.push({
                    tab1Spaces,
                    tab8Spaces,
                    isSpacePresent,
                    isTabPresent,
                });
                this._tokens.push(IndentToken.create(startOffset, tab1Spaces, tab8Spaces, false, this._getComments()));
            }
        } else {
            const prevTabInfo = this._indentAmounts[this._indentAmounts.length - 1];
            if (prevTabInfo.tab8Spaces < tab8Spaces) {
                // The Python spec says that if there is ambiguity about how tabs should
                // be translated into spaces because the user has intermixed tabs and
                // spaces, it should be an error. We'll record this condition in the token
                // so the parser can later report it.
                const isIndentAmbiguous =
                    ((prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent)) &&
                    prevTabInfo.tab1Spaces >= tab1Spaces;

                this._indentCount++;
                if (isTabPresent) {
                    this._indentTabCount++;
                }
                this._indentSpacesTotal += tab8Spaces - this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces;

                this._indentAmounts.push({
                    tab1Spaces,
                    tab8Spaces,
                    isSpacePresent,
                    isTabPresent,
                });

                this._tokens.push(
                    IndentToken.create(startOffset, tab1Spaces, tab8Spaces, isIndentAmbiguous, this._getComments())
                );
            } else if (prevTabInfo.tab8Spaces === tab8Spaces) {
                // The Python spec says that if there is ambiguity about how tabs should
                // be translated into spaces because the user has intermixed tabs and
                // spaces, it should be an error. We'll record this condition in the token
                // so the parser can later report it.
                if ((prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent)) {
                    this._tokens.push(
                        IndentToken.create(startOffset, tab1Spaces, tab8Spaces, true, this._getComments())
                    );
                }
            } else {
                // The Python spec says that if there is ambiguity about how tabs should
                // be translated into spaces because the user has intermixed tabs and
                // spaces, it should be an error. We'll record this condition in the token
                // so the parser can later report it.
                let isDedentAmbiguous =
                    (prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent);

                // The Python spec says that dedent amounts need to match the indent
                // amount exactly. An error is generated at runtime if it doesn't.
                // We'll record that error condition within the token, allowing the
                // parser to report it later.
                const dedentPoints: number[] = [];
                while (
                    this._indentAmounts.length > 0 &&
                    this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces > tab8Spaces
                ) {
                    dedentPoints.push(
                        this._indentAmounts.length > 1
                            ? this._indentAmounts[this._indentAmounts.length - 2].tab8Spaces
                            : 0
                    );
                    this._indentAmounts.pop();
                }

                dedentPoints.forEach((dedentAmount, index) => {
                    const matchesIndent = index < dedentPoints.length - 1 || dedentAmount === tab8Spaces;
                    const actualDedentAmount = index < dedentPoints.length - 1 ? dedentAmount : tab8Spaces;
                    this._tokens.push(
                        DedentToken.create(
                            this._cs.position,
                            0,
                            actualDedentAmount,
                            matchesIndent,
                            isDedentAmbiguous,
                            this._getComments()
                        )
                    );

                    isDedentAmbiguous = false;
                });
            }
        }
    }

    private _tryIdentifier(): boolean {
        const cs = this._cs;
        const text = cs.getText();
        const textLen = text.length;
        const start = cs.position;

        // Fast path for ASCII identifier start. Avoids the function call and
        // surrogate logic for the common case (Python source is overwhelmingly
        // ASCII identifiers).
        const firstChar = cs.currentChar;
        let pos = start;
        if (firstChar < 128) {
            if (!_asciiIdentifierStart[firstChar]) {
                // Not an identifier start and not a surrogate candidate.
                return false;
            }
            pos++;

            // Tight loop: advance while we're still in ASCII identifier chars.
            while (pos < textLen) {
                const ch = text.charCodeAt(pos);
                if (ch < 128 && _asciiIdentifierContinue[ch]) {
                    pos++;
                } else {
                    break;
                }
            }

            // If we hit a non-ASCII char, fall back to the generic loop to
            // handle possible unicode identifier continue / surrogate pairs.
            if (pos < textLen && text.charCodeAt(pos) >= 128) {
                cs.advance(pos - start);
                this._swallowNonAsciiIdentifierChars();
                pos = cs.position;
            } else {
                cs.advance(pos - start);
            }
        } else {
            // Non-ASCII start: use the generic path (supports surrogates).
            if (isIdentifierStartChar(firstChar)) {
                cs.moveNext();
            } else if (isIdentifierStartChar(firstChar, cs.nextChar)) {
                cs.moveNext();
                cs.moveNext();
            } else {
                return false;
            }
            this._swallowNonAsciiIdentifierChars();
            pos = cs.position;
        }

        if (pos > start) {
            const end = pos;
            const length = end - start;
            const keywordType = getKeywordTypeFromTextSlice(text, start, length);

            if (keywordType !== undefined) {
                this._tokens.push(KeywordToken.create(start, length, keywordType, this._getComments()));
            } else {
                const value = this._internIdentifier(text, start, end, length);
                this._tokens.push(IdentifierToken.create(start, length, value, this._getComments()));
            }
            return true;
        }
        return false;
    }

    // Per-tokenize identifier intern cache. Direct-mapped, so collisions
    // simply replace the slot. Common identifiers (self, cls, True, None,
    // str, int, dict, etc.) get deduplicated to a single string object,
    // avoiding repeated detachSubstring allocations for the same name.
    private _internIdentifier(text: string, start: number, end: number, length: number): string {
        const firstChar = text.charCodeAt(start);
        const lastChar = text.charCodeAt(end - 1);
        // Hash mixes length, first and last char; multiplier values chosen
        // to spread hits for common short identifiers across the table.
        const hash = (firstChar * 31 + lastChar * 7 + length) & Tokenizer._identifierCacheMask;
        const cached = this._identifierCache[hash];
        if (cached !== undefined && cached.length === length && text.startsWith(cached, start)) {
            return cached;
        }
        const value = detachSubstring(text, start, end);
        this._identifierCache[hash] = value;
        return value;
    }

    // Generic identifier-continue loop that handles unicode + surrogate pairs.
    // Falls back to this when the fast ASCII loop encounters a non-ASCII char.
    private _swallowNonAsciiIdentifierChars(): void {
        while (true) {
            if (isIdentifierChar(this._cs.currentChar)) {
                this._cs.moveNext();
            } else if (isIdentifierChar(this._cs.currentChar, this._cs.nextChar)) {
                this._cs.moveNext();
                this._cs.moveNext();
            } else {
                break;
            }
        }
    }

    private _isPossibleNumber(): boolean {
        if (isDecimal(this._cs.currentChar)) {
            return true;
        }

        if (this._cs.currentChar === Char.Period && isDecimal(this._cs.nextChar)) {
            return true;
        }

        return false;
    }

    private _tryNumber(): boolean {
        const start = this._cs.position;

        if (this._cs.currentChar === Char._0) {
            let radix = 0;
            let leadingChars = 0;

            // Try hex => hexinteger: "0" ("x" | "X") (["_"] hexdigit)+
            if ((this._cs.nextChar === Char.x || this._cs.nextChar === Char.X) && isHex(this._cs.lookAhead(2))) {
                this._cs.advance(2);
                leadingChars = 2;
                while (isHex(this._cs.currentChar)) {
                    this._cs.moveNext();
                }
                radix = 16;
            }

            // Try binary => bininteger: "0" ("b" | "B") (["_"] bindigit)+
            else if (
                (this._cs.nextChar === Char.b || this._cs.nextChar === Char.B) &&
                isBinary(this._cs.lookAhead(2))
            ) {
                this._cs.advance(2);
                leadingChars = 2;
                while (isBinary(this._cs.currentChar)) {
                    this._cs.moveNext();
                }
                radix = 2;
            }

            // Try octal => octinteger: "0" ("o" | "O") (["_"] octdigit)+
            else if ((this._cs.nextChar === Char.o || this._cs.nextChar === Char.O) && isOctal(this._cs.lookAhead(2))) {
                this._cs.advance(2);
                leadingChars = 2;
                while (isOctal(this._cs.currentChar)) {
                    this._cs.moveNext();
                }
                radix = 8;
            }

            if (radix > 0) {
                const end = this._cs.position;
                const text = this._cs.getText();
                const simpleIntText = removeUnderscoresFromRange(text, start, end);
                let intValue: number | bigint = parseInt(simpleIntText.slice(leadingChars), radix);

                if (!isNaN(intValue)) {
                    const bigIntValue = BigInt(simpleIntText);
                    if (
                        !isFinite(intValue) ||
                        intValue < Number.MIN_SAFE_INTEGER ||
                        intValue > Number.MAX_SAFE_INTEGER
                    ) {
                        intValue = bigIntValue;
                    }

                    this._tokens.push(
                        NumberToken.create(start, end - start, intValue, true, false, this._getComments())
                    );
                    return true;
                }
            }
        }

        let isDecimalInteger = false;
        let mightBeFloatingPoint = false;
        // Try decimal int =>
        //    decinteger: nonzerodigit (["_"] digit)* | "0" (["_"] "0")*
        //    nonzerodigit: "1"..."9"
        //    digit: "0"..."9"
        if (this._cs.currentChar >= Char._1 && this._cs.currentChar <= Char._9) {
            while (isDecimal(this._cs.currentChar)) {
                mightBeFloatingPoint = true;
                this._cs.moveNext();
            }
            isDecimalInteger =
                this._cs.currentChar !== Char.Period &&
                this._cs.currentChar !== Char.e &&
                this._cs.currentChar !== Char.E;
        }

        // "0" (["_"] "0")*
        if (this._cs.currentChar === Char._0) {
            mightBeFloatingPoint = true;
            while (this._cs.currentChar === Char._0 || this._cs.currentChar === Char.Underscore) {
                this._cs.moveNext();
            }
            isDecimalInteger =
                this._cs.currentChar !== Char.Period &&
                this._cs.currentChar !== Char.e &&
                this._cs.currentChar !== Char.E &&
                (this._cs.currentChar < Char._1 || this._cs.currentChar > Char._9);
        }

        if (isDecimalInteger) {
            const textEnd = this._cs.position;
            const sourceText = this._cs.getText();
            const simpleIntText = removeUnderscoresFromRange(sourceText, start, textEnd);
            let intValue: number | bigint = parseInt(simpleIntText, 10);

            if (!isNaN(intValue)) {
                let isImaginary = false;
                let tokenLength = textEnd - start;

                const bigIntValue = BigInt(simpleIntText);
                if (
                    !isFinite(intValue) ||
                    bigIntValue < Number.MIN_SAFE_INTEGER ||
                    bigIntValue > Number.MAX_SAFE_INTEGER
                ) {
                    intValue = bigIntValue;
                }

                if (this._cs.currentChar === Char.j || this._cs.currentChar === Char.J) {
                    isImaginary = true;
                    this._cs.moveNext();
                    tokenLength += 1;
                }

                this._tokens.push(
                    NumberToken.create(start, tokenLength, intValue, true, isImaginary, this._getComments())
                );
                return true;
            }
        }

        // Floating point. Sign and leading digits were already skipped over.
        this._cs.position = start;
        if (
            mightBeFloatingPoint ||
            (this._cs.currentChar === Char.Period && this._cs.nextChar >= Char._0 && this._cs.nextChar <= Char._9)
        ) {
            if (this._skipFloatingPointCandidate()) {
                const floatEnd = this._cs.position;
                const floatText = removeUnderscoresFromRange(this._cs.getText(), start, floatEnd);
                const value = parseFloat(floatText);
                if (!isNaN(value)) {
                    let isImaginary = false;
                    let tokenLength = floatEnd - start;
                    if (this._cs.currentChar === Char.j || this._cs.currentChar === Char.J) {
                        isImaginary = true;
                        this._cs.moveNext();
                        tokenLength += 1;
                    }
                    this._tokens.push(
                        NumberToken.create(start, tokenLength, value, false, isImaginary, this._getComments())
                    );
                    return true;
                }
            }
        }

        this._cs.position = start;
        return false;
    }

    private _tryOperator(): boolean {
        const currentChar = this._cs.currentChar;
        let length = 0;
        const nextChar = this._cs.nextChar;
        let operatorType: OperatorType;

        if (currentChar < 128 && nextChar < 128) {
            const twoCharKey = (currentChar << 8) | nextChar;
            const specialTokenType = _twoCharSpecialTokenTypeMap.get(twoCharKey);
            if (specialTokenType !== undefined) {
                this._tokens.push(Token.create(specialTokenType, this._cs.position, 2, this._getComments()));
                this._cs.advance(2);
                return true;
            }

            const twoCharOperatorType = _twoCharOperatorTypeMap.get(twoCharKey);
            if (twoCharOperatorType !== undefined) {
                this._tokens.push(OperatorToken.create(this._cs.position, 2, twoCharOperatorType, this._getComments()));
                this._cs.advance(2);
                return true;
            }

            if (currentChar === nextChar) {
                const repeatedOperatorType = _repeatedCharOperatorTypeTable[currentChar];
                if (repeatedOperatorType !== _unsetSingleCharOperatorType) {
                    const hasTrailingEqual = this._cs.lookAhead(2) === Char.Equal;
                    const repeatedLength = hasTrailingEqual ? 3 : 2;
                    const operatorType = hasTrailingEqual
                        ? _repeatedCharEqualOperatorTypeTable[currentChar]
                        : repeatedOperatorType;
                    this._tokens.push(
                        OperatorToken.create(
                            this._cs.position,
                            repeatedLength,
                            operatorType as OperatorType,
                            this._getComments()
                        )
                    );
                    this._cs.advance(repeatedLength);
                    return true;
                }
            }
        }

        if (currentChar < 128) {
            const singleCharOperatorType = _singleCharOperatorTypeTable[currentChar];
            if (singleCharOperatorType !== _unsetSingleCharOperatorType) {
                const equalOperatorType = _singleCharEqualOperatorTypeTable[currentChar];
                if (nextChar === Char.Equal && equalOperatorType !== _unsetSingleCharOperatorType) {
                    length = 2;
                    operatorType = equalOperatorType as OperatorType;
                } else {
                    length = 1;
                    operatorType = singleCharOperatorType as OperatorType;
                }

                this._tokens.push(OperatorToken.create(this._cs.position, length, operatorType, this._getComments()));
                this._cs.advance(length);
                return true;
            }
        }

        // `!=` is handled by the 2-char fast path above.
        if (currentChar === Char.ExclamationMark && this._activeFString) {
            // Handle the conversion separator (!) within an f-string.
            this._tokens.push(Token.create(TokenType.ExclamationMark, this._cs.position, 1, this._getComments()));
            this._cs.advance(1);
            return true;
        }

        return false;
    }

    private _handleInvalid(): boolean {
        const start = this._cs.position;
        while (true) {
            if (
                this._cs.currentChar === Char.LineFeed ||
                this._cs.currentChar === Char.CarriageReturn ||
                this._cs.isAtWhiteSpace() ||
                this._cs.isEndOfStream()
            ) {
                break;
            }

            if (isSurrogateChar(this._cs.currentChar)) {
                this._cs.moveNext();
                this._cs.moveNext();
            } else {
                this._cs.moveNext();
            }
        }
        const length = this._cs.position - start;
        if (length > 0) {
            this._tokens.push(Token.create(TokenType.Invalid, start, length, this._getComments()));
            return true;
        }
        return false;
    }

    private _getComments(): Comment[] | undefined {
        const prevComments = this._comments;
        this._comments = undefined;
        return prevComments;
    }

    private _getIPythonMagicsKind(): MagicsKind {
        const curChar = this._cs.currentChar;
        if (curChar !== Char.Percent && curChar !== Char.ExclamationMark) {
            return MagicsKind.None;
        }

        const prevToken = this._tokens.length > 0 ? this._tokens[this._tokens.length - 1] : undefined;
        if (prevToken !== undefined && !Tokenizer.isWhitespace(prevToken)) {
            return MagicsKind.None;
        }

        if (this._cs.nextChar === curChar) {
            // Eat up next magic char.
            this._cs.moveNext();
            return MagicsKind.Cell;
        }

        return MagicsKind.Line;
    }

    private _handleIPythonMagics(type: CommentType): void {
        const start = this._cs.position + 1;
        const sourceText = this._cs.getText();

        let begin = start;
        while (true) {
            this._cs.skipToEol();

            if (type === CommentType.IPythonMagic || type === CommentType.IPythonShellEscape) {
                // is it multiline magics?
                // %magic command \
                //        next arguments
                if (!endsWithBackslashContinuation(sourceText, begin, this._cs.position)) {
                    break;
                }
            }

            this._cs.moveNext();
            begin = this._cs.position + 1;

            if (this._cs.isEndOfStream()) {
                break;
            }
        }

        const length = this._cs.position - start;
        const comment = Comment.create(start, length, sourceText.slice(start, start + length), type);
        this._addComments(comment);
    }

    private _handleComment(): void {
        const start = this._cs.position + 1;
        this._cs.skipToEol();

        const length = this._cs.position - start;
        const sourceText = this._cs.getText();
        const end = start + length;
        const comment = Comment.create(start, length, sourceText.slice(start, end));

        // Fast pre-filter: any ignore directive must contain the substring 'ignore'.
        // Search only the current comment so comment-heavy files remain linear in size.
        if (comment.value.includes('ignore')) {
            const typeIgnoreMatch = matchIgnoreDirective(sourceText, start, end, 'type');
            if (typeIgnoreMatch) {
                const commentStart = typeIgnoreMatch.index;
                const textRange: TextRange = {
                    start: commentStart + typeIgnoreMatch.prefix.length,
                    length: typeIgnoreMatch.fullMatch.length - typeIgnoreMatch.prefix.length,
                };
                const ignoreComment: IgnoreComment = {
                    range: textRange,
                    rulesList: this._getIgnoreCommentRulesList(commentStart, typeIgnoreMatch),
                };

                let isIgnoreAll = false;
                if (!this._hasTokenBeforeIgnoreAll) {
                    // Are there any tokens other than NewLine / Indent yet?
                    const hasOther = this._tokens.some(
                        (t) => t && t.type !== TokenType.NewLine && t.type !== TokenType.Indent
                    );
                    if (hasOther) {
                        this._hasTokenBeforeIgnoreAll = true;
                    } else {
                        isIgnoreAll = true;
                    }
                }

                if (isIgnoreAll) {
                    this._typeIgnoreAll = ignoreComment;
                } else {
                    this._typeIgnoreLines.set(this._lineRanges.length, ignoreComment);
                }
            }

            const pyrightIgnoreMatch = matchIgnoreDirective(sourceText, start, end, 'pyright');
            if (pyrightIgnoreMatch) {
                const commentStart = pyrightIgnoreMatch.index;
                const textRange: TextRange = {
                    start: commentStart + pyrightIgnoreMatch.prefix.length,
                    length: pyrightIgnoreMatch.fullMatch.length - pyrightIgnoreMatch.prefix.length,
                };
                const ignoreComment: IgnoreComment = {
                    range: textRange,
                    rulesList: this._getIgnoreCommentRulesList(commentStart, pyrightIgnoreMatch),
                };
                this._pyrightIgnoreLines.set(this._lineRanges.length, ignoreComment);
            }
        }

        this._addComments(comment);
    }

    // Extracts the individual rules within a "type: ignore [x, y, z]" comment.
    private _getIgnoreCommentRulesList(start: number, match: IgnoreDirectiveMatch): IgnoreCommentRule[] | undefined {
        if (match.bracketContent === undefined) {
            return undefined;
        }

        const splitElements = match.bracketContent.split(',');
        const commentRules: IgnoreCommentRule[] = [];
        let currentOffset = start + match.fullMatch.indexOf('[') + 1;

        for (const element of splitElements) {
            const frontTrimmed = element.trimStart();
            currentOffset += element.length - frontTrimmed.length;
            const endTrimmed = frontTrimmed.trimEnd();

            if (endTrimmed.length > 0) {
                commentRules.push({
                    range: { start: currentOffset, length: endTrimmed.length },
                    text: cloneStr(endTrimmed),
                });
            }

            currentOffset += frontTrimmed.length + 1;
        }

        return commentRules;
    }

    private _addComments(comment: Comment) {
        if (this._comments) {
            this._comments.push(comment);
        } else {
            this._comments = [comment];
        }
    }

    private _getStringPrefixLength(): number {
        if (this._cs.currentChar === Char.SingleQuote || this._cs.currentChar === Char.DoubleQuote) {
            // Simple string, no prefix
            return 0;
        }

        if (this._cs.nextChar === Char.SingleQuote || this._cs.nextChar === Char.DoubleQuote) {
            switch (this._cs.currentChar) {
                case Char.f:
                case Char.F:
                case Char.r:
                case Char.R:
                case Char.b:
                case Char.B:
                case Char.u:
                case Char.U:
                case Char.t:
                case Char.T:
                    // Single-char prefix like u"" or r""
                    return 1;
                default:
                    break;
            }
        }

        if (this._cs.lookAhead(2) === Char.SingleQuote || this._cs.lookAhead(2) === Char.DoubleQuote) {
            const prefix = this._cs
                .getText()
                .slice(this._cs.position, this._cs.position + 2)
                .toLowerCase();
            switch (prefix) {
                case 'rf':
                case 'fr':
                case 'rt':
                case 'tr':
                case 'br':
                case 'rb':
                    return 2;
                default:
                    break;
            }
        }
        return -1;
    }

    private _getQuoteTypeFlags(prefix: string): StringTokenFlags {
        let flags = StringTokenFlags.None;

        prefix = prefix.toLowerCase();
        for (let i = 0; i < prefix.length; i++) {
            switch (prefix[i]) {
                case 'u':
                    flags |= StringTokenFlags.Unicode;
                    break;

                case 'b':
                    flags |= StringTokenFlags.Bytes;
                    break;

                case 'r':
                    flags |= StringTokenFlags.Raw;
                    break;

                case 'f':
                    flags |= StringTokenFlags.Format;
                    break;

                case 't':
                    flags |= StringTokenFlags.Template;
                    break;
            }
        }

        if (this._cs.currentChar === Char.SingleQuote) {
            flags |= StringTokenFlags.SingleQuote;
            if (this._cs.nextChar === Char.SingleQuote && this._cs.lookAhead(2) === Char.SingleQuote) {
                flags |= StringTokenFlags.Triplicate;
            }
        } else if (this._cs.currentChar === Char.DoubleQuote) {
            flags |= StringTokenFlags.DoubleQuote;
            if (this._cs.nextChar === Char.DoubleQuote && this._cs.lookAhead(2) === Char.DoubleQuote) {
                flags |= StringTokenFlags.Triplicate;
            }
        }

        return flags;
    }

    private _handleString(flags: StringTokenFlags, stringPrefixLength: number): void {
        const start = this._cs.position - stringPrefixLength;

        if (flags & (StringTokenFlags.Format | StringTokenFlags.Template)) {
            if (flags & StringTokenFlags.Triplicate) {
                this._cs.advance(3);
            } else {
                this._cs.moveNext();
            }

            const end = this._cs.position;

            const fStringStartToken = FStringStartToken.create(
                start,
                end - start,
                flags,
                stringPrefixLength,
                this._getComments()
            );

            // Create a new f-string context and push it on the stack.
            const fStringContext: FStringContext = {
                startToken: fStringStartToken,
                replacementFieldStack: [],
            };

            if (this._activeFString) {
                this._fStringStack.push(this._activeFString);
            }
            this._activeFString = fStringContext;

            this._tokens.push(fStringStartToken);
        } else {
            if (flags & StringTokenFlags.Triplicate) {
                this._cs.advance(3);
            } else {
                this._cs.moveNext();

                if (flags & StringTokenFlags.SingleQuote) {
                    this._singleQuoteCount++;
                } else {
                    this._doubleQuoteCount++;
                }
            }

            const stringLiteralInfo = this._skipToEndOfStringLiteral(flags);
            const end = this._cs.position;

            // If this is an unterminated string, see if it matches the string type
            // of an active f-string. If so, we'll treat it as an f-string end
            // token rather than an unterminated regular string. This helps with
            // parse error recovery if a closing bracket is missing in an f-string.
            if (
                (stringLiteralInfo.flags & StringTokenFlags.Unterminated) !== 0 &&
                this._activeFString?.activeReplacementField
            ) {
                if (
                    (flags &
                        (StringTokenFlags.Bytes |
                            StringTokenFlags.Unicode |
                            StringTokenFlags.Raw |
                            StringTokenFlags.Format |
                            StringTokenFlags.Template)) ===
                    0
                ) {
                    const quoteTypeMask =
                        StringTokenFlags.Triplicate | StringTokenFlags.DoubleQuote | StringTokenFlags.SingleQuote;
                    if ((this._activeFString.startToken.flags & quoteTypeMask) === (flags & quoteTypeMask)) {
                        // Unwind to the start of this string token and terminate any replacement fields
                        // that are active. This will cause the tokenizer to re-process the quote as an
                        // FStringEnd token.
                        this._cs.position = start;
                        while (this._activeFString.replacementFieldStack.length > 0) {
                            this._activeFString.activeReplacementField =
                                this._activeFString.replacementFieldStack.pop();
                        }
                        this._parenDepth = this._activeFString.activeReplacementField!.parenDepth - 1;
                        this._activeFString.activeReplacementField = undefined;
                        return;
                    }
                }
            }

            this._tokens.push(
                StringToken.create(
                    start,
                    end - start,
                    stringLiteralInfo.flags,
                    stringLiteralInfo.escapedValue,
                    stringPrefixLength,
                    this._getComments()
                )
            );
        }
    }

    // Scans for either the FString end token or a replacement field.
    private _handleFStringMiddle(): void {
        const activeFString = this._activeFString!;
        const inFormatSpecifier = !!this._activeFString!.activeReplacementField?.inFormatSpecifier;
        const start = this._cs.position;
        const flags = activeFString.startToken.flags;
        const stringLiteralInfo = this._skipToEndOfStringLiteral(flags, inFormatSpecifier);
        const end = this._cs.position;

        const isUnterminated = (stringLiteralInfo.flags & StringTokenFlags.Unterminated) !== 0;
        const sawReplacementFieldStart = (stringLiteralInfo.flags & StringTokenFlags.ReplacementFieldStart) !== 0;
        const sawReplacementFieldEnd = (stringLiteralInfo.flags & StringTokenFlags.ReplacementFieldEnd) !== 0;
        const sawEndQuote = !isUnterminated && !sawReplacementFieldStart && !sawReplacementFieldEnd;

        let middleTokenLength = end - start;
        if (sawEndQuote) {
            middleTokenLength -= activeFString.startToken.quoteMarkLength;
        }

        if (middleTokenLength > 0 || isUnterminated) {
            this._tokens.push(
                FStringMiddleToken.create(
                    start,
                    middleTokenLength,
                    stringLiteralInfo.flags,
                    stringLiteralInfo.escapedValue
                )
            );
        }

        if (sawEndQuote) {
            this._tokens.push(
                FStringEndToken.create(
                    start + middleTokenLength,
                    activeFString.startToken.quoteMarkLength,
                    stringLiteralInfo.flags
                )
            );

            this._activeFString = this._fStringStack.pop();
        } else if (isUnterminated) {
            this._activeFString = this._fStringStack.pop();
        }
    }

    private _skipToEndOfStringLiteral(flags: StringTokenFlags, inFormatSpecifier = false): StringScannerOutput {
        const quoteChar = flags & StringTokenFlags.SingleQuote ? Char.SingleQuote : Char.DoubleQuote;
        const isTriplicate = (flags & StringTokenFlags.Triplicate) !== 0;
        const isFString = (flags & (StringTokenFlags.Format | StringTokenFlags.Template)) !== 0;
        let isInNamedUnicodeEscape = false;
        const start = this._cs.position;
        let escapedValueLength = 0;
        const getEscapedValue = () => cloneStr(this._cs.getText().slice(start, start + escapedValueLength));

        while (true) {
            if (this._cs.isEndOfStream()) {
                // Hit the end of file without a termination.
                flags |= StringTokenFlags.Unterminated;
                return {
                    escapedValue: getEscapedValue(),
                    flags,
                };
            }

            if (this._cs.currentChar === Char.Backslash) {
                escapedValueLength++;

                // Move past the escape (backslash) character.
                this._cs.moveNext();

                // Handle the special escape sequence /N{name} for unicode characters.
                if (
                    !isInNamedUnicodeEscape &&
                    this._cs.getCurrentChar() === Char.N &&
                    this._cs.nextChar === Char.OpenBrace
                ) {
                    flags |= StringTokenFlags.NamedUnicodeEscape;
                    isInNamedUnicodeEscape = true;
                } else {
                    // If this is an f-string, the only escapes that are allowed is for
                    // a single or double quote symbol or a newline/carriage return.
                    const isEscapedQuote =
                        this._cs.getCurrentChar() === Char.SingleQuote ||
                        this._cs.getCurrentChar() === Char.DoubleQuote;
                    const isEscapedNewLine =
                        this._cs.getCurrentChar() === Char.CarriageReturn ||
                        this._cs.getCurrentChar() === Char.LineFeed;
                    const isEscapedBackslash = this._cs.getCurrentChar() === Char.Backslash;

                    if (!isFString || isEscapedBackslash || isEscapedQuote || isEscapedNewLine) {
                        if (isEscapedNewLine) {
                            if (
                                this._cs.getCurrentChar() === Char.CarriageReturn &&
                                this._cs.nextChar === Char.LineFeed
                            ) {
                                escapedValueLength++;
                                this._cs.moveNext();
                            }
                            escapedValueLength++;
                            this._cs.moveNext();
                            this._addLineRange();
                        } else {
                            escapedValueLength++;
                            this._cs.moveNext();
                        }
                    }
                }
            } else if (this._cs.currentChar === Char.LineFeed || this._cs.currentChar === Char.CarriageReturn) {
                if (!isTriplicate) {
                    if (!isFString || !this._activeFString?.activeReplacementField) {
                        // Unterminated single-line string
                        flags |= StringTokenFlags.Unterminated;
                        return {
                            escapedValue: getEscapedValue(),
                            flags,
                        };
                    }
                }

                // Skip over the new line (either one or two characters).
                if (this._cs.currentChar === Char.CarriageReturn && this._cs.nextChar === Char.LineFeed) {
                    escapedValueLength++;
                    this._cs.moveNext();
                }

                escapedValueLength++;
                this._cs.moveNext();
                this._addLineRange();
            } else if (!isTriplicate && this._cs.currentChar === quoteChar) {
                this._cs.moveNext();
                break;
            } else if (
                isTriplicate &&
                this._cs.currentChar === quoteChar &&
                this._cs.nextChar === quoteChar &&
                this._cs.lookAhead(2) === quoteChar
            ) {
                this._cs.advance(3);
                break;
            } else if (!isInNamedUnicodeEscape && isFString && this._cs.currentChar === Char.OpenBrace) {
                if (inFormatSpecifier || this._cs.nextChar !== Char.OpenBrace) {
                    flags |= StringTokenFlags.ReplacementFieldStart;
                    break;
                } else {
                    escapedValueLength++;
                    this._cs.moveNext();
                    escapedValueLength++;
                    this._cs.moveNext();
                }
            } else if (isInNamedUnicodeEscape && this._cs.currentChar === Char.CloseBrace) {
                isInNamedUnicodeEscape = false;
                escapedValueLength++;
                this._cs.moveNext();
            } else if (isFString && this._cs.currentChar === Char.CloseBrace) {
                if (inFormatSpecifier || this._cs.nextChar !== Char.CloseBrace) {
                    flags |= StringTokenFlags.ReplacementFieldEnd;
                    break;
                } else {
                    escapedValueLength++;
                    this._cs.moveNext();
                    escapedValueLength++;
                    this._cs.moveNext();
                }
            } else {
                escapedValueLength++;
                this._cs.moveNext();
            }
        }

        return {
            escapedValue: getEscapedValue(),
            flags,
        };
    }

    private _skipFloatingPointCandidate(): boolean {
        // Determine end of the potential floating point number
        const start = this._cs.position;
        this._skipFractionalNumber();
        if (this._cs.position > start) {
            // Optional exponent sign
            if (this._cs.currentChar === Char.e || this._cs.currentChar === Char.E) {
                this._cs.moveNext();

                // Skip exponent value
                this._skipDecimalNumber(/* allowSign */ true);
            }
        }
        return this._cs.position > start;
    }

    private _skipFractionalNumber(): void {
        this._skipDecimalNumber(false);
        if (this._cs.currentChar === Char.Period) {
            // Optional period
            this._cs.moveNext();
        }
        this._skipDecimalNumber(false);
    }

    private _skipDecimalNumber(allowSign: boolean): void {
        if (allowSign && (this._cs.currentChar === Char.Hyphen || this._cs.currentChar === Char.Plus)) {
            // Optional sign
            this._cs.moveNext();
        }
        while (isDecimal(this._cs.currentChar)) {
            // Skip integer part
            this._cs.moveNext();
        }
    }
}
