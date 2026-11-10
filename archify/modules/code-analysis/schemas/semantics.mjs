import { rangeText, validSourceRange } from '../core/index.mjs';
import { createHash } from 'node:crypto';

// Schema validation checks shape; these checks protect graph identity and
// references. Keep errors in the same structured format as AJV diagnostics.
//
// The checks run in a fixed order and callers keep only the first errors, so
// the order below is part of the contract: add a check where it belongs in the
// sequence, not at the end of the file.
export function semanticErrors(name, data) {
  const report = createReport();
  if (name === 'baseline') report.unique(data.accepted, 'id', '/accepted');
  if (name === 'raw-facts') rawFactsErrors(data, report);
  if (name === 'module-graph') moduleGraphErrors(data, report);
  return report.errors;
}

function createReport() {
  const errors = [];
  const add = (path, message, params = {}) => errors.push({ path, message, params });
  const unique = (items, key, prefix) => {
    const seen = new Set();
    items.forEach((item, i) => {
      const value = item[key];
      if (seen.has(value)) add(`${prefix}/${i}/${key}`, `must be unique: ${value}`, { value });
      seen.add(value);
    });
    return seen;
  };
  return { errors, add, unique };
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const pointKey = (file, point) => JSON.stringify([file, point.name, point.line, point.column]);
const isPoint = (point) => Number.isInteger(point.line) && point.line >= 1 && Number.isInteger(point.column) && point.column >= 1;

// Call models this validator recognizes, per language: the model name without
// its version suffix and the newest version. A capture's version is 0 when its
// callModel is missing, unrecognized or belongs to another language, so
// "needs version N" is one comparison. When an extractor adds a model version,
// raise the number here.
const CALL_MODELS = {
  py: { prefix: 'python-lexical', latest: 2 },
  java: { prefix: 'java-static-lexical', latest: 5 },
  go: { prefix: 'go-source-direct', latest: 4 },
  rust: { prefix: 'rust-source-direct', latest: 14 },
};

function callModelVersions(data) {
  const versions = { py: 0, java: 0, go: 0, rust: 0 };
  const language = data.repository.language;
  if (!Object.hasOwn(CALL_MODELS, language)) return versions;
  const { prefix, latest } = CALL_MODELS[language];
  for (let version = 1; version <= latest; version += 1) {
    if (data.callModel === `${prefix}-v${version}`) versions[language] = version;
  }
  return versions;
}

// A call resolution that only a given language's model version can produce.
const RESOLUTION_MODELS = new Map([
  ['java-qualified-static-method', ['java', 2, 'requires the Java v2 source model']],
  ['rust-inherent-source-candidate', ['rust', 2, 'requires the Rust v2 inherent source-candidate model']],
  ['rust-specialized-inherent-source-candidate', ['rust', 3, 'requires the Rust v3 concrete-specialization source-candidate model']],
  ['rust-lifetime-inherent-source-candidate', ['rust', 4, 'requires the Rust v4 lifetime-only inherent source-candidate model']],
  ['rust-direct-function', ['rust', 1, 'requires the Rust source-direct model']],
  ['rust-trait-impl', ['rust', 5, 'requires the Rust v5 trait impl model']],
  ['rust-trait-method-candidate', ['rust', 5, 'requires the Rust v5 trait candidate model']],
  ['go-direct-method', ['go', 2, 'requires the Go v2 concrete-method model']],
  ['go-interface-method', ['go', 3, 'requires the Go v3 interface-declaration model']],
  ['go-direct-function', ['go', 1, 'requires the Go source-direct model']],
]);

function rawFactsErrors(data, report) {
  const { add } = report;
  const unresolved = data.imports.filter((edge) => !edge.resolved).length;
  if (Object.values(data.unresolved).reduce((sum, count) => sum + count, 0) !== unresolved) {
    add('/unresolved', 'counter total must match unresolved imports');
  }
  const files = report.unique(data.files, 'path', '/files');
  recordedFileErrors(data, files, add);

  const model = callModelVersions(data);
  if (model.go >= 3 && !data.languageScope?.standardLibrary) add('/languageScope/standardLibrary', 'requires recorded Go v3 SDK scope');
  const sourceTexts = new Map(data.files.map((file) => [file.path, file.sourceText]));
  const metadata = javaProjectMetadata(data, files, model, report);

  functionRangeErrors(data, sourceTexts, model, add);
  // Java build metadata is not a source file, but call evidence may point into it.
  for (const input of metadata.values()) sourceTexts.set(input.file, input.sourceText);

  const traitDeclarations = traitDeclarationPoints(data, files, add);
  const context = callContext(data, { files, model, sourceTexts, metadata, traitDeclarations, add });
  data.calls.forEach((call, i) => callErrors(call, `/calls/${i}`, context));
  data.parse_errors?.forEach((error, i) => {
    if (!files.has(error.path)) add(`/parse_errors/${i}/path`, 'must reference a recorded file');
  });
}

function recordedFileErrors(data, files, add) {
  data.imports.forEach((edge, i) => {
    if (!files.has(edge.from)) add(`/imports/${i}/from`, 'must reference a recorded file');
    if (edge.resolved && !files.has(edge.to)) add(`/imports/${i}/to`, 'must reference a recorded file');
  });
  data.symbols.forEach((symbol, i) => {
    if (!files.has(symbol.file)) add(`/symbols/${i}/file`, 'must reference a recorded file');
  });
  data.functions?.forEach((fn, i) => {
    if (!files.has(fn.file)) add(`/functions/${i}/file`, 'must reference a recorded file');
    if (fn.endLine < fn.line) add(`/functions/${i}/endLine`, 'must not precede line');
    if (fn.deepestLine < fn.line || fn.deepestLine > fn.endLine) add(`/functions/${i}/deepestLine`, 'must lie inside the function');
  });
}

// Java v5 records the build files that declare project scope, separately from
// source files. Returns them by path; empty for every other model.
function javaProjectMetadata(data, files, model, { add, unique }) {
  if (model.java !== 5) return new Map();
  if (data.languageScope?.language !== 'java') add('/languageScope', 'requires Java v5 declared project scope');
  unique(data.languageScope?.metadata || [], 'file', '/languageScope/metadata');
  const metadata = new Map((data.languageScope?.metadata || []).map((input) => [input.file, input]));
  for (const input of metadata.values()) {
    if (files.has(input.file) || sha256(input.sourceText) !== input.sha256) add('/languageScope/metadata', 'must contain separate captured metadata with matching hashes');
  }
  return metadata;
}

const DEFINITION_LANGUAGE = { FunctionDef: 'py', AsyncFunctionDef: 'py', FuncDecl: 'go', InterfaceMethod: 'go', RustItemFn: 'rust' };

function functionRangeErrors(data, sourceTexts, model, add) {
  const language = data.repository.language;
  const exactRanges = model.py || model.java || model.go || model.rust;
  data.functions?.forEach((fn, i) => {
    if ((exactRanges || fn.sourceRange) && !validSourceRange(sourceTexts.get(fn.file), fn, language)) add(`/functions/${i}/sourceRange`, 'must match exact captured definition range and digest');
    if (fn.definition && !validDefinitionExtent(fn, sourceTexts.get(fn.file), language)) {
      add(`/functions/${i}/definition/sourceRange`, 'must match exact captured owned definition extent and digest');
    }
  });
}

// The owned extent (decorators, attributes, doc headers) must hash to its
// recorded digest, belong to this language, and enclose the function range:
// start at or before it and end exactly with it.
function validDefinitionExtent(fn, sourceText, language) {
  const { kind, sourceRange: range } = fn.definition;
  const slice = rangeText(sourceText, range, language);
  if (slice === null || sha256(slice) !== range.sha256) return false;
  if (range.line > fn.line || range.endLine !== fn.endLine) return false;
  const expected = Object.hasOwn(DEFINITION_LANGUAGE, kind) ? DEFINITION_LANGUAGE[kind] : 'java';
  if (language !== expected) return false;
  const inner = fn.sourceRange;
  if (!inner) return true;
  const startsAfter = range.line > inner.line || (range.line === inner.line && range.column > inner.column);
  return !startsAfter && range.endLine === inner.endLine && range.endColumn === inner.endColumn;
}

// Validates trait records and returns every trait method declaration point,
// which trait-related call evidence must match.
function traitDeclarationPoints(data, files, add) {
  const declarations = new Set();
  const captured = (point) => point && files.has(point.file) && isPoint(point);
  for (const [i, decl] of (data.traits || []).entries()) {
    if (!captured(decl.declaration)) add(`/traits/${i}/declaration`, 'must reference a valid captured declaration point');
    for (const [j, method] of (decl.methods || []).entries()) {
      if (!captured(method)) add(`/traits/${i}/methods/${j}`, 'must reference a valid captured declaration point');
      declarations.add(pointKey(method.file, method));
    }
  }
  for (const [i, edge] of (data.traitImplementations || []).entries()) {
    for (const part of ['trait', 'traitMethod', 'implementation']) {
      if (!captured(edge[part])) add(`/traitImplementations/${i}/${part}`, 'must reference a valid captured declaration point');
    }
    if (edge.traitMethod) declarations.add(pointKey(edge.traitMethod.file, edge.traitMethod));
  }
  return declarations;
}

// Lookups shared by every call check, built once per document.
function callContext(data, { files, model, sourceTexts, metadata, traitDeclarations, add }) {
  // Each producer counts lines by its own language's line terminators.
  const lineBreak = model.go || model.rust ? /\n/ : model.py ? /\r\n|[\n\r]/ : /\r\n|[\n\r\u2028\u2029]/;
  const sourceLines = new Map();
  const validPoint = (file, point, exclusive = false) => {
    if (!sourceLines.has(file)) sourceLines.set(file, sourceTexts.get(file)?.split(lineBreak));
    const lines = sourceLines.get(file);
    return lines && point.line <= lines.length && point.column <= lines[point.line - 1].length + (exclusive ? 1 : 0);
  };
  const brokenFiles = new Set((data.parse_errors || []).map((error) => error.path));
  const staticImports = new Map();
  for (const edge of data.imports) if (edge.resolved && edge.kind === 'static' && !edge.typeOnly) {
    if (!staticImports.has(edge.from)) staticImports.set(edge.from, new Set());
    staticImports.get(edge.from).add(edge.to);
  }
  const forwardingModel = data.repository.language === 'ts' && /^typescript@/.test(data.repository.adapter) && data.callModel === 'js-ts-lexical-v5';
  const valueImportLines = forwardingModel ? new Set(data.imports.filter((edge) => edge.resolved && ['static', 'export'].includes(edge.kind) && !edge.typeOnly).map((edge) => JSON.stringify([edge.from, edge.line, edge.to]))) : null;
  const functions = data.functions || [];
  return {
    add, files, model, metadata, traitDeclarations, validPoint, brokenFiles, staticImports, forwardingModel, valueImportLines,
    functionStarts: new Set(functions.map((fn) => JSON.stringify([fn.file, fn.name, fn.line]))),
    functionPoints: new Set(functions.map((fn) => JSON.stringify([fn.file, fn.name, fn.sourceRange?.line, fn.sourceRange?.column]))),
    // A point in a captured, parse-valid file that lies inside its source.
    capturedPoint: (point) => files.has(point.file) && !brokenFiles.has(point.file) && validPoint(point.file, point),
  };
}

function callErrors(call, at, context) {
  callSiteErrors(call, at, context);
  if (call.defaultMethod) defaultMethodErrors(call, at, context);
  if (call.macroTemplate) macroTemplateErrors(call, at, context);
  if (call.closure) closureErrors(call, at, context);
  callProvenanceErrors(call, at, context);
  if (call.target) callTargetErrors(call, at, context);
}

function callSiteErrors(call, at, { add, files, validPoint, brokenFiles }) {
  if (!files.has(call.file)) add(`${at}/file`, 'must reference a recorded file');
  else if (!validPoint(call.file, call)) add(at, 'callsite must lie inside captured source');
  if (!validPoint(call.file, { line: call.endLine, column: call.endColumn }, true)) add(at, 'call end must lie inside captured source or at EOF');
  if (call.endLine < call.line || (call.endLine === call.line && call.endColumn <= call.column)) add(at, 'call end must follow its start');
  if (brokenFiles.has(call.file)) add(at, 'calls must be omitted for files with parse errors');
}

function defaultMethodErrors(call, at, { add, model, capturedPoint, traitDeclarations }) {
  const method = call.defaultMethod;
  if (model.rust < 6) add(`${at}/defaultMethod`, 'requires the Rust v6+ trait default-body model');
  else if (!capturedPoint(method) || !traitDeclarations.has(pointKey(method.file, method))) add(`${at}/defaultMethod`, 'must match a captured trait method declaration');
}

function macroTemplateErrors(call, at, { add, model, capturedPoint, validPoint }) {
  const { definition, expansions } = call.macroTemplate;
  if (model.rust < 12) add(`${at}/macroTemplate`, 'requires the Rust v12+ impl-body macro provenance model');
  if (!capturedPoint(definition)) add(`${at}/macroTemplate/definition`, 'must reference a valid captured macro definition point');
  const origins = new Set();
  for (const [j, expansion] of expansions.entries()) {
    const origin = JSON.stringify([expansion.file, expansion.line, expansion.column, expansion.implLine, expansion.implColumn]);
    if (origins.has(origin)) add(`${at}/macroTemplate/expansions/${j}`, 'must contain distinct expansion origins');
    origins.add(origin);
    if (!capturedPoint(expansion) || !validPoint(expansion.file, { line: expansion.implLine, column: expansion.implColumn })) add(`${at}/macroTemplate/expansions/${j}`, 'must reference valid captured invocation and impl points');
  }
}

function closureErrors(call, at, { add, model, files, brokenFiles, validPoint }) {
  if (model.rust < 13) add(`${at}/closure`, 'requires the Rust v13+ closure-parameter model');
  const point = call.closure;
  if (!files.has(point.file) || point.file !== call.file || brokenFiles.has(point.file) || !validPoint(point.file, point)) add(`${at}/closure`, 'must reference a valid closure point in the callsite file');
}

// Evidence about how a call was reached, each tied to the model that records it.
function callProvenanceErrors(call, at, { add, model, metadata, validPoint, capturedPoint, forwardingModel }) {
  if (call.directCaller?.kind === 'macro-generated-method' && model.rust < 11) add(`${at}/directCaller/kind`, 'requires the Rust v11+ impl-body macro model');
  if (call.reason === 'java-inherited-build-scope' && model.java < 4) add(`${at}/reason`, 'requires the Java v4 inherited-context model');
  const qualified = call.resolution === 'java-qualified-static-method';
  if (call.buildEvidence) {
    if (model.java !== 5 || !qualified) add(`${at}/buildEvidence`, 'requires a qualified Java v5 project-source candidate');
    for (const point of call.buildEvidence) if (!metadata.has(point.file) || !validPoint(point.file, point)) add(`${at}/buildEvidence`, 'must reference a captured POM source point');
  }
  if (call.qualifierAncestry) {
    if (model.java < 4 || !qualified) add(`${at}/qualifierAncestry`, 'requires a qualified call under Java v4');
    const points = new Set();
    for (const point of call.qualifierAncestry) {
      const key = JSON.stringify(point);
      if (points.has(key) || !capturedPoint(point)) add(`${at}/qualifierAncestry`, 'must contain distinct valid captured ancestor points');
      points.add(key);
    }
  }
  if (call.via && (!forwardingModel || call.resolution !== 'imported-function')) add(`${at}/via`, 'requires an imported call under the JS/TS v5 forwarding model');
}

function callTargetErrors(call, at, context) {
  const { add, model, validPoint, traitDeclarations, functionPoints, functionStarts } = context;
  const targetFile = call.target.file || call.file;
  const traitCandidate = call.resolution === 'rust-trait-method-candidate';
  const required = RESOLUTION_MODELS.get(call.resolution);
  if (required && model[required[0]] < required[1]) add(`${at}/resolution`, required[2]);
  if (call.resolution === 'imported-function') importedTargetErrors(call, at, targetFile, context);
  if (traitCandidate && !traitDeclarations.has(pointKey(targetFile, call.target))) add(`${at}/target`, 'must match a captured trait method declaration');
  if (!validPoint(targetFile, call.target)) add(`${at}/target`, 'target must lie inside captured source');
  // A trait candidate points at a declaration, which need not be a measured function.
  if (traitCandidate) return;
  if ((model.py || model.java || model.go || model.rust) && !functionPoints.has(pointKey(targetFile, call.target))) add(`${at}/target`, 'must match a captured definition start');
  if (!functionStarts.has(JSON.stringify([targetFile, call.target.name, call.target.line]))) add(`${at}/target`, 'target must reference a recorded function in its target file');
}

// An imported target must be reachable from the call's file: directly, through
// one Python v2 re-export, or along the recorded JS/TS v5 forwarding path.
function importedTargetErrors(call, at, targetFile, context) {
  const { add, model, brokenFiles, staticImports, forwardingModel } = context;
  const direct = staticImports.get(call.file)?.has(targetFile);
  let forwarded = model.py === 2 && [...(staticImports.get(call.file) || [])].some((via) => !brokenFiles.has(via) && staticImports.get(via)?.has(targetFile));
  if (call.via && forwardingModel) {
    forwarded = followsForwardingPath(call, targetFile, context);
    if (!forwarded) add(`${at}/via`, 'must follow an acyclic recorded value import/export path at captured source points');
  }
  if (targetFile === call.file || (!direct && !forwarded)) add(`${at}/target/file`, 'must follow a recorded static import or supported reexport to another captured file');
  if (brokenFiles.has(targetFile)) add(`${at}/target`, 'target file must have no parse errors');
}

function followsForwardingPath(call, targetFile, { staticImports, capturedPoint, valueImportLines }) {
  const route = [call.file, ...call.via.map((point) => point.file), targetFile];
  if (new Set(route).size !== route.length || !staticImports.get(call.file)?.has(route[1])) return false;
  return call.via.every((point, index) => capturedPoint(point) && valueImportLines.has(JSON.stringify([point.file, point.line, route[index + 2]])));
}

function moduleGraphErrors(data, { add, unique }) {
  const ids = unique(data.modules, 'id', '/modules');
  const pairs = new Set();
  data.edges.forEach((edge, i) => {
    for (const key of ['from', 'to']) if (!ids.has(edge[key])) add(`/edges/${i}/${key}`, 'must reference an existing module');
    if (edge.from === edge.to) add(`/edges/${i}`, 'must connect two distinct modules');
    const pair = JSON.stringify([edge.from, edge.to]);
    if (pairs.has(pair)) add(`/edges/${i}`, 'must be aggregated into one edge per module pair');
    pairs.add(pair);
  });
  if (!data.fileModules) return;
  const counts = new Map();
  for (const [file, id] of Object.entries(data.fileModules).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!ids.has(id)) add('/fileModules', 'must reference an existing module', { file, id });
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  data.modules.forEach((m, i) => {
    if ((counts.get(m.id) || 0) !== m.files) add(`/modules/${i}/files`, 'must match fileModules ownership count');
    if (m.entry.some((file) => data.fileModules[file] !== m.id)) add(`/modules/${i}/entry`, 'must belong to this module');
  });
  data.edges.forEach((e, i) => e.evidence.forEach((v, j) => {
    if (data.fileModules[v.file] !== e.from || data.fileModules[v.to] !== e.to) add(`/edges/${i}/evidence/${j}`, 'must agree with fileModules ownership');
  }));
}
