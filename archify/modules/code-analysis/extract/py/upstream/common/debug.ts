/*
 * debug.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions that display user friendly debugging info.
 */

import { AnyFunction } from './core.js';

export function assert(
    expression: any,
    message?: string,
    verboseDebugInfo?: string | (() => string),
    stackCrawlMark?: AnyFunction
): asserts expression {
    if (!expression) {
        if (verboseDebugInfo) {
            message +=
                '\r\nVerbose Debug Information: ' +
                (typeof verboseDebugInfo === 'string' ? verboseDebugInfo : verboseDebugInfo());
        }
        fail(message ? 'False expression: ' + message : 'False expression.', stackCrawlMark || assert);
    }
}

export function fail(message?: string, stackCrawlMark?: AnyFunction): never {
    // debugger;
    const e = new Error(message ? `Debug Failure. ${message}` : 'Debug Failure.');
    if (Error.captureStackTrace) {
        Error.captureStackTrace(e, stackCrawlMark || fail);
    }
    throw e;
}
