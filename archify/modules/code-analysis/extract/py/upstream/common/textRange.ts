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

    export function fromBounds(start: number, end: number): TextRange {
        if (start < 0) {
            fail('start must be non-negative');
        }
        if (start > end) {
            fail('end must be greater than or equal to start');
        }
        return create(start, end - start);
    }

    export function getEnd(range: TextRange): number {
        return range.start + range.length;
    }

    export function contains(range: TextRange, position: number): boolean {
        return position >= range.start && position < getEnd(range);
    }

    export function containsRange(range: TextRange, span: TextRange): boolean {
        return span.start >= range.start && getEnd(span) <= getEnd(range);
    }

    export function overlaps(range: TextRange, position: number): boolean {
        return position >= range.start && position <= getEnd(range);
    }

    export function overlapsRange(range: TextRange, other: TextRange): boolean {
        return overlaps(range, other.start) || overlaps(other, range.start);
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

    export function combine(ranges: TextRange[]): TextRange | undefined {
        if (ranges.length === 0) {
            return undefined;
        }

        let combinedRange: TextRange = { start: ranges[0].start, length: ranges[0].length };
        for (let i = 1; i < ranges.length; i++) {
            combinedRange = extend(combinedRange, ranges[i]);
        }
        return combinedRange;
    }
}

export interface Position {
    // Both line and column are zero-based
    line: number;
    character: number;
}

export namespace Position {
    export function print(value: Position): string {
        return `(${value.line}:${value.character})`;
    }
}

export interface Range {
    start: Position;
    end: Position;
}

export namespace Range {
    export function print(value: Range): string {
        return `${Position.print(value.start)}-${Position.print(value.end)}`;
    }
}

// Represents a range within a particular document.
export function comparePositions(a: Position, b: Position) {
    if (a.line < b.line) {
        return -1;
    } else if (a.line > b.line) {
        return 1;
    } else if (a.character < b.character) {
        return -1;
    } else if (a.character > b.character) {
        return 1;
    }
    return 0;
}

export function getEmptyPosition(): Position {
    return {
        line: 0,
        character: 0,
    };
}

export function doRangesOverlap(a: Range, b: Range) {
    if (comparePositions(b.start, a.end) >= 0) {
        return false;
    } else if (comparePositions(a.start, b.end) >= 0) {
        return false;
    }
    return true;
}

export function doRangesIntersect(a: Range, b: Range) {
    if (comparePositions(b.start, a.end) > 0) {
        return false;
    } else if (comparePositions(a.start, b.end) > 0) {
        return false;
    }
    return true;
}

export function isPositionInRange(range: Range, position: Position): boolean {
    return comparePositions(range.start, position) <= 0 && comparePositions(range.end, position) >= 0;
}

export function isRangeInRange(range: Range, containedRange: Range): boolean {
    return isPositionInRange(range, containedRange.start) && isPositionInRange(range, containedRange.end);
}

export function positionsAreEqual(a: Position, b: Position) {
    return comparePositions(a, b) === 0;
}

export function rangesAreEqual(a: Range, b: Range) {
    return positionsAreEqual(a.start, b.start) && positionsAreEqual(a.end, b.end);
}

export function getEmptyRange(): Range {
    return {
        start: getEmptyPosition(),
        end: getEmptyPosition(),
    };
}

export function isEmptyPosition(pos: Position) {
    return pos.character === 0 && pos.line === 0;
}

export function isEmptyRange(range: Range) {
    return isEmptyPosition(range.start) && isEmptyPosition(range.end);
}

export function extendRange(range: Range, extension: Range) {
    if (comparePositions(extension.start, range.start) < 0) {
        range.start = extension.start;
    }

    if (comparePositions(extension.end, range.end) > 0) {
        range.end = extension.end;
    }
}

export function combineRange(ranges: Range[]): Range | undefined {
    if (ranges.length === 0) {
        return undefined;
    }

    const combinedRange = ranges[0];
    for (let i = 1; i < ranges.length; i++) {
        extendRange(combinedRange, ranges[i]);
    }

    return combinedRange;
}
