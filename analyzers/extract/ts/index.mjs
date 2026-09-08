// TypeScript Compiler API adapter (JS + TS via allowJs). M1 scope: files and
// import edges only. Symbols and calls stay empty until M2 introduces a Program.
import fs from 'node:fs';
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
  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0 };
  const fileRecords = [];

  for (const rel of files) {
    const abs = path.join(absRoot, rel);
    const content = fs.readFileSync(abs, 'utf8');
    fileRecords.push({ path: rel, loc: lineCount(content), role: classifyRole(rel, config.roles) });

    const source = ts.createSourceFile(abs, content, ts.ScriptTarget.ESNext, true, scriptKind(rel));
    for (const found of collectImports(source)) {
      const record = { from: rel, specifier: found.specifier, kind: found.kind, line: found.line, resolved: false };
      if (found.names.length) record.names = found.names;
      const target = resolve(found.specifier, abs, absRoot, fileSet);
      if (target.to) { record.to = target.to; record.resolved = true; }
      else unresolved[target.reason] += 1;
      imports.push(record);
    }
  }

  imports.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.specifier.localeCompare(b.specifier));

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

function scriptKind(rel) {
  if (/\.tsx$/.test(rel)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(rel)) return ts.ScriptKind.JSX;
  if (/\.[mc]?ts$/.test(rel)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function collectImports(source) {
  const found = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, kind: 'static', line: lineOf(source, node), names: importedNames(node.importClause) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ specifier: node.moduleSpecifier.text, kind: 'export', line: lineOf(source, node), names: exportedNames(node.exportClause) });
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        found.push({ specifier: node.arguments[0].text, kind: 'dynamic', line: lineOf(source, node), names: [] });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        found.push({ specifier: node.arguments[0].text, kind: 'require', line: lineOf(source, node), names: [] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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
