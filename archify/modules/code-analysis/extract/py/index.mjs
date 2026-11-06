// Python adapter: the standard-library `ast` script in extract.py reports raw
// import statements; this module lists files, runs the script, and resolves
// specifiers against the analyzed tree with the same external / outside /
// unknown policy as the TypeScript adapter.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../shared/diagnostics.mjs';
import { classifyRole, listFiles, snapshotSources } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';

export const id = 'py';
// Extraction logic revision; see extract/ts/index.mjs and docs/TECH-GUIDE.md.
export const REVISION = 7;

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extract.py');
const PY_EXT = /\.py$/;
const CANDIDATES = process.env.BAUIFY_PYTHON
  ? [[process.env.BAUIFY_PYTHON, []]]
  : [['python3', []], ['python', []], ['py', ['-3']]];

export function detect(root, config) {
  return listFiles(root, config).some((f) => PY_EXT.test(f));
}

export function countSources(root, config) {
  return listFiles(root, config).filter((f) => PY_EXT.test(f)).length;
}

export function runPython(request, candidates = CANDIDATES, spawn = spawnSync) {
  const input = JSON.stringify(request);
  const attempts = [];
  for (const [command, args] of candidates) {
    const probe = spawn(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { encoding: 'utf8', timeout: 5000 });
    if (probe.error || probe.status !== 0) {
      attempts.push(`${command}: incompatible or unavailable Python 3.8+ (${probe.error?.code || probe.status})`);
      continue;
    }
    const result = spawn(command, [...args, SCRIPT], { input, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 256 * 1024 * 1024 });
    if (result.error) { attempts.push(`${command}: ${result.error.code || result.error.message}`); continue; }
    if (result.status !== 0) fail('extract/python-failed', 'The Python extractor exited with an error.', {
      subject: { command, script: SCRIPT },
      evidence: { exitCode: result.status, stderr: result.stderr.trim().split('\n').slice(-5) },
      supportedFixes: ['run the command manually to inspect the traceback', 'report it with the evidence'],
    });
    return { command, output: JSON.parse(result.stdout) };
  }
  fail('extract/python-unavailable', 'No Python 3 interpreter could be started.', {
    subject: { tried: candidates.map(([c]) => c) },
    evidence: { attempts },
    supportedFixes: ['install Python 3.8+ and put it on PATH', 'set BAUIFY_PYTHON to the interpreter path'],
  });
}

export function extract(root, config) {
  const absRoot = path.resolve(root);
  const { contents: snapshot, packageMarkers } = snapshotSources(absRoot, config, f => PY_EXT.test(f));
  const files = [...snapshot.keys()];
  const fileSet = new Set(files);
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join('/'));
  }
  const { command, output } = runPython({ files, sources: Object.fromEntries([...snapshot].map(([rel, bytes]) => [rel, bytes.toString('base64')])) });

  const calls = [];
  const parsedFiles = new Map(output.files.filter(record => !record.error).map(record => [record.path, record]));
  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  const parseErrors = [];
  const fileRecords = [];
  const symbols = [];
  const functions = [];
  for (const record of output.files) {
    fileRecords.push({ path: record.path, loc: record.loc, role: classifyRole(record.path, config.roles), sourceText: record.sourceText });
    for (const b of record.symbols || []) symbols.push({ file: record.path, name: b.name, kind: b.kind, line: b.line });
    for (const fn of record.functions || []) functions.push({ file: record.path, ...fn });
    if (record.error) { parseErrors.push({ path: record.path, message: record.error }); continue; }
    for (const found of record.calls || []) {
      const { _import: binding, ...call } = found;
      if (binding) {
        const edges = resolveDeclaredImport({ module: binding.module, level: binding.level, names: [binding.name] }, record.path, fileSet);
        const targets = edges.filter(edge => edge.to && edge.to !== record.path && edge.names?.includes(binding.name));
        if (targets.length === 1) {
          const file = targets[0].to;
          const definitions = parsedFiles.get(file)?.definitions;
          const target = definitions && Object.hasOwn(definitions, binding.name) ? definitions[binding.name] : null;
          if (target) {
            call.resolution = 'imported-function'; delete call.reason;
            call.target = { file, name: target.name, line: target.line, column: target.column };
          }
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
    repository: { ...repo, language: 'py', adapter: `python@${output.python}`, adapterRevision: REVISION },
    files: fileRecords,
    packageMarkers,
    imports,
    symbols: symbols.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.name, b.name)),
    functions: functions.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.qualname, b.qualname)),
    callModel: 'python-lexical-v1',
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
