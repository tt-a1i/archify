// TypeScript Compiler API adapter (JS + TS via allowJs). M1 scope: files and
// import edges only. A no-resolution Program supplies lexical binding information;
// exported symbols and calls stay empty until M2.
import path from 'node:path';
import ts from 'typescript';
import { classifyRole, lineCount, listFiles, snapshotTree, toPosix, packageMarkersIn } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';
import { snapshotHost } from './snapshot-host.mjs';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';
import { isShortCircuitExpression, measureFunctions } from './functions.mjs';

export const id = 'ts';
// Revision of this adapter's own extraction logic, recorded as
// repository.adapterRevision. Bump it when the same sources can yield different
// raw facts (see docs/TECH-GUIDE.md, "Extractor revisions").
export const REVISION = 2;

const SOURCE_EXT = /\.(?:[mc]?[jt]s|[jt]sx)$/;
// Placeholder specifier for import()/require() calls whose argument is not a string literal.
export const OPAQUE = '<computed>';

export function detect(root, config) {
  return listFiles(root, config).some((f) => SOURCE_EXT.test(f));
}

export function countSources(root, config) {
  return listFiles(root, config).filter((f) => SOURCE_EXT.test(f)).length;
}

const COMPILER_OPTIONS = {
  allowJs: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
};

export function extract(root, config) {
  const absRoot = path.resolve(root);
  const include = matcher(config.include), exclude = matcher(config.exclude);
  const selected = file => SOURCE_EXT.test(file) && include(file) && !exclude(file)
    && !file.split('/').slice(0, -1).some((_, i, parts) => exclude(`${parts.slice(0, i + 1).join('/')}/`));
  const snapshot = snapshotTree(absRoot, file => selected(file) || file.endsWith('.json'));
  const files = snapshot.names.filter(selected);
  const inputs = snapshotHost(absRoot, snapshot);
  const options = compilerOptions(absRoot, inputs);
  const fileSet = new Set(files);
  const programOptions = {
    ...options, noResolve: true, noLib: true, types: [],
  };
  const host = ts.createCompilerHost(programOptions);
  host.readFile = file => snapshot.contents.get(toPosix(path.relative(absRoot, file)))?.toString('utf8');
  host.fileExists = inputs.fileExists;
  host.directoryExists = inputs.directoryExists;
  host.getDirectories = inputs.getDirectories;
  host.getCurrentDirectory = inputs.getCurrentDirectory;
  host.realpath = inputs.realpath;
  host.getSourceFile = (file, version) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, version, true);
  };
  const program = ts.createProgram(files.map((rel) => path.join(absRoot, rel)), programOptions, host);
  const checker = program.getTypeChecker();
  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  const fileRecords = [];
  const functions = [];
  const parseErrors = [];

  for (const rel of files) {
    const abs = path.join(absRoot, rel);
    const source = program.getSourceFile(abs);
    // TypeScript recovers from syntax errors and returns a partial tree, so a broken
    // file can silently lose its imports and functions. Record it like Python's
    // parse_errors: coverage shows it, and run comparisons treat it as a scope change.
    const syntax = program.getSyntacticDiagnostics(source);
    if (syntax.length) {
      const first = syntax[0];
      const line = first.start === undefined ? null : source.getLineAndCharacterOfPosition(first.start).line + 1;
      parseErrors.push({ path: rel, message: `${line ? `line ${line}: ` : ''}${ts.flattenDiagnosticMessageText(first.messageText, ' ')}${syntax.length > 1 ? ` (+${syntax.length - 1} more)` : ''}` });
    }
    fileRecords.push({ path: rel, loc: lineCount(source.text), role: classifyRole(rel, config.roles), sourceText: source.text });
    if (!source.isDeclarationFile) functions.push(...measureFunctions(source, rel));
    for (const found of collectImports(source, checker, options)) {
      const record = { from: rel, specifier: found.specifier, kind: found.kind, line: found.line, resolved: false };
      if (found.names.length) record.names = found.names;
      if (found.lazy) record.lazy = true;
      if (found.conditional) record.conditional = true;
      if (source.isDeclarationFile || found.typeOnly) record.typeOnly = true;
      const target = found.opaque ? { reason: 'opaque' } : resolve(found.specifier, abs, absRoot, fileSet, options, inputs);
      if (target.to) { record.to = target.to; record.resolved = true; }
      else unresolved[target.reason] += 1;
      imports.push(record);
    }
  }

  imports.sort((a, b) => compareText(a.from, b.from) || a.line - b.line || compareText(a.specifier, b.specifier));

  inputs.assertUnchanged();
  // Markers come from the frozen inventory, like every other resolution input.
  const packageMarkers = packageMarkersIn(snapshot.names, config);
  const repo = describeRepository(absRoot);
  return {
    schema_version: 1,
    repository: { ...repo, language: 'ts', adapter: `typescript@${ts.version}`, adapterRevision: REVISION },
    files: fileRecords,
    packageMarkers,
    imports,
    symbols: [],
    functions: functions.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.qualname, b.qualname)),
    calls: [],
    ...(parseErrors.length ? { parse_errors: parseErrors } : {}),
    unresolved,
  };
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Read options explicitly selected by the analyzed root; never discover ancestor configs. */
function compilerOptions(root, inputs) {
  const configPath = path.join(root, 'tsconfig.json');
  if (!inputs.fileExists(configPath)) return COMPILER_OPTIONS;
  const loaded = ts.readConfigFile(configPath, inputs.readFile);
  inputs.assertUnchanged();
  if (loaded.error) fail('extract/tsconfig-invalid', 'Cannot read tsconfig.json.', { subject: { file: configPath } });
  const parsed = ts.parseJsonConfigFileContent(loaded.config, inputs, path.dirname(configPath));
  inputs.assertUnchanged();
  const errors = parsed.errors.filter((e) => e.code !== 18003); // no input files is irrelevant to a subtree analysis
  if (errors.length) fail('extract/tsconfig-invalid', 'Invalid TypeScript configuration.', { subject: { file: configPath }, evidence: { errors: errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')) } });
  return { ...COMPILER_OPTIONS, ...parsed.options, allowJs: true };
}

function collectImports(source, checker, options) {
  const found = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const inlineTypesOnly = !clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
      found.push({ specifier: node.moduleSpecifier.text, kind: 'static', line: lineOf(source, node), names: importedNames(clause), typeOnly: Boolean(clause?.isTypeOnly || (inlineTypesOnly && !options.verbatimModuleSyntax)) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      found.push({ specifier: node.moduleReference.expression.text, kind: 'require', line: lineOf(source, node), names: ['*'], typeOnly: Boolean(node.isTypeOnly) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const inlineTypesOnly = clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
      found.push({ specifier: node.moduleSpecifier.text, kind: 'export', line: lineOf(source, node), names: exportedNames(clause), typeOnly: Boolean(node.isTypeOnly || (inlineTypesOnly && !options.verbatimModuleSyntax)) });
    } else if (ts.isCallExpression(node) && node.arguments.length) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = !isImport && ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && isModuleRequire(node.expression, checker);
      if (isImport || isRequire) {
        const kind = isImport ? 'dynamic' : 'require';
        const argument = node.arguments[0];
        const opaque = !ts.isStringLiteralLike(argument);
        found.push({
          specifier: opaque ? OPAQUE : argument.text, kind, line: lineOf(source, node),
          names: [], opaque, ...loadContext(node, isRequire),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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

// Native CommonJS require has no source declaration. Also preserve the common
// ESM createRequire pattern, but never infer an arbitrary local function is a loader.
function isModuleRequire(identifier, checker) {
  const declarations = checker.getSymbolAtLocation(identifier)?.declarations || [];
  if (!declarations.length) return true;
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer
    || !ts.isCallExpression(declaration.initializer)) return false;
  const args = declaration.initializer.arguments;
  const base = args[0];
  if (args.length !== 1 || !ts.isPropertyAccessExpression(base) || base.name.text !== 'url'
    || !ts.isMetaProperty(base.expression) || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword) return false;
  const factory = declaration.initializer.expression;
  if (!ts.isIdentifier(factory)) return false;
  const imported = checker.getSymbolAtLocation(factory)?.declarations?.[0];
  if (!imported || !ts.isImportSpecifier(imported)
    || (imported.propertyName || imported.name).text !== 'createRequire') return false;
  const statement = imported.parent.parent.parent;
  return ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
    && ['node:module', 'module'].includes(statement.moduleSpecifier.text);
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

function resolve(specifier, containingFile, absRoot, fileSet, options, inputs) {
  const isPathLike = specifier.startsWith('.') || specifier.startsWith('/');
  const result = ts.resolveModuleName(specifier, containingFile, options, inputs);
  const resolvedFile = result.resolvedModule?.resolvedFileName;
  if (!resolvedFile) return { reason: isPathLike ? 'unknown' : 'external' };
  if (result.resolvedModule.isExternalLibraryImport || resolvedFile.split(path.sep).join('/').includes('/node_modules/')) return { reason: 'external' };
  const rel = toPosix(path.relative(absRoot, resolvedFile));
  // Only a parent-directory result is outside the root; an in-root directory whose
  // name merely starts with ".." (e.g. "..generated/") must not be misclassified.
  if (rel === '..' || rel.startsWith('../')) return { reason: 'outside' };
  if (!fileSet.has(rel)) return { reason: 'unknown' };
  return { to: rel };
}
