export class PrPackError extends Error {
  constructor(message, { code, stage, diagnostics = [] } = {}) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.diagnostics = diagnostics.length ? diagnostics : [packDiagnostic({ code, message })];
  }
}

export function packDiagnostic({ code, message, subject = {}, evidence = {}, supportedFixes = [], severity = 'error' }) {
  return { code, severity, message, subject: { surface: 'pr-pack', ...subject }, evidence, supportedFixes };
}

export function failPrPack(code, stage, message, options = {}) {
  throw new PrPackError(message, { code, stage, diagnostics: [packDiagnostic({ code, message, ...options })] });
}

// Keep the pointer structural when an authored key itself triggered the error.
export function reviewTextFailure(stage, pointer = '/') {
  const error = new PrPackError('Review text contains a prohibited verdict.', {
    code: 'pr-pack/risk-verdict',
    stage,
    diagnostics: [packDiagnostic({
      code: 'pr-pack/risk-verdict',
      message: 'Review text contains a prohibited verdict.',
      subject: { path: pointer },
      supportedFixes: ['use objective text and evidence'],
    })],
  });
  error.reviewTextBoundary = true;
  return error;
}
