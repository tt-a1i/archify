/*
 * stringUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility methods for manipulating and comparing strings.
 */

import { compareComparableValues, Comparison } from './core.js';

// Determines if typed string matches a symbol
// name. Characters must appear in order.
// Return true if all typed characters are in symbol
export function isPatternInSymbol(typedValue: string, symbolName: string): boolean {
    // This function is extremely hot: it runs against the entire symbol index
    // during auto-import and completion filtering. The original implementation
    // eagerly allocated two fully lower-cased copies of both strings up front
    // (via toLocaleLowerCase), even when an early character mismatch would
    // immediately reject the match.
    //
    // Fast path: scan character-by-character with charCodeAt (no allocation) and
    // fold case via a precomputed Latin-1 table (built at module init from
    // toLocaleLowerCase, so it preserves the original's exact locale-sensitive
    // behavior) while BOTH current characters fold to a single length-preserving
    // Latin-1 code unit. The overwhelming majority of Python symbol names and typed
    // queries are ASCII/Latin-1 identifiers, so this avoids the two
    // toLocaleLowerCase allocations entirely for the common case. Folds that would
    // change a string's length fall back to the exact original algorithm below.
    const typedLength = typedValue.length;
    const symbolLength = symbolName.length;
    let typedPos = 0;
    let symbolPos = 0;
    while (typedPos < typedLength && symbolPos < symbolLength) {
        const typedCode = typedValue.charCodeAt(typedPos);
        const symbolCode = symbolName.charCodeAt(symbolPos);

        // Fold each current character via the precomputed table. Any code point
        // outside Latin-1 (index > 0xff) is not in the table and always needs the
        // fallback; a Latin-1 code point maps to NEEDS_FALLBACK when its case fold
        // is not a single length-preserving Latin-1 code unit under the active
        // locale (see the table comment below).
        const typedFold = typedCode <= 0xff ? latin1LowerCaseTable[typedCode] : NEEDS_FALLBACK;
        const symbolFold = symbolCode <= 0xff ? latin1LowerCaseTable[symbolCode] : NEEDS_FALLBACK;

        if (typedFold === NEEDS_FALLBACK || symbolFold === NEEDS_FALLBACK) {
            // We hit a character whose case folding can change string length or is
            // locale-sensitive in a way the per-character table cannot represent
            // (e.g. non-Latin-1 code points like the ligature ﬁ, Greek, CJK, a
            // combining mark, or Turkish dotted capital İ). Fall back to the exact
            // original algorithm: lower-case both FULL strings and match over the
            // lower-cased strings from the start. Restarting (rather than resuming
            // at typedPos/symbolPos over original indices) is required for
            // correctness, because toLocaleLowerCase can produce a different number
            // of code units than the original string.
            const typedLower = typedValue.toLocaleLowerCase();
            const symbolLower = symbolName.toLocaleLowerCase();
            const typedLowerLength = typedLower.length;
            const symbolLowerLength = symbolLower.length;
            let tp = 0;
            let sp = 0;
            while (tp < typedLowerLength && sp < symbolLowerLength) {
                if (typedLower[tp] === symbolLower[sp]) {
                    tp += 1;
                }
                sp += 1;
            }
            return tp === typedLowerLength;
        }

        if (typedFold === symbolFold) {
            typedPos += 1;
        }
        symbolPos += 1;
    }

    return typedPos === typedLength;
}

// Sentinel marking a Latin-1 code point whose case fold cannot be represented as a
// single length-preserving Latin-1 code unit under the active locale, so matches
// involving it must take the full-string toLocaleLowerCase fallback.
const NEEDS_FALLBACK = -1;

// Case-folding lookup table for the Latin-1 range (0x00-0xff). Each entry holds the
// lower-cased code point produced by String.prototype.toLocaleLowerCase for that
// code unit under the process locale at module-init time. This preserves the exact
// behavior of the original toLocaleLowerCase-based implementation — including any
// locale-sensitive ASCII casing such as the Turkish/Azeri dotless-i rule — while
// avoiding a per-call allocation. Entries whose fold is not a single code unit
// (length-changing folds) map to NEEDS_FALLBACK so those matches take the slow path.
// Building the table once assumes the process locale is stable for its lifetime,
// which holds for the language server.
const latin1LowerCaseTable: Int32Array = (() => {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        const lower = String.fromCharCode(i).toLocaleLowerCase();
        table[i] = lower.length === 1 ? lower.charCodeAt(0) : NEEDS_FALLBACK;
    }
    return table;
})();

// This is a simple, non-cryptographic hash function for text.
export function hashString(contents: string) {
    let hash = 0;

    for (let i = 0; i < contents.length; i++) {
        hash = ((hash << 5) - hash + contents.charCodeAt(i)) | 0;
    }
    return hash;
}

export interface StringFingerprint {
    readonly primary: number;
    readonly secondary: number;
}

// Computes the legacy string hash and an independent FNV-1a component in one pass.
export function getStringFingerprint(contents: string): StringFingerprint {
    let primary = 0;
    let secondary = 0x811c9dc5;

    for (let i = 0; i < contents.length; i++) {
        const codeUnit = contents.charCodeAt(i);
        primary = ((primary << 5) - primary + codeUnit) | 0;
        secondary = Math.imul(secondary ^ codeUnit, 0x01000193);
    }

    return { primary, secondary };
}

export function areStringFingerprintsEqual(left: StringFingerprint, right: StringFingerprint) {
    return left.primary === right.primary && left.secondary === right.secondary;
}

/**
 * Compare two strings using a case-insensitive ordinal comparison.
 *
 * Ordinal comparisons are based on the difference between the unicode code points of both
 * strings. Characters with multiple unicode representations are considered unequal. Ordinal
 * comparisons provide predictable ordering, but place "a" after "B".
 *
 * Case-insensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point after applying `toUpperCase` to each string. We always map both
 * strings to their upper-case form as some unicode characters do not properly round-trip to
 * lowercase (such as `áºž` (German sharp capital s)).
 */
export function compareStringsCaseInsensitive(a: string | undefined, b: string | undefined): Comparison {
    return a === b
        ? Comparison.EqualTo
        : a === undefined
        ? Comparison.LessThan
        : b === undefined
        ? Comparison.GreaterThan
        : compareComparableValues(a.toUpperCase(), b.toUpperCase());
}

/**
 * Compare two strings using a case-sensitive ordinal comparison.
 *
 * Ordinal comparisons are based on the difference between the unicode code points of both
 * strings. Characters with multiple unicode representations are considered unequal. Ordinal
 * comparisons provide predictable ordering, but place "a" after "B".
 *
 * Case-sensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point.
 */
export function compareStringsCaseSensitive(a: string | undefined, b: string | undefined): Comparison {
    return compareComparableValues(a, b);
}

export function getStringComparer(ignoreCase?: boolean) {
    return ignoreCase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
}

/**
 * Compare the equality of two strings using a case-insensitive ordinal comparison.
 *
 * Case-insensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point after applying `toUpperCase` to each string. We always map both
 * strings to their upper-case form as some unicode characters do not properly round-trip to
 * lowercase (such as `ẞ` (German sharp capital s)).
 */
export function equateStringsCaseInsensitive(a: string, b: string) {
    return compareStringsCaseInsensitive(a, b) === Comparison.EqualTo;
}

/**
 * Compare the equality of two strings using a case-sensitive ordinal comparison.
 *
 * Case-sensitive comparisons compare both strings one code-point at a time using the
 * integer value of each code-point.
 */
export function equateStringsCaseSensitive(a: string, b: string) {
    return compareStringsCaseSensitive(a, b) === Comparison.EqualTo;
}

export function getCharacterCount(value: string, ch: string) {
    let result = 0;
    for (let i = 0; i < value.length; i++) {
        if (value[i] === ch) {
            result++;
        }
    }
    return result;
}

export function getLastDottedString(text: string) {
    const index = text.lastIndexOf('.');
    return index > 0 ? text.substring(index + 1) : text;
}

export function truncate(text: string, maxLength: number) {
    if (text.length > maxLength) {
        return text.substring(0, maxLength - '...'.length) + '...';
    }
    return text;
}

export function escapeRegExp(text: string) {
    return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
