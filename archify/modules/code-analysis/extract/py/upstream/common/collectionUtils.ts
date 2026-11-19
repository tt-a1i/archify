/*
 * collectionUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions relating to collections and arrays.
 */

/**
 * Safely pushes the values of one array onto another array. This is the
 * same as receiver.push(...elementsToPush) except that it doesn't risk overflowing
 * the stack if elementsToPush is very large.
 */
export function appendArray<T>(to: T[], elementsToPush: readonly T[]) {
    if (elementsToPush.length < 256) {
        to.push(...elementsToPush);
        return;
    }

    for (const elem of elementsToPush) {
        to.push(elem);
    }
}
