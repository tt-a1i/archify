/*
 * collectionUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions relating to collections and arrays.
 */

import { compareValues, Comparison, equateValues, isArray, MapLike } from './core.js';

export const emptyArray: never[] = [] as never[];
export type EqualityComparer<T> = (a: T, b: T) => boolean;

export function contains<T>(
    array: readonly T[] | undefined,
    value: T,
    equalityComparer: EqualityComparer<T> = equateValues
): boolean {
    if (array) {
        for (const v of array) {
            if (equalityComparer(v, value)) {
                return true;
            }
        }
    }
    return false;
}

/** Array that is only intended to be pushed to, never read. */
export interface Push<T> {
    push(...values: T[]): void;
}

/**
 * Appends a value to an array, returning the array.
 *
 * @param to The array to which `value` is to be appended. If `to` is `undefined`, a new array
 * is created if `value` was appended.
 * @param value The value to append to the array. If `value` is `undefined`, nothing is
 * appended.
 */
export function append<TArray extends any[] | undefined, TValue extends NonNullable<TArray>[number] | undefined>(
    to: TArray,
    value: TValue
): [undefined, undefined] extends [TArray, TValue] ? TArray : NonNullable<TArray>[number][];
export function append<T>(to: T[], value: T | undefined): T[];
export function append<T>(to: T[] | undefined, value: T): T[];
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined;
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined {
    if (value === undefined) {
        return to;
    }
    if (to === undefined) {
        return [value];
    }
    to.push(value);
    return to;
}

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

/** Works like Array.filter except that it returns a second array with the filtered elements. **/
export function partition<T, S extends T>(array: readonly T[], cb: (value: T) => boolean): [S[], T[]] {
    const trueItems: S[] = [];
    const falseItems: T[] = [];

    for (const item of array) {
        if (cb(item)) {
            trueItems.push(item as S);
        } else {
            falseItems.push(item);
        }
    }

    return [trueItems, falseItems];
}

/** Works like Array.prototype.find, returning `undefined` if no element satisfying the predicate is found. */
export function find<T, U extends T>(
    array: readonly T[],
    predicate: (element: T, index: number) => element is U
): U | undefined;
export function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean): T | undefined;
export function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean): T | undefined {
    for (let i = 0; i < array.length; i++) {
        const value = array[i];
        if (predicate(value, i)) {
            return value;
        }
    }
    return undefined;
}

/**
 * Gets the actual offset into an array for a relative offset. Negative offsets indicate a
 * position offset from the end of the array.
 */
function toOffset(array: readonly any[], offset: number) {
    return offset < 0 ? array.length + offset : offset;
}

/**
 * Appends a range of value to an array, returning the array.
 *
 * @param to The array to which `value` is to be appended. If `to` is `undefined`, a new array
 * is created if `value` was appended.
 * @param from The values to append to the array. If `from` is `undefined`, nothing is
 * appended. If an element of `from` is `undefined`, that element is not appended.
 * @param start The offset in `from` at which to start copying values.
 * @param end The offset in `from` at which to stop copying values (non-inclusive).
 */
export function addRange<T>(to: T[], from: readonly T[] | undefined, start?: number, end?: number): T[];
export function addRange<T>(
    to: T[] | undefined,
    from: readonly T[] | undefined,
    start?: number,
    end?: number
): T[] | undefined;
export function addRange<T>(
    to: T[] | undefined,
    from: readonly T[] | undefined,
    start?: number,
    end?: number
): T[] | undefined {
    if (from === undefined || from.length === 0) {
        return to;
    }
    if (to === undefined) {
        return from.slice(start, end);
    }
    start = start === undefined ? 0 : toOffset(from, start);
    end = end === undefined ? from.length : toOffset(from, end);
    for (let i = start; i < end && i < from.length; i++) {
        if (from[i] !== undefined) {
            to.push(from[i]);
        }
    }
    return to;
}

export function insertAt<T>(array: T[], index: number, value: T) {
    if (index === 0) {
        array.unshift(value);
    } else if (index === array.length) {
        array.push(value);
    } else {
        for (let i = array.length; i > index; i--) {
            array[i] = array[i - 1];
        }
        array[index] = value;
    }
    return array;
}

export type Comparer<T> = (a: T, b: T) => Comparison;

export interface SortedReadonlyArray<T> extends ReadonlyArray<T> {
    ' __sortedArrayBrand': any;
}

export interface SortedArray<T> extends Array<T> {
    ' __sortedArrayBrand': any;
}

/**
 * Returns a new sorted array.
 */
export function cloneAndSort<T>(array: readonly T[], comparer?: Comparer<T>): SortedReadonlyArray<T> {
    return (array.length === 0 ? array : array.slice().sort(comparer)) as SortedReadonlyArray<T>;
}

function selectIndex(_: unknown, i: number) {
    return i;
}

function indicesOf(array: readonly unknown[]): number[] {
    return array.map(selectIndex);
}

/**
 * Stable sort of an array. Elements equal to each other maintain their relative position in the array.
 */
export function stableSort<T>(array: readonly T[], comparer: Comparer<T>): SortedReadonlyArray<T> {
    const indices = indicesOf(array);
    stableSortIndices(array, indices, comparer);
    return indices.map((i) => array[i]) as SortedArray<T> as SortedReadonlyArray<T>;
}

function stableSortIndices<T>(array: readonly T[], indices: number[], comparer: Comparer<T>) {
    // sort indices by value then position
    indices.sort((x, y) => comparer(array[x], array[y]) || compareValues(x, y));
}

export function map<T, U>(array: readonly T[], f: (x: T, i: number) => U): U[];
export function map<T, U>(array: readonly T[] | undefined, f: (x: T, i: number) => U): U[] | undefined;
export function map<T, U>(array: readonly T[] | undefined, f: (x: T, i: number) => U): U[] | undefined {
    if (array) {
        return array.map(f);
    }
    return undefined;
}

export function some<T>(array: readonly T[] | undefined): array is readonly T[];
export function some<T>(array: readonly T[] | undefined, predicate: (value: T) => boolean): boolean;
export function some<T>(array: readonly T[] | undefined, predicate?: (value: T) => boolean): boolean {
    if (array) {
        if (predicate) {
            return array.some(predicate);
        } else {
            return array.length > 0;
        }
    }
    return false;
}

/**
 * Iterates through `array` by index and performs the callback on each element of array until the callback
 * returns a falsey value, then returns false.
 * If no such value is found, the callback is applied to each element of array and `true` is returned.
 */
export function every<T>(array: readonly T[], callback: (element: T, index: number) => boolean): boolean {
    if (array) {
        return array.every(callback);
    }

    return true;
}

/**
 * Performs a binary search, finding the index at which `value` occurs in `array`.
 * If no such index is found, returns the 2's-complement of first index at which
 * `array[index]` exceeds `value`.
 * @param array A sorted array whose first element must be no larger than number
 * @param value The value to be searched for in the array.
 * @param keySelector A callback used to select the search key from `value` and each element of
 * `array`.
 * @param keyComparer A callback used to compare two keys in a sorted array.
 * @param offset An offset into `array` at which to start the search.
 */
export function binarySearch<T, U>(
    array: readonly T[],
    value: T,
    keySelector: (v: T) => U,
    keyComparer: Comparer<U>,
    offset?: number
): number {
    return binarySearchKey(array, keySelector(value), keySelector, keyComparer, offset);
}

/**
 * Performs a binary search, finding the index at which an object with `key` occurs in `array`.
 * If no such index is found, returns the 2's-complement of first index at which
 * `array[index]` exceeds `key`.
 * @param array A sorted array whose first element must be no larger than number
 * @param key The key to be searched for in the array.
 * @param keySelector A callback used to select the search key from each element of `array`.
 * @param keyComparer A callback used to compare two keys in a sorted array.
 * @param offset An offset into `array` at which to start the search.
 */
export function binarySearchKey<T, U>(
    array: readonly T[],
    key: U,
    keySelector: (v: T) => U,
    keyComparer: Comparer<U>,
    offset?: number
): number {
    if (!some(array)) {
        return -1;
    }

    let low = offset || 0;
    let high = array.length - 1;
    while (low <= high) {
        const middle = low + ((high - low) >> 1);
        const midKey = keySelector(array[middle]);
        switch (keyComparer(midKey, key)) {
            case Comparison.LessThan:
                low = middle + 1;
                break;
            case Comparison.EqualTo:
                return middle;
            case Comparison.GreaterThan:
                high = middle - 1;
                break;
        }
    }

    return ~low;
}

/**
 * Flattens an array containing a mix of array or non-array elements.
 *
 * @param array The array to flatten.
 */
export function flatten<T>(array: (readonly NonNullable<T>[] | NonNullable<T>)[]): T[] {
    const result: T[] = [];
    for (const v of array) {
        if (v) {
            if (isArray(v)) {
                addRange(result, v);
            } else {
                result.push(v);
            }
        }
    }
    return result;
}

/**
 * Retrieves nested objects by parsing chained properties. ie. "a.b.c"
 * Returns undefined if not found
 * @param object The object to query
 * @param property The property to be searched for in the object ie. "a.b.c"
 */
export function getNestedProperty(object: any, property: string) {
    const value = property.split('.').reduce((obj, prop) => {
        return obj && obj[prop];
    }, object);
    return value;
}

export function getOrAdd<K, V>(map: MapLike<K, V>, key: K, newValueFactory: () => V): V {
    const value = map.get(key);
    if (value !== undefined) {
        return value;
    }

    const newValue = newValueFactory();
    map.set(key, newValue);

    return newValue;
}

/**
 * Remove matching item from the array in place.
 * Returns the given array itself.
 * @param array The array to operate on.
 * @param predicate Return true for an item to delete.
 */
export function removeArrayElements<T>(array: T[], predicate: (item: T) => boolean): T[] {
    for (let i = 0; i < array.length; i++) {
        if (predicate(array[i])) {
            array.splice(i, 1);

            // Array is modified in place, we need to look at the same index again.
            i--;
        }
    }

    return array;
}

export function createMapFromItems<T>(items: T[], keyGetter: (t: T) => string) {
    // Single O(n) pass. The previous implementation appended with
    // `(map.get(key) || []).concat(item)`, which rebuilt the whole bucket array
    // on every insertion and cost O(k^2) for a key that accumulated k items.
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = keyGetter(item);
        const existing = map.get(key);
        if (existing === undefined) {
            map.set(key, [item]);
        } else {
            existing.push(item);
        }
    }
    return map;
}

export function addIfUnique<T>(arr: T[], t: T, equalityComparer: EqualityComparer<T> = equateValues): T[] {
    if (contains(arr, t, equalityComparer)) {
        return arr;
    }

    arr.push(t);
    return arr;
}

export function getMapValues<K, V>(m: ReadonlyMap<K, V>, predicate: (k: K, v: V) => boolean): V[] {
    const values: V[] = [];
    m.forEach((v, k) => {
        if (predicate(k, v)) {
            values.push(v);
        }
    });

    return values;
}

export function addIfNotNull<T>(arr: T[], t: T): T[] {
    if (t === undefined) {
        return arr;
    }

    arr.push(t);
    return arr;
}

export function arrayEquals<T>(c1: T[], c2: T[], predicate: (e1: T, e2: T) => boolean) {
    if (c1.length !== c2.length) {
        return false;
    }

    return c1.every((v, i) => predicate(v, c2[i]));
}
