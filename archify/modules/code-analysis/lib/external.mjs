// Existing tool reports -> ordinary findings with explicit source provenance.
// This module reads data and bounded source snapshots; it never runs a linter.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fail, matcher } from '../core/index.mjs';
import { readInside } from './evidence.mjs';
import { parseEslint } from '../import/eslint.mjs';
import { parseRuff } from '../import/ruff.mjs';
import { parseSarif } from '../import/sarif.mjs';
import { parseGithubReview } from '../import/github-review.mjs';
import { lineFingerprints } from '../import/fingerprints.mjs';
import { object } from '../import/common.mjs';

const PARSERS = { eslint: parseEslint, ruff: parseRuff, sarif: parseSarif, 'github-review': parseGithubReview };
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 100000;
const SHA256 = /^[a-f0-9]{64}$/;
const textOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = text => createHash('sha256').update(text).digest('hex');

export function importExternal({ root, config = {}, facts = null }) {
  const settings = config.external;
  if (settings == null) return { diagnostics: [], sources: [], evidenceFiles: [] };
  if (!object(settings) || !Array.isArray(settings.sources) || (settings.severity !== undefined && !['source', 'warning'].includes(settings.severity))) configError('external must contain sources[] and an optional severity policy (source or warning).');
  const ids = new Set();
  for (const source of settings.sources) {
    if (!object(source) || typeof source.id !== 'string' || !/^[\w][\w.:-]{0,127}$/.test(source.id) || ids.has(source.id)) configError('Every external source needs a unique stable id (letters, digits, underscore, dot, colon or hyphen).');
    ids.add(source.id);
    if (!Object.hasOwn(PARSERS, source.format) || typeof source.file !== 'string' || !source.file) configError('Every external source needs a supported format and report file.', source.id);
    if (source.pathBase !== undefined && typeof source.pathBase !== 'string') configError('External pathBase must be a path string.', source.id);
    if (source.tool !== undefined && (typeof source.tool !== 'string' || !source.tool.trim())) configError('External tool must be a non-empty string.', source.id);
    if (source.author !== undefined && (typeof source.author !== 'string' || !source.author.trim())) configError('GitHub review author must be a non-empty login string.', source.id);
    if (source.pathMappings !== undefined && (!Array.isArray(source.pathMappings) || source.pathMappings.some(m => !object(m) || typeof m.from !== 'string' || !m.from || typeof m.to !== 'string'))) configError('External pathMappings must be an array of { from, to } path strings.', source.id);
  }
  let absRoot;
  try { absRoot = fs.realpathSync(root); } catch { configError('External imports require a readable analysis root.'); }
  const captured = new Map((facts?.files || []).filter(f => typeof f.sourceText === 'string').map(f => [f.path, f.sourceText]));
  const supplemental = new Map(), fileCache = new Map(), fingerprintCache = new Map(), comparisonLines = new Map();
  const excluded = matcher(config.exclude || []);
  let capturedBytes = 0, recordCount = 0;
  const sourceText = (file, persist = false) => {
    if (fileCache.has(file)) {
      const value = fileCache.get(file);
      if (persist && value.status === 'ok' && !captured.has(file)) supplemental.set(file, { path: file, sourceText: value.text, sha256: sha256(value.text) });
      return value;
    }
    let value;
    if (excluded(file)) value = { status: 'unverifiable', reason: 'file matches the analysis exclusion patterns' };
    else if (captured.has(file)) {
      const current = readInside(absRoot, file);
      value = { status: 'ok', text: captured.get(file), ...(current.status === 'ok' && current.text === captured.get(file) ? { byteSha256: current.byteSha256 } : {}) };
    }
    else {
      let size = 0;
      try { size = fs.statSync(path.resolve(absRoot, file)).size; } catch { /* readInside reports the failure. */ }
      if (size > MAX_SOURCE_BYTES || capturedBytes + size > MAX_CAPTURE_BYTES) value = { status: 'unverifiable', reason: 'supplemental source capture exceeds the per-file or per-run byte limit' };
      else {
        value = readInside(absRoot, file);
        if (value.status === 'ok' && value.text.includes('\0')) value = { status: 'unverifiable', reason: 'binary source text is not captured' };
        if (value.status === 'ok') {
          capturedBytes += Buffer.byteLength(value.text);
          if (persist) supplemental.set(file, { path: file, sourceText: value.text, sha256: sha256(value.text) });
        }
      }
    }
    fileCache.set(file, value);
    return value;
  };
  const diagnostics = [], sources = [], usedSourceIds = new Set();
  for (const source of settings.sources) {
    const reportFile = path.resolve(absRoot, source.file);
    const { data, digest } = readJson(reportFile, source.id, 'report');
    const manifest = readManifest(source.manifest, absRoot, source.id);
    const runs = PARSERS[source.format](data, source, facts);
    if (!runs.length) configError('A SARIF report with no runs cannot identify a checked source; regenerate a report containing its tool run.', source.id);
    const runKeys = new Map();
    for (const run of runs) {
      if (source.tool && source.format !== 'github-review' && source.tool.toLowerCase() !== run.tool.toLowerCase()) {
        fail('external/tool-mismatch', `Expected ${source.tool}, but the report identifies ${run.tool}.`, { subject: { sourceId: source.id }, supportedFixes: ['select the correct report or update the expected tool in config.external.sources'] });
      }
      if (manifest?.toolVersion && run.version && manifest.toolVersion !== run.version) configError('The manifest tool version conflicts with the report tool version.', source.id);
      recordCount += run.records.length;
      if (recordCount > MAX_RECORDS) configError(`External reports exceed the ${MAX_RECORDS} diagnostic limit; split the configured sources into smaller runs.`, source.id);
      const runKey = run.key || '';
      const runOccurrence = (runKeys.get(runKey) || 0) + 1;
      runKeys.set(runKey, runOccurrence);
      const sourceId = source.format === 'sarif' ? `${source.id}:run-${sha256(runKey).slice(0, 12)}${runOccurrence > 1 ? `-${runOccurrence}` : ''}` : source.id;
      if (usedSourceIds.has(sourceId)) configError('Derived external source ids collide; choose distinct configured source ids.', source.id);
      usedSourceIds.add(sourceId);
      const notices = [...run.notices];
      const notice = (code, message) => { if (notices.length < 128 && !notices.some(n => n.code === code && n.message === message)) notices.push({ code, message }); };
      let incomplete = run.incomplete || runOccurrence > 1 || (manifest?.exitCode !== undefined && manifest.exitCode > 1);
      if (runOccurrence > 1) notice('external/run-identity-ambiguous', 'Multiple SARIF runs have the same tool and automation identity; their order disambiguates them.');
      if (manifest?.exitCode > 1) notice('external/tool-failed', `The source manifest records exit code ${manifest.exitCode}.`);
      const normalize = raw => {
        const resolved = repoPath(raw, source, absRoot);
        if (resolved.file) return resolved.file;
        incomplete = true;
        notice('external/path-unresolved', resolved.reason);
        return null;
      };
      // Manifest paths describe this repository, not the producer's cwd. A
      // report pathBase such as packages/api must not prefix them a second time.
      const manifestPath = raw => {
        const resolved = repoPath(raw, { pathBase: '.' }, absRoot);
        if (resolved.file) return resolved.file;
        configError('Manifest source and scope paths must identify files inside the analyzed repository.', source.id);
      };
      const evidenceHashes = new Map();
      const expect = (file, hash, kind = 'bytes') => {
        if (!file) return;
        if (!evidenceHashes.has(file)) evidenceHashes.set(file, []);
        evidenceHashes.get(file).push({ kind, hash });
      };
      for (const entry of run.sourceTexts || []) expect(normalize(entry.path), sha256(entry.text), 'text');
      for (const entry of run.sourceHashes || []) expect(normalize(entry.path), entry.sha256);
      for (const [file, hash] of Object.entries(manifest?.files || {})) expect(manifestPath(file), hash);
      const reportedFiles = [...new Set(run.files.map(normalize).filter(Boolean))].sort(textOrder);
      const scopeFiles = manifest?.scope ? [...new Set(manifest.scope.files.map(manifestPath))].sort(textOrder) : reportedFiles;
      if (manifest?.scope && reportedFiles.some(f => !scopeFiles.includes(f))) { incomplete = true; notice('external/scope-mismatch', 'A reported file is outside the source manifest scope.'); }
      const bindingFor = files => {
        if (!files.length) return 'unverified';
        let verified = true;
        for (const file of files) {
          const value = sourceText(file), expected = evidenceHashes.get(file);
          if (value.status !== 'ok' || !expected?.length) { verified = false; continue; }
          for (const assertion of expected) {
            const actual = assertion.kind === 'text' ? sha256(value.text) : value.byteSha256;
            if (!actual) { verified = false; continue; }
            if (assertion.hash !== actual) return 'changed';
          }
        }
        return verified ? 'verified' : 'unverified';
      };
      const allFiles = [...new Set([...scopeFiles, ...evidenceHashes.keys()])];
      let binding = bindingFor(allFiles);
      if (!allFiles.length && manifest?.scope?.complete && manifest.scope.files.length === 0 && object(manifest.files)) binding = 'verified';
      const tool = run.tool;
      const ai = source.format === 'github-review';
      const code = `${ai ? 'external' : 'conventions'}/${toolSlug(tool)}`;
      const severityPolicy = ai ? 'warning' : settings.severity || 'warning';
      const importSettingsDigest = sha256(JSON.stringify({ format: source.format, tool, severityPolicy, pathBase: source.pathBase || '.', pathMappings: source.pathMappings || [], author: source.author || null }));
      const sourceHashEntries = [], sourceTextHashEntries = [];
      for (const [file, assertions] of evidenceHashes) {
        const hashes = [...new Set(assertions.filter(a => a.kind === 'bytes').map(a => a.hash))];
        if (hashes.length === 1) sourceHashEntries.push([file, hashes[0]]);
        const textHashes = [...new Set(assertions.filter(a => a.kind === 'text').map(a => a.hash))];
        if (textHashes.length === 1) sourceTextHashEntries.push([file, textHashes[0]]);
      }
      const sourceHashes = Object.fromEntries(sourceHashEntries.sort(([a], [b]) => textOrder(a, b)));
      const sourceTextHashes = Object.fromEntries(sourceTextHashEntries.sort(([a], [b]) => textOrder(a, b)));
      const context = {
        id: sourceId, code, format: source.format, tool, toolVersion: manifest?.toolVersion ?? run.version ?? null,
        adapterRevision: source.format === 'sarif' ? 2 : 1, identityRevision: source.format === 'sarif' ? 2 : 1, reportSha256: digest,
        severityPolicy, importSettingsDigest,
        configDigest: manifest?.configDigest ?? null, status: 'imported',
        coverage: { files: scopeFiles, complete: manifest?.scope?.complete ?? null },
        binding, suppressed: run.suppressed || 0, notices,
        ...(Object.keys(sourceHashes).length ? { sourceHashes } : {}),
        ...(Object.keys(sourceTextHashes).length ? { sourceTextHashes } : {}),
        ...(manifest?.command ? { command: manifest.command } : {}), reportFile: source.file,
      };
      const seenRecords = new Set(), identityCounts = new Map();
      // Sort physical occurrences so a report's output ordering does not reassign ids.
      const records = [...run.records].sort((a, b) => textOrder(recordPosition(a), recordPosition(b)));
      for (const record of records) {
        let usable = record.locations.some(loc => loc.role !== 'related');
        const locations = [];
        for (const native of record.locations) {
          const file = normalize(native.path);
          if (!file) { usable = false; continue; }
          if (native.noSource) { locations.push({ file, ...(native.role ? { role: native.role } : {}) }); usable = false; continue; }
          const value = sourceText(file, true);
          if (value.status !== 'ok') { usable = false; notice('external/evidence-unavailable', `${file}: ${value.reason}`); }
          const loc = normalizedLocation(file, native, value.status === 'ok' ? value.text : null);
          if (loc.reason) { usable = false; incomplete = true; notice('external/location-unverifiable', `${file}: ${loc.reason}`); }
          locations.push({ ...loc.location, ...(native.role ? { role: native.role } : {}) });
        }
        const recordKey = JSON.stringify([record.ruleId, record.message, record.originalSeverity, locations.length ? locations : record.locations, record.fingerprint, record.suggestions, record.helpUri, reviewOrigin(record.origin)]);
        if (seenRecords.has(recordKey)) continue;
        seenRecords.add(recordKey);
        let recordBinding = usable ? bindingFor(locations.map(l => l.file)) : 'unverified';
        if (binding === 'changed') recordBinding = 'changed';
        const fingerprint = record.fingerprint || fallbackFingerprint(locations, record, sourceText, fingerprintCache);
        const anchor = record.fingerprintPartial ? [fingerprint, fallbackFingerprint(locations, record, sourceText, fingerprintCache)] : fingerprint;
        const component = record.origin?.toolComponent;
        const identity = JSON.stringify([sourceId, ...(component ? [component.identityAmbiguous ? [component.name, component.index] : component.guid || component.name] : []), record.ruleId, locations.map(l => l.file), anchor]);
        const ordinal = (identityCounts.get(identity) || 0) + 1;
        identityCounts.set(identity, ordinal);
        const id = `${ai ? 'EXT' : 'CONV'}-${sha256(`${identity}:${ordinal}`).slice(0, 12)}`;
        const severity = severityPolicy === 'warning' ? (record.severity === 'info' && !ai ? 'info' : 'warning') : record.severity;
        const primary = { ...(locations.find(loc => loc.role !== 'related') || {}) };
        delete primary.role;
        // Keep a comparison-only anchor separate from finding IDs and approval digests.
        let comparisonLineSha256;
        if (source.format === 'eslint' && !record.fingerprint && recordBinding === 'verified' && locations.length === 1
          && primary.line && primary.column && (primary.endLine ?? primary.line) === primary.line) {
          if (!comparisonLines.has(primary.file)) {
            const value = sourceText(primary.file);
            comparisonLines.set(primary.file, { lines: value.status === 'ok' ? value.text.split(/\r\n|\r|\n/) : [], hashes: new Map() });
          }
          const { lines, hashes } = comparisonLines.get(primary.file);
          const line = lines[primary.line - 1];
          if (line !== undefined && !hashes.has(primary.line)) hashes.set(primary.line, sha256(line));
          comparisonLineSha256 = hashes.get(primary.line);
        }
        const external = {
          sourceId, tool, ruleId: record.ruleId ?? null, originalSeverity: record.originalSeverity ?? null,
          ...(record.severityDefaulted ? { severityDefaulted: true } : {}),
          ...(record.helpUri ? { helpUri: record.helpUri } : {}),
          reportPointer: record.pointer, identityRevision: context.identityRevision, fingerprint,
          binding: recordBinding,
          ...(comparisonLineSha256 ? { comparisonLineSha256 } : {}),
          reviewDigest: sha256(JSON.stringify([tool, context.toolVersion, context.configDigest, context.adapterRevision, context.identityRevision, importSettingsDigest, record.ruleId, record.message, record.originalSeverity, severity, record.helpUri, record.suggestions, reviewOrigin(record.origin), ...(source.format === 'sarif' ? [locations] : []), ...(component?.identityAmbiguous ? [context.reportSha256] : [])])),
          locations,
          origin: { ...(record.origin || {}), nativeLocations: record.locations },
          ...(record.suggestions.length ? { suggestions: record.suggestions } : {}),
        };
        const files = [...new Set(locations.map(l => l.file))].sort(textOrder);
        // A lint rule may depend on other lines in its cited files (e.g. a use
        // added below an import). Snippets locate it; acceptance hashes whole files.
        const evidenceDigest = usable && files.length && files.every(file => sourceText(file).status === 'ok')
          ? { files, sha256: sha256(JSON.stringify(files.map(file => [file, sha256(sourceText(file).text)]))) } : null;
        diagnostics.push({
          id, code,
          dimension: ai ? 'external-review' : 'conventions', severity, confidence: null,
          message: record.message, subject: { ...primary, ...(locations.length > 1 || locations.some(loc => loc.role === 'related') ? { locations } : {}) },
          evidence: { sourceId, reportPointer: record.pointer }, supportedFixes: record.suggestions,
          external, ...(evidenceDigest ? { evidenceDigest } : {}),
        });
      }
      if (binding !== 'verified') notice(binding === 'changed' ? 'external/source-changed' : 'external/source-unverified', binding === 'changed' ? 'The captured source differs from the source bound to the report.' : 'The report does not prove it was generated from this captured source snapshot.');
      if (context.coverage.complete === null) notice('external/scope-unknown', 'The report does not establish its full scan scope or successful coverage.');
      if (incomplete) { context.status = 'partial'; context.coverage.complete = false; }
      sources.push(context);
    }
  }
  return {
    diagnostics: diagnostics.sort((a, b) => textOrder(a.id, b.id)),
    sources: sources.sort((a, b) => textOrder(a.id, b.id)),
    evidenceFiles: [...supplemental.values()].sort((a, b) => textOrder(a.path, b.path)),
  };
}

function readJson(file, sourceId, kind) {
  let bytes;
  try {
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > MAX_REPORT_BYTES) throw new Error('not a file, or exceeds the 32 MiB input limit');
    bytes = fs.readFileSync(file);
  } catch (error) {
    fail('external/input-unreadable', `External ${kind} cannot be read: ${file}`, { subject: { sourceId, file }, evidence: { reason: error.message }, supportedFixes: ['provide the configured report or manifest file', 'split reports larger than 32 MiB'] });
  }
  try { return { data: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), digest: sha256(bytes) }; }
  catch (error) { fail('external/input-not-json', `External ${kind} is not valid JSON: ${file}`, { subject: { sourceId, file }, evidence: { reason: error.message }, supportedFixes: ['regenerate the structured report'] }); }
}

function readManifest(value, root, id) {
  if (value === undefined) return null;
  const manifest = typeof value === 'string' ? readJson(path.resolve(root, value), id, 'manifest').data : value;
  if (!object(manifest) || manifest.schema_version !== 1) configError('External manifests need schema_version: 1.', id);
  if (manifest.toolVersion != null && (typeof manifest.toolVersion !== 'string' || !manifest.toolVersion.trim())) configError('Manifest toolVersion must be a non-empty string or null.', id);
  if (manifest.configDigest != null && (typeof manifest.configDigest !== 'string' || !SHA256.test(manifest.configDigest))) configError('Manifest configDigest must be a lowercase SHA-256 digest or null.', id);
  if (manifest.command !== undefined && typeof manifest.command !== 'string') configError('Manifest command must be a string.', id);
  if (manifest.exitCode !== undefined && (!Number.isInteger(manifest.exitCode) || manifest.exitCode < 0)) configError('Manifest exitCode must be a non-negative integer.', id);
  if (manifest.scope !== undefined && (!object(manifest.scope) || !Array.isArray(manifest.scope.files) || manifest.scope.files.some(f => typeof f !== 'string' || !f) || typeof manifest.scope.complete !== 'boolean')) configError('Manifest scope needs files[] and complete boolean.', id);
  if (manifest.files !== undefined && (!object(manifest.files) || Object.entries(manifest.files).some(([file, hash]) => !file || typeof hash !== 'string' || !SHA256.test(hash)))) configError('Manifest files must map paths to lowercase SHA-256 hashes of the generated-time source.', id);
  return manifest;
}

function repoPath(raw, source, root) {
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) return { reason: 'The source location has no supported file path.' };
  let file = raw;
  if (/^file:/i.test(file)) {
    try {
      const uri = new URL(file);
      if (uri.search || uri.hash) return { reason: 'File URIs with query or fragment components need an explicit local path.' };
      file = decodeURIComponent(uri.pathname);
      if (uri.hostname && uri.hostname !== 'localhost') file = `//${uri.hostname}${file}`;
      file = file.replace(/^\/([A-Za-z]:\/)/, '$1');
    } catch { return { reason: 'The source file URI could not be decoded.' }; }
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(file) && !/^[A-Za-z]:[\\/]/.test(file)) return { reason: 'Non-file source URIs are retained in the original report; no network content is read.' };
  file = file.replace(/\\/g, '/');
  const mappings = [...(source.pathMappings || [])].sort((a, b) => b.from.length - a.from.length);
  for (const mapping of mappings) {
    const from = mapping.from.replace(/\\/g, '/').replace(/\/$/, '');
    if (file === from || file.startsWith(`${from}/`)) { file = `${mapping.to.replace(/\\/g, '/').replace(/\/$/, '')}${file.slice(from.length)}`; break; }
  }
  if (path.win32.isAbsolute(file) && !path.isAbsolute(file)) return { reason: `Producer path ${raw} needs an explicit pathMappings root.` };
  const base = path.resolve(root, source.pathBase || '.');
  const absolute = path.resolve(base, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { reason: `Source path ${raw} resolves outside the analyzed repository; configure its producer root explicitly.` };
  return { file: relative.split(path.sep).join('/') };
}

function normalizedLocation(file, native, text) {
  const location = { file };
  if (native.line === undefined) {
    return { location, ...(native.column !== undefined || native.endLine !== undefined || native.endColumn !== undefined ? { reason: 'positions without a start line cannot be mapped' } : {}) };
  }
  const line = native.line, endLine = native.endLine ?? line;
  if (endLine < line) return { location, reason: 'endLine precedes startLine' };
  location.line = line; location.endLine = endLine;
  const lines = text === null ? null : text.split(/\r\n|\r|\n/);
  if (lines && (line > lines.length || endLine > lines.length)) return { location: { file }, reason: 'reported line range is outside the captured source' };
  const convert = (column, at) => {
    if (column === undefined) return undefined;
    if (!lines) return native.columnKind === 'utf16CodeUnits' || !native.columnKind ? column : null;
    const value = lines[at - 1];
    if (native.columnKind === 'unicodeCodePoints') {
      const chars = [...value];
      return column <= chars.length + 1 ? chars.slice(0, column - 1).join('').length + 1 : null;
    }
    if (native.columnKind === 'utf8Bytes') {
      const bytes = Buffer.from(value, 'utf8');
      if (column > bytes.length + 1) return null;
      const prefix = bytes.subarray(0, column - 1).toString('utf8');
      return Buffer.byteLength(prefix) === column - 1 ? prefix.length + 1 : null;
    }
    return column <= value.length + 1 ? column : null;
  };
  const column = convert(native.column, line), endColumn = convert(native.endColumn, endLine);
  if (column === null || endColumn === null || (endLine === line && column !== undefined && endColumn !== undefined && endColumn < column)) return { location: { file, line, endLine }, reason: 'source columns cannot be mapped to a valid UTF-16 range' };
  if (column !== undefined) location.column = column;
  if (endColumn !== undefined) location.endColumn = endColumn;
  return { location };
}

function fallbackFingerprint(locations, record, read, cache) {
  const anchors = locations.map(loc => {
    const value = read(loc.file);
    if (value.status !== 'ok' || !loc.line) return [loc.file, 'unlocated'];
    if (!cache.has(loc.file)) cache.set(loc.file, lineFingerprints(value.text));
    const line = value.text.split(/\r\n|\r|\n/)[loc.line - 1] || '';
    const column = loc.column ? line.slice(0, loc.column - 1).replace(/[ \t]/g, '').length : null;
    return [loc.file, cache.get(loc.file).get(loc.line) || 'unlocated', column];
  });
  return `archify-line-context/v1:${sha256(JSON.stringify([anchors, anchors.length ? null : record.message]))}`;
}

function recordPosition(record) {
  return JSON.stringify(record.locations.map(l => [l.path, String(l.line || 0).padStart(12, '0'), String(l.column || 0).padStart(12, '0')]).concat([[record.ruleId, record.message, record.pointer]]));
}
function reviewOrigin(origin) {
  if (!origin) return null;
  return { commentId: origin.commentId, commit: origin.commit, originalCommit: origin.originalCommit, side: origin.side, messageId: origin.messageId, ruleGuid: origin.ruleGuid, ...(origin.toolComponent ? { toolComponent: origin.toolComponent } : {}) };
}
function toolSlug(tool) { return tool.toLowerCase().replace(/[^a-z-]+/g, '-').replace(/^-+|-+$/g, '') || 'tool'; }
function configError(message, sourceId = null) {
  fail('external/config-invalid', message, { subject: { sourceId }, supportedFixes: ['check config.external.sources and the versioned source manifest'] });
}
