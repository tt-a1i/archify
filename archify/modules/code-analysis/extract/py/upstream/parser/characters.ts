/*
 * characters.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Based on code from vscode-python repository:
 *  https://github.com/Microsoft/vscode-python
 *
 * Utility routines used by tokenizer.
 */

import { Char } from '../common/charCodes.js';
import * as unicode from './unicode.js';

enum CharCategory {
    // Character cannot appear in identifier
    NotIdentifierChar = 0,

    // Character can appear at beginning or within identifier
    StartIdentifierChar = 1,

    // Character can appear only within identifier, not at beginning
    IdentifierChar = 2,

    // Character is a surrogate, meaning that additional character
    // needs to be consulted.
    SurrogateChar = 3,
}

// Table of first 256 character codes (the most common cases).
const _identifierCharFastTableSize = 256;
const _identifierCharFastTable: CharCategory[] = new Array(_identifierCharFastTableSize);

// Map of remaining characters that can appear within identifier.
type CharCategoryMap = { [code: number]: CharCategory };
const _identifierCharMap: CharCategoryMap = {};

// Secondary character map based on the primary (surrogate) character.
const _surrogateCharMap: { [code: number]: CharCategoryMap } = {};

// We do lazy initialization of this map because it's rarely used.
let _identifierCharMapInitialized = false;

export function isIdentifierStartChar(char: number, nextChar?: number): boolean {
    if (char < _identifierCharFastTableSize) {
        return _identifierCharFastTable[char] === CharCategory.StartIdentifierChar;
    }

    // Lazy initialize the char map. We'll rarely get here.
    if (!_identifierCharMapInitialized) {
        _buildIdentifierLookupTable(false);
        _identifierCharMapInitialized = true;
    }

    let charCategory: CharCategory;
    if (nextChar !== undefined) {
        charCategory = _lookUpSurrogate(char, nextChar);
    } else {
        charCategory = _identifierCharMap[char];
    }

    return charCategory === CharCategory.StartIdentifierChar;
}

export function isIdentifierChar(char: number, nextChar?: number): boolean {
    if (char < _identifierCharFastTableSize) {
        return (
            _identifierCharFastTable[char] === CharCategory.StartIdentifierChar ||
            _identifierCharFastTable[char] === CharCategory.IdentifierChar
        );
    }

    // Lazy initialize the char map. We'll rarely get here.
    if (!_identifierCharMapInitialized) {
        _buildIdentifierLookupTable(false);
        _identifierCharMapInitialized = true;
    }

    let charCategory: CharCategory;
    if (nextChar !== undefined) {
        charCategory = _lookUpSurrogate(char, nextChar);
    } else {
        charCategory = _identifierCharMap[char];
    }

    return charCategory === CharCategory.StartIdentifierChar || charCategory === CharCategory.IdentifierChar;
}

export function isSurrogateChar(char: number): boolean {
    if (char < _identifierCharFastTableSize) {
        return false;
    }

    // Lazy initialize the char map. We'll rarely get here.
    if (!_identifierCharMapInitialized) {
        _buildIdentifierLookupTable(false);
        _identifierCharMapInitialized = true;
    }

    return _identifierCharMap[char] === CharCategory.SurrogateChar;
}

export function isWhiteSpace(ch: number): boolean {
    return ch === Char.Space || ch === Char.Tab || ch === Char.FormFeed;
}

export function isLineBreak(ch: number): boolean {
    return ch === Char.CarriageReturn || ch === Char.LineFeed;
}

export function isNumber(ch: number): boolean {
    return (ch >= Char._0 && ch <= Char._9) || ch === Char.Underscore;
}

export function isDecimal(ch: number): boolean {
    return (ch >= Char._0 && ch <= Char._9) || ch === Char.Underscore;
}

export function isHex(ch: number): boolean {
    return isDecimal(ch) || (ch >= Char.a && ch <= Char.f) || (ch >= Char.A && ch <= Char.F) || ch === Char.Underscore;
}

export function isOctal(ch: number): boolean {
    return (ch >= Char._0 && ch <= Char._7) || ch === Char.Underscore;
}

export function isBinary(ch: number): boolean {
    return ch === Char._0 || ch === Char._1 || ch === Char.Underscore;
}

function _lookUpSurrogate(char: number, nextChar: number): CharCategory {
    if (_identifierCharMap[char] !== CharCategory.SurrogateChar) {
        return CharCategory.NotIdentifierChar;
    }

    const surrogateTable = _surrogateCharMap[char];
    if (!surrogateTable) {
        return CharCategory.NotIdentifierChar;
    }

    return surrogateTable[nextChar];
}

// Underscore is explicitly allowed to start an identifier.
// Characters with the Other_ID_Start property.
const _specialStartIdentifierChars: unicode.UnicodeRangeTable = [
    Char.Underscore,
    0x1885,
    0x1886,
    0x2118,
    0x212e,
    0x309b,
    0x309c,
];

const _startIdentifierCharRanges = [
    _specialStartIdentifierChars,
    unicode.unicodeLu,
    unicode.unicodeLl,
    unicode.unicodeLt,
    unicode.unicodeLo,
    unicode.unicodeLm,
    unicode.unicodeNl,
];

const _startCharSurrogateRanges = [
    unicode.unicodeLuSurrogate,
    unicode.unicodeLlSurrogate,
    unicode.unicodeLoSurrogate,
    unicode.unicodeLmSurrogate,
    unicode.unicodeNlSurrogate,
];

// Characters with the Other_ID_Start property.
const _specialIdentifierChars: unicode.UnicodeRangeTable = [
    0x00b7, 0x0387, 0x1369, 0x136a, 0x136b, 0x136c, 0x136d, 0x136e, 0x136f, 0x1370, 0x1371, 0x19da,
];

const _identifierCharRanges = [
    _specialIdentifierChars,
    unicode.unicodeMn,
    unicode.unicodeMc,
    unicode.unicodeNd,
    unicode.unicodePc,
];

const _identifierCharSurrogateRanges = [
    unicode.unicodeMnSurrogate,
    unicode.unicodeMcSurrogate,
    unicode.unicodeNdSurrogate,
];

function _buildIdentifierLookupTableFromUnicodeRangeTable(
    table: unicode.UnicodeRangeTable,
    category: CharCategory,
    fastTableOnly: boolean,
    fastTable: CharCategoryMap,
    fullTable: CharCategoryMap
): void {
    for (let entryIndex = 0; entryIndex < table.length; entryIndex++) {
        const entry = table[entryIndex];
        let rangeStart: number;
        let rangeEnd: number;

        if (Array.isArray(entry)) {
            rangeStart = entry[0];
            rangeEnd = entry[1];
        } else {
            rangeStart = rangeEnd = entry;
        }

        for (let i = rangeStart; i <= rangeEnd; i++) {
            if (i < _identifierCharFastTableSize) {
                fastTable[i] = category;
            } else {
                fullTable[i] = category;
            }
        }

        if (fastTableOnly && rangeStart >= _identifierCharFastTableSize) {
            break;
        }
    }
}

function _buildIdentifierLookupTableFromSurrogateRangeTable(
    surrogateTable: unicode.UnicodeSurrogateRangeTable,
    category: CharCategory
): void {
    for (const surrogateChar in surrogateTable) {
        if (!_surrogateCharMap[surrogateChar]) {
            _surrogateCharMap[surrogateChar] = {};
            _identifierCharMap[surrogateChar] = CharCategory.SurrogateChar;
        }

        _buildIdentifierLookupTableFromUnicodeRangeTable(
            surrogateTable[surrogateChar],
            category,
            /* fastTableOnly */ false,
            _surrogateCharMap[surrogateChar],
            _surrogateCharMap[surrogateChar]
        );
    }
}

// Build a lookup table for to speed up tokenization of identifiers.
function _buildIdentifierLookupTable(fastTableOnly: boolean): void {
    _identifierCharFastTable.fill(CharCategory.NotIdentifierChar);

    _identifierCharRanges.forEach((table) => {
        _buildIdentifierLookupTableFromUnicodeRangeTable(
            table,
            CharCategory.IdentifierChar,
            fastTableOnly,
            _identifierCharFastTable,
            _identifierCharMap
        );
    });

    _startIdentifierCharRanges.forEach((table) => {
        _buildIdentifierLookupTableFromUnicodeRangeTable(
            table,
            CharCategory.StartIdentifierChar,
            fastTableOnly,
            _identifierCharFastTable,
            _identifierCharMap
        );
    });

    // Populate the surrogate tables for characters that require two
    // character codes.
    if (!fastTableOnly) {
        for (const surrogateTable of _identifierCharSurrogateRanges) {
            _buildIdentifierLookupTableFromSurrogateRangeTable(surrogateTable, CharCategory.IdentifierChar);
        }

        for (const surrogateTable of _startCharSurrogateRanges) {
            _buildIdentifierLookupTableFromSurrogateRangeTable(surrogateTable, CharCategory.StartIdentifierChar);
        }
    }
}

_buildIdentifierLookupTable(true);
