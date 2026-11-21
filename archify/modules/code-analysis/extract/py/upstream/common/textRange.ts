/*
 * textRange.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Specifies the range of text within a larger string.
 */

import { fail } from './debug.js';

export interface TextRange {
    readonly start: number;
    readonly length: number;
}

export namespace TextRange {
    export function create(start: number, length: number): TextRange {
        if (start < 0) {
            fail('start must be non-negative');
        }
        if (length < 0) {
            fail('length must be non-negative');
        }
        return { start, length };
    }

    export function getEnd(range: TextRange): number {
        return range.start + range.length;
    }

    export function contains(range: TextRange, position: number): boolean {
        return position >= range.start && position < getEnd(range);
    }

    export function extend(range: TextRange, extension: TextRange): TextRange {
        let result = range;

        if (extension.start < result.start) {
            result = {
                start: extension.start,
                length: result.length + result.start - extension.start,
            };
        }

        const extensionEnd = getEnd(extension);
        const resultEnd = getEnd(result);
        if (extensionEnd > resultEnd) {
            result = {
                start: result.start,
                length: result.length + extensionEnd - resultEnd,
            };
        }

        return result;
    }
}

export interface Position {
    // Both line and column are zero-based
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}
