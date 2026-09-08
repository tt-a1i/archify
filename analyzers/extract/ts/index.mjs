// TypeScript Compiler API adapter (JS + TS via allowJs). M1 scope: files and
// import edges only. A no-resolution Program supplies lexical binding information;
// exported symbols and calls stay empty until M2.
import path from 'node:path';
import ts from 'typescript';
import { classifyRole, lineCount, listFiles, toPosix } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';

export const id = 'ts';

const SOURCE_EXT = /\.(?:[mc]?[jt]s|[jt]sx)$/;

export function detect(root, config) {
  return listFiles(root, config).some((f) => SOURCE_EXT.test(f));
}

const COMPILER_OPTIONS = {
  allowJs: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
};

export function extract(root, config) {
  const absRoot = path.resolve(root);
  const files = listFiles(absRoot, config);
  const fileSet = new Set(files);
  const program = ts.createProgram(files.map((rel) => path.join(absRoot, rel)), {
    ...COMPILER_OPTIONS, noResolve: true, noLib: true, types: [],
  });
  const checker = program.getTypeChecker();
  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0 };
  const fileRecords = [];

  for (const rel of files) {
    const abs = path.join(absRoot, rel);
    const source = program.getSourceFile(abs);
    fileRecords.push({ path: rel, loc: lineCount(source.text), role: classifyRole(rel, config.roles) });
    for (const found of collectImports(source, checker)) {
      const record = { from: rel, specifier: found.specifier, kind: found.kind, line: found.line, resolved: false };
      if (found.names.length) record.names = found.names;
      const target = resolve(found.specifier, abs, absRoot, fileSet);
      if (target.to) { record.to = target.to; record.resolved = true; }
      else unresolved[target.reason] += 1;
      imports.push(record);
    }
  }

  imports.sort((a, b) => compareText(a.from, b.from) || a.line - b.line || compareText(a.specifier, b.specifier));

  const repo = describeRepository(absRoot);
  return {
    schema_version: 1,
    repository: { root: repo.root, revision: repo.revision, language: 'ts', adapter: `typescript@${ts.version}` },
    files: fileRecords,
    imports,
    symbols: [],
    calls: [],
    unresolved,
  };
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function collectImports(source, checker) {
  const found = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, kind: 'static', line: lineOf(source, node), names: importedNames(node.importClause) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      found.push({ specifier: node.moduleReference.expression.text, kind: 'require', line: lineOf(source, node), names: ['*'] });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, kind: 'export', line: lineOf(source, node), names: exportedNames(node.exportClause) });
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        found.push({ specifier: node.arguments[0].text, kind: 'dynamic', line: lineOf(source, node), names: [] });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require'
        && isModuleRequire(node.expression, checker)) {
        found.push({ specifier: node.arguments[0].text, kind: 'require', line: lineOf(source, node), names: [] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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

function resolve(specifier, containingFile, absRoot, fileSet) {
  const isPathLike = specifier.startsWith('.') || specifier.startsWith('/');
  if (!isPathLike) return { reason: 'external' };
  const result = ts.resolveModuleName(specifier, containingFile, COMPILER_OPTIONS, ts.sys);
  const resolvedFile = result.resolvedModule?.resolvedFileName;
  if (!resolvedFile) return { reason: 'unknown' };
  const rel = toPosix(path.relative(absRoot, resolvedFile));
  if (rel.startsWith('..')) return { reason: 'outside' };
  if (!fileSet.has(rel)) return { reason: 'unknown' };
  return { to: rel };
}
