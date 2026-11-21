/* Derived from microsoft/pyright 1.1.414, MIT, Copyright Microsoft Corporation.
 * Parser-only diagnostic values; editor actions, URIs and serialization removed.
 */
import { Range } from './textRange.js';
export const enum DiagnosticCategory { Error }
export class Diagnostic {
    constructor(readonly category: DiagnosticCategory, readonly message: string, readonly range: Range) {}
}
