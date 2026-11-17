/*
 * timing.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A simple duration class that can be used to record and report
 * durations at the millisecond level of resolution.
 */

import { ConsoleInterface } from './console.js';

export class Duration {
    private _startTime: number;

    constructor() {
        this._startTime = Date.now();
    }

    getDurationInMilliseconds() {
        const curTime = Date.now();
        return curTime - this._startTime;
    }

    getDurationInSeconds() {
        return this.getDurationInMilliseconds() / 1000;
    }
}

export class TimingStat {
    totalTime = 0;
    callCount = 0;
    isTiming = false;

    timeOperation<T extends (...args: any[]) => any>(callback: T, ...args: any[]): ReturnType<T> {
        this.callCount++;

        // Handle reentrancy.
        if (this.isTiming) {
            return callback(...args);
        } else {
            this.isTiming = true;
            const duration = new Duration();
            const result = callback(...args);
            this.totalTime += duration.getDurationInMilliseconds();
            this.isTiming = false;

            return result;
        }
    }

    subtractFromTime(callback: () => void) {
        if (this.isTiming) {
            this.isTiming = false;
            const duration = new Duration();
            callback();
            this.totalTime -= duration.getDurationInMilliseconds();
            this.isTiming = true;
        } else {
            callback();
        }
    }

    printTime(): string {
        const totalTimeInSec = this.totalTime / 1000;
        const roundedTime = Math.round(totalTimeInSec * 100) / 100;
        return roundedTime.toString() + 'sec';
    }
}

export class TimingStats {
    totalDuration = new Duration();
    findFilesTime = new TimingStat();
    readFileTime = new TimingStat();
    tokenizeFileTime = new TimingStat();
    parseFileTime = new TimingStat();
    resolveImportsTime = new TimingStat();
    cycleDetectionTime = new TimingStat();
    bindTime = new TimingStat();
    typeCheckerTime = new TimingStat();
    typeEvaluationTime = new TimingStat();

    printSummary(console: ConsoleInterface) {
        console.info(`Completed in ${this.totalDuration.getDurationInSeconds()}sec`);
    }

    printDetails(console: ConsoleInterface) {
        console.info('');
        console.info('Timing stats');
        console.info('Find Source Files:    ' + this.findFilesTime.printTime());
        console.info('Read Source Files:    ' + this.readFileTime.printTime());
        console.info('Tokenize:             ' + this.tokenizeFileTime.printTime());
        console.info('Parse:                ' + this.parseFileTime.printTime());
        console.info('Resolve Imports:      ' + this.resolveImportsTime.printTime());
        console.info('Bind:                 ' + this.bindTime.printTime());
        console.info('Check:                ' + this.typeCheckerTime.printTime());
        console.info('Detect Cycles:        ' + this.cycleDetectionTime.printTime());
    }

    getTotalDuration() {
        return this.totalDuration.getDurationInSeconds();
    }
}

export const timingStats = new TimingStats();
