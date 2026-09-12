// Mirrors archify/renderers/shared/diagnostics.mjs: every failure is one
// structured diagnostic (code / severity / subject / evidence / supportedFixes)
// so the CLI never has to print a Node stack.
export class DiagnosticError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = 'DiagnosticError';
    this.diagnostics = diagnostics;
  }
}

export function fail(code, message, { subject = {}, evidence = {}, supportedFixes = [] } = {}) {
  throw new DiagnosticError(message, [{ code, severity: 'error', message, subject, evidence, supportedFixes }]);
}

export function receipt(status, extra = {}) {
  return { schemaVersion: 1, status, ...extra };
}
