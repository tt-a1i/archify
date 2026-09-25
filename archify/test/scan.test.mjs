import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-scan-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function scan(folder, ...args) {
  const result = spawnSync(process.execPath, [cli, 'scan', folder, '--json', ...args], { encoding: 'utf8' });
  let receipt = null;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    receipt = null;
  }
  return { ...result, receipt };
}

function ids(document, key = 'components') {
  return new Set(document[key].map((entry) => entry.id));
}

const PYTHON_PROJECT = {
  'app/__init__.py': '',
  'app/config.py': 'import os\nDB = os.getenv("DB")\n',
  'app/db.py': 'from .config import DB\nimport redis\n',
  'app/llm.py': '"""Not an import: import os from docs."""\nfrom .config import DB\nfrom openai import OpenAI\n',
  'app/service.py': 'from .config import DB\nfrom . import (\n    db,\n    llm,\n)\nimport redis  # already reached through db\n',
  'app/main.py': [
    'from fastapi import FastAPI',
    'from .service import *',
    'app = FastAPI()',
    '@app.get("/")',
    'def root():',
    '    return {}',
    '@app.post("/chat")',
    'def chat():',
    '    return {}',
    '',
  ].join('\n'),
  'app/test_main.py': 'from .db import *\n',
  'static/app.js': 'fetch("/chat"); new EventSource("/stream");\n',
  'tests/test_api.py': 'from app.main import app\n',
};

test('scan drafts a validated Python architecture from static imports', (t) => {
  const root = tempDir(t);
  write(root, PYTHON_PROJECT);
  const output = path.join(root, 'out/draft.architecture.json');
  const result = scan(root, '--output', output, '--title', 'Python draft');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.receipt.ok, true);
  assert.equal(result.receipt.validation.errors, 0);
  assert.deepEqual(result.receipt.hiddenModules, ['__init__.py', 'config.py']);
  assert.deepEqual(result.receipt.services, ['svc-openai', 'svc-redis']);

  const document = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(document.meta.title, 'Python draft');
  assert.equal(document.diagram_type, 'architecture');
  assert.deepEqual([...ids(document)].sort(), [
    'frontend', 'mod-app-db', 'mod-app-llm', 'mod-app-main', 'mod-app-service', 'svc-openai', 'svc-redis',
  ]);
  const connections = ids(document, 'connections');
  for (const expected of [
    'frontend--mod-app-main',
    'mod-app-main--mod-app-service',
    'mod-app-service--mod-app-db',
    'mod-app-service--mod-app-llm',
    'mod-app-db--svc-redis',
    'mod-app-llm--svc-openai',
  ]) {
    assert.ok(connections.has(expected), `missing ${expected}`);
  }
  assert.ok(!connections.has('mod-app-service--svc-redis'), 'service reaches Redis through db; the direct edge is redundant');
  const main = document.components.find((component) => component.id === 'mod-app-main');
  assert.equal(main.tag, 'FastAPI · 2 routes');
  const frontend = document.components.find((component) => component.id === 'frontend');
  assert.equal(frontend.tag, '2 request sites');
  assert.equal(document.components.some((component) => /test/.test(component.id)), false);
});

test('scan resolves JavaScript and TypeScript imports, requires, and dynamic imports', (t) => {
  const root = tempDir(t);
  write(root, {
    'package.json': '{"type":"module"}',
    'src/server.ts': "import express from 'express';\nimport { routes } from './routes';\nconst app = express();\napp.get('/health', () => {});\napp.post('/orders', () => {});\n",
    'src/routes/index.ts': "export { orders } from './orders.js';\n",
    'src/routes/orders.ts': "import type { Order } from '../types';\nconst db = require('../db/client');\nexport const orders = () => import('../queue/publish.mjs');\n",
    'src/types.ts': 'export type Order = { id: string };\n',
    'src/db/client.cjs': "const { Pool } = require('pg');\nmodule.exports = new Pool();\n",
    'src/queue/index.ts': "export * from './publish.mjs';\n",
    'src/queue/publish.mjs': "import { Queue } from 'bullmq';\nimport Redis from 'ioredis';\n// import fake from './missing';\n",
    'src/routes/orders.test.ts': "import { orders } from './orders';\n",
    'node_modules/pg/index.js': "require('./lib');\n",
  });
  const output = path.join(root, 'draft.architecture.json');
  const result = scan(path.join(root, 'src'), '--output', output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const document = JSON.parse(fs.readFileSync(output, 'utf8'));
  const connections = ids(document, 'connections');
  for (const expected of [
    'mod-server--mod-routes-index',
    'mod-routes-index--mod-routes-orders',
    'mod-routes-orders--mod-types',
    'mod-routes-orders--mod-db-client',
    'mod-routes-orders--mod-queue-publish',
    'mod-db-client--svc-postgres',
    'mod-queue-publish--svc-queue',
    'mod-queue-publish--svc-redis',
  ]) {
    assert.ok(connections.has(expected), `missing ${expected}`);
  }
  const server = document.components.find((component) => component.id === 'mod-server');
  assert.equal(server.tag, 'Express · 2 routes');
  const labels = document.components.map((component) => component.label);
  assert.ok(labels.includes('routes/index.ts'), 'duplicate basenames keep their folder');
  assert.ok(labels.includes('queue/index.ts'));
  assert.equal(labels.some((label) => label.includes('test')), false);
});

test('scan output is deterministic for identical trees', (t) => {
  const root = tempDir(t);
  write(root, PYTHON_PROJECT);
  const first = path.join(root, 'first.json');
  const second = path.join(root, 'second.json');
  assert.equal(scan(root, '--output', first).status, 0);
  assert.equal(scan(root, '--output', second).status, 0);
  assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8'));
});

test('large repositories collapse into folder nodes and unconnected modules sit below the graph', (t) => {
  const root = tempDir(t);
  const files = {};
  for (const folder of ['api', 'core', 'jobs']) {
    for (let index = 0; index < 9; index += 1) {
      const next = folder === 'api' ? "import '../core/m0.js';\n" : folder === 'core' ? "import pg from 'pg';\n" : '';
      files[`${folder}/m${index}.js`] = index === 0 ? next : '';
    }
  }
  write(root, files);
  const output = path.join(root, 'draft.architecture.json');
  const result = scan(root, '--output', output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.receipt.aggregated, true);
  const document = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual([...ids(document)].sort(), ['dir-api', 'dir-core', 'dir-jobs', 'svc-postgres']);
  assert.ok(ids(document, 'connections').has('dir-api--dir-core'));
  const byId = Object.fromEntries(document.components.map((component) => [component.id, component]));
  assert.equal(byId['dir-jobs'].sublabel, '9 modules');
  const connectedBottom = Math.max(...['dir-api', 'dir-core', 'svc-postgres'].map((id) => byId[id].pos[1] + byId[id].size[1]));
  assert.ok(byId['dir-jobs'].pos[1] > connectedBottom, 'unconnected folder is placed below the graph');
});

test('scan --evidence pins sources to the checked-out revision and validates them', (t) => {
  const root = tempDir(t);
  write(root, { 'service/app/__init__.py': '', 'service/app/main.py': 'from .db import *\n', 'service/app/db.py': 'import redis\n' });
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.email=ci@example.com', '-c', 'user.name=ci', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('remote', 'add', 'origin', 'git@github.com:example/service.git');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const revision = git('rev-parse', 'HEAD');
  const output = path.join(root, 'draft.architecture.json');
  const result = scan(path.join(root, 'service'), '--output', output, '--evidence');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const document = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(document.meta.repository, { url: 'https://github.com/example/service', revision });
  const main = document.components.find((component) => component.id === 'mod-app-main');
  assert.deepEqual(main.sources, [{ path: 'service/app/main.py', line: 1 }]);
});

test('scan failures are machine-readable', (t) => {
  const root = tempDir(t);
  const missing = scan(path.join(root, 'missing'));
  assert.equal(missing.status, 1);
  assert.equal(missing.receipt.ok, false);
  assert.equal(missing.receipt.diagnostics[0].code, 'scan/folder-not-found');

  write(root, { 'README.md': '# nothing to scan\n' });
  const empty = scan(root, '--output', path.join(root, 'x.json'));
  assert.equal(empty.status, 1);
  assert.match(empty.receipt.error, /no Python or JavaScript\/TypeScript modules/);
  assert.equal(empty.receipt.diagnostics[0].code, 'scan/no-modules');

  const unknown = scan(root, '--frobnicate');
  assert.equal(unknown.status, 2);
  assert.equal(unknown.receipt.diagnostics[0].code, 'cli/unknown-option');

  const badOutput = scan(root, '--output', path.join(root, 'draft.html'));
  assert.equal(badOutput.status, 2);
  assert.equal(badOutput.receipt.diagnostics[0].code, 'cli/invalid-output');

  write(root, { 'app/main.py': 'import redis\n' });
  const noGit = scan(root, '--output', path.join(root, 'x.json'), '--evidence');
  assert.equal(noGit.status, 1);
  assert.equal(noGit.receipt.diagnostics[0].code, 'scan/evidence-unavailable');
});
