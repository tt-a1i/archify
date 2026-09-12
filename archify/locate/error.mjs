export class LocateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocateError';
    this.code = code;
    this.details = details;
    this.severity = details.severity || 'error';
    this.subject = details.subject || {};
    this.evidence = details.evidence || {};
    this.supportedFixes = details.supportedFixes || [];
  }
}

export function locateFail(code, message, details = {}) {
  throw new LocateError(code, message, details);
}

export function locateDiagnostic(error) {
  return {
    code: error.code || 'locate/internal',
    severity: error.severity || 'error',
    message: error.message,
    subject: error.subject || {},
    evidence: error.evidence || error.details?.evidence || {},
    supportedFixes: error.supportedFixes || error.details?.supportedFixes || [],
  };
}
