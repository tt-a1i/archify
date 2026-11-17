/*
 * debug.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions that display user friendly debugging info.
 */

import { stableSort } from './collectionUtils.js';
import { AnyFunction, compareValues, hasProperty, isString } from './core.js';

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

export function assertDefined<T>(
    value: T,
    message?: string,
    stackCrawlMark?: AnyFunction
): asserts value is NonNullable<T> {
    if (value === undefined || value === null) {
        fail(message, stackCrawlMark || assertDefined);
    }
}

export function assertEachDefined<T>(
    value: T[],
    message?: string,
    stackCrawlMark?: AnyFunction
): asserts value is NonNullable<T>[] {
    for (const v of value) {
        assertDefined(v, message, stackCrawlMark || assertEachDefined);
    }
}

export function assertNever(member: never, message = 'Illegal value:', stackCrawlMark?: AnyFunction): never {
    let detail = '';

    try {
        detail = JSON.stringify(member);
    } catch {
        // Do nothing.
    }

    fail(`${message} ${detail}`, stackCrawlMark || assertNever);
}

export function getFunctionName(func: AnyFunction) {
    if (typeof func !== 'function') {
        return '';
    } else if (hasProperty(func, 'name')) {
        return (func as any).name;
    } else {
        const text = Function.prototype.toString.call(func);
        const match = /^function\s+([\w$]+)\s*\(/.exec(text);
        return match ? match[1] : '';
    }
}

/**
 * Formats an enum value as a string for debugging and debug assertions.
 */
export function formatEnum(value = 0, enumObject: any, isFlags?: boolean) {
    const members = getEnumMembers(enumObject);
    if (value === 0) {
        return members.length > 0 && members[0][0] === 0 ? members[0][1] : '0';
    }
    if (isFlags) {
        let result = '';
        let remainingFlags = value;
        for (const [enumValue, enumName] of members) {
            if (enumValue > value) {
                break;
            }
            if (enumValue !== 0 && enumValue & value) {
                result = `${result}${result ? '|' : ''}${enumName}`;
                remainingFlags &= ~enumValue;
            }
        }
        if (remainingFlags === 0) {
            return result;
        }
    } else {
        for (const [enumValue, enumName] of members) {
            if (enumValue === value) {
                return enumName;
            }
        }
    }
    return value.toString();
}

export function getErrorString(error: any): string {
    return (
        (error.stack ? error.stack.toString() : undefined) ||
        (typeof error.message === 'string' ? error.message : undefined) ||
        JSON.stringify(error)
    );
}

export function getSerializableError(error: any): Error | undefined {
    if (!error) {
        return undefined;
    }

    const exception = JSON.stringify(error);
    if (exception.length > 2) {
        // Given error object is JSON.stringify serializable. Use it as it is
        // to preserve properties.
        return error;
    }

    // Convert error to JSON.stringify serializable Error shape.
    const name = error.name ? (isString(error.name) ? error.name : 'noname') : 'noname';
    const message = error.message ? (isString(error.message) ? error.message : 'nomessage') : 'nomessage';
    const stack = error.stack ? (isString(error.stack) ? error.stack : undefined) : undefined;
    return { name, message, stack };
}

function getEnumMembers(enumObject: any) {
    const result: [number, string][] = [];
    for (const name of Object.keys(enumObject)) {
        const value = enumObject[name];
        if (typeof value === 'number') {
            result.push([value, name]);
        }
    }

    return stableSort<[number, string]>(result, (x, y) => compareValues(x[0], y[0]));
}
