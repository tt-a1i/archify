import fs from 'node:fs';
import path from 'node:path';

const DIAGNOSTIC_MODE = process.env.ARCHIFY_DIAGNOSTIC_FORMAT === 'json';
const recorded = [];
const recordedDiagnosticKeys = new Set();
const recordedDiagnosticIndexesByMessage = new Map();
const knownDiagnosticsByMessage = new Map();
const boundaryKey = Symbol.for('archify.renderer-diagnostic-boundary');
let recordingSuppressionDepth = 0;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizedDiagnostic(diagnostic) {
  const message = String(diagnostic?.message || 'Archify could not classify this failure.').trim();
  return {
    code: String(diagnostic?.code || 'internal/unclassified'),
    severity: diagnostic?.severity === 'warning' ? 'warning' : 'error',
    message,
    subject: plainObject(diagnostic?.subject),
    evidence: plainObject(diagnostic?.evidence),
    supportedFixes: Array.isArray(diagnostic?.supportedFixes)
      ? [...new Set(diagnostic.supportedFixes.map((fix) => String(fix).trim()).filter(Boolean))]
      : [],
    ...(Array.isArray(diagnostic?.suppresses) ? {
      suppresses: [...new Set(diagnostic.suppresses.map((code) => String(code).trim()).filter(Boolean))],
    } : {}),
  };
}

/**
 * Build one normalized, machine-actionable layout issue.
 *
 * Layout validators historically accumulated strings. New validators can use
 * this shape without forcing every existing rule to migrate at once.
 */
export function layoutIssue(issue, defaults = {}) {
  const source = typeof issue === 'string' ? { message: issue } : plainObject(issue);
  return normalizedDiagnostic({
    ...defaults,
    ...source,
    subject: {
      ...plainObject(defaults.subject),
      ...plainObject(source.subject),
    },
    evidence: {
      ...plainObject(defaults.evidence),
      ...plainObject(source.evidence),
    },
    supportedFixes: source.supportedFixes ?? defaults.supportedFixes,
  });
}

export function recordDiagnostic(diagnostic) {
  if (recordingSuppressionDepth > 0) return;
  const normalized = normalizedDiagnostic(diagnostic);
  const messageKey = `${normalized.severity}\u0000${normalized.message}`;
  const priorKnown = knownDiagnosticsByMessage.get(messageKey);
  const specificity = (entry) => (
    (entry.code === 'layout/constraint' || entry.code === 'internal/unclassified' ? 0 : 100)
    + Object.keys(entry.subject).length * 4
    + Object.keys(entry.evidence).length * 2
    + entry.supportedFixes.length
  );
  if (!priorKnown || specificity(normalized) > specificity(priorKnown)) {
    knownDiagnosticsByMessage.set(messageKey, normalized);
  }
  if (!DIAGNOSTIC_MODE) return;
  const key = JSON.stringify(normalized);
  if (recordedDiagnosticKeys.has(key)) return;
  const priorIndex = recordedDiagnosticIndexesByMessage.get(messageKey);
  if (priorIndex !== undefined) {
    const prior = recorded[priorIndex];
    if (specificity(normalized) > specificity(prior)) {
      recorded[priorIndex] = normalized;
      recordedDiagnosticKeys.add(key);
    }
    return;
  }
  recordedDiagnosticKeys.add(key);
  recordedDiagnosticIndexesByMessage.set(messageKey, recorded.length);
  recorded.push(normalized);
}

export function withDiagnosticRecordingSuppressed(callback) {
  recordingSuppressionDepth += 1;
  try {
    return callback();
  } finally {
    recordingSuppressionDepth -= 1;
  }
}

export function throwDiagnosticError(message, diagnostics) {
  for (const diagnostic of diagnostics || []) recordDiagnostic(diagnostic);
  const error = new Error(message);
  error.archifyDiagnostics = (diagnostics || []).map(normalizedDiagnostic);
  throw error;
}

export function throwDiagnosticProblems(prefix, problems, {
  code = 'layout/constraint',
  severity = 'error',
  subject = {},
  evidence = {},
  supportedFixes = [],
} = {}) {
  const diagnostics = (problems || []).map((problem) => {
    const known = typeof problem === 'string'
      ? knownDiagnosticsByMessage.get(`${severity}\u0000${problem.trim()}`)
      : null;
    return layoutIssue(known || problem, {
      code,
      severity,
      subject,
      evidence,
      supportedFixes,
    });
  });
  const messages = diagnostics.map((diagnostic) => diagnostic.message);
  throwDiagnosticError(`${prefix}:\n- ${messages.join('\n- ')}`, diagnostics);
}

function fallbackDiagnostic(error) {
  const input = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  if (error instanceof SyntaxError) {
    return normalizedDiagnostic({
      code: 'input/json-parse',
      severity: 'error',
      message: `Input JSON could not be parsed: ${error.message}`,
      subject: { input },
      evidence: { reason: error.message },
      supportedFixes: ['repair the JSON syntax and run validation again'],
    });
  }
  if (error?.code === 'ENOENT' || error?.code === 'EACCES' || error?.code === 'EISDIR') {
    return normalizedDiagnostic({
      code: 'input/read',
      severity: 'error',
      message: `Input could not be read: ${error.message}`,
      subject: { input },
      evidence: { systemCode: error.code, reason: error.message },
      supportedFixes: ['provide one readable JSON input file'],
    });
  }
  return normalizedDiagnostic({
    code: 'internal/unclassified',
    severity: 'error',
    message: error?.message || 'Renderer failed without a diagnostic.',
    subject: { input },
    evidence: { errorName: error?.name || 'Error' },
    supportedFixes: [],
  });
}
function rendererFailure(error) {
  const attached = Array.isArray(error?.archifyDiagnostics)
    ? error.archifyDiagnostics.map(normalizedDiagnostic)
    : [];
  const diagnostics = recorded.length ? recorded : (attached.length ? attached : [fallbackDiagnostic(error)]);
  return {
    schemaVersion: 1,
    ok: false,
    source: 'renderer',
    error: error?.message || 'Renderer failed without a diagnostic.',
    diagnostics,
  };
}

export function installRendererDiagnosticBoundary() {
  if (!DIAGNOSTIC_MODE || globalThis[boundaryKey]) return;
  globalThis[boundaryKey] = true;
  process.on('uncaughtException', (error) => {
    const payload = `${JSON.stringify(rendererFailure(error))}\n`;
    try {
      fs.writeSync(process.stderr.fd, payload);
    } catch {
      // The renderer is already failing. Avoid replacing its real error with a
      // secondary stream failure; the parent CLI still has the exit status.
    }
    process.exit(1);
  });
}
