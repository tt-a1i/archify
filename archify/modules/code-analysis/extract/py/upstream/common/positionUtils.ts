/*
 * positionUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility routines for converting between file offsets and
 * line/column positions.
 */

import { assert } from './debug.js';
import { Position, Range, TextRange } from './textRange.js';
import { TextRangeCollection } from './textRangeCollection.js';

// Translates a file offset into a line/column pair.
export function convertOffsetToPosition(offset: number, lines: TextRangeCollection<TextRange>): Position {
    // Handle the case where the file is empty.
    if (lines.end === 0) {
        return {
            line: 0,
            character: 0,
        };
    }

    const itemIndex = offset >= lines.end ? lines.count - 1 : lines.getItemContaining(offset);
    assert(itemIndex >= 0 && itemIndex <= lines.count);
    const lineRange = lines.getItemAt(itemIndex);
    assert(lineRange !== undefined);
    return {
        line: itemIndex,
        character: Math.max(0, Math.min(lineRange.length, offset - lineRange.start)),
    };
}

// Translates a start/end file offset into a pair of line/column positions.
export function convertOffsetsToRange(
    startOffset: number,
    endOffset: number,
    lines: TextRangeCollection<TextRange>
): Range {
    const start = convertOffsetToPosition(startOffset, lines);

    // Fast path: when the end offset falls on the same line as the start, derive
    // the end position directly from the start's line range instead of doing a
    // second binary search. The overwhelming majority of ranges converted during
    // binding/analysis are single-line (identifier and keyword tokens), so this
    // avoids a large number of redundant lookups on big files. The result is
    // identical to calling convertOffsetToPosition(endOffset) for these cases.
    if (lines.end !== 0 && endOffset >= startOffset) {
        const lineRange = lines.getItemAt(start.line);
        const lineEnd = lineRange.start + lineRange.length;
        if (endOffset >= lineRange.start && endOffset < lineEnd) {
            return {
                start,
                end: {
                    line: start.line,
                    character: endOffset - lineRange.start,
                },
            };
        }
    }

    const end = convertOffsetToPosition(endOffset, lines);
    return { start, end };
}
