#!/opt/homebrew/opt/node@22/bin/node
'use strict';

// A deliberately dependency-isolated, cold-process TypeScript navigation probe.
const entryUptimeMs = process.uptime() * 1e3;
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

const DEFAULT_TYPESCRIPT = '/private/tmp/archify-semantic-repair-20260921/tool-deps/node_modules/typescript';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const DEFAULT_EXCLUDED_SEGMENTS = new Set(['node_modules', 'test', 'tests', '__tests__']);

function fail(message) { process.stderr.write(`semantic-navigation: ${message}\n`); process.exitCode = 2; }
function usage() {
  return `Usage:\n  /opt/homebrew/opt/node@22/bin/node semantic-navigation.cjs --repo-root ABSOLUTE --scope RELATIVE_DIR (--at path:line:column | --symbol [path:]Qualified.Name) [--limit N] [--json]\n\nThe default TypeScript package is ${DEFAULT_TYPESCRIPT}.\n`;
}
function parseArgs(argv) {
  const out = { limit: 40, declarationLines: 40, json: false, typescript: DEFAULT_TYPESCRIPT };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--help' || key === '-h') return { help: true };
    if (key === '--json') { out.json = true; continue; }
    if (!['--repo-root', '--scope', '--at', '--symbol', '--limit', '--declaration-lines', '--typescript'].includes(key)) throw new Error(`unknown option ${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    out[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  if (!out.repoRoot || !out.scope || (!out.at && !out.symbol) || (out.at && out.symbol)) throw new Error('provide --repo-root, --scope, and exactly one of --at or --symbol');
  if (!path.isAbsolute(out.repoRoot)) throw new Error('--repo-root must be absolute');
  if (!path.isAbsolute(out.typescript)) throw new Error('--typescript must be an absolute package path');
  out.limit = Number(out.limit);
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 500) throw new Error('--limit must be an integer from 1 to 500');
  out.declarationLines = Number(out.declarationLines);
  if (!Number.isInteger(out.declarationLines) || out.declarationLines < 1 || out.declarationLines > 200) throw new Error('--declaration-lines must be an integer from 1 to 200');
  return out;
}
function within(root, candidate) { const rel = path.relative(root, candidate); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
function listSourceFiles(scopeRoot) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (DEFAULT_EXCLUDED_SEGMENTS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) files.push(absolute);
    }
  }
  walk(scopeRoot);
  return files.sort();
}
function parseAt(value, repoRoot) {
  const match = /^(.*):(\d+):(\d+)$/.exec(value);
  if (!match) throw new Error('--at must be path:line:column (one-based)');
  const fileName = path.resolve(repoRoot, match[1]);
  if (!within(repoRoot, fileName)) throw new Error('--at path escapes --repo-root');
  return { fileName, line: Number(match[2]), column: Number(match[3]) };
}
function makeHost(ts, files, options) {
  const versions = new Map(files.map((file) => [file, '1']));
  return {
    getCompilationSettings: () => options,
    getScriptFileNames: () => files,
    getScriptVersion: (file) => versions.get(file) || '0',
    getScriptSnapshot: (file) => {
      if (!fs.existsSync(file)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8'));
    },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: fs.existsSync,
    readFile: (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; } },
    readDirectory: ts.sys.readDirectory,
    directoryExists: (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } },
    getDirectories: (dir) => { try { return fs.readdirSync(dir).filter((x) => fs.statSync(path.join(dir, x)).isDirectory()); } catch { return []; } },
  };
}
function positionFor(ts, sourceFile, line, column) {
  if (line < 1 || column < 1 || line > sourceFile.getLineAndCharacterOfPosition(sourceFile.text.length).line + 1) throw new Error('--at line is outside the source file');
  const starts = sourceFile.getLineStarts();
  const start = starts[line - 1];
  const next = starts[line] ?? sourceFile.text.length + 1;
  const pos = start + column - 1;
  if (pos < start || pos >= next) throw new Error('--at column is outside the source line');
  return pos;
}
function canonical(ts, checker, symbol) { return symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol; }
function textSpan(ts, sourceFile, span, repoRoot) {
  const start = sourceFile.getLineAndCharacterOfPosition(span.start);
  const end = sourceFile.getLineAndCharacterOfPosition(span.start + span.length);
  const lineStart = sourceFile.getLineStarts()[start.line];
  const lineEnd = sourceFile.text.indexOf('\n', lineStart);
  return {
    path: path.relative(repoRoot, sourceFile.fileName).split(path.sep).join('/'),
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
    snippet: sourceFile.text.slice(lineStart, lineEnd === -1 ? sourceFile.text.length : lineEnd).trim(),
  };
}
function declarationSpan(ts, declaration, repoRoot) {
  const sourceFile = declaration.getSourceFile();
  const name = declaration.name && ts.isIdentifier(declaration.name) ? declaration.name : declaration;
  return textSpan(ts, sourceFile, { start: name.getStart(sourceFile), length: name.getWidth(sourceFile) }, repoRoot);
}
function declarationRole(ts, declaration) {
  if (ts.isMethodDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isConstructorDeclaration(declaration)) return declaration.body ? 'implementation' : 'overload-signature';
  return 'declaration';
}
function lineEnd(sourceFile, line) {
  const start = sourceFile.getLineStarts()[line];
  const end = sourceFile.text.indexOf('\n', start);
  return end === -1 ? sourceFile.text.length : end;
}
function declarationDetails(ts, declaration, repoRoot, declarationLines) {
  const sourceFile = declaration.getSourceFile();
  const startPosition = declaration.getStart(sourceFile);
  const endPosition = declaration.getEnd();
  const start = sourceFile.getLineAndCharacterOfPosition(startPosition);
  const end = sourceFile.getLineAndCharacterOfPosition(endPosition);
  const visibleEndLine = Math.min(end.line, start.line + declarationLines - 1);
  return {
    identifier: declarationSpan(ts, declaration, repoRoot),
    kind: ts.SyntaxKind[declaration.kind],
    role: declarationRole(ts, declaration),
    range: {
      start: { line: start.line + 1, column: start.character + 1 },
      end: { line: end.line + 1, column: end.character + 1 },
    },
    source: {
      startLine: start.line + 1,
      shownThroughLine: visibleEndLine + 1,
      fullEndLine: end.line + 1,
      text: sourceFile.text.slice(sourceFile.getLineStarts()[start.line], lineEnd(sourceFile, visibleEndLine)).trimEnd(),
      truncatedLines: Math.max(0, end.line - visibleEndLine),
    },
  };
}
function qualifiedName(ts, node) {
  const parts = [];
  let current = node;
  while (current) {
    if ((ts.isClassDeclaration(current) || ts.isFunctionDeclaration(current) || ts.isInterfaceDeclaration(current) || ts.isEnumDeclaration(current) || ts.isModuleDeclaration(current)) && current.name) parts.unshift(current.name.text);
    current = current.parent;
  }
  return parts;
}
function selectSymbolByName(ts, checker, program, selector, repoRoot, eligibleFiles) {
  const colon = selector.indexOf(':');
  const requestedFile = colon === -1 ? null : path.resolve(repoRoot, selector.slice(0, colon));
  const wanted = (colon === -1 ? selector : selector.slice(colon + 1)).split('.').filter(Boolean);
  if (!wanted.length) throw new Error('--symbol must name a declaration');
  const finalName = wanted.at(-1);
  const candidates = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (!eligibleFiles.has(path.resolve(sourceFile.fileName)) || (requestedFile && path.resolve(sourceFile.fileName) !== requestedFile)) continue;
    function visit(node) {
      if (node.name && ts.isIdentifier(node.name) && node.name.text === finalName) {
        const prefixes = qualifiedName(ts, node);
        const full = [...prefixes, finalName];
        if (wanted.length === 1 || full.join('.') === wanted.join('.')) {
          const symbol = canonical(ts, checker, checker.getSymbolAtLocation(node.name));
          if (symbol && symbol.declarations && symbol.declarations.some((d) => d.name === node.name)) candidates.set(symbol, node.name);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  if (candidates.size === 0) throw new Error(`no declaration named ${selector} in scope`);
  if (candidates.size > 1) {
    const choices = [...candidates].map(([symbol]) => symbol.declarations.map((d) => declarationSpan(ts, d, repoRoot).path).join(', '));
    throw new Error(`ambiguous --symbol ${selector}; use path:Qualified.Name. Candidates: ${choices.join(' | ')}`);
  }
  return [...candidates][0];
}
function limit(items, max) { return { items: items.slice(0, max), truncated: Math.max(0, items.length - max) }; }
function render(result, json) {
  if (json) return JSON.stringify(result, null, 2) + '\n';
  const lines = [`${result.query.kind}: ${result.symbol || result.query.at}`, `files: ${result.scope.includedFiles}; startup≈${result.timing.entryUptimeMs.toFixed(1)}ms program=${result.timing.programBuildMs.toFixed(1)}ms query=${result.timing.queryMs.toFixed(1)}ms`];
  for (const d of result.declarations.items) lines.push(`def ${d.role} ${d.identifier.path}:${d.range.start.line}:${d.range.start.column}-${d.range.end.line}:${d.range.end.column} (id ${d.identifier.start.line}:${d.identifier.start.column}-${d.identifier.end.line}:${d.identifier.end.column}; shown through line ${d.source.shownThroughLine}/${d.source.fullEndLine}${d.source.truncatedLines ? `; ${d.source.truncatedLines} lines omitted` : ''})`);
  if (result.declarations.truncated) lines.push(`... ${result.declarations.truncated} more declarations omitted`);
  for (const r of result.references.items) lines.push(`ref ${r.path}:${r.start.line}:${r.start.column}-${r.end.line}:${r.end.column}  ${r.snippet}`);
  if (result.references.truncated) lines.push(`... ${result.references.truncated} more references omitted`);
  lines.push(`limits: ${result.limits.join(' ')}`);
  return lines.join('\n') + '\n';
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  const requireTypeScript = createRequire(path.join(args.typescript, 'package.json'));
  const ts = requireTypeScript('typescript');
  const repoRoot = fs.realpathSync(args.repoRoot);
  const scopeRoot = fs.realpathSync(path.resolve(repoRoot, args.scope));
  if (!within(repoRoot, scopeRoot) || !fs.existsSync(scopeRoot) || !fs.statSync(scopeRoot).isDirectory()) throw new Error('--scope must be an existing directory within --repo-root');
  const files = listSourceFiles(scopeRoot);
  const eligibleFiles = new Set(files.map((file) => path.resolve(file)));
  if (!files.length) throw new Error('scope has no eligible TS/JS files');
  const options = { allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const buildStart = process.hrtime.bigint();
  const service = ts.createLanguageService(makeHost(ts, files, options), ts.createDocumentRegistry());
  const program = service.getProgram();
  const checker = program.getTypeChecker();
  const programBuildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
  const queryStart = process.hrtime.bigint();
  let symbol, location, definitions, references;
  if (args.at) {
    const at = parseAt(args.at, repoRoot);
    const sourceFile = program.getSourceFile(at.fileName);
    if (!sourceFile || !eligibleFiles.has(path.resolve(at.fileName))) throw new Error('--at file is not included by the scope policy');
    const position = positionFor(ts, sourceFile, at.line, at.column);
    const info = service.getQuickInfoAtPosition(at.fileName, position);
    if (!info) throw new Error('no TypeScript symbol at --at location');
    symbol = ts.displayPartsToString(info.displayParts);
    const definitionSymbols = new Set();
    for (const definition of service.getDefinitionAtPosition(at.fileName, position) || []) {
      const definitionSource = program.getSourceFile(definition.fileName);
      const token = definitionSource && ts.getTokenAtPosition(definitionSource, definition.textSpan.start);
      const definitionSymbol = token && canonical(ts, checker, checker.getSymbolAtLocation(token));
      if (definitionSymbol) definitionSymbols.add(definitionSymbol);
    }
    definitions = [...definitionSymbols].flatMap((definitionSymbol) => definitionSymbol.declarations || []).map((d) => declarationDetails(ts, d, repoRoot, args.declarationLines));
    references = (service.getReferencesAtPosition(at.fileName, position) || []).map((r) => textSpan(ts, program.getSourceFile(r.fileName), r.textSpan, repoRoot));
    location = args.at;
  } else {
    const [selected] = selectSymbolByName(ts, checker, program, args.symbol, repoRoot, eligibleFiles);
    const name = selected.declarations.find((d) => d.name && ts.isIdentifier(d.name))?.name;
    if (!name) throw new Error('selected symbol has no navigable identifier declaration');
    symbol = checker.symbolToString(selected);
    definitions = selected.declarations.map((d) => declarationDetails(ts, d, repoRoot, args.declarationLines));
    references = (service.getReferencesAtPosition(name.getSourceFile().fileName, name.getStart()) || []).map((r) => textSpan(ts, program.getSourceFile(r.fileName), r.textSpan, repoRoot));
  }
  const omittedByScope = { declarations: 0, references: 0 };
  definitions = definitions.filter((item) => { const keep = eligibleFiles.has(path.resolve(repoRoot, item.identifier.path)); if (!keep) omittedByScope.declarations += 1; return keep; });
  references = references.filter((item) => { const keep = eligibleFiles.has(path.resolve(repoRoot, item.path)); if (!keep) omittedByScope.references += 1; return keep; });
  const queryMs = Number(process.hrtime.bigint() - queryStart) / 1e6;
  const result = {
    tool: { name: 'semantic-navigation', typescript: ts.version, typescriptPath: args.typescript, coldProcess: true },
    query: args.at ? { kind: 'at', at: location } : { kind: 'symbol', symbol: args.symbol }, symbol,
    scope: { repoRoot, scope: args.scope, includedFiles: files.length, omittedByScope, dependencyResolution: 'TypeScript may parse imported files outside the root set; queries and returned source locations are restricted to eligible root files', policy: 'recursive TS/JS source only; excludes node_modules, test, tests, and __tests__ path segments; does not execute code or install target-repository dependencies' },
    outputPolicy: { resultLimit: args.limit, declarationLines: args.declarationLines, declarationSlice: 'AST declaration starts at range.start and ends at shownThroughLine; fullEndLine/range.end remain exact when the slice is truncated' },
    timing: { entryUptimeMs, programBuildMs, queryMs },
    declarations: limit(definitions, args.limit), references: limit(references, args.limit),
    limits: ['static TypeScript bindings only', 'dynamic import, eval, reflection, runtime registration/configuration, and external unresolved modules are not proven', 'source scope policy can omit callers outside the chosen directory'],
  };
  process.stdout.write(render(result, args.json));
}
try { main(); } catch (error) { fail(error.message); }
