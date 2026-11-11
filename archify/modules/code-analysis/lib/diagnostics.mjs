import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fail } from '../extract/shared/diagnostics.mjs';

// Import the small SARIF subset that can be checked against a local repository.
// The adapter never downloads artifacts or executes the producing tool. Results
// outside the selected root remain visible but cannot become actionable tasks.
export function importSarif(document, { root = '.', source = 'sarif', importedAt = null, limits = {} } = {}) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.runs)) fail('diagnostics/sarif-invalid', 'SARIF input must contain a runs array.', { supportedFixes: ['pass a SARIF 2.x document'] });
  const maxRuns = limits.maxRuns ?? 100;
  const maxResults = limits.maxResults ?? 10000;
  const maxLocations = limits.maxLocations ?? 100;
  if (document.runs.length > maxRuns) fail('diagnostics/sarif-too-large', `SARIF input contains more than ${maxRuns} runs.`, { evidence: { runs: document.runs.length, maxRuns }, supportedFixes: ['split the SARIF export into smaller inputs'] });
  const findings = [];
  const digestCache = new Map();
  let resultCount = 0;
  for (const [runIndex, run] of document.runs.entries()) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) fail('diagnostics/sarif-invalid', `SARIF run ${runIndex} must be an object.`, { evidence: { runIndex }, supportedFixes: ['regenerate the SARIF export'] });
    const tool = run?.tool?.driver || {};
    const toolName = typeof tool.name === 'string' && tool.name ? tool.name : 'unknown';
    const toolVersion = typeof tool.version === 'string' ? tool.version : null;
    const rules = new Map((Array.isArray(tool.rules) ? tool.rules : []).filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
    if (run.results !== undefined && !Array.isArray(run.results)) fail('diagnostics/sarif-invalid', `SARIF run ${runIndex}.results must be an array.`, { evidence: { runIndex }, supportedFixes: ['regenerate the SARIF export'] });
    for (const [resultIndex, result] of (run.results || []).entries()) {
      resultCount += 1;
      if (resultCount > maxResults) fail('diagnostics/sarif-too-large', `SARIF input contains more than ${maxResults} results.`, { evidence: { results: resultCount, maxResults }, supportedFixes: ['split the SARIF export into smaller inputs'] });
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail('diagnostics/sarif-invalid', `SARIF result ${runIndex}:${resultIndex} must be an object.`, { evidence: { runIndex, resultIndex }, supportedFixes: ['regenerate the SARIF export'] });
      const rule = typeof result.ruleId === 'string' ? result.ruleId : 'unknown';
      const level = typeof result.level === 'string' ? result.level : 'warning';
      const primaryLocations = Array.isArray(result.locations) ? result.locations : [];
      const relatedLocations = Array.isArray(result.relatedLocations) ? result.relatedLocations : [];
      const locations = normalizeLocations([...primaryLocations, ...relatedLocations], root, maxLocations)
        .map((location, index) => index < primaryLocations.length ? location : { ...location, role: 'related' });
      const primary = primaryLocations.length ? locations[0] : { file: null, line: null, column: null, status: 'unverifiable', reason: 'SARIF result has no supported location' };
      const message = typeof result.message?.text === 'string' && result.message.text ? result.message.text : `External diagnostic ${rule}`;
      findings.push(externalFinding({ root, source, toolName, toolVersion, rule, level, message, locations, primary, ruleDescription: rules.get(rule)?.shortDescription?.text || null, importedAt, digestCache }));
    }
  }
  return uniqueFindings(findings);
}

export function importEslint(document, { root = '.', source = 'eslint', importedAt = null, limits = {} } = {}) {
  if (!Array.isArray(document)) fail('diagnostics/eslint-invalid', 'ESLint JSON input must be an array of file results.', { supportedFixes: ['pass the JSON output from eslint -f json'] });
  const maxFiles = limits.maxFiles ?? 10000;
  const maxResults = limits.maxResults ?? 10000;
  if (document.length > maxFiles) fail('diagnostics/eslint-too-large', `ESLint input contains more than ${maxFiles} file results.`, { evidence: { files: document.length, maxFiles }, supportedFixes: ['split the ESLint export into smaller inputs'] });
  const findings = [];
  const digestCache = new Map();
  let resultCount = 0;
  for (const [fileIndex, file] of document.entries()) {
    if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.filePath !== 'string') fail('diagnostics/eslint-invalid', `ESLint file result ${fileIndex} must be an object with filePath.`, { evidence: { fileIndex }, supportedFixes: ['regenerate the ESLint JSON export'] });
    if (!Array.isArray(file.messages)) fail('diagnostics/eslint-invalid', `ESLint file result ${fileIndex}.messages must be an array.`, { evidence: { fileIndex }, supportedFixes: ['regenerate the ESLint JSON export'] });
    for (const [resultIndex, result] of file.messages.entries()) {
      resultCount += 1;
      if (resultCount > maxResults) fail('diagnostics/eslint-too-large', `ESLint input contains more than ${maxResults} messages.`, { evidence: { messages: resultCount, maxResults }, supportedFixes: ['split the ESLint export into smaller inputs'] });
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail('diagnostics/eslint-invalid', `ESLint message ${fileIndex}:${resultIndex} must be an object.`, { evidence: { fileIndex, resultIndex }, supportedFixes: ['regenerate the ESLint JSON export'] });
      const rule = typeof result.ruleId === 'string' && result.ruleId ? result.ruleId : 'unknown';
      const locations = normalizeLocations([{ physicalLocation: { artifactLocation: { uri: file.filePath }, region: { startLine: result.line, startColumn: result.column, endLine: result.endLine, endColumn: result.endColumn } } }], root);
      findings.push(externalFinding({ root, source, toolName: 'eslint', toolVersion: null, rule, level: result.severity === 2 ? 'error' : result.severity === 1 ? 'warning' : 'info', message: typeof result.message === 'string' && result.message ? result.message : `External diagnostic ${rule}`, locations, primary: locations[0], importedAt, digestCache }));
    }
  }
  return uniqueFindings(findings);
}

export function importRuff(document, { root = '.', source = 'ruff', importedAt = null, limits = {} } = {}) {
  if (!Array.isArray(document)) fail('diagnostics/ruff-invalid', 'Ruff JSON input must be an array of diagnostics.', { supportedFixes: ['pass the JSON output from ruff --output-format json'] });
  const maxResults = limits.maxResults ?? 10000;
  if (document.length > maxResults) fail('diagnostics/ruff-too-large', `Ruff input contains more than ${maxResults} diagnostics.`, { evidence: { results: document.length, maxResults }, supportedFixes: ['split the Ruff export into smaller inputs'] });
  const digestCache = new Map();
  return uniqueFindings(document.map((result, resultIndex) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail('diagnostics/ruff-invalid', `Ruff diagnostic ${resultIndex} must be an object.`, { evidence: { resultIndex }, supportedFixes: ['regenerate the Ruff JSON export'] });
    const location = result.location || {};
    const endLocation = result.end_location || {};
    const rule = typeof result.code === 'string' && result.code ? result.code : 'unknown';
    const locations = normalizeLocations([{ physicalLocation: { artifactLocation: { uri: result.filename }, region: { startLine: location.row, startColumn: location.column, endLine: endLocation.row, endColumn: endLocation.column } } }], root);
    return externalFinding({ root, source, toolName: 'ruff', toolVersion: null, rule, level: 'warning', message: typeof result.message === 'string' && result.message ? result.message : `External diagnostic ${rule}`, locations, primary: locations[0], importedAt, digestCache });
  }));
}

function uniqueFindings(findings) {
  const unique = new Map();
  for (const finding of findings) if (!unique.has(finding.id)) unique.set(finding.id, finding);
  return [...unique.values()];
}

function externalFinding({ root, source, toolName, toolVersion, rule, level, message, locations, primary, ruleDescription = null, importedAt = null, digestCache = new Map() }) {
  const code = `external/${toolName.replace(/[^a-z-]/gi, '-').toLowerCase() || 'tool'}`;
  const digestFiles = [...new Set((locations || []).filter((location) => location.status === 'ok' && location.file).map((location) => location.file))].sort();
  const fileDigests = digestFiles.map((file) => [file, digestFile(root, file, digestCache)]);
  const evidenceDigest = fileDigests.length && fileDigests.every(([, digest]) => digest) ? createHash('sha256').update(JSON.stringify(fileDigests)).digest('hex') : null;
  const finding = {
    code, dimension: 'ai-smell', severity: 'warning', confidence: 0.5,
    message, subject: { file: primary?.file || null, line: primary?.line || null, column: primary?.column || null, rule, tool: toolName },
    evidence: { threshold: null, source, tool: toolName, toolVersion, rule, originalLevel: level, ruleDescription, locations, importedAt },
    supportedFixes: primary?.status === 'ok' ? ['review the external diagnostic and verify it against the current source before changing code'] : ['re-run or export the diagnostic with a source location inside the repository'],
  };
  if (evidenceDigest) finding.evidenceDigest = { files: digestFiles, sha256: evidenceDigest };
  const locationIdentity = (locations || []).map(({ file, line, column, endLine, endColumn, role }) => [file || null, line || null, column || null, endLine || null, endColumn || null, role || 'primary']);
  finding.id = `AISM-${createHash('sha256').update(JSON.stringify([code, source, toolName, rule, message, locationIdentity])).digest('hex').slice(0, 12)}`;
  return finding;
}

function digestFile(root, file, cache) {
  const key = `${path.resolve(root)}\u0000${file}`;
  if (cache.has(key)) return cache.get(key);
  let digest = null;
  try {
    const base = fs.realpathSync(root), target = fs.realpathSync(path.resolve(root, file));
    const relative = path.relative(base, target);
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) digest = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  } catch { /* missing and root-external files remain unverifiable */ }
  cache.set(key, digest);
  return digest;
}

function normalizeLocations(locations, root, maxLocations = 100) {
  if (locations.length > maxLocations) fail('diagnostics/sarif-too-large', `SARIF result contains more than ${maxLocations} locations.`, { evidence: { locations: locations.length, maxLocations }, supportedFixes: ['split the SARIF result or reduce related locations'] });
  return (Array.isArray(locations) ? locations : []).map((location) => {
    const physical = location?.physicalLocation;
    const uri = physical?.artifactLocation?.uri;
    const region = physical?.region || {};
    const line = region.startLine;
    const column = region.startColumn;
    const range = {
      line,
      column: column || null,
      ...(region.endLine !== undefined ? { endLine: region.endLine } : {}),
      ...(region.endColumn !== undefined ? { endColumn: region.endColumn } : {}),
    };
    if (typeof uri !== 'string' || !uri || !Number.isInteger(line) || line < 1) return { file: null, line: null, column: null, status: 'unverifiable', reason: 'missing supported URI or line' };
    let clean;
    try { clean = uri.startsWith('file:') ? fileURLToPath(uri) : uri; }
    catch { return { file: uri, ...range, status: 'unverifiable', reason: 'location has an invalid file URI' }; }
    clean = clean.replaceAll('\\', '/');
    const relative = relativeLocation(clean, String(root).replaceAll('\\', '/'));
    if (!relative || relative === '..' || relative.startsWith('../') || pathFlavor(relative) || relative.split('/').includes('..')) return { file: relative || clean, ...range, status: 'unverifiable', reason: 'location is outside the analysis root' };
    const hostFlavor = process.platform === 'win32' ? 'win32' : 'posix';
    const rootFlavor = pathFlavor(String(root).replaceAll('\\', '/'));
    if (rootFlavor && rootFlavor !== hostFlavor) return { file: relative, ...range, status: 'unverifiable', reason: 'location does not resolve to a current source file' };
    try {
      const base = fs.realpathSync(root), target = fs.realpathSync(path.resolve(root, relative)), resolved = path.relative(base, target);
      if (!resolved || resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) return { file: relative, ...range, status: 'unverifiable', reason: 'location resolves outside the analysis root' };
    } catch { return { file: relative, ...range, status: 'unverifiable', reason: 'location does not resolve to a current source file' }; }
    return { file: relative, ...range, status: 'ok' };
  });
}

function pathFlavor(file) {
  if (/^[A-Za-z]:/.test(file) || file.startsWith('//')) return 'win32';
  if (file.startsWith('/')) return 'posix';
  return null;
}

function relativeLocation(file, root) {
  const flavor = pathFlavor(file);
  if (!flavor) return file.replace(/^\.\//, '');
  const api = path[flavor];
  if (!api.isAbsolute(file)) return file;
  const hostFlavor = process.platform === 'win32' ? 'win32' : 'posix';
  let absoluteRoot = root;
  if (!pathFlavor(root)) {
    if (flavor !== hostFlavor) return file;
    absoluteRoot = api.resolve(root);
  }
  if (pathFlavor(absoluteRoot) !== flavor || !api.isAbsolute(absoluteRoot)) return file;
  return api.relative(absoluteRoot, file).replaceAll('\\', '/');
}
