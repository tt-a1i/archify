// TypeScript Compiler API adapter (JS + TS via allowJs). A no-resolution
// Program supplies imports and conservative lexical call bindings.
// Calls do not establish execution or runtime dispatch.
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeTypeScriptText } from '../../core/index.mjs';
import { classifyRole, lineCount, listFiles, snapshotTree, toPosix, packageMarkersIn } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';
import { snapshotHostTools } from './snapshot-host.mjs';
import { runtimePackageTools } from './runtime-package-target.mjs';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';
import { functionTools } from './functions.mjs';
import { CALL_MODEL, callTools } from './calls.mjs';
import { importedCallTools } from './imported-calls.mjs';
import { selectTypeScripts } from './sdk.mjs';
import { syntaxNodes } from './syntax-walk.mjs';

export const id = 'ts';
// Revision of this adapter's own extraction logic, recorded as
// repository.adapterRevision. Bump it when the same sources can yield different
// raw facts (see docs/TECH-GUIDE.md, "Extractor revisions").
export const REVISION = 30;

const SOURCE_EXT = /\.(?:[mc]?[jt]s|[jt]sx)$/;
// Placeholder specifier for import()/require() calls whose argument is not a string literal.
export const OPAQUE = '<computed>';

export function detect(root, config) {
  return listFiles(root, config).some((f) => SOURCE_EXT.test(f));
}

export function countSources(root, config) {
  return listFiles(root, config).filter((f) => SOURCE_EXT.test(f)).length;
}

export function extract(root, config, { onCapture, capturedOnly = false } = {}) {
  const absRoot = path.resolve(root);
  const include = matcher(config.include), exclude = matcher(config.exclude);
  const selected = file => SOURCE_EXT.test(file) && include(file) && !exclude(file)
    && !file.split('/').slice(0, -1).some((_, i, parts) => exclude(`${parts.slice(0, i + 1).join('/')}/`));
  const snapshot = snapshotTree(absRoot, file => selected(file) || file.endsWith('.json'));
  const sdkGroups = selectTypeScripts(absRoot, snapshot, config, selected, { capturedOnly });
  const mixedSdks = sdkGroups.length > 1;
  const segments = sdkGroups.map(({ sdk, files }) => {
    const engine = createExtractor(sdk.ts);
    return { sdk, engine, prepared: engine.prepare(absRoot, files, snapshot, { capturedOnly, mixedSdks }) };
  });
  if (!capturedOnly && config.typescript?.requireProjectSdk) {
    const missing = segments.find(segment => segment.prepared.projects.length && segment.sdk.status === 'fallback');
    if (missing) fail('extract/typescript-sdk-required', 'A captured project has no installed TypeScript SDK.', {
      subject: { root: absRoot, file: missing.prepared.projects[0].files[0] },
      supportedFixes: ['install TypeScript 5.6–6.0 in the trusted project for "auto" discovery', 'set typescript.sdk to a validated package path you trust', 'disable typescript.requireProjectSdk to allow "bundled"'],
    });
  }
  const fileSet = new Set(segments.flatMap(segment => segment.prepared.projects.flatMap(project => project.files)));
  const results = segments.map(segment => {
    const facts = segment.engine.run(absRoot, config, { snapshot, sdk: segment.sdk, prepared: segment.prepared,
      fileSet, capturedOnly });
    return { ...segment, facts };
  });
  for (const { prepared } of segments) prepared.inputs.assertUnchanged();
  const reads = new Map();
  for (const { prepared } of segments) for (const [file, value] of prepared.inputs.reads) {
    if (reads.has(file) && reads.get(file) !== value) fail('extract/source-changed', 'A TypeScript resolution input changed between project captures.', { subject: { file } });
    reads.set(file, value);
  }
  const sdkRecord = sdk => {
    const relative = sdk.packagePath && path.relative(fs.realpathSync(absRoot), sdk.packagePath);
    const inside = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    const packagePath = sdk.packagePath ? (inside ? toPosix(relative) : sdk.packagePath) : null;
    return { version: sdk.version, source: sdk.source, status: sdk.status, packagePath };
  };
  if (onCapture) {
    const projects = results.flatMap(({ sdk, prepared }) => prepared.projects.map(project => ({
      config: project.config, options: project.options,
      ...(results.length > 1 ? { sdkVersion: sdk.version, sdk: sdkRecord(sdk) } : {}),
    })));
    projects.sort((a, b) => compareText(a.config ?? '', b.config ?? '')
      || compareText(JSON.stringify(a.sdk), JSON.stringify(b.sdk)));
    onCapture({ options: results.length === 1 && projects.length === 1 ? projects[0].options : projects, reads });
    for (const { prepared } of segments) prepared.inputs.assertUnchanged();
  }
  const base = results[0].facts;
  const projects = results.flatMap(({ facts, sdk }, sdkIndex) => facts.languageScope.projects.map(project => ({ ...project, sdkIndex, sdkVersion: sdk.version })));
  const combined = { ...base,
    repository: { ...base.repository, adapter: results.length === 1 ? base.repository.adapter : 'typescript@multi' },
    languageScope: { language: 'ts', sdk: results.length === 1 ? base.languageScope.sdk : { version: 'multi', source: 'multi', status: 'matched' },
      sdks: results.map(({ sdk }) => sdkRecord(sdk)), projects,
      excludedByProject: [],
      limitations: [...new Set([...results.flatMap(({ sdk }) => sdk.limitations), ...(projects.length > 1
        ? ['Call targets follow captured members of the caller Program. Cross-SDK targets and forwarding paths that disagree with recorded owner imports remain unresolved.'] : [])])] },
    files: results.flatMap(({ facts }) => facts.files).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    imports: results.flatMap(({ facts }) => facts.imports).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line),
    functions: results.flatMap(({ facts }) => facts.functions).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
    calls: results.flatMap(({ facts }) => facts.calls).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column),
    unresolved: Object.fromEntries(Object.keys(base.unresolved).map(key => [key, results.reduce((sum, { facts }) => sum + facts.unresolved[key], 0)])),
  };
  const parseErrors = results.flatMap(({ facts }) => facts.parse_errors || []).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (parseErrors.length) combined.parse_errors = parseErrors;
  else delete combined.parse_errors;
  return combined;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function createExtractor(ts) {
const { snapshotHost } = snapshotHostTools(ts);
const { runtimePackageTarget } = runtimePackageTools(ts);
const { isShortCircuitExpression, measureFunctions } = functionTools(ts);
const { callsite } = callTools(ts);
const { importedCallTarget, commonJsCallTarget, isRequireCall } = importedCallTools(ts);

const COMPILER_OPTIONS = {
  allowJs: true,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  allowImportingTsExtensions: true,
};

function prepare(root, files, snapshot, { capturedOnly, mixedSdks }) {
  const inputs = snapshotHost(root, snapshot, { capturedOnly });
  return { inputs, ...configuredProjects(root, files, inputs, snapshot, mixedSdks) };
}

// Both project membership and lexical extraction read the same captured source
// bytes. External metadata can resolve a module, but cannot add source facts.
function sourceProgram(root, files, options, inputs, snapshot) {
  const programOptions = { ...options, noLib: true, types: [] };
  const host = ts.createCompilerHost(programOptions);
  host.readFile = file => {
    const data = snapshot.contents.get(toPosix(path.relative(root, file)));
    return data === undefined ? undefined : file.endsWith('.json') ? inputs.readFile(file) : decodeTypeScriptText(data, true);
  };
  host.fileExists = inputs.fileExists;
  host.directoryExists = inputs.directoryExists;
  host.getDirectories = inputs.getDirectories;
  host.getCurrentDirectory = inputs.getCurrentDirectory;
  host.realpath = inputs.realpath;
  host.getSourceFile = (file, version) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, version, true);
  };
  return ts.createProgram(files.map(file => path.join(root, file)), programOptions, host);
}

function run(root, config, { snapshot, sdk, prepared, fileSet, capturedOnly }) {
  const absRoot = path.resolve(root);
  const { inputs, projects } = prepared;
  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  const fileRecords = [];
  const functions = [];
  const calls = [];
  const parseErrors = [];
  const bindings = [], ownerImports = new Map();

  for (const project of projects) {
    const options = project.options;
    const owned = new Set(project.files);
    const program = sourceProgram(absRoot, project.members, { ...options, noResolve: true }, inputs, snapshot);
    const checker = program.getTypeChecker();
    const pendingCalls = [];
    const importTargets = new Map();
    const sources = new Map();
    for (const rel of project.members) {
      const abs = path.join(absRoot, rel);
      const source = program.getSourceFile(abs);
      // TypeScript recovers from syntax errors and returns a partial tree, so a broken
      // file can silently lose its imports and functions. Record it like Python's
      // parse_errors: coverage shows it, and run comparisons treat it as a scope change.
      const syntax = program.getSyntacticDiagnostics(source);
      if (owned.has(rel) && syntax.length) {
        const first = syntax[0];
        const line = first.start === undefined ? null : source.getLineAndCharacterOfPosition(first.start).line + 1;
        parseErrors.push({ path: rel, message: `${line ? `line ${line}: ` : ''}${ts.flattenDiagnosticMessageText(first.messageText, ' ')}${syntax.length > 1 ? ` (+${syntax.length - 1} more)` : ''}` });
      }
      if (owned.has(rel)) fileRecords.push({ path: rel, loc: lineCount(source.text), role: classifyRole(rel, config.roles), sourceText: source.text });
      const functionRecords = new Map();
      const measured = source.isDeclarationFile ? [] : measureFunctions(source, rel, (record, node) => functionRecords.set(node, record));
      if (owned.has(rel)) functions.push(...measured);
      sources.set(rel, { source, functionRecords, valid: !syntax.length && !source.isDeclarationFile });
      for (const found of collectImports(source, checker, options, !owned.has(rel) || syntax.length || source.isDeclarationFile ? null : (node) => pendingCalls.push({ node, source, rel, functionRecords }))) {
        const record = { from: rel, specifier: found.specifier, kind: found.kind, line: found.line, resolved: false };
        if (found.names.length) record.names = found.names;
        if (found.lazy) record.lazy = true;
        if (found.conditional) record.conditional = true;
        if (source.isDeclarationFile || found.typeOnly) record.typeOnly = true;
        // The compiler does not recognize createRequire aliases as require usage.
        const mode = found.kind === 'require' && found.statement ? ts.ModuleKind.CommonJS
          : program.getModeForUsageLocation(source, found.usage);
        const target = found.opaque ? { reason: 'opaque' } : resolve(record, abs, absRoot, fileSet, options, inputs, mode);
        if (target.to) {
          record.to = target.to; record.resolved = true;
          if (found.statement) importTargets.set(found.statement, target.to);
          if (owned.has(rel) && found.statement && !record.typeOnly) {
            const point = source.getLineAndCharacterOfPosition(found.statement.getStart(source));
            ownerImports.set(JSON.stringify([rel, point.line + 1, point.character + 1]), target.to);
          }
        } else if (owned.has(rel)) unresolved[target.reason] += 1;
        if (owned.has(rel)) imports.push(record);
      }
    }

    for (const { node, source, rel, functionRecords } of pendingCalls) {
      const call = callsite(node, source, rel, checker, functionRecords);
      const candidate = call.reason === 'no-local-function-binding' && ts.isIdentifier(node.expression);
      const target = candidate ? importedCallTarget(node, source, checker, importTargets, sources) : null;
      const commonJs = candidate && !target ? commonJsCallTarget(node, source, rel, checker, importTargets, sources) : null;
      if (!target && !commonJs) { calls.push(call); continue; }
      const { reason, ...record } = call;
      const bound = target ? { ...record, resolution: 'imported-function', ...target }
        : { ...record, resolution: 'commonjs-function', target: commonJs };
      const point = bound.target;
      const measurement = [...sources.get(point.file).functionRecords.values()].find(fn => fn.name === point.name
        && fn.sourceRange.line === point.line && fn.sourceRange.column === point.column);
      // Keep only plain evidence after this Program, so checkers/ASTs do not
      // accumulate while the other owners produce their canonical facts.
      bindings.push({ bound, fallback: call, measurement });
    }
  }

  const broken = new Set(parseErrors.map(error => error.path));
  const canonical = new Map(functions.map(fn => [JSON.stringify([fn.file, fn.name, fn.sourceRange.line, fn.sourceRange.column]), fn]));
  for (const { bound, fallback, measurement } of bindings) {
    const target = bound.target;
    const recorded = canonical.get(JSON.stringify([target.file, target.name, target.line, target.column]));
    const sameBody = recorded && measurement && !broken.has(target.file) && recorded.syntaxKind === measurement.syntaxKind
      && JSON.stringify(recorded.sourceRange) === JSON.stringify(measurement.sourceRange);
    // A shared barrel is resolved with caller options, while its saved graph
    // edge belongs to its owner. Do not emit a route the facts cannot support.
    const sameRoute = (bound.via || []).every((via, index, path) => !broken.has(via.file)
      && ownerImports.get(JSON.stringify([via.file, via.line, via.column])) === (path[index + 1]?.file || target.file));
    calls.push(sameBody && sameRoute ? bound : fallback);
  }

  imports.sort((a, b) => compareText(a.from, b.from) || a.line - b.line || compareText(a.specifier, b.specifier));

  inputs.assertUnchanged();
  // Markers come from the frozen inventory, like every other resolution input.
  const packageMarkers = packageMarkersIn(snapshot.names, config);
  const repo = capturedOnly
    ? { revision: null, baseRevision: null, sourceKind: 'working-tree', root: '.', url: null }
    : describeRepository(absRoot);
  return {
    schema_version: 1,
    repository: { ...repo, language: 'ts', adapter: `typescript@${ts.version}`, adapterRevision: REVISION },
    languageScope: { language: 'ts', sdk: { version: sdk.version, source: sdk.source, status: sdk.status },
      projects: projects.map(({ config, optionsDigest, selectionDigest, files, members }) => ({
        config, optionsDigest, ...(selectionDigest ? { selectionDigest } : {}), files, members,
      })),
      excludedByProject: [], limitations: [...sdk.limitations, ...(projects.length > 1
        ? ['Call targets follow captured members of the caller Program. Cross-SDK targets and forwarding paths that disagree with recorded owner imports remain unresolved.'] : [])] },
    files: fileRecords,
    packageMarkers,
    imports,
    symbols: [],
    functions: functions.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.qualname, b.qualname)),
    callModel: CALL_MODEL,
    calls: calls.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || a.column - b.column),
    ...(parseErrors.length ? { parse_errors: parseErrors } : {}),
    unresolved,
  };
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Assign selected sources to configured projects or inferred-project defaults. */
function configuredProjects(root, files, inputs, snapshot, mixedSdks) {
  const parsed = new Map();
  const groups = new Map();
  const owners = [];
  const groupFiles = new Set(files);
  const followReferences = references => {
    for (const reference of references || []) {
      const referenced = ts.resolveProjectReferencePath(reference);
      if (inputs.fileExists(referenced)) loadConfig(toPosix(path.relative(root, referenced)));
    }
  };
  const loadConfig = relative => {
    if (parsed.has(relative)) return parsed.get(relative);
    const file = path.join(root, relative);
    const loaded = ts.readConfigFile(file, inputs.readFile);
    inputs.assertUnchanged();
    if (loaded.error) fail('extract/tsconfig-invalid', 'Cannot read a TypeScript project configuration.', { subject: { file } });
    const result = ts.parseJsonConfigFileContent(loaded.config, inputs, path.dirname(file), undefined, file);
    inputs.assertUnchanged();
    const roots = result.fileNames.map(name => toPosix(path.relative(root, name)))
      .filter(name => snapshot.contents.has(name));
    // Configs serve the SDK groups whose sources they select as roots. Parsing
    // returns those roots and references even when this SDK rejects an option.
    // Follow foreign solutions and references without applying their options.
    if (mixedSdks && !roots.some(name => groupFiles.has(name))) {
      parsed.set(relative, null);
      followReferences(result.projectReferences);
      return null;
    }
    const errors = result.errors.filter(error => ![18002, 18003].includes(error.code));
    if (errors.length) fail('extract/tsconfig-invalid', 'Invalid TypeScript project configuration.', {
      subject: { file }, evidence: { errors: errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')) },
    });
    const options = result.options;
    const { files: rootSpec, include, exclude, references } = result.raw;
    const selection = JSON.stringify({ files: rootSpec, include, exclude, references });
    const selectionDigest = createHash('sha256').update(selection).digest('hex');
    // include/exclude selects roots, not the complete project. Let this SDK
    // follow imports and references; only captured source bytes are available.
    const members = new Set(roots);
    // Expansion cannot add facts when every captured candidate is already a
    // root. Avoid a second parse of that common case and explicit noResolve.
    if (!options.noResolve && files.some(name => !members.has(name))) {
      const program = sourceProgram(root, roots, options, inputs, snapshot);
      for (const source of program.getSourceFiles()) members.add(toPosix(path.relative(root, source.fileName)));
    }
    const project = { config: relative, options, members, selectionDigest };
    parsed.set(relative, project);
    followReferences(result.projectReferences);
    return project;
  };
  for (const relative of files) {
    let directory = path.dirname(path.join(root, relative));
    const candidates = [];
    while (true) {
      const configFile = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(directory, name))
        .find(inputs.fileExists);
      if (configFile) candidates.push(loadConfig(toPosix(path.relative(root, configFile))));
      if (directory === root) break;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    owners.push([relative, candidates]);
  }
  for (const [relative, candidates] of owners) {
    // A nearer config can omit a source that another configured Program
    // imports. Prefer its own project when applicable, then an importing one.
    const owner = candidates.find(project => project?.members.has(relative))
      || [...parsed.values()].find(project => project?.members.has(relative));
    const key = owner?.config ?? null;
    if (!groups.has(key)) {
      const options = owner?.options ?? COMPILER_OPTIONS;
      const normalized = JSON.stringify(options, (_key, value) => {
        if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
        const relativePath = path.relative(root, value);
        return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) ? value : `<root>/${toPosix(relativePath)}`;
      });
      groups.set(key, { config: key, options, optionsDigest: createHash('sha256').update(normalized).digest('hex'), files: [], members: owner?.members, selectionDigest: owner?.selectionDigest });
    }
    groups.get(key).files.push(relative);
  }
  for (const project of groups.values()) {
    const members = project.members || new Set(project.files);
    if (project.config === null && files.some(file => !members.has(file))) {
      const program = sourceProgram(root, project.files, project.options, inputs, snapshot);
      for (const source of program.getSourceFiles()) members.add(toPosix(path.relative(root, source.fileName)));
    }
    // SDK groups never exchange ASTs or callable bodies. The actual Program
    // may also discover external/other-SDK files, outside this facts projection.
    project.members = files.filter(file => members.has(file)).sort(compareText);
  }
  return { projects: [...groups.values()] };
}

function collectImports(source, checker, options, onCall) {
  const found = [];
  for (const node of syntaxNodes(ts, source)) {
    if (onCall && ts.isCallExpression(node)) onCall(node);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const inlineTypesOnly = !clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
      found.push({ statement: node, specifier: node.moduleSpecifier.text, usage: node.moduleSpecifier, kind: 'static', line: lineOf(source, node), names: importedNames(clause), typeOnly: Boolean(clause?.isTypeOnly || (inlineTypesOnly && !options.verbatimModuleSyntax)) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      found.push({ specifier: node.moduleReference.expression.text, usage: node.moduleReference.expression, kind: 'require', line: lineOf(source, node), names: ['*'], typeOnly: Boolean(node.isTypeOnly) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const inlineTypesOnly = clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
      found.push({ statement: node, specifier: node.moduleSpecifier.text, usage: node.moduleSpecifier, kind: 'export', line: lineOf(source, node), names: exportedNames(clause), typeOnly: Boolean(node.isTypeOnly || (inlineTypesOnly && !options.verbatimModuleSyntax)) });
    } else if (ts.isCallExpression(node) && node.arguments.length) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = !isImport && isRequireCall(node, checker);
      if (isImport || isRequire) {
        const kind = isImport ? 'dynamic' : 'require';
        const argument = node.arguments[0];
        const opaque = !ts.isStringLiteralLike(argument);
        found.push({
          statement: node, usage: argument, specifier: opaque ? OPAQUE : argument.text, kind, line: lineOf(source, node),
          names: [], opaque, ...loadContext(node, isRequire),
        });
      }
    }
  }
  return found;
}

function loadContext(node, isRequire) {
  const context = {};
  for (let current = node; current.parent; current = current.parent) {
    const parent = current.parent;
    if (ts.isFunctionLike(parent) && (parent.body === current || parent.parameters?.includes(current))) context.lazy = true;
    // Instance field initializers run on construction, unlike static fields.
    if (ts.isPropertyDeclaration(parent) && parent.initializer === current && !parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) context.lazy = true;
    if (isRequire && isConditionalChild(parent, current)) context.conditional = true;
  }
  return context;
}

function isConditionalChild(parent, child) {
  // Chain predicates include continuous ?. segments but exclude grouped chain
  // breaks. Only arguments/keys are guarded; the chain's base still runs.
  if (ts.isCallChain(parent)) return parent.arguments.includes(child);
  if (ts.isElementAccessChain(parent)) return child === parent.argumentExpression;
  if (ts.isIfStatement(parent)) return child === parent.thenStatement || child === parent.elseStatement;
  if (ts.isConditionalExpression(parent)) return child === parent.whenTrue || child === parent.whenFalse;
  if (isShortCircuitExpression(parent)) return child === parent.right;
  if (ts.isWhileStatement(parent)) return child === parent.statement;
  if (ts.isForStatement(parent)) return (child === parent.statement && Boolean(parent.condition)) || child === parent.incrementor;
  if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) return child === parent.statement || child === parent.initializer;
  if (ts.isCaseOrDefaultClause(parent)) {
    // The first case test runs even if a default precedes it. Later tests and
    // clause bodies depend on selection; a sole default always runs.
    const firstCase = parent.parent.clauses.find(ts.isCaseClause);
    return Boolean(firstCase && (child !== parent.expression || parent !== firstCase));
  }
  return ts.isCatchClause(parent);
}

function importedNames(clause) {
  if (!clause) return [];
  const names = [];
  if (clause.name) names.push('default');
  const bindings = clause.namedBindings;
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) names.push('*');
    else for (const el of bindings.elements) names.push((el.propertyName || el.name).text);
  }
  return names.sort();
}

function exportedNames(clause) {
  if (!clause) return ['*'];
  if (ts.isNamespaceExport(clause)) return ['*'];
  return clause.elements.map((el) => (el.propertyName || el.name).text).sort();
}

function resolve(record, containingFile, absRoot, fileSet, options, inputs, resolutionMode) {
  const { specifier } = record;
  const isPathLike = specifier.startsWith('.') || specifier.startsWith('/');
  // Without the usage mode, NodeNext selects require conditions even for import().
  const correction = runtimePackageTarget(record, containingFile, absRoot, options, inputs, resolutionMode);
  if (correction && correction.status !== 'selected') return { reason: 'unknown' };
  const result = correction ? null : ts.resolveModuleName(specifier, containingFile, options, inputs, undefined, undefined, resolutionMode);
  const resolvedFile = correction?.file || result?.resolvedModule?.resolvedFileName;
  if (!resolvedFile) return { reason: isPathLike ? 'unknown' : 'external' };
  if (resolvedFile.split(path.sep).join('/').includes('/node_modules/')) return { reason: 'external' };
  let rel = toPosix(path.relative(absRoot, resolvedFile));
  // Only a parent-directory result is outside the root; an in-root directory whose
  // name merely starts with ".." (e.g. "..generated/") must not be misclassified.
  // TS 5.6 also marks in-package #imports/self exports as external library
  // imports. Captured in-root source identity takes precedence over that flag.
  if (rel === '..' || rel.startsWith('../')) return { reason: result?.resolvedModule.isExternalLibraryImport ? 'external' : 'outside' };
  if (record.kind === 'require' && !record.typeOnly && /\.d\.(?:ts|cts|mts)$/.test(rel)) {
    const runtime = resolveRelativeRequire(specifier, containingFile, absRoot, fileSet, inputs);
    if (runtime) return runtime;
  }
  if ((!isPathLike || resolutionMode === ts.ModuleKind.ESNext) && !record.typeOnly && /\.[cm]?js$/.test(containingFile) && /\.d\.(?:ts|mts|cts)$/.test(rel)) {
    // Resolve once more with a captured host that exposes only JS candidates.
    // Type declarations and TS substitutions cannot become runtime edges;
    // excluded-file boundaries remain checked against the captured file set.
    const runtimeHost = { ...inputs, fileExists: file => !/\.[cm]?tsx?$/.test(file) && inputs.fileExists(file) };
    const runtime = ts.resolveModuleName(specifier, containingFile, { ...options, noDtsResolution: true }, runtimeHost, undefined, undefined, resolutionMode).resolvedModule;
    const file = runtime?.resolvedFileName;
    if (!file || !/\.[cm]?js$/.test(file)) return { reason: 'unknown' };
    if (file.split(path.sep).join('/').includes('/node_modules/')) return { reason: 'external' };
    rel = toPosix(path.relative(absRoot, file));
    if (rel === '..' || rel.startsWith('../')) return { reason: runtime.isExternalLibraryImport ? 'external' : 'outside' };
  }
  if (!fileSet.has(rel)) return { reason: 'unknown' };
  return { to: rel };
}

// TypeScript can prefer a declaration even for a runtime require. Check only
// relative files and directory entries using the analysis's frozen inventory.
function resolveRelativeRequire(specifier, containingFile, root, fileSet, inputs) {
  const parts = specifier.split('/');
  if (!['.', '..'].includes(parts[0])) return;
  const requested = path.resolve(path.dirname(containingFile), specifier);
  const relative = path.relative(root, requested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;

  const target = file => {
    const rel = toPosix(path.relative(root, file));
    return /\.[cm]?js$/.test(rel) && fileSet.has(rel) ? { to: rel } : { reason: 'unknown' };
  };
  // JSON, native, and excluded files also win before a directory. Their
  // presence must stop the search even though they cannot supply a JS edge.
  const explicitDirectory = ['', '.', '..'].includes(parts.at(-1));
  if (!explicitDirectory) {
    const file = ['', '.js', '.json', '.node'].map(ext => requested + ext).find(inputs.fileExists);
    if (file) return target(file);
  }
  if (!inputs.directoryExists(requested)) return { reason: 'unknown' };
  const manifest = inputs.readFile(path.join(requested, 'package.json'));
  let main = 'index.js';
  if (manifest !== undefined) {
    try {
      const pkg = JSON.parse(manifest);
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { reason: 'unknown' };
      main = pkg.main || main;
    } catch { return { reason: 'unknown' }; }
  }
  if (typeof main !== 'string' || !/\.[cm]?js$/.test(main)) return { reason: 'unknown' };
  return target(path.resolve(requested, main));
}

return { prepare, run };
}
