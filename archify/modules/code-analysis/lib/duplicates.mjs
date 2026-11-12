// Optional jscpd backend. Scan the captured sources, never a second reading of
// the working tree. The temporary tree contains only this run's selected files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fail } from '../core/index.mjs';

export const JSCPD_VERSION = '5.4.3';
export const DUPLICATE_RULE = 'redundancy/duplicate-block';
const LIMIT = 32 * 1024 * 1024;
const EXTENSIONS = {
  py: new Set(['.py']),
  ts: new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx']),
  java: new Set(['.java']),
  go: new Set(['.go']),
  rust: new Set(['.rs']),
};
const VENDORED = /(^|\/)(vendor|vendored|third_party|third-party)\//;
const DEFAULTS = { executable: 'jscpd', minTokens: 50, minLines: 5, identifiers: 'exact', timeoutMs: 30000, maxFileBytes: 1000000 };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = text => createHash('sha256').update(text).digest('hex');

// jscpd on Windows may use extended-length prefixes and either separator.
// Compare equivalent spellings without widening the captured inventory.
const inputKey = name => process.platform === 'win32'
  ? path.toNamespacedPath(path.normalize(name)).toLowerCase()
  : path.normalize(name);

export function duplicateOptions(config = {}) {
  const raw = config.duplicates;
  if (raw === undefined) return null;
  const invalid = (field, message) => fail('duplicates/config-invalid', `duplicates.${field} ${message}`, {
    subject: { setting: `duplicates.${field}` }, supportedFixes: ['correct the duplicate detection configuration'],
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('enabled', 'must be configured in an object.');
  if (typeof raw.enabled !== 'boolean') invalid('enabled', 'must be true or false.');
  if (!raw.enabled) return null;
  for (const key of Object.keys(raw)) if (key !== 'enabled' && !(key in DEFAULTS)) invalid(key, 'is not a supported setting.');
  const options = { ...DEFAULTS, ...raw };
  for (const [key, max] of [['minTokens', 1000000], ['minLines', 1000000], ['timeoutMs', 300000], ['maxFileBytes', 100000000]]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > max) invalid(key, `must be a whole number from 1 to ${max}.`);
  }
  if (!['exact', 'consistent'].includes(options.identifiers)) invalid('identifiers', 'must be "exact" or "consistent".');
  if (typeof options.executable !== 'string' || !options.executable.trim() || options.executable.includes('\0')) invalid('executable', 'must name the jscpd executable.');
  // A scan changes cwd to its private snapshot. Resolve an explicitly relative
  // executable once in the caller's cwd; a bare command still uses PATH.
  if (!path.isAbsolute(options.executable) && /[\\/]/.test(options.executable)) options.executable = path.resolve(options.executable);
  return options;
}

function runTool(options, args, cwd) {
  const result = spawnSync(options.executable, args, {
    cwd, encoding: 'utf8', timeout: options.timeoutMs, killSignal: 'SIGKILL',
    maxBuffer: LIMIT, windowsHide: true, shell: false, detached: process.platform !== 'win32',
    env: { ...process.env, CI: '1', JSCPD_NO_TIPS: '1' },
  });
  // npm's POSIX launcher spawns the native binary rather than replacing itself.
  // A timeout must stop that process group before the snapshot is removed.
  if (process.platform !== 'win32' && result.pid && (result.error || result.status !== 0)) {
    try { process.kill(-result.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (result.error?.code === 'ENOENT') fail('duplicates/tool-unavailable', 'jscpd is enabled but its executable was not found.', {
    subject: { executable: options.executable }, supportedFixes: [`install jscpd ${JSCPD_VERSION} separately and set duplicates.executable`, 'set duplicates.enabled to false to leave C6 unchecked'],
  });
  if (result.error || result.status !== 0) fail('duplicates/tool-failed', 'jscpd did not complete; duplicate detection has no successful result.', {
    subject: { executable: options.executable },
    evidence: { exitCode: result.status, signal: result.signal, reason: result.error?.code || null, stderr: (result.stderr || '').slice(0, 2000) },
    supportedFixes: ['check the executable and its diagnostic output', 'increase duplicates.timeoutMs if the scan timed out'],
  });
  return result.stdout.trim();
}

function invalidReport(message) {
  fail('duplicates/report-invalid', `Invalid jscpd report: ${message}`, {
    supportedFixes: [`use jscpd ${JSCPD_VERSION} and re-run the analysis; report a reproducible output mismatch`],
  });
}

function point(buffer, source, native) {
  if (!native || !Number.isSafeInteger(native.position) || native.position < 0 || native.position > buffer.length
    || !Number.isSafeInteger(native.line) || native.line < 1 || !Number.isSafeInteger(native.column) || native.column < 0) invalidReport('invalid source coordinate.');
  // JSON offsets and columns count UTF-8 bytes, including CRLF bytes.
  const prefix = buffer.subarray(0, native.position).toString('utf8');
  if (!Buffer.from(prefix, 'utf8').equals(buffer.subarray(0, native.position)) || source.slice(0, prefix.length) !== prefix) invalidReport('coordinate splits a UTF-8 character.');
  const lineStart = native.position === 0 ? 0 : buffer.lastIndexOf(10, native.position - 1) + 1;
  const line = prefix.split('\n').length;
  if (line !== native.line || native.position - lineStart !== native.column) invalidReport('line, column and byte offset disagree.');
  return { offset: prefix.length, line, column: prefix.length - prefix.lastIndexOf('\n') };
}

export function analyzeDuplicates(graph, config, facts) {
  const options = duplicateOptions(config);
  if (!options) return null;
  if (!facts || !Array.isArray(facts.files)) fail('duplicates/source-unavailable', 'Duplicate detection requires captured source facts.', { supportedFixes: ['extract the repository before evaluating duplicates'] });
  if (!EXTENSIONS[facts.repository?.language]) fail('duplicates/config-invalid', 'Duplicate detection supports JS/TS, Python, Java, Go and Rust analysis.', {
    subject: { language: facts.repository?.language }, supportedFixes: ['select ts, py, java, go or rust, or disable duplicate detection for this language'],
  });
  const version = runTool(options, ['--version']);
  if (version !== `jscpd ${JSCPD_VERSION}`) fail('duplicates/tool-version', `Expected jscpd ${JSCPD_VERSION}, received ${version || 'no version'}.`, {
    supportedFixes: [`select a jscpd ${JSCPD_VERSION} executable`],
  });
  const engine = { name: 'jscpd', version: JSCPD_VERSION, adapterRevision: 2 };
  const settings = { mode: 'weak', identifiers: options.identifiers, minTokens: options.minTokens, minLines: options.minLines, maxFileBytes: options.maxFileBytes };
  const owned = new Set(Object.keys(graph.fileModules || {}));
  // Retain the omission record when the module graph excludes vendored sources as generated.
  const selected = facts.files
    .filter(f => owned.has(f.path) || (f.role === 'generated' && VENDORED.test(f.path)))
    .sort((a, b) => compare(a.path, b.path));
  const parseErrors = new Set((facts.parse_errors || []).map(e => e.path));
  const coverage = { selected: selected.map(f => f.path), analyzed: [], omitted: [], complete: false };
  const staged = [];
  for (const file of selected) {
    if (typeof file.sourceText !== 'string') fail('duplicates/source-unavailable', `No captured source for ${file.path}.`, {
      subject: { file: file.path }, supportedFixes: ['regenerate source facts with captured source text'],
    });
    const reason = VENDORED.test(file.path) ? 'vendored'
      : parseErrors.has(file.path) ? 'parse-error'
      : !EXTENSIONS[facts.repository.language].has(path.extname(file.path).toLowerCase()) ? 'unsupported-format'
        : Buffer.byteLength(file.sourceText, 'utf8') > options.maxFileBytes ? 'max-file-bytes' : null;
    if (reason) coverage.omitted.push({ file: file.path, reason });
    else staged.push(file);
  }
  const analysis = { engine, settings, coverage };
  if (!staged.length) return { pairs: [], analysis };
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-jscpd-')));
  try {
    const sourceRoot = path.join(temporary, 'source');
    const output = path.join(temporary, 'report');
    const configuration = path.join(temporary, 'config.json');
    fs.mkdirSync(sourceRoot);
    fs.writeFileSync(configuration, '{}\n');
    const inputs = new Map();
    for (const file of staged) {
      const rel = file.path;
      if (!rel || path.isAbsolute(rel) || path.win32.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(p => p === '..' || p === '.' || !p)) invalidReport('captured source path is not repository-relative.');
      const target = path.join(sourceRoot, rel);
      const key = inputKey(target);
      if (inputs.has(key)) invalidReport('duplicate input path.');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.sourceText, 'utf8');
      inputs.set(key, { file, buffer: Buffer.from(file.sourceText, 'utf8') });
    }
    const args = ['--config', configuration, '--no-gitignore', '--absolute', '--workers', '1', '--silent', '--no-tips',
      '--reporters', 'json', '--output', output, '--summary', '--summary-top', String(staged.length),
      '--min-tokens', String(options.minTokens), '--min-lines', String(options.minLines), '--mode', 'weak',
      '--max-size', String(options.maxFileBytes), '--max-lines', String(options.maxFileBytes + 1), '--max-gap-lines', '0'];
    if (options.identifiers === 'consistent') args.push('--ignore-identifiers=consistent');
    args.push(sourceRoot);
    runTool(options, args, temporary);
    const reportPath = path.join(output, 'jscpd-report.json');
    let report;
    try {
      if (fs.statSync(reportPath).size > LIMIT) invalidReport('report exceeds 32 MiB.');
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (error) {
      if (error.name === 'DiagnosticError') throw error;
      invalidReport('missing or unreadable JSON report.');
    }
    if (!report || typeof report !== 'object' || !Array.isArray(report.duplicates) || !Array.isArray(report.summary?.files)
      || !Number.isSafeInteger(report.summary.totalFiles) || report.summary.totalFiles < 0
      || report.summary.files.length !== report.summary.totalFiles || report.statistics?.total?.sources !== report.summary.totalFiles) invalidReport('missing or truncated analyzed-file inventory.');
    const inputFor = name => {
      if (typeof name !== 'string' || !path.isAbsolute(name) || !inputs.has(inputKey(name))) invalidReport('reported path is outside the captured input inventory.');
      return inputs.get(inputKey(name));
    };
    for (const row of report.summary.files) {
      const file = inputFor(row?.path).file.path;
      if (coverage.analyzed.includes(file)) invalidReport('duplicate analyzed-file entry.');
      coverage.analyzed.push(file);
    }
    coverage.analyzed.sort(compare);
    const analyzed = new Set(coverage.analyzed);
    for (const file of staged) if (!analyzed.has(file.path)) coverage.omitted.push({ file: file.path, reason: 'not-reported-by-engine' });
    coverage.omitted.sort((a, b) => compare(a.file, b.file));
    coverage.complete = coverage.selected.length > 0 && coverage.omitted.length === 0;
    const occurrences = new Map();
    function location(native) {
      const { file, buffer } = inputFor(native?.name);
      if (!analyzed.has(file.path)) invalidReport('clone cites a file outside the analyzed inventory.');
      const start = point(buffer, file.sourceText, native.startLoc);
      const end = point(buffer, file.sourceText, native.endLoc);
      if (end.offset <= start.offset || native.start !== start.line || native.end !== end.line) invalidReport('invalid clone range.');
      const loc = { file: file.path, line: start.line, endLine: end.line,
        column: start.column, endColumn: end.column, start: start.offset, end: end.offset };
      const key = JSON.stringify([loc.file, loc.start, loc.end]);
      if (!occurrences.has(key)) {
        const enclosing = (facts.functions || []).filter(f => f.file === loc.file && f.line <= loc.line && f.endLine >= loc.endLine)
          .sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line));
        occurrences.set(key, { ...loc, ...(enclosing[0] ? { symbol: enclosing[0].qualname } : {}),
          contentHash: sha256(file.sourceText.slice(loc.start, loc.end)) });
      }
      return occurrences.get(key);
    }
    const pairs = report.duplicates.map(d => {
      if (!d || !['exact', 'renamed'].includes(d.kind) || (options.identifiers === 'exact' && d.kind !== 'exact')
        || !Number.isSafeInteger(d.tokens) || d.tokens < options.minTokens || !Number.isSafeInteger(d.lines) || d.lines < options.minLines) invalidReport('unexpected clone kind or length.');
      const locations = [location(d.firstFile), location(d.secondFile)];
      if (locations[0] === locations[1]) invalidReport('a clone cannot duplicate its own identical range.');
      return { kind: d.kind, tokens: d.tokens, lines: d.lines, locations };
    });
    // Identity distinguishes actual occurrences. Content edits may create new
    // identities; positions and unrelated findings do not define the ID.
    const groups = new Map();
    for (const loc of occurrences.values()) {
      const key = JSON.stringify([loc.file, loc.symbol || null, loc.contentHash]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(loc);
    }
    for (const [key, group] of groups) {
      group.sort((a, b) => a.start - b.start || a.end - b.end);
      group.forEach((loc, index) => { loc.identity = sha256(JSON.stringify([key, index, group.length])); });
    }
    const seen = new Set();
    for (const pair of pairs) {
      pair.locations.sort((a, b) => compare(a.identity, b.identity));
      const identity = JSON.stringify(pair.locations.map(loc => loc.identity));
      if (seen.has(identity)) invalidReport('duplicate native pair.');
      seen.add(identity);
    }
    return { pairs, analysis };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
