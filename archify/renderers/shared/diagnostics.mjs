import fs from 'node:fs';
import path from 'node:path';

const DIAGNOSTIC_MODE = process.env.ARCHIFY_DIAGNOSTIC_FORMAT === 'json';
const recorded = [];
const recordedMessages = new Set();
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

export function recordDiagnostic(diagnostic) {
  if (!DIAGNOSTIC_MODE || recordingSuppressionDepth > 0) return;
  const normalized = normalizedDiagnostic(diagnostic);
  if (recordedMessages.has(normalized.message)) return;
  recordedMessages.add(normalized.message);
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

export function throwDiagnosticProblems(prefix, problems, { code = 'layout/constraint', subject = {} } = {}) {
  const messages = (problems || []).map((problem) => String(problem));
  const diagnostics = messages.map((message) => normalizedDiagnostic({
      code,
      severity: 'error',
      message,
      subject,
      evidence: {},
      supportedFixes: [],
    }));
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

const readerSignal = new Int32Array(new SharedArrayBuffer(4));

function waitForReader() {
  // Sleep instead of spinning on EAGAIN. A retry budget looks like a safeguard
  // and behaves like a truncation gate: a spinning loop burns thousands of
  // attempts in a few milliseconds, so a reader that is merely slow to start
  // exhausts it and loses the tail of the receipt. Waiting costs nothing while
  // the reader catches up, and a reader that goes away raises EPIPE, which the
  // caller already treats as a real write failure.
  Atomics.wait(readerSignal, 0, 0, 1);
}

export function installRendererDiagnosticBoundary() {
  if (!DIAGNOSTIC_MODE || globalThis[boundaryKey]) return;
  globalThis[boundaryKey] = true;
  process.on('uncaughtException', (error) => {
    const payload = `${JSON.stringify(rendererFailure(error))}\n`;
    try {
      // stderr may be a pipe. fs.writeSync performs a PARTIAL write once the
      // payload exceeds the OS pipe buffer (8KB on macOS) and returns the byte
      // count actually written. Ignoring that return value silently truncated
      // large diagnostic payloads mid-JSON, so the parent CLI's JSON.parse
      // failed and the fail-closed boundary reported internal/unclassified
      // instead of the diagnostics we had already computed. Loop until drained.
      // A full pipe also makes writeSync throw EAGAIN; wait for the reader
      // rather than treat it as a stream failure, otherwise the tail is
      // dropped just the same.
      const buffer = Buffer.from(payload, 'utf8');
      let written = 0;
      while (written < buffer.length) {
        try {
          written += fs.writeSync(process.stderr.fd, buffer, written, buffer.length - written);
        } catch (writeError) {
          if (writeError?.code === 'EAGAIN') {
            waitForReader();
            continue;
          }
          throw writeError;
        }
      }
    } catch {
      // The renderer is already failing. Avoid replacing its real error with a
      // secondary stream failure; the parent CLI still has the exit status.
    }
    process.exit(1);
  });
}
