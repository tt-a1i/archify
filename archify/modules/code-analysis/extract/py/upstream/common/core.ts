/*
 * core.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various helpers that don't have a dependency on other code files.
 */

export const enum Comparison {
    LessThan = -1,
    EqualTo = 0,
    GreaterThan = 1,
}

/**
 * Safer version of `Function` which should not be called.
 * Every function should be assignable to this, but this should not be assignable to every function.
 */
export type AnyFunction = (...args: never[]) => void;

/** Do nothing and return false */
export function returnFalse(): false {
    return false;
}

/** Do nothing and return true */
export function returnTrue(): true {
    return true;
}

/** Do nothing and return undefined */
export function returnUndefined(): undefined {
    return undefined;
}

/** Returns its argument. */
export function identity<T>(x: T) {
    return x;
}

/** Returns lower case string */
export function toLowerCase(x: string) {
    return x.toLowerCase();
}

export function equateValues<T>(a: T, b: T) {
    return a === b;
}

export function compareComparableValues(a: string | undefined, b: string | undefined): Comparison;
export function compareComparableValues(a: number | undefined, b: number | undefined): Comparison;
export function compareComparableValues(a: string | number | undefined, b: string | number | undefined) {
    return a === b
        ? Comparison.EqualTo
        : a === undefined
        ? Comparison.LessThan
        : b === undefined
        ? Comparison.GreaterThan
        : a < b
        ? Comparison.LessThan
        : Comparison.GreaterThan;
}

/**
 * Compare two numeric values for their order relative to each other.
 * To compare strings, use any of the `compareStrings` functions.
 */
export function compareValues(a: number | undefined, b: number | undefined): Comparison {
    return compareComparableValues(a, b);
}

/**
 * Tests whether a value is an array.
 */
export function isArray<T extends any[] | readonly any[]>(value: any): value is T {
    return Array.isArray ? Array.isArray(value) : value instanceof Array;
}

/**
 * Tests whether a value is string
 */
export function isString(text: unknown): text is string {
    return typeof text === 'string';
}

export function isNumber(x: unknown): x is number {
    return typeof x === 'number';
}

export function isBoolean(x: unknown): x is boolean {
    return typeof x === 'boolean';
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Type of objects whose values are all of the same type.
 * The `in` and `for-in` operators can *not* be safely used,
 * since `Object.prototype` may be modified by outside code.
 */
export interface MapLike<K, V> {
    readonly [Symbol.toStringTag]: string;
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): this;
}

/**
 * Indicates whether a map-like contains an own property with the specified key.
 *
 * @param map A map-like.
 * @param key A property key.
 */
export function hasProperty(map: { [index: string]: any }, key: string): boolean {
    return hasOwnProperty.call(map, key);
}

/**
 * Convert the given value to boolean
 * @param trueOrFalse string value 'true' or 'false'
 */
export function toBoolean(trueOrFalse: string): boolean {
    const normalized = trueOrFalse?.trim().toUpperCase();
    if (normalized === 'TRUE') {
        return true;
    }

    return false;
}

let _debugMode: boolean | undefined = undefined;
export function test_setDebugMode(debugMode: boolean | undefined) {
    const oldValue = _debugMode;
    _debugMode = debugMode;
    return oldValue;
}

export function isDebugMode() {
    if (_debugMode === undefined) {
        // Cache debugging mode since it can't be changed while process is running.
        const argv = process.execArgv.join();
        _debugMode = argv.includes('inspect') || argv.includes('debug');
    }

    return _debugMode;
}

interface Thenable<T> {
    then<TResult>(
        onfulfilled?: (value: T) => TResult | Thenable<TResult>,
        onrejected?: (reason: any) => TResult | Thenable<TResult>
    ): Thenable<TResult>;
    then<TResult>(
        onfulfilled?: (value: T) => TResult | Thenable<TResult>,
        onrejected?: (reason: any) => void
    ): Thenable<TResult>;
}

export function isThenable<T>(v: any): v is Thenable<T> {
    return typeof v?.then === 'function';
}

export function isDefined<T>(element: T | undefined): element is T {
    return element !== undefined;
}

export function getEnumNames<T>(enumType: T) {
    const result: string[] = [];
    for (const value in enumType) {
        if (isNaN(Number(value))) {
            result.push(value);
        }
    }

    return result;
}

export function containsOnlyWhitespace(text: string, start?: number, end?: number) {
    if (start !== undefined) {
        text = text.substring(start, end);
    }

    return /^\s*$/.test(text);
}

export function cloneStr(str: string): string {
    // Ensure we get a copy of the string that is not shared with the original string.
    // Node.js has an internal optimization where it uses sliced strings for `substring`, `slice`, `substr`
    // when it deems appropriate. Most of the time, this optimization is beneficial, but in this case, we want
    // to ensure we get a copy of the string to prevent the original string from being retained in memory.
    // For example, the import resolution cache in importResolver might hold onto the full original file content
    // because seemingly innocent the import name  (e.g., `foo` in `import foo`) is in the cache.

    // V8 uses a SlicedString representation for substrings only above a small length threshold (currently 13),
    // so short strings can be returned as-is without retaining the original text in memory.
    // https://github.com/v8/v8/blob/02558d5a88c8f06ff064e3b6b332f342e1ab6143/src/objects/string.h#L1054
    if (str.length < 13) {
        return str;
    }

    return Buffer.from(str, 'utf8').toString('utf8');
}

export namespace Disposable {
    export function is(value: any): value is { dispose(): void } {
        return value && typeof value.dispose === 'function';
    }
}

export function isMap(obj: unknown): obj is Map<unknown, unknown> {
    return typeof obj === 'object' && obj !== null && obj.constructor === Map;
}

export function isPromise(obj: unknown): obj is Promise<unknown> {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof (obj as any).then === 'function' &&
        typeof (obj as any).catch === 'function'
    );
}
