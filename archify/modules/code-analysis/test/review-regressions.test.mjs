import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { globToRegExp } from '../extract/shared/glob.mjs';
import { extract } from '../extract/py/index.mjs';
import { run as moduleCycles } from '../evaluate/rules/coupling/cycle.mjs';
import { run as fileCycles } from '../evaluate/rules/coupling/import-cycle.mjs';
import { withInstallLock } from '../lib/install-lock.mjs';
import { snapshotFiles } from '../extract/shared/files.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url)));
function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test('glob alternatives translate wildcards and nested braces consistently', () => {
  const match = globToRegExp('**/{*.test,{unit?,integration*}}.{js,ts}');
  for (const name of ['a.test.js', 'src/unit1.ts', 'src/integration-long.js']) assert.ok(match.test(name), name);
  for (const name of ['src/unit12.ts', 'a.js', 'src/a.test.py']) assert.ok(!match.test(name), name);
  assert.ok(globToRegExp(String.raw`literal\{x\}\*.js`).test('literal{x}*.js'));
  assert.throws(() => globToRegExp('{a,{b,c}'), /Unclosed brace/);
});

test('both coupling rules handle a dependency chain beyond the JS call stack', () => {
  const ids = Array.from({ length: 16000 }, (_, i) => `n${String(i).padStart(5, '0')}`);
  const edges = ids.slice(1).map((to, i) => ({ from: ids[i], to, weight: 1, kinds: { eager: 1 }, evidence: [] }));
  const graph = { modules: ids.map(id => ({ id, label: id })), edges, excluded: { roles: [] } };
  assert.deepEqual(moduleCycles({ graph }), []);
  const facts = { files: ids.map(path => ({ path, role: 'source' })), repository: { language: 'py' }, imports: edges.map(e => ({ ...e, resolved: true, kind: 'static', line: 1 })) };
  assert.deepEqual(fileCycles({ graph, facts }), []);
  edges.push({ from: ids.at(-1), to: ids.at(-2), weight: 1, kinds: { eager: 1 }, evidence: [] });
  assert.deepEqual(moduleCycles({ graph })[0].subject.modules, ids.slice(-2));
  facts.imports.push({ ...edges.at(-1), resolved: true, kind: 'static', line: 1 });
  assert.deepEqual(fileCycles({ graph, facts })[0].subject.files, ids.slice(-2));
});

test('Python honors source encoding cookies, BOMs, and reports invalid encodings', t => {
  const root = fixture(t, {
    'latin.py': Buffer.from('# coding: cp1252\nname = "caf\xe9 \x80"\n', 'latin1'),
    'bom.py': Buffer.from('\ufeffname = "café"\n'),
    'bad.py': '# coding: not-an-encoding\nname = 1\n',
  });
  const facts = extract(root, config);
  assert.equal(facts.files.find(f => f.path === 'latin.py').sourceText, '# coding: cp1252\nname = "café €"\n');
  assert.equal(facts.files.find(f => f.path === 'bom.py').sourceText, 'name = "café"\n');
  assert.deepEqual(facts.parse_errors.map(e => e.path), ['bad.py']);
});

test('Python loader recognition respects statement order and lexical rebinding', t => {
  const root = fixture(t, {
    'dep.py': '',
    'ordered.py': 'import importlib\nimportlib.import_module("dep")\nimportlib = object()\nimportlib.import_module("dep")\n__import__("dep")\n__import__ = lambda x: x\n__import__("dep")\n',
    'scopes.py': `import importlib
def parameter(importlib):
    importlib.import_module("dep")
def local():
    __import__("dep")
    __import__ = lambda x: x
def good():
    importlib.import_module("dep")
def nested():
    importlib = object()
    def inner():
        nonlocal importlib
        importlib.import_module("dep")
def alias():
    import importlib as loader
    loader.import_module("dep")
`,
    'global.py': 'import importlib\ndef bad():\n    global importlib\n    importlib = object()\n    importlib.import_module("dep")\ndef uncertain():\n    importlib.import_module("dep")\n',
    'nonlocal.py': 'def outer():\n    import importlib\n    def inner():\n        nonlocal importlib\n        importlib = object()\n        importlib.import_module("dep")\n',
  });
  const dynamic = extract(root, config).imports.filter(e => e.kind === 'dynamic');
  assert.deepEqual(dynamic.map(e => [e.from, e.line]), [['ordered.py', 2], ['ordered.py', 5], ['scopes.py', 8], ['scopes.py', 16]]);
});

test('relative Python imports cannot escape a top-level or src-layout package', t => {
  const root = fixture(t, { 'src/app/core.py': 'from ..sibling import x\nfrom . import sub\n', 'src/sibling.py': 'x = 1', 'src/app/sub.py': '' });
  const facts = extract(root, config);
  assert.equal(facts.unresolved.outside, 1);
  assert.equal(facts.imports.find(e => e.specifier === '..sibling').resolved, false);
  assert.equal(facts.imports.find(e => e.to === 'src/app/sub.py').resolved, true);
  const packageRoot = fixture(t, { '__init__.py': '', 'core.py': 'from . import sub\nfrom .. import missing\n', 'sub.py': '' });
  const packageFacts = extract(packageRoot, config);
  assert.equal(packageFacts.imports.find(e => e.to === 'sub.py').resolved, true);
  assert.equal(packageFacts.unresolved.outside, 1);
});

test('Python free loaders honor global declarations and uncertain conditional imports', t => {
  const root = fixture(t, {
    'dep.py': '',
    'global.py': 'import importlib\ndef outer():\n    importlib = object()\n    def inner():\n        global importlib\n        importlib.import_module("dep")\n',
    'conditional.py': 'if condition:\n    import importlib\ndef load():\n    importlib.import_module("dep")\n',
    'comprehension.py': 'import importlib\n[importlib.import_module("dep") for importlib in loaders]\nimportlib.import_module("dep")\n',
  });
  assert.deepEqual(extract(root, config).imports.filter(e => e.kind === 'dynamic').map(e => [e.from, e.line]), [
    ['comprehension.py', 3], ['global.py', 6],
  ]);
});

test('separate installers serialize and recheck shared dependency state', async t => {
  const root = fixture(t);
  const module = new URL('../lib/install-lock.mjs', import.meta.url).href;
  const script = `import fs from 'node:fs'; import { setTimeout } from 'node:timers/promises'; import { withInstallLock } from ${JSON.stringify(module)};
    const root = process.argv[1]; await withInstallLock(root, async () => {
      if (fs.existsSync(root + '/ready')) return;
      fs.appendFileSync(root + '/installs', 'install\\n'); await setTimeout(150);
      fs.writeFileSync(root + '/ready', 'ready');
    });`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, root]);
    let error = ''; child.stderr.on('data', data => { error += data; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)));
  });
  await Promise.all([run(), run(), run()]);
  assert.equal(fs.readFileSync(path.join(root, 'installs'), 'utf8'), 'install\n');
  await assert.rejects(withInstallLock(root, () => { throw new Error('installer failed'); }), /installer failed/);
  assert.equal(fs.existsSync(path.join(root, '.code-analysis-install.lock')), false);
});

test('extraction rejects a directory replaced after enumeration, before reading outside bytes', t => {
  const root = fixture(t, { 'src/index.py': 'inside = True\n' });
  const outside = fixture(t, { 'index.py': 'secret = True\n' });
  const original = fs.readdirSync;
  let swapped = false;
  fs.readdirSync = function (dir, ...args) {
    const entries = original.call(this, dir, ...args);
    if (!swapped && path.resolve(dir) === fs.realpathSync(root)) {
      swapped = true;
      fs.renameSync(path.join(root, 'src'), path.join(root, 'saved'));
      fs.symlinkSync(outside, path.join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    return entries;
  };
  try { assert.throws(() => snapshotFiles(root, config), error => error.diagnostics?.[0].code === 'extract/source-changed'); }
  finally { fs.readdirSync = original; }
});

test('source snapshots skip existing links and retain bytes after the live path changes', t => {
  const root = fixture(t, { 'src/index.py': 'inside = True\n' });
  const outside = fixture(t, { 'index.py': 'secret = True\n' });
  fs.symlinkSync(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  const snapshot = snapshotFiles(root, config);
  fs.writeFileSync(path.join(root, 'src/index.py'), 'changed = True\n');
  assert.deepEqual([...snapshot.keys()], ['src/index.py']);
  assert.equal(snapshot.get('src/index.py').toString(), 'inside = True\n');
});

test('source snapshots reject a file swapped between path validation and descriptor opening', t => {
  const root = fixture(t, { 'index.py': 'inside = True\n' });
  const original = fs.openSync;
  let swapped = false;
  fs.openSync = function (file, ...args) {
    if (!swapped && file === path.join(fs.realpathSync(root), 'index.py')) {
      swapped = true;
      fs.renameSync(file, path.join(root, 'saved.py'));
      fs.writeFileSync(file, 'replacement = True\n');
    }
    return original.call(this, file, ...args);
  };
  try { assert.throws(() => snapshotFiles(root, config), error => error.diagnostics?.[0].code === 'extract/source-changed'); }
  finally { fs.openSync = original; }
});
