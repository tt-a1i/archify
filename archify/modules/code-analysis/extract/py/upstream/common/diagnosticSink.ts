/* Derived from microsoft/pyright, MIT, Copyright Microsoft Corporation.
 * Parser diagnostics only. No editor actions, URI or file-system services.
 */
import { Diagnostic, DiagnosticCategory } from './diagnostic.js';
import { Range } from './textRange.js';

export class DiagnosticSink {
    private diagnostics: Diagnostic[] = [];
    private keys = new Set<string>();
    fetchAndClear() {
        const result = this.diagnostics;
        this.diagnostics = [];
        this.keys.clear();
        return result;
    }
    addDiagnostic(diagnostic: Diagnostic) {
        const { start, end } = diagnostic.range;
        const key = `${start.line}:${start.character}:${end.line}:${end.character}:${diagnostic.message}`;
        if (!this.keys.has(key)) {
            this.keys.add(key);
            this.diagnostics.push(diagnostic);
        }
        return diagnostic;
    }
    addError(message: string, range: Range) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Error, message, range));
    }
    addWarning(message: string, range: Range) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Warning, message, range));
    }
    addInformation(message: string, range: Range) {
        return this.addDiagnostic(new Diagnostic(DiagnosticCategory.Information, message, range));
    }
}
