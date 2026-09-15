// Python adapter: the standard-library `ast` script in extract.py reports raw
// import statements; this module lists files, runs the script, and resolves
// specifiers against the analyzed tree with the same external / outside /
// unknown policy as the TypeScript adapter.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../shared/diagnostics.mjs';
import { classifyRole, listFiles } from '../shared/files.mjs';
import { describeRepository } from '../shared/git.mjs';

export const id = 'py';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extract.py');
const PY_EXT = /\.py$/;
const CANDIDATES = process.env.BAUIFY_PYTHON
  ? [[process.env.BAUIFY_PYTHON, []]]
  : [['python3', []], ['python', []], ['py', ['-3']]];

export function detect(root, config) {
  return listFiles(root, config).some((f) => PY_EXT.test(f));
}

function runPython(request) {
  const input = JSON.stringify(request);
  const attempts = [];
  for (const [command, args] of CANDIDATES) {
    const result = spawnSync(command, [...args, SCRIPT], { input, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 256 * 1024 * 1024 });
    if (result.error) { attempts.push(`${command}: ${result.error.code || result.error.message}`); continue; }
    if (result.status !== 0) fail('extract/python-failed', 'The Python extractor exited with an error.', {
      subject: { command, script: SCRIPT },
      evidence: { exitCode: result.status, stderr: result.stderr.trim().split('\n').slice(-5) },
      supportedFixes: ['run the command manually to inspect the traceback', 'report it with the evidence'],
    });
    return { command, output: JSON.parse(result.stdout) };
  }
  fail('extract/python-unavailable', 'No Python 3 interpreter could be started.', {
    subject: { tried: CANDIDATES.map(([c]) => c) },
    evidence: { attempts },
    supportedFixes: ['install Python 3.8+ and put it on PATH', 'set BAUIFY_PYTHON to the interpreter path'],
  });
}

export function extract(root, config) {
  const absRoot = path.resolve(root);
  const files = listFiles(absRoot, config).filter((f) => PY_EXT.test(f));
  const fileSet = new Set(files);
  const { command, output } = runPython({ root: absRoot.split(path.sep).join('/'), files });

  const imports = [];
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  const parseErrors = [];
  const fileRecords = [];
  const symbols = [];
  for (const record of output.files) {
    fileRecords.push({ path: record.path, loc: record.loc, role: classifyRole(record.path, config.roles) });
    for (const b of record.symbols || []) symbols.push({ file: record.path, name: b.name, kind: b.kind, line: b.line });
    if (record.error) { parseErrors.push({ path: record.path, message: record.error }); continue; }
    const implicitStatements = new Set();
    for (const found of record.imports) {
      const flags = Object.fromEntries(['lazy', 'typeOnly', 'conditional'].filter((key) => found[key]).map((key) => [key, true]));
      if (found.opaque) {
        imports.push({ from: record.path, specifier: '<computed>', kind: found.kind, line: found.line, resolved: false, ...flags });
        unresolved.opaque += 1;
        continue;
      }
      for (const edge of resolveImport(found, record.path, fileSet)) {
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
    repository: { root: repo.root, revision: repo.revision, url: repo.url, language: 'py', adapter: `python@${output.python}` },
    files: fileRecords,
    imports,
    symbols: symbols.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.name, b.name)),
    calls: [],
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
function resolveImport(found, fromFile, fileSet) {
  const declared = resolveDeclaredImport(found, fromFile, fileSet);
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

function resolveDeclaredImport(found, fromFile, fileSet) {
  const { level, module, names } = found;
  const specifier = `${'.'.repeat(level)}${module}`;
  if (level === 0 && !module) return [];

  let base = null; // null = absolute import
  if (level > 0) {
    base = parentDir(path.posix.dirname(fromFile), level - 1);
    if (base === undefined) return [{ specifier, names, reason: 'outside' }];
  }

  const moduleTarget = module ? resolveDotted(module, base, fileSet) : packageFile(base, fileSet);

  // PEP 420 namespace package: a directory with no __init__.py. It has no file
  // of its own, so only `from ns import submodule` can produce edges.
  if (!moduleTarget) {
    const nsDir = module ? namespaceDir(module, base, fileSet) : base;
    if (nsDir !== null && names.length && names[0] !== '*') {
      const edges = [];
      for (const name of names) {
        const sub = resolveDotted(name, nsDir, fileSet);
        if (sub) edges.push({ specifier: `${specifier}.${name}`, names: ['*'], to: sub });
        else edges.push({ specifier: `${specifier}.${name}`, names: ['*'], reason: 'unknown' });
      }
      return edges;
    }
    if (level > 0) return [{ specifier, names, reason: 'unknown' }];
    const head = module.split('.')[0];
    const inTree = fileSet.has(`${head}.py`) || fileSet.has(`src/${head}.py`)
      || [...fileSet].some((f) => f.startsWith(`${head}/`) || f.startsWith(`src/${head}/`));
    return [{ specifier, names, reason: inTree ? 'unknown' : 'external' }];
  }

  const isPackage = moduleTarget.endsWith('__init__.py');
  if (!isPackage || !names.length || names[0] === '*') return [{ specifier, names, to: moduleTarget }];

  const pkgDir = moduleTarget === '__init__.py' ? '' : moduleTarget.slice(0, -'/__init__.py'.length);
  const edges = [];
  const attributeNames = [];
  for (const name of names) {
    const sub = resolveDotted(name, pkgDir, fileSet);
    if (sub) edges.push({ specifier: module ? `${specifier}.${name}` : `${specifier}${name}`, names: ['*'], to: sub });
    else attributeNames.push(name);
  }
  if (attributeNames.length || !edges.length) edges.unshift({ specifier, names: attributeNames.length ? attributeNames : names, to: moduleTarget });
  return edges;
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

// A dotted name that is a directory in the tree but has no __init__.py.
function namespaceDir(dotted, base, fileSet) {
  const rel = dotted.split('.').join('/');
  const prefixes = base === null ? ['', 'src/'] : [base ? `${base}/` : ''];
  for (const prefix of prefixes) {
    const dir = `${prefix}${rel}`;
    for (const file of fileSet) if (file.startsWith(`${dir}/`)) return dir;
  }
  return null;
}

// base: null = absolute (root, then src/); '' = repository root; 'a/b' = directory.
function resolveDotted(dotted, base, fileSet) {
  const rel = dotted.split('.').join('/');
  const prefixes = base === null ? ['', 'src/'] : [base ? `${base}/` : ''];
  for (const prefix of prefixes) {
    for (const candidate of [`${prefix}${rel}.py`, `${prefix}${rel}/__init__.py`]) {
      if (fileSet.has(candidate)) return candidate;
    }
  }
  return null;
}
