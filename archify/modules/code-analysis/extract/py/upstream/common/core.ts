/*
 * core.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various helpers that don't have a dependency on other code files.
 */

/**
 * Safer version of `Function` which should not be called.
 * Every function should be assignable to this, but this should not be assignable to every function.
 */
export type AnyFunction = (...args: never[]) => void;

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
