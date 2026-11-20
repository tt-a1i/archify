/*
 * pythonLanguageVersion.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Types and functions that relate to the Python language version.
 */

export type PythonReleaseLevel = 'alpha' | 'beta' | 'candidate' | 'final';

export interface PythonVersion {
    major: number;
    minor: number;
    micro?: number;
    releaseLevel?: PythonReleaseLevel;
    serial?: number;
}

export namespace PythonVersion {
    export function is(value: any): value is PythonVersion {
        if (value && typeof value.major === 'number' && typeof value.minor === 'number') {
            if (value.micro !== undefined && typeof value.micro !== 'number') {
                return false;
            }
            if (value.releaseLevel !== undefined && typeof value.releaseLevel !== 'string') {
                return false;
            }
            if (value.serial !== undefined && typeof value.serial !== 'number') {
                return false;
            }
            return true;
        }

        return false;
    }
    export function create(
        major: number,
        minor: number,
        micro?: number,
        releaseLevel?: PythonReleaseLevel,
        serial?: number
    ): PythonVersion {
        return {
            major,
            minor,
            micro,
            releaseLevel,
            serial,
        };
    }

    export function isEqualTo(version: PythonVersion, other: PythonVersion) {
        if (version.major !== other.major || version.minor !== other.minor) {
            return false;
        }

        if (version.micro === undefined || other.micro === undefined) {
            return true;
        } else if (version.micro !== other.micro) {
            return false;
        }

        if (version.releaseLevel === undefined || other.releaseLevel === undefined) {
            return true;
        } else if (version.releaseLevel !== other.releaseLevel) {
            return false;
        }

        if (version.serial === undefined || other.serial === undefined) {
            return true;
        } else if (version.serial !== other.serial) {
            return false;
        }

        return true;
    }

    export function isGreaterThan(version: PythonVersion, other: PythonVersion) {
        if (version.major > other.major) {
            return true;
        } else if (version.major < other.major) {
            return false;
        }

        if (version.minor > other.minor) {
            return true;
        } else if (version.minor < other.minor) {
            return false;
        }

        if (version.micro === undefined || other.micro === undefined || version.micro < other.micro) {
            return false;
        } else if (version.micro > other.micro) {
            return true;
        }

        // We leverage the fact that the alphabetical ordering
        // of the release level designators are ordered by increasing
        // release level.
        if (
            version.releaseLevel === undefined ||
            other.releaseLevel === undefined ||
            version.releaseLevel < other.releaseLevel
        ) {
            return false;
        } else if (version.releaseLevel > other.releaseLevel) {
            return true;
        }

        if (version.serial === undefined || other.serial === undefined || version.serial < other.serial) {
            return false;
        } else if (version.serial > other.serial) {
            return true;
        }

        // They are exactly equal!
        return false;
    }

    export function isGreaterOrEqualTo(version: PythonVersion, other: PythonVersion) {
        return isEqualTo(version, other) || isGreaterThan(version, other);
    }

    export function isLessThan(version: PythonVersion, other: PythonVersion) {
        return !isGreaterOrEqualTo(version, other);
    }

    export function isLessOrEqualTo(version: PythonVersion, other: PythonVersion) {
        return !isGreaterThan(version, other);
    }

    export function toMajorMinorString(version: PythonVersion): string {
        return `${version.major}.${version.minor}`;
    }

    export function toString(version: PythonVersion): string {
        let versString = toMajorMinorString(version);

        if (version.micro === undefined) {
            return versString;
        }

        versString += `.${version.micro}`;

        if (version.releaseLevel === undefined) {
            return versString;
        }

        versString += `.${version.releaseLevel}`;

        if (version.serial === undefined) {
            return versString;
        }

        versString += `.${version.serial}`;
        return versString;
    }

    export function fromString(val: string): PythonVersion | undefined {
        const split = val.split('.');

        if (split.length < 2) {
            return undefined;
        }

        const major = parseInt(split[0], 10);
        const minor = parseInt(split[1], 10);

        if (isNaN(major) || isNaN(minor)) {
            return undefined;
        }

        let micro: number | undefined;
        if (split.length >= 3) {
            micro = parseInt(split[2], 10);
            if (isNaN(micro)) {
                micro = undefined;
            }
        }

        let releaseLevel: PythonReleaseLevel | undefined;
        if (split.length >= 4) {
            const releaseLevels: PythonReleaseLevel[] = ['alpha', 'beta', 'candidate', 'final'];
            if (releaseLevels.some((level) => level === split[3])) {
                releaseLevel = split[3] as PythonReleaseLevel;
            }
        }

        let serial: number | undefined;
        if (split.length >= 5) {
            serial = parseInt(split[4], 10);
            if (isNaN(serial)) {
                serial = undefined;
            }
        }

        return create(major, minor, micro, releaseLevel, serial);
    }
}

// Predefine some versions.
export const pythonVersion3_0 = PythonVersion.create(3, 0);
export const pythonVersion3_1 = PythonVersion.create(3, 1);
export const pythonVersion3_2 = PythonVersion.create(3, 2);
export const pythonVersion3_3 = PythonVersion.create(3, 3);
export const pythonVersion3_4 = PythonVersion.create(3, 4);
export const pythonVersion3_5 = PythonVersion.create(3, 5);
export const pythonVersion3_6 = PythonVersion.create(3, 6);
export const pythonVersion3_7 = PythonVersion.create(3, 7);
export const pythonVersion3_8 = PythonVersion.create(3, 8);
export const pythonVersion3_9 = PythonVersion.create(3, 9);
export const pythonVersion3_10 = PythonVersion.create(3, 10);
export const pythonVersion3_11 = PythonVersion.create(3, 11);
export const pythonVersion3_12 = PythonVersion.create(3, 12);
export const pythonVersion3_13 = PythonVersion.create(3, 13);
export const pythonVersion3_14 = PythonVersion.create(3, 14);
export const pythonVersion3_15 = PythonVersion.create(3, 15);

export const latestStablePythonVersion = pythonVersion3_14;
