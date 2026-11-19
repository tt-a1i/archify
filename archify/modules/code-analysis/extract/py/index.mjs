// Python source analysis using the transplanted Pyright parser. Target source
// is captured once and never imported or executed.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../shared/diagnostics.mjs';
import { analyzeFile, resolveSourceCalls } from './analyze.mjs';
import { classifyRole, listFiles, snapshotSources } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';
import { captureDeclarations } from './declarations.mjs';

export const id = 'py';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 16;

const PY_EXT = /\.py$/;

export function detect(root, config) {
  return listFiles(root, config).some((f) => PY_EXT.test(f));
}

export function countSources(root, config) {
  return listFiles(root, config).filter((f) => PY_EXT.test(f)).length;
}

export function extract(root, config) {
  const targetVersion = config.python?.targetVersion ?? '3.14';
  if (typeof targetVersion !== 'string' || !/^3\.(?:[8-9]|1[0-4])$/.test(targetVersion)) fail('extract/python-target-version', 'python.targetVersion must be a supported Python version from 3.8 through 3.14.', {
    subject: { setting: 'python.targetVersion' }, evidence: { value: targetVersion }, supportedFixes: ['choose a string such as "3.12" or "3.14"'],
  });
  const absRoot = path.resolve(root);
  const { contents: snapshot, packageMarkers } = snapshotSources(absRoot, config, f => PY_EXT.test(f));
  const files = [...snapshot.keys()];
  const fileSet = new Set(files);
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
  }
  const analyses = [...snapshot].map(([file, bytes]) => analyzeFile(file, bytes, targetVersion));
  const dependencies = captureDeclarations(fs.realpathSync(absRoot), config.python?.declarations, targetVersion, fileSet);
  const records = analyses.map(analysis => analysis.record);
  resolveSourceCalls(analyses, (from, module, level, name) => {
    if (level && dependencies.origins.has(from)) return dependencies.locate(from, module, level, name);
    const edges = resolveDeclaredImport({ module, level, names: name ? [name] : ['*'] }, from, fileSet, directories);
    if (edges.length !== 1) return;
    const edge = edges[0];
    if (edge.to) return { file: edge.to, module: !name || !edge.names?.includes(name) };
    if (edge.reason === 'external') return dependencies.locate(from, module, level, name);
  }, dependencies.analyses);

  const calls = [];
  const parsedFiles = new Map(records.filter(record => !record.error).map(record => [record.path, record]));
  // Reuse captured import resolution for one explicit reexport. No project
  // import or arbitrary chain traversal; ambiguous/rebound bindings are absent.
  const importedDefinition = (from, binding, reexports = 1) => {
    const edges = resolveDeclaredImport({ module: binding.module, level: binding.level, names: [binding.name] }, from, fileSet, directories);
    const targets = edges.filter(edge => edge.to && edge.to !== from && edge.names?.includes(binding.name));
    if (targets.length !== 1) return null;
    const file = targets[0].to, record = parsedFiles.get(file);
    if (!record) return null;
    const target = Object.hasOwn(record.definitions, binding.name) ? record.definitions[binding.name] : null;
    if (target) return { file, name: target.name, line: target.line, column: target.column };
    const forwarded = Object.hasOwn(record.importBindings, binding.name) ? record.importBindings[binding.name] : null;
    return reexports && forwarded ? importedDefinition(file, forwarded, reexports - 1) : null;
  };
  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  const parseErrors = [];
  const fileRecords = [];
  const symbols = [];
  const functions = [];
  for (const record of records) {
    fileRecords.push({ path: record.path, loc: record.loc, role: classifyRole(record.path, config.roles), sourceText: record.sourceText });
    for (const b of record.symbols || []) symbols.push({ file: record.path, name: b.name, kind: b.kind, line: b.line });
    for (const fn of record.functions || []) functions.push({ file: record.path, ...fn });
    if (record.error) { parseErrors.push({ path: record.path, message: record.error }); continue; }
    for (const found of record.calls || []) {
      const { _import: binding, ...call } = found;
      if (binding) {
        const target = importedDefinition(record.path, binding);
        if (target && target.file !== record.path) {
          call.resolution = 'imported-function'; delete call.reason;
          call.target = target;
        }
      }
      calls.push({ file: record.path, ...call });
    }
    const implicitStatements = new Set();
    for (const found of record.imports) {
      const flags = Object.fromEntries(['lazy', 'typeOnly', 'conditional'].filter((key) => found[key]).map((key) => [key, true]));
      if (found.opaque) {
        imports.push({ from: record.path, specifier: '<computed>', kind: found.kind, line: found.line, resolved: false, ...flags });
        unresolved.opaque += 1;
        continue;
      }
      for (const edge of resolveImport(found, record.path, fileSet, directories)) {
        // Aliases share an AST statement position; semicolon-separated statements do not.
        if (edge.implicit) {
          const key = JSON.stringify([found.line, found.column, edge.to]);
          if (implicitStatements.has(key)) continue;
          implicitStatements.add(key);
        }
        const out = { from: record.path, specifier: edge.specifier, kind: found.kind, line: found.line, resolved: false, ...flags };
        if (edge.names && edge.names.length) out.names = edge.names;
        if (edge.implicit) out.implicit = true;
        if (edge.to) { out.to = edge.to; out.resolved = true; } else unresolved[edge.reason] += 1;
        imports.push(out);
      }
    }
  }
  imports.sort((a, b) => compareText(a.from, b.from) || a.line - b.line || compareText(a.specifier, b.specifier));

  const repo = describeRepository(absRoot);
  const facts = {
    schema_version: 1,
    repository: { ...repo, language: 'py', adapter: `pyright-parser@1.1.414/python-${targetVersion}`, adapterRevision: REVISION },
    files: fileRecords,
    packageMarkers,
    imports,
    symbols: symbols.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.name, b.name)),
    functions: functions.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.qualname, b.qualname)),
    callModel: 'python-source-v3',
    ...(dependencies.scope.declarations.length ? { languageScope: dependencies.scope } : {}),
    calls,
    unresolved,
  };
  if (parseErrors.length) facts.parse_errors = parseErrors.sort((a, b) => compareText(a.path, b.path));
  return facts;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Returns one or more edges for a raw import. A `from pkg import a, b` whose
// names are themselves submodules yields one edge per submodule plus the
// package edge when any name is an attribute rather than a submodule.
function resolveImport(found, fromFile, fileSet, directories) {
  const declared = resolveDeclaredImport(found, fromFile, fileSet, directories);
  const seen = new Set(declared.filter((e) => e.to).map((e) => e.to));
  const initializers = [];
  for (const edge of declared) {
    if (!edge.to) continue;
    const dirs = edge.to.split('/').slice(0, -1);
    for (let i = 1; i <= dirs.length; i += 1) {
      const dir = dirs.slice(0, i).join('/');
      const init = `${dir}/__init__.py`;
      // The importing module's own ancestors are already being initialized.
      // Re-entering them does not execute their bodies a second time.
      if (fromFile.startsWith(`${dir}/`) || !fileSet.has(init) || seen.has(init)) continue;
      seen.add(init);
      initializers.push({ specifier: edge.specifier, names: ['*'], to: init, implicit: true });
    }
  }
  return [...initializers, ...declared];
}

function resolveDeclaredImport(found, fromFile, fileSet, directories) {
  const { level, module, names } = found;
  const specifier = `${'.'.repeat(level)}${module}`;
  if (level === 0 && !module) return [];

  let base = null; // null = absolute import
  if (level > 0) {
    const dirs = fromFile.split('/').slice(0, -1);
    // src/ is a search root, not a package, unless it has an initializer.
    const rootPackage = fileSet.has('__init__.py');
    const depth = dirs.length + (rootPackage ? 1 : 0)
      - (!rootPackage && dirs[0] === 'src' && !fileSet.has('src/__init__.py') ? 1 : 0);
    if (level > depth) return [{ specifier, names, reason: 'outside' }];
    base = parentDir(path.posix.dirname(fromFile), level - 1);
    if (base === undefined) return [{ specifier, names, reason: 'outside' }];
  }

  const searchDirs = base === null ? ['', 'src'] : relativeSearchDirs(base, fileSet, directories);
  const target = module ? resolveDotted(module, searchDirs, fileSet, directories)
    : { file: packageFile(base, fileSet), dirs: searchDirs };
  const moduleTarget = target?.file;

  // PEP 420 namespace package: a directory with no __init__.py. It has no file
  // of its own, so only `from ns import submodule` can produce edges.
  if (!moduleTarget) {
    if (target?.dirs.length && names.length && names[0] !== '*') {
      const edges = [];
      for (const name of names) {
        const sub = resolveDotted(name, target.dirs, fileSet, directories)?.file;
        const member = module ? `${specifier}.${name}` : `${specifier}${name}`;
        if (sub) edges.push({ specifier: member, names: ['*'], to: sub });
        else edges.push({ specifier: member, names: ['*'], reason: 'unknown' });
      }
      return edges;
    }
    if (level > 0) return [{ specifier, names, reason: 'unknown' }];
    const head = module.split('.')[0];
    const inTree = fileSet.has(`${head}.py`) || fileSet.has(`src/${head}.py`)
      || directories.has(head) || directories.has(`src/${head}`);
    return [{ specifier, names, reason: inTree ? 'unknown' : 'external' }];
  }

  const isPackage = moduleTarget.endsWith('__init__.py');
  if (!isPackage || !names.length || names[0] === '*') return [{ specifier, names, to: moduleTarget }];

  const edges = [];
  const attributeNames = [];
  for (const name of names) {
    const sub = resolveDotted(name, target.dirs, fileSet, directories)?.file;
    if (sub) edges.push({ specifier: module ? `${specifier}.${name}` : `${specifier}${name}`, names: ['*'], to: sub });
    else attributeNames.push(name);
  }
  if (attributeNames.length || !edges.length) edges.unshift({ specifier, names: attributeNames.length ? attributeNames : names, to: moduleTarget });
  return edges;
}

// A namespace package can have portions in both conventional search roots.
// Expand only when the inferred package includes this physical directory.
// An analyzed package root has no known external import name; keep its lexical
// relative paths, as for regular packages and shadowed source directories.
function relativeSearchDirs(base, fileSet, directories) {
  if (!base || fileSet.has('__init__.py') || packageFile(base, fileSet)) return [base];
  const parts = base.split('/');
  if (parts[0] === 'src' && !fileSet.has('src/__init__.py')) parts.shift();
  if (!parts.length) return [base];
  const target = resolveDotted(parts.join('.'), ['', 'src'], fileSet, directories);
  return target && !target.file && target.dirs.includes(base) ? target.dirs : [base];
}

// Walk `up` parent directories from dir; returns undefined when leaving the tree.
function parentDir(dir, up) {
  let current = dir === '.' ? '' : dir;
  for (let i = 0; i < up; i += 1) {
    if (!current) return undefined;
    current = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
  }
  return current;
}

function packageFile(dir, fileSet) {
  const candidate = dir ? `${dir}/__init__.py` : '__init__.py';
  return fileSet.has(candidate) ? candidate : null;
}

// Resolve each parent before its children. A regular package confines lookup
// to its directory; a module has no children. PEP 420 portions accumulate only
// until a regular package or module is found in the ordered search paths.
function resolveDotted(dotted, searchDirs, fileSet, directories) {
  let target;
  for (const part of dotted.split('.')) {
    const portions = [];
    target = null;
    for (const parent of searchDirs) {
      const dir = parent ? `${parent}/${part}` : part;
      const init = packageFile(dir, fileSet);
      if (init) { target = { file: init, dirs: [dir] }; break; }
      if (fileSet.has(`${dir}.py`)) { target = { file: `${dir}.py`, dirs: [] }; break; }
      if (directories.has(dir)) portions.push(dir);
    }
    if (!target && portions.length) target = { file: null, dirs: portions };
    if (!target) return null;
    searchDirs = target.dirs;
  }
  return target;
}
