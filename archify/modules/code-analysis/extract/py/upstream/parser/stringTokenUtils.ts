/*
 * stringTokenUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Methods that handle unescaping of escaped string token
 * literal values.
 */

import { Char } from '../common/charCodes.js';
import { FStringMiddleToken, StringToken, StringTokenFlags } from './tokenizerTypes.js';

export const enum UnescapeErrorType {
    InvalidEscapeSequence,
}

export interface UnescapeError {
    // Offset within the unescaped string where
    // this error begins.
    offset: number;

    // Length of section associated with error.
    length: number;

    // Type of error.
    errorType: UnescapeErrorType;
}

export interface UnescapedString {
    value: string;
    unescapeErrors: UnescapeError[];
    nonAsciiInBytes: boolean;
}

interface IncompleteUnescapedString {
    valueParts: string[];
    unescapeErrors: UnescapeError[];
    nonAsciiInBytes: boolean;
}

function completeUnescapedString(incomplete: IncompleteUnescapedString, originalString: string): UnescapedString {
    const newValue = incomplete.valueParts.join('');
    // Use the original string if it's identical. This prevents us from allocating
    // memory to hold a copy. A copy is made because the original string is a
    // 'slice' of another, so it doesn't exist in the cache yet.
    const value = originalString !== newValue ? newValue : originalString;
    return {
        ...incomplete,
        value,
    };
}

export function getUnescapedString(stringToken: StringToken | FStringMiddleToken, elideCrlf = true): UnescapedString {
    const escapedString = stringToken.escapedValue;
    const isRaw = (stringToken.flags & StringTokenFlags.Raw) !== 0;

    if (isRaw) {
        return {
            value: escapedString,
            unescapeErrors: [],
            nonAsciiInBytes: false,
        };
    }

    const isBytes = (stringToken.flags & StringTokenFlags.Bytes) !== 0;

    // Scan once for the characters that force the slow (unescaping) path. Building a
    // number[] of every char code up front (one per character of every non-raw string
    // literal in the file) is a significant source of GC pressure during parsing, and
    // the common case (no escapes/newlines) only needs a cheap charCodeAt scan. The
    // slow path below reads char codes directly from `escapedString` as well.
    let hasEscapeOrNewLine = false;
    let nonAsciiInBytes = false;
    for (let index = 0; index < escapedString.length; index++) {
        const curChar = escapedString.charCodeAt(index);
        if (curChar === Char.CarriageReturn || curChar === Char.LineFeed || curChar === Char.Backslash) {
            hasEscapeOrNewLine = true;
            // `nonAsciiInBytes` below is only consulted by the fast-path return, which
            // we won't take once an escape/newline is found (the slow path recomputes
            // it), so there's no need to keep scanning.
            break;
        }
        if (isBytes && curChar >= 128) {
            nonAsciiInBytes = true;
        }
    }

    // Handle the common case in an expedited manner.
    if (!hasEscapeOrNewLine) {
        return {
            value: escapedString,
            unescapeErrors: [],
            nonAsciiInBytes,
        };
    }

    let strOffset = 0;
    const output: IncompleteUnescapedString = {
        valueParts: [],
        unescapeErrors: [],
        nonAsciiInBytes: false,
    };

    const addInvalidEscapeOffset = () => {
        // Invalid escapes are not reported for raw strings.
        if (!isRaw) {
            output.unescapeErrors.push({
                offset: strOffset - 1,
                length: 2,
                errorType: UnescapeErrorType.InvalidEscapeSequence,
            });
        }
    };

    const getEscapedCharacter = (offset = 0) => {
        if (strOffset + offset >= escapedString.length) {
            return Char.EndOfText;
        }

        return escapedString.charCodeAt(strOffset + offset);
    };

    const scanHexEscape = (digitCount: number) => {
        let foundIllegalHexDigit = false;
        let hexValue = 0;
        let localValue = '';

        for (let i = 0; i < digitCount; i++) {
            const charCode = getEscapedCharacter(1 + i);
            if (!_isHexCharCode(charCode)) {
                foundIllegalHexDigit = true;
                break;
            }
            hexValue = 16 * hexValue + _getHexDigitValue(charCode);
        }

        if (foundIllegalHexDigit) {
            addInvalidEscapeOffset();
            localValue = '\\' + String.fromCharCode(getEscapedCharacter());
            strOffset++;
        } else {
            localValue = String.fromCharCode(hexValue);
            strOffset += 1 + digitCount;
        }

        return localValue;
    };

    const appendOutputChar = (charCode: number) => {
        const char = String.fromCharCode(charCode);
        output.valueParts.push(char);
    };

    while (true) {
        let curChar = getEscapedCharacter();
        if (curChar === Char.EndOfText) {
            return completeUnescapedString(output, escapedString);
        }

        if (curChar === Char.Backslash) {
            // Move past the escape (backslash) character.
            strOffset++;

            if (isRaw) {
                appendOutputChar(curChar);
                continue;
            }

            curChar = getEscapedCharacter();
            let localValue = '';

            if (curChar === Char.CarriageReturn || curChar === Char.LineFeed) {
                if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
                    if (isRaw) {
                        localValue += String.fromCharCode(curChar);
                    }
                    strOffset++;
                    curChar = getEscapedCharacter();
                }
                if (isRaw) {
                    localValue = '\\' + localValue + String.fromCharCode(curChar);
                }
                strOffset++;
            } else {
                if (isRaw) {
                    localValue = '\\' + String.fromCharCode(curChar);
                    strOffset++;
                } else {
                    switch (curChar) {
                        case Char.Backslash:
                        case Char.SingleQuote:
                        case Char.DoubleQuote:
                            localValue = String.fromCharCode(curChar);
                            strOffset++;
                            break;

                        case Char.a:
                            localValue = '\u0007';
                            strOffset++;
                            break;

                        case Char.b:
                            localValue = '\b';
                            strOffset++;
                            break;

                        case Char.f:
                            localValue = '\f';
                            strOffset++;
                            break;

                        case Char.n:
                            localValue = '\n';
                            strOffset++;
                            break;

                        case Char.r:
                            localValue = '\r';
                            strOffset++;
                            break;

                        case Char.t:
                            localValue = '\t';
                            strOffset++;
                            break;

                        case Char.v:
                            localValue = '\v';
                            strOffset++;
                            break;

                        case Char.x:
                            localValue = scanHexEscape(2);
                            break;

                        case Char.N: {
                            let foundIllegalChar = false;
                            let charCount = 1;

                            // This type of escape isn't allowed for bytes.
                            if (isBytes) {
                                foundIllegalChar = true;
                            }

                            if (getEscapedCharacter(charCount) !== Char.OpenBrace) {
                                foundIllegalChar = true;
                            } else {
                                charCount++;
                                while (true) {
                                    const lookaheadChar = getEscapedCharacter(charCount);
                                    if (lookaheadChar === Char.CloseBrace) {
                                        break;
                                    } else if (
                                        !_isAlphaNumericChar(lookaheadChar) &&
                                        lookaheadChar !== Char.Hyphen &&
                                        !_isWhitespaceChar(lookaheadChar)
                                    ) {
                                        foundIllegalChar = true;
                                        break;
                                    } else {
                                        charCount++;
                                    }
                                }
                            }

                            if (foundIllegalChar) {
                                addInvalidEscapeOffset();
                                localValue = '\\' + String.fromCharCode(curChar);
                                strOffset++;
                            } else {
                                // We don't have the Unicode name database handy, so
                                // assume that the name is valid and use a '-' as a
                                // replacement character.
                                localValue = '-';
                                strOffset += 1 + charCount;
                            }
                            break;
                        }

                        case Char.u:
                        case Char.U:
                            // This type of escape isn't allowed for bytes.
                            if (isBytes) {
                                addInvalidEscapeOffset();
                            }
                            localValue = scanHexEscape(curChar === Char.u ? 4 : 8);
                            break;

                        default:
                            if (_isOctalCharCode(curChar)) {
                                let octalCode = curChar - Char._0;
                                strOffset++;
                                curChar = getEscapedCharacter();
                                if (_isOctalCharCode(curChar)) {
                                    octalCode = octalCode * 8 + curChar - Char._0;
                                    strOffset++;
                                    curChar = getEscapedCharacter();

                                    if (_isOctalCharCode(curChar)) {
                                        octalCode = octalCode * 8 + curChar - Char._0;
                                        strOffset++;
                                    }
                                }

                                localValue = String.fromCharCode(octalCode);
                            } else {
                                localValue = '\\';
                                addInvalidEscapeOffset();
                            }
                            break;
                    }
                }
            }

            output.valueParts.push(localValue);
        } else if (curChar === Char.LineFeed || curChar === Char.CarriageReturn) {
            // Skip over the escaped new line (either one or two characters).
            if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
                if (!elideCrlf) {
                    appendOutputChar(curChar);
                }
                strOffset++;
                curChar = getEscapedCharacter();
            }

            appendOutputChar(curChar);
            strOffset++;
        } else {
            // There's nothing to unescape, so output the escaped character directly.
            if (isBytes && curChar >= 128) {
                output.nonAsciiInBytes = true;
            }

            appendOutputChar(curChar);
            strOffset++;
        }
    }
}

function _isWhitespaceChar(charCode: number): boolean {
    return charCode === Char.Space || charCode === Char.Tab;
}

function _isAlphaNumericChar(charCode: number): boolean {
    if (charCode >= Char._0 && charCode <= Char._9) {
        return true;
    }

    if (charCode >= Char.a && charCode <= Char.z) {
        return true;
    }

    if (charCode >= Char.A && charCode <= Char.Z) {
        return true;
    }

    return false;
}

function _isOctalCharCode(charCode: number): boolean {
    return charCode >= Char._0 && charCode <= Char._7;
}

function _isHexCharCode(charCode: number): boolean {
    if (charCode >= Char._0 && charCode <= Char._9) {
        return true;
    }

    if (charCode >= Char.a && charCode <= Char.f) {
        return true;
    }

    if (charCode >= Char.A && charCode <= Char.F) {
        return true;
    }

    return false;
}

function _getHexDigitValue(charCode: number): number {
    if (charCode >= Char._0 && charCode <= Char._9) {
        return charCode - Char._0;
    }

    if (charCode >= Char.a && charCode <= Char.f) {
        return charCode - Char.a + 10;
    }

    if (charCode >= Char.A && charCode <= Char.F) {
        return charCode - Char.A + 10;
    }

    return 0;
}
