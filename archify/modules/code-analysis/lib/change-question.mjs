// Fresh paired source orientation. Slots are reading aids, never persistent IDs.
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { extractFacts, loadConfig } from './analysis.mjs';
import { readInside } from './evidence.mjs';
import { measureFunctions } from '../extract/ts/functions.mjs';
import { rangeText } from '../extract/shared/source-range.mjs';
import { fail } from '../extract/shared/diagnostics.mjs';

const LIMIT = 40;
const digest = text => createHash('sha256').update(text).digest('hex');
const bounded = items => ({ total: items.length, included: Math.min(items.length, LIMIT), omitted: Math.max(0, items.length - LIMIT), limit: LIMIT, items: items.slice(0, LIMIT) });
const key = (...parts) => JSON.stringify(parts);
const point = (source, offset) => {
  const p = source.getLineAndCharacterOfPosition(offset);
  return { line: p.line + 1, column: p.character + 1 };
};
const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
const end = range => ({ line: range.endLine, column: range.endColumn });

// Normalize root-relative compiler paths, without rewriting arbitrary strings
// such as path patterns. External paths remain explicit comparison differences.
function normalize(value, root) {
  if (Array.isArray(value)) return value.map(item => normalize(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k], root)]));
  if (typeof value === 'string' && path.isAbsolute(value)) {
    const rel = path.relative(root, value);
    if (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return `<root>/${rel.split(path.sep).join('/')}`;
  }
  return value;
}

export function changeEntryLanguage(entry) {
  if (typeof entry !== 'string' || !entry || path.isAbsolute(entry) || entry.includes('\\') || entry.split('/').some(part => part === '..' || part === '.') || entry.includes('\0')) fail('task/entry-invalid', 'Pass a repository-relative JS/TS, .py or .java source file with --entry.');
  if (/\.(?:[mc]?[jt]s|[jt]sx)$/.test(entry)) return 'ts';
  if (/\.py$/.test(entry)) return 'py';
  if (/\.java$/.test(entry)) return 'java';
  fail('task/entry-invalid', 'Pass a repository-relative JS/TS, .py or .java source file with --entry.');
}

export function captureChangeSide(root, config, language = 'ts') {
  root = path.resolve(root);
  let resolution;
  const { facts } = extractFacts(root, { language, config, onCapture: input => { resolution = input; } });
  if (language !== 'ts') resolution = { coverage: 'not-applicable', model: 'captured-source-import-resolution' };
  return { root, facts, resolution, language, configDigest: digest(JSON.stringify(config)) };
}

function inspectSide(capture, side) {
  const { root, facts, resolution } = capture;
  const errors = new Map((facts.parse_errors || []).map(error => [error.path, error.message]));
  const files = new Map();
  for (const file of facts.files) {
    const current = readInside(root, file.path);
    const status = current.status !== 'ok' ? current.status : current.text !== file.sourceText ? 'changed' : errors.has(file.path) ? 'parse-error' : 'valid';
    files.set(file.path, { ...file, status, ...(errors.has(file.path) ? { parseError: errors.get(file.path) } : {}) });
  }
  const inputs = [];
  let resolutionFresh = true;
  for (const [file, text] of resolution.reads || []) {
    // Includes absent reads for freshness, but only actual content contributes
    // to the settings digest: adding an import may probe new absent paths.
    const status = ts.sys.readFile(file) === text ? 'valid' : 'changed';
    if (status !== 'valid') resolutionFresh = false;
    if (text !== undefined) inputs.push({ file: normalize(file, root), sha256: digest(text) });
  }
  inputs.sort((a, b) => a.file.localeCompare(b.file));
  const settings = { options: normalize(resolution.options || {}, root), inputs };
  const unavailable = [...files.values()].filter(file => file.status !== 'valid').map(file => ({ file: file.path, status: file.status, ...(file.parseError ? { parseError: file.parseError } : {}) }));
  const summary = {
    side, root, snapshot: facts.repository, language: facts.repository.language, producer: { adapter: facts.repository.adapter, adapterRevision: facts.repository.adapterRevision }, callModel: facts.callModel ?? null, analysisConfigDigest: capture.configDigest, capturedFiles: files.size,
    sourceIdentity: unavailable.some(file => file.status !== 'parse-error') ? 'incomplete' : 'valid',
    unavailableFiles: bounded(unavailable), parseErrors: (facts.parse_errors || []).length,
    resolution: facts.repository.language === 'ts' ? { digest: digest(JSON.stringify(settings)), fresh: resolutionFresh, options: settings.options, inputs: bounded(inputs) } : { ...resolution, digest: capture.configDigest },
  };
  const references = new Map(), calls = new Map();
  (facts.calls || []).forEach((fact, factIndex) => {
    const record = { side, snapshotId: facts.repository.snapshotId, factIndex, fact };
    const fileCalls = calls.get(fact.file) || [];
    fileCalls.push(record); calls.set(fact.file, fileCalls);
    if (fact.target) {
      const targetKey = key(fact.target.file || fact.file, fact.target.line, fact.target.column, fact.target.name);
      const refs = references.get(targetKey) || [];
      refs.push(record); references.set(targetKey, refs);
    }
  });
  const importsByTarget = new Map();
  let unresolvedImports = 0;
  facts.imports.forEach((fact, factIndex) => {
    const record = { side, snapshotId: facts.repository.snapshotId, factIndex, fact };
    if (!fact.resolved) { unresolvedImports += 1; return; }
    const targets = importsByTarget.get(fact.to) || [];
    targets.push(record); importsByTarget.set(fact.to, targets);
  });
  for (const records of calls.values()) records.sort((a, b) => a.fact.line - b.fact.line || a.fact.column - b.fact.column || a.fact.endLine - b.fact.endLine || a.fact.endColumn - b.fact.endColumn);
  const callCoverage = (facts.repository.language === 'ts' && /^typescript@/.test(facts.repository.adapter) && ['js-ts-lexical-v1', 'js-ts-lexical-v2'].includes(facts.callModel))
    || (facts.repository.language === 'py' && /^python@/.test(facts.repository.adapter) && facts.callModel === 'python-lexical-v1')
    || (facts.repository.language === 'java' && /^java-parser@/.test(facts.repository.adapter) && facts.callModel === 'java-static-lexical-v1');
  return { side, root, facts, files, references, calls, callCoverage, importsByTarget, unresolvedImports, summary, resolutionFresh, settings };
}

function compareSettings(base, head) {
  const optionChanges = [];
  for (const option of [...new Set([...Object.keys(base.options), ...Object.keys(head.options)])].sort()) {
    if (JSON.stringify(base.options[option]) !== JSON.stringify(head.options[option])) optionChanges.push({ option, base: base.options[option] ?? null, head: head.options[option] ?? null });
  }
  const a = new Map(base.inputs.map(input => [input.file, input.sha256]));
  const b = new Map(head.inputs.map(input => [input.file, input.sha256]));
  const inputChanges = [...new Set([...a.keys(), ...b.keys()])].sort().filter(file => a.get(file) !== b.get(file)).map(file => ({ file, baseSha256: a.get(file) ?? null, headSha256: b.get(file) ?? null }));
  return { optionChanges: bounded(optionChanges), inputChanges: bounded(inputChanges) };
}

function definitions(side, file) {
  const captured = side.files.get(file);
  if (!captured || captured.status !== 'valid') return { coverage: captured?.status || 'not-captured', records: [] };
  if (side.facts.repository.language !== 'ts') {
    const result = [], unavailable = [];
    const kinds = side.facts.repository.language === 'py' ? ['FunctionDef', 'AsyncFunctionDef'] : ['methodDeclaration', 'interfaceMethodDeclaration', 'constructorDeclaration', 'compactConstructorDeclaration'];
    for (const fn of side.facts.functions.filter(fn => fn.file === file)) {
      const metadata = fn.definition;
      const slice = rangeText(captured.sourceText, metadata?.sourceRange);
      if (!metadata || !kinds.includes(metadata.kind) || slice === null || digest(slice) !== metadata.sourceRange.sha256) {
        unavailable.push({ file, name: fn.name, qualname: fn.qualname, reason: !metadata ? 'definition-metadata-unavailable' : 'definition-metadata-invalid' });
        continue;
      }
      // Identity remains the original def-start, independently of decorated headers.
      const identity = fn.sourceRange || metadata.sourceRange;
      result.push({ file, name: fn.name, qualname: fn.qualname, kind: metadata.kind,
        line: identity.line, column: identity.column || fn.column || 1,
        endLine: metadata.sourceRange.endLine, endColumn: metadata.sourceRange.endColumn,
        sourceRange: metadata.sourceRange, textSha256: metadata.sourceRange.sha256 });
    }
    return { coverage: unavailable.length ? 'definition-regions-unavailable' : 'available', records: result, unavailable };
  }
  const source = ts.createSourceFile(file, captured.sourceText, ts.ScriptTarget.Latest, true);
  if (source.isDeclarationFile) return { coverage: 'declaration-file-unsupported', records: [] };
  const result = [];
  measureFunctions(source, file, (fn, node) => {
    const start = point(source, node.getStart(source));
    const finish = point(source, node.getEnd());
    result.push({ file, name: fn.name, qualname: fn.qualname, kind: ts.SyntaxKind[node.kind], ...start,
      endLine: finish.line, endColumn: finish.column, textSha256: digest(source.text.slice(node.getStart(source), node.getEnd())) });
  });
  return { coverage: 'available', records: result };
}

function callsInRange(records, range) {
  // Calls are sorted by source start. Seek to the selected definition rather
  // than scanning the whole file for every adjacent function.
  let low = 0, high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(range, records[middle].fact)) high = middle;
    else low = middle + 1;
  }
  const selected = [];
  for (let i = low; i < records.length && before(records[i].fact, end(range)); i += 1) {
    const record = records[i];
    if (record.fact.resolution === 'unresolved' && before(end(record.fact), end(range))) selected.push(record);
  }
  return selected;
}

function describeDefinition(side, definition) {
  const refs = side.references.get(key(definition.file, definition.line, definition.column, definition.name)) || [];
  const knownReferences = refs.map(record => {
    const status = !side.resolutionFresh ? 'resolution-input-changed' : side.files.get(record.fact.file)?.status || 'unverifiable';
    return { ...record, bindingAttribution: side.bindingAttribution, navigation: { status, location: status === 'valid' ? { file: record.fact.file, line: record.fact.line, column: record.fact.column, endLine: record.fact.endLine, endColumn: record.fact.endColumn } : null } };
  });
  const unresolved = callsInRange(side.calls.get(definition.file) || [], definition.sourceRange || definition);
  const unavailable = { coverage: 'unavailable', reason: 'unsupported-or-unknown-call-model', total: null, included: 0, omitted: null, limit: LIMIT, items: [] };
  const available = items => ({ coverage: 'available', ...bounded(items) });
  return { side: side.side, snapshotId: side.facts.repository.snapshotId, definition,
    knownReferences: side.callCoverage ? available(knownReferences) : { ...unavailable }, unresolvedWithinSourceRange: side.callCoverage ? { ...available(unresolved), containment: 'physical-source-range-including-nested-definitions-and-owned-headers' } : { ...unavailable } };
}

function moduleReferences(side, entry) {
  const entryStatus = side.files.get(entry)?.status || 'not-captured';
  const records = (side.importsByTarget.get(entry) || []).map(record => {
    const originStatus = side.files.get(record.fact.from)?.status || 'not-captured';
    const status = !side.resolutionFresh ? 'resolution-input-changed' : entryStatus !== 'valid' ? `entry-${entryStatus}` : originStatus;
    return { ...record, bindingAttribution: side.bindingAttribution, originStatus, entryStatus,
      navigation: { status, location: status === 'valid' ? { file: record.fact.from, line: record.fact.line } : null } };
  });
  return { side: side.side, snapshotId: side.facts.repository.snapshotId, entryStatus,
    resolvedReferences: bounded(records), unresolvedImports: side.unresolvedImports,
    unknown: 'Unresolved import destinations cannot be attributed to this entry. The count covers all captured sources, not potential consumers of this file.' };
}

function outgoingImports(side, entry) {
  const originStatus = side.files.get(entry)?.status || 'not-captured';
  const records = side.facts.imports.flatMap((fact, factIndex) => {
    if (fact.from !== entry) return [];
    const status = !side.resolutionFresh ? 'resolution-input-changed' : originStatus !== 'valid' ? `origin-${originStatus}` : !fact.resolved ? 'external-or-unresolved' : side.files.get(fact.to)?.status || 'not-captured';
    return [{ side: side.side, snapshotId: side.facts.repository.snapshotId, factIndex, fact, originStatus,
      bindingAttribution: side.bindingAttribution,
      targetNavigation: { status, location: status === 'valid' ? { file: fact.to, line: 1 } : null,
        ...(!fact.resolved ? { reason: 'external-or-unresolved-import-destination' } : {}) } }];
  });
  return { side: side.side, snapshotId: side.facts.repository.snapshotId, originStatus, ...bounded(records) };
}

function fileQuestion(sides, entry) {
  const definitionCoverage = {}, unavailableDefinitions = {};
  const slots = { base: new Map(), head: new Map() };
  for (const [name, side] of Object.entries(sides)) {
    const measured = definitions(side, entry);
    definitionCoverage[name] = measured.coverage;
    unavailableDefinitions[name] = bounded(measured.unavailable || []);
    for (const definition of measured.records) {
      const slot = key(definition.file, definition.qualname, definition.kind);
      const group = slots[name].get(slot) || [];
      group.push(definition); slots[name].set(slot, group);
    }
  }
  const changed = [], shifted = [], unpaired = [];
  for (const slot of new Set([...slots.base.keys(), ...slots.head.keys()])) {
    const a = slots.base.get(slot) || [], b = slots.head.get(slot) || [];
    if (a.length !== 1 || b.length !== 1) {
      for (const [name, defs] of [['base', a], ['head', b]]) {
        const other = sides[name === 'base' ? 'head' : 'base'].files.get(entry);
        const otherCoverage = definitionCoverage[name === 'base' ? 'head' : 'base'];
        const reason = a.length > 1 || b.length > 1 ? 'duplicate-slot' : (other && other.status !== 'valid') || otherCoverage === 'definition-regions-unavailable' ? 'counterpart-unavailable' : `${name}-only`;
        for (const definition of defs) unpaired.push({ reason, ...describeDefinition(sides[name], definition) });
      }
      continue;
    }
    if (a[0].textSha256 !== b[0].textSha256) changed.push({ pairing: 'unique-exact-source-slot', base: describeDefinition(sides.base, a[0]), head: describeDefinition(sides.head, b[0]) });
    else if (a[0].line !== b[0].line || a[0].column !== b[0].column) shifted.push({ base: { side: 'base', snapshotId: sides.base.facts.repository.snapshotId, definition: a[0] }, head: { side: 'head', snapshotId: sides.head.facts.repository.snapshotId, definition: b[0] } });
  }
  return {
    definitionCoverage, unavailableDefinitions,
    outgoingImports: { role: 'entry-file-wide source reading evidence, not selected-definition calls or execution timing', base: outgoingImports(sides.base, entry), head: outgoingImports(sides.head, entry) },
    moduleReading: {
      role: 'dependency reading locations, separate from calls; not proof of execution or affected behavior',
      base: moduleReferences(sides.base, entry), head: moduleReferences(sides.head, entry),
      factRole: 'Original records from this side/snapshot imports array. Preserve kind, typeOnly and lazy; absent typeOnly/lazy mean false. Use navigation.location only when valid.',
    },
    changedDefinitions: bounded(changed), positionOnlyDefinitions: bounded(shifted), unpairedDefinitions: bounded(unpaired),
  };
}

// Only accepts captures made by captureChangeSide in this invocation; not an
// import API for old analysis artifacts or user-supplied provenance receipts.
export function buildChangeQuestion({ question, entry, base, head, config }) {
  if (typeof question !== 'string' || !question.trim()) fail('task/question-invalid', 'Pass a nonempty --question.');
  const language = changeEntryLanguage(entry);
  const expectedConfig = digest(JSON.stringify(config));
  for (const capture of [base, head]) {
    const repo = capture.facts.repository;
    const producerMatches = language === 'ts' ? /^typescript@/.test(repo.adapter) : language === 'py' ? /^python@/.test(repo.adapter) : /^java-parser@/.test(repo.adapter);
    if (capture.language !== language || repo.language !== language || !producerMatches || capture.configDigest !== expectedConfig) fail('task/capture-mismatch', 'Both captures must use the entry language, matching producers and the same analysis configuration.');
  }
  if (base.facts.repository.adapter !== head.facts.repository.adapter || base.facts.repository.adapterRevision !== head.facts.repository.adapterRevision || base.facts.callModel !== head.facts.callModel) fail('task/capture-mismatch', 'Paired capture producers, revisions and call models must match.');
  entry = path.posix.normalize(entry.split(path.sep).join('/'));
  const sides = { base: inspectSide(base, 'base'), head: inspectSide(head, 'head') };
  const reasons = [];
  for (const [name, side] of Object.entries(sides)) {
    if (side.summary.unavailableFiles.total) reasons.push({ code: 'source-regions-unavailable', side: name, count: side.summary.unavailableFiles.total, message: 'Some captured source regions failed parsing or freshness checks; other valid regions remain available.' });
    if (!side.resolutionFresh) reasons.push({ code: 'resolution-input-changed', side: name, message: 'A configuration/package input changed after capture; call and dependency navigation for this side is unavailable.' });
  }
  const settingsEqual = sides.base.summary.resolution.digest === sides.head.summary.resolution.digest;
  const bindingAttribution = language !== 'ts' ? 'source-import-model-only' : settingsEqual && sides.base.resolutionFresh && sides.head.resolutionFresh ? 'same-observed-settings' : 'limited';
  for (const side of Object.values(sides)) side.bindingAttribution = bindingAttribution;
  const resolutionChanges = compareSettings(sides.base.settings, sides.head.settings);
  if (!settingsEqual) reasons.push({ code: 'resolution-settings-differ', message: 'Observed compiler options or configuration/package input contents differ. Binding differences cannot be attributed to source text alone.' });
  if (!sides.base.files.has(entry) && !sides.head.files.has(entry)) reasons.push({ code: 'entry-not-captured', file: entry, message: 'The entry was not captured on either side; check source path and filters.' });
  const fileChanges = [];
  for (const file of [...new Set([...sides.base.files.keys(), ...sides.head.files.keys()])].sort()) {
    const a = sides.base.files.get(file), b = sides.head.files.get(file);
    if (a?.sourceText === b?.sourceText) continue;
    fileChanges.push({ file, status: !a ? 'head-only' : !b ? 'base-only' : 'text-changed',
      base: a ? { snapshotId: base.facts.repository.snapshotId, sha256: digest(a.sourceText), status: a.status } : null,
      head: b ? { snapshotId: head.facts.repository.snapshotId, sha256: digest(b.sourceText), status: b.status } : null });
  }
  const selected = fileQuestion(sides, entry);
  if (Object.values(selected.definitionCoverage).some(coverage => ['declaration-file-unsupported', 'definition-regions-unavailable'].includes(coverage))) {
    reasons.push({ code: 'definition-regions-unsupported', count: 1 });
  }
  return {
    kind: 'archify-change-question', stage: 'orientation-only', status: reasons.length ? 'partial' : 'ready', question: question.trim(), entry,
    workflow: 'docs/FUNCTION-ANALYSIS.md', language, capture: 'fresh-pair; same current language extractor and effective analysis configuration',
    analysisConfigDigest: digest(JSON.stringify(config)),
    sides: { base: sides.base.summary, head: sides.head.summary },
    comparison: { sourceText: 'reading-signals-only', bindingAttribution, reasons, resolutionChanges },
    fileChanges: bounded(fileChanges), ...selected,
    limitations: [
      'File changes cover captured sources of the selected entry language only. Documents, excluded files and other languages are not checked; absence here is not evidence of no change. Definitions are selected only in the entry file; references search all captured files.',
      'Unique file + qualified name + syntax kind slots pair reading locations, not persistent entities. Renames and moves are never inferred. Function text changes, including formatting, do not prove semantic change; identical text shifted in position is reported separately.',
      'Known references are conservative lexical callsites, not runtime callers or complete/transitive impact. Member/dynamic dispatch, constructors and tagged templates remain outside binding coverage. Unresolved calls inside source ranges can include nested closures and owned decorators/headers. Python python-lexical-v1 targets only ordinary undecorated module definitions or direct from-import aliases; decorated/method targets remain unsupported. Java java-static-lexical-v1 inventories method invocations and binds only bounded same-file static source candidates; overloads, member dispatch and inherited owners remain unresolved. Argument type applicability and compilation are not checked. Historical unrecognized models remain unavailable with unknown totals.',
      'Coordinates and factIndex belong to the named side/snapshot only. Original facts are captured evidence; use navigation.location only when valid. No whole-tree atomic capture or live re-resolution after capture is claimed.',
      'Observed resolution settings include compiler options and actually read configuration/package contents. Differences conservatively limit binding attribution, even for irrelevant config text edits. Matching settings do not prove matching runtime environments; added source candidates can change resolution.',
      'Every list is bounded with total/included/omitted. Git metadata is background; captured text and freshness checks establish source identity, including uncommitted edits.',
    ],
    nextSteps: [
      'Read the changed source and the known callsite in each named side; inspect unresolved calls, adapter/configuration inputs and omitted regions relevant to the question.',
      'Explain the behavior from source and appropriate project checks. Keep inference and unknowns explicit; this orientation is not a completed change review.',
    ],
  };
}

export function captureChangeQuestion({ question, entry, baseRoot, root, configPath = null }) {
  const language = changeEntryLanguage(entry);
  const config = loadConfig(configPath);
  const base = captureChangeSide(baseRoot, config, language);
  const head = captureChangeSide(root, config, language);
  return buildChangeQuestion({ question, entry, base, head, config });
}

export function renderChangeQuestionMarkdown(brief) {
  // Keep every bounded evidence record available to the host Agent in either
  // output format, without maintaining a second selection/interpretation path.
  return `# Change question orientation\n\n${brief.question}\n\nStatus: ${brief.status}${brief.status === 'partial' ? ' (capture/configuration limits, not a finding gate)' : ''}. Read ${brief.workflow} and complete the analysis.\n\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\`\n`;
}
