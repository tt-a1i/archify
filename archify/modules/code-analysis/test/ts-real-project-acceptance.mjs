// Manual real-project acceptance against its installed TypeScript SDK.
// node test/ts-real-project-acceptance.mjs <clean checkout> <evidence directory>
// Installs nothing and executes no analyzed source or package script.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { inferredOptions, serverProjects } from './ts-official-oracle.mjs';

const [, , checkout, evidenceDirectory] = process.argv;
if (!checkout || !evidenceDirectory) throw new Error('Pass a clean Git checkout and an evidence directory.');
const root = fs.realpathSync(checkout), out = path.resolve(evidenceDirectory);
if (out === root || out.startsWith(`${root}${path.sep}`)) throw new Error('Evidence must be outside the analyzed checkout.');
fs.mkdirSync(out, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Git failed');
  return result.stdout;
};
if (git('status', '--porcelain').trim()) throw new Error('Use a clean checkout, with dependencies ignored by Git.');
const require = createRequire(path.join(root, 'package.json'));
const sdkPath = path.dirname(require.resolve('typescript/package.json'));
const ts = require(sdkPath);
// This acceptance selects the entire tracked JS/TS tree, excluding declaration
// and generated outputs by the existing defaults. Reject unsupported layouts.
const selected = git('ls-files', '-z').split('\0').filter(file => /\.(?:[mc]?[jt]s|[jt]sx)$/.test(file)
  && !file.endsWith('.d.ts') && !file.split('/').some(part => ['node_modules', 'dist', 'build', 'coverage', '_archive'].includes(part))).sort();
const sourceHashes = () => Object.fromEntries(selected.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
const initialHashes = sourceHashes();
const started = performance.now(), contexts = new Map(), differences = [];
const report = {
  schemaVersion: 1, status: 'running', acceptanceScope: 'captured source facts and bounded known call targets; full language-service coverage is assessed separately',
  project: { origin: git('remote', 'get-url', 'origin').trim(), commit: git('rev-parse', 'HEAD').trim(),
    packageVersion: require('./package.json').version, clean: true, lockSha256: hash(fs.readFileSync(path.join(root, 'package-lock.json'))) },
  environment: { platform: process.platform, arch: process.arch, node: process.version, sdkVersion: ts.version, sdkPath },
  scope: { selected, sourceSha256: initialHashes, policy: 'all tracked JS/TS selected by default Archify filters; native Programs may overlap; source facts have one owner' },
  differences, files: [], imports: [], functions: [], knownCalls: [], unknownCalls: [], sensitivity: [],
};
const point = (source, pos) => { const p = source.getLineAndCharacterOfPosition(pos); return [p.line + 1, p.character + 1]; };
const range = (source, node) => [...point(source, node.getStart(source)), ...point(source, node.getEnd())];
const key = value => JSON.stringify(value);
const relative = file => path.relative(root, file).split(path.sep).join('/');
const compare = (category, subject, actual, expected) => {
  if (key(actual) !== key(expected)) differences.push({ category, subject, actual, expected });
};
const sorted = values => values.map(key).sort();
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k])]));
  return typeof value === 'string' && path.isAbsolute(value) && !relative(value).startsWith('../') ? `<root>/${relative(value)}` : value;
};
function* nodes(rootNode) {
  const pending = [rootNode];
  while (pending.length) {
    const node = pending.pop(); yield node;
    ts.forEachChild(node, child => { pending.push(child); });
  }
}
function context(config, inferredFiles) {
  if (contexts.has(config)) return contexts.get(config);
  let options, roots;
  if (config === null) {
    options = ts.convertCompilerOptionsFromJson(inferredOptions, root).options;
    roots = inferredFiles.map(file => path.join(root, file));
  } else {
    const file = path.join(root, config), read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
    const errors = parsed.errors.filter(error => ![18002, 18003].includes(error.code));
    if (errors.length) throw new Error(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    options = parsed.options; roots = parsed.fileNames;
  }
  const service = ts.createLanguageService({
    getScriptFileNames: () => roots, getScriptVersion: () => '0',
    getScriptSnapshot: file => { const text = ts.sys.readFile(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => root, getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories, realpath: ts.sys.realpath,
  });
  const result = { options, service, program: service.getProgram() };
  contexts.set(config, result);
  return result;
}
const nativeNavigation = definitions => (definitions || []).map(definition => ({
  file: relative(definition.fileName), name: definition.name, kind: definition.kind,
  textSpan: definition.textSpan, ...(definition.contextSpan ? { contextSpan: definition.contextSpan } : {}),
}));

function nativeImplementationMatches(peer, definitions, target) {
  const source = peer.program.getSourceFile(path.join(root, target.file));
  if (!source) return false;
  const position = source.getPositionOfLineAndCharacter(target.line - 1, target.column - 1);
  const checker = peer.program.getTypeChecker();
  for (const definition of definitions.filter(definition => definition.file === target.file)) {
    const token = [...nodes(source)].find(node => ts.isIdentifier(node) && node.getStart(source) === definition.textSpan.start);
    let symbol = token && checker.getSymbolAtLocation(token);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const bodies = (symbol?.declarations || []).flatMap(declaration => {
      if (ts.isFunctionLike(declaration) && declaration.body) return [declaration];
      let value = ts.isVariableDeclaration(declaration) && declaration.initializer;
      while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value)
        || ts.isTypeAssertionExpression(value) || ts.isNonNullExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression;
      return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? [value] : [];
    });
    if (bodies.length === 1 && bodies[0].getSourceFile() === source && bodies[0].getStart(source) === position) return true;
  }
  return false;
}

try {
  let captured;
  const config = { ...loadConfig(null), typescript: { sdk: 'auto', requireProjectSdk: true } };
  const { facts } = extractFacts(root, { language: 'ts', config, onCapture: value => { captured = value; } });
  fs.writeFileSync(path.join(out, 'archify-raw-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  report.candidate = { adapter: facts.repository.adapter, adapterRevision: facts.repository.adapterRevision, callModel: facts.callModel,
    sourceSha256: Object.fromEntries(['index.mjs', 'sdk.mjs', 'calls.mjs', 'functions.mjs', 'imported-calls.mjs', 'snapshot-host.mjs', 'runtime-package-target.mjs', 'syntax-walk.mjs']
      .map(file => [file, hash(fs.readFileSync(new URL(`../extract/ts/${file}`, import.meta.url)))])),
    runnerSha256: hash(fs.readFileSync(new URL(import.meta.url))),
    protocolHelperSha256: hash(fs.readFileSync(new URL('./ts-official-oracle.mjs', import.meta.url))) };
  compare('selected-files', 'whole checkout', facts.files.map(file => file.path), selected);
  compare('sdk-version', 'project SDK', facts.languageScope.sdk.version, ts.version);
  compare('sdk-source', 'project SDK', facts.languageScope.sdk.source, 'project');
  compare('sdk-path', 'project SDK', facts.languageScope.sdks[0].packagePath, relative(fs.realpathSync(sdkPath)));
  const peers = await serverProjects(root, selected, sdkPath);
  fs.writeFileSync(path.join(out, 'tsserver-projects.json'), `${JSON.stringify(Object.fromEntries(peers), null, 2)}\n`);
  const inferredFiles = selected.filter(file => peers.get(file).config === null);
  const projectOptions = Array.isArray(captured.options) ? captured.options : [{ config: facts.languageScope.projects[0].config, options: captured.options }];
  report.projects = facts.languageScope.projects.map(project => {
    const peer = context(project.config, inferredFiles);
    const expectedFiles = selected.filter(file => peers.get(file).config === project.config);
    compare('project-files', project.config, project.files, expectedFiles);
    compare('compiler-options', project.config, normalize(projectOptions.find(p => p.config === project.config)?.options), normalize(peer.options));
    const nativeSelectedMembers = [...new Set(expectedFiles.flatMap(file => peers.get(file).files.filter(name => selected.includes(name))))].sort();
    compare('program-members', project.config, project.members, nativeSelectedMembers);
    return { config: project.config, files: project.files, sdkVersion: project.sdkVersion, effectiveOptions: normalize(peer.options),
      members: project.members, nativeSelectedMembers };
  });

  for (const file of selected) {
    const owner = facts.languageScope.projects.find(project => project.files.includes(file));
    compare('project-owner', file, owner?.config, peers.get(file).config);
    const peer = context(peers.get(file).config, inferredFiles), source = peer.program.getSourceFile(path.join(root, file));
    if (!source) throw new Error(`Official Program omitted ${file}`);
    const syntax = peer.program.getSyntacticDiagnostics(source);
    compare('syntax-coverage', file, Boolean(facts.parse_errors?.some(error => error.path === file)), Boolean(syntax.length));
    compare('source-text', file, facts.files.find(record => record.path === file)?.sourceText, source.text);
    const ast = [...nodes(source)], functionBodies = ast.filter(node => ts.isFunctionLike(node) && node.body);
    const calls = ast.filter(ts.isCallExpression), literals = ast.filter(ts.isStringLiteralLike);
    const actualFunctions = facts.functions.filter(fn => fn.file === file), actualCalls = facts.calls.filter(call => call.file === file);
    compare('call-inventory', file, sorted(actualCalls.map(call => [call.line, call.column, call.endLine, call.endColumn])), sorted(calls.map(node => range(source, node))));
    const required = new Set(functionBodies.filter(node => node.name || ts.isConstructorDeclaration(node)
      || ((ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isPropertyDeclaration(node.parent)) && node.parent.initializer === node)
      || !functionBodies.some(parent => parent !== node && parent.pos <= node.pos && parent.end >= node.end)).map(node => key(range(source, node))));
    for (const fn of actualFunctions) {
      const r = fn.sourceRange, measured = [r.line, r.column, r.endLine, r.endColumn];
      const native = functionBodies.find(node => key(range(source, node)) === key(measured));
      if (!native) differences.push({ category: 'function-range', subject: { file, name: fn.name, measured } });
      else compare('function-hash', { file, name: fn.name, measured }, r.sha256, hash(source.text.slice(native.getStart(source), native.getEnd())));
      required.delete(key(measured));
      report.functions.push({ file, name: fn.name, range: measured, matched: Boolean(native) });
    }
    if (required.size) differences.push({ category: 'missing-function-bodies', subject: file, expected: [...required] });

    // The compiler's independent preprocessor supplies the literal dependency
    // inventory; syntax is used only to locate the usage mode and statement.
    const imports = ts.preProcessFile(source.text, true, true).importedFiles.map(dependency => {
      const literal = literals.find(node => node.text === dependency.fileName && node.getStart(source) <= dependency.pos && node.end >= dependency.end);
      if (!literal) throw new Error(`No AST usage for ${file}:${dependency.fileName}`);
      let statement = literal;
      while (statement.parent && !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)
        && !ts.isImportEqualsDeclaration(statement) && !ts.isCallExpression(statement)) statement = statement.parent;
      const kind = ts.isExportDeclaration(statement) ? 'export' : ts.isImportEqualsDeclaration(statement) ? 'require'
        : ts.isCallExpression(statement) ? statement.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic' : 'require' : 'static';
      const line = point(source, statement.getStart(source))[0];
      const resolved = ts.resolveModuleName(dependency.fileName, source.fileName, peer.options, ts.sys, undefined, undefined,
        peer.program.getModeForUsageLocation(source, literal)).resolvedModule;
      const resolvedFile = resolved && relative(fs.realpathSync(resolved.resolvedFileName));
      const projected = selected.includes(resolvedFile) ? resolvedFile : null;
      return { file, line, specifier: dependency.fileName, kind, officialTarget: resolvedFile || null, projected };
    });
    const actualImports = facts.imports.filter(edge => edge.from === file);
    compare('import-inventory', file, sorted(actualImports.map(edge => [edge.line, edge.specifier, edge.kind])), sorted(imports.map(edge => [edge.line, edge.specifier, edge.kind])));
    for (const edge of imports) {
      const actual = actualImports.find(item => item.line === edge.line && item.specifier === edge.specifier && item.kind === edge.kind);
      compare('module-target', { file, line: edge.line, specifier: edge.specifier }, actual?.to || null, edge.projected);
      report.imports.push({ ...edge, archifyTarget: actual?.to || null, matched: (actual?.to || null) === edge.projected });
    }

    for (const call of actualCalls.filter(call => call.target)) {
      const node = calls.find(node => key(range(source, node)) === key([call.line, call.column, call.endLine, call.endColumn]));
      const definitions = nativeNavigation(peer.service.getDefinitionAtPosition(source.fileName, node.expression.getStart(source)));
      const target = { ...call.target, file: call.target.file || file };
      // Normalize official overload/variable symbols to exactly one body. A
      // nearby name or a broad enclosing context span is insufficient.
      const matched = nativeImplementationMatches(peer, definitions, target);
      if (!matched) differences.push({ category: 'known-call-target', subject: { file, line: call.line, column: call.column }, actual: target, official: definitions });
      report.knownCalls.push({ file, line: call.line, column: call.column, resolution: call.resolution, target, matched, officialDefinitions: definitions });
      if (!report.sensitivity.length) {
        const wrong = facts.functions.find(fn => fn.file === target.file && (fn.sourceRange.line !== target.line || fn.sourceRange.column !== target.column));
        if (wrong) {
          const altered = { file: target.file, name: wrong.name, line: wrong.sourceRange.line, column: wrong.sourceRange.column };
          const detected = !nativeImplementationMatches(peer, definitions, altered);
          report.sensitivity.push({ mutation: 'different function in the same target file', call: { file, line: call.line, column: call.column }, original: target, altered, detected });
          if (!detected) differences.push({ category: 'acceptance-sensitivity', subject: altered });
        }
      }
    }
    for (const call of actualCalls.filter(call => !call.target)) {
      const node = calls.find(node => key(range(source, node)) === key([call.line, call.column, call.endLine, call.endColumn]));
      const position = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.getStart(source)
        : ts.isIdentifier(node.expression) ? node.expression.getStart(source) : null;
      // Computed keys and factory-result expressions do not supply a single
      // identifier cursor whose navigation can be treated as a callee query.
      const definitions = position === null ? [] : nativeNavigation(peer.service.getDefinitionAtPosition(source.fileName, position));
      const captured = definitions.filter(definition => selected.includes(definition.file));
      const category = position === null ? 'expression-not-queried' : captured.length
        ? captured.some(definition => facts.languageScope.projects.find(project => project.files.includes(definition.file))?.config === owner.config)
          ? 'captured-definition-same-project' : 'captured-definition-other-project'
        : definitions.length ? 'external-definition' : 'no-definition';
      report.unknownCalls.push({ file, line: call.line, column: call.column, reason: call.reason, category,
        calleeSyntax: ts.SyntaxKind[node.expression.kind], officialDefinitions: definitions,
        policy: 'definition candidates are not runtime dispatch evidence' });
    }
    report.files.push({ file, config: owner?.config, syntaxErrors: syntax.length, imports: imports.length, functions: actualFunctions.length, calls: actualCalls.length });
  }
  const finalHashes = sourceHashes(), trackedChanges = git('status', '--porcelain').trim();
  compare('source-stability', 'checkout', finalHashes, initialHashes);
  compare('tracked-tree-stability', 'checkout', trackedChanges, '');
  const again = extractFacts(root, { language: 'ts', config }).facts;
  const rawDigest = hash(JSON.stringify(facts)), repeatedDigest = hash(JSON.stringify(again));
  compare('repeat-capture', 'raw facts', repeatedDigest, rawDigest);
  report.reproducibility = { sourceUnchanged: key(finalHashes) === key(initialHashes), trackedTreeClean: trackedChanges === '',
    rawFactsSha256: rawDigest, repeatedRawFactsSha256: repeatedDigest, repeatedCaptureIdentical: rawDigest === repeatedDigest };
  report.summary = { files: report.files.length, projects: report.projects.length, imports: report.imports.length,
    functions: report.functions.length, calls: facts.calls.length, knownCalls: report.knownCalls.length,
    sharedMemberTargets: report.knownCalls.filter(call => facts.languageScope.projects.find(project => project.files.includes(call.file))
      !== facts.languageScope.projects.find(project => project.files.includes(call.target.file))).length,
    unknownCalls: facts.calls.filter(call => !call.target).length,
    unknownReasons: Object.fromEntries([...new Set(facts.calls.filter(call => !call.target).map(call => call.reason))].map(reason => [reason, facts.calls.filter(call => call.reason === reason).length])),
    unknownDefinitionCategories: Object.fromEntries([...new Set(report.unknownCalls.map(call => call.category))].map(category => [category, report.unknownCalls.filter(call => call.category === category).length])),
    unresolved: facts.unresolved, unexplainedDifferences: differences.length };
  report.coverageGates = {
    capturedFacts: differences.length ? 'failed' : 'passed',
    knownTargetPrecision: report.knownCalls.every(call => call.matched) ? 'passed' : 'failed',
    completeDefinitionNavigation: report.unknownCalls.some(call => call.category.startsWith('captured-definition')) ? 'gap-observed' : 'no-gap-in-queried-calls',
    note: 'A navigation candidate may be an interface, property, parameter or unresolved alias; candidate counts are not executable-body counts or runtime dispatch proof.',
  };
  report.status = differences.length ? 'failed' : 'passed';
} catch (error) {
  report.status = 'failed'; report.error = { message: error.message, diagnostics: error.diagnostics, stack: error.stack };
} finally {
  for (const peer of contexts.values()) peer.service.dispose();
  report.elapsedMs = Math.round(performance.now() - started);
  fs.writeFileSync(path.join(out, 'acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: report.status, project: report.project, sdk: ts.version, summary: report.summary, error: report.error?.message, elapsedMs: report.elapsedMs })}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}
