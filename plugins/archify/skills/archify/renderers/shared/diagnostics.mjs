import fs from 'node:fs';
import path from 'node:path';

const DIAGNOSTIC_MODE = process.env.ARCHIFY_DIAGNOSTIC_FORMAT === 'json';
const recorded = [];
const recordedMessages = new Set();
const boundaryKey = Symbol.for('archify.renderer-diagnostic-boundary');

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
  };
}

export function recordDiagnostic(diagnostic) {
  if (!DIAGNOSTIC_MODE) return;
  const normalized = normalizedDiagnostic(diagnostic);
  if (recordedMessages.has(normalized.message)) return;
  recordedMessages.add(normalized.message);
  recorded.push(normalized);
}

export function throwDiagnosticError(message, diagnostics) {
  for (const diagnostic of diagnostics || []) recordDiagnostic(diagnostic);
  const error = new Error(message);
  error.archifyDiagnostics = (diagnostics || []).map(normalizedDiagnostic);
  throw error;
}

export function throwDiagnosticProblems(prefix, problems, { code = 'layout/constraint', subject = {} } = {}) {
  const messages = (problems || []).map((problem) => String(problem));
  for (const message of messages) {
    recordDiagnostic({
      code,
      severity: 'error',
      message,
      subject,
      evidence: {},
      supportedFixes: [],
    });
  }
  throw new Error(`${prefix}:\n- ${messages.join('\n- ')}`);
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
