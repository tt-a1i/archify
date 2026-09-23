import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRepositoryEvidence, buildRepositoryIndex, createRepositorySnapshot } from '../modules/repository-index/index.mjs';
import { buildSourceLevel2 } from '../modules/repository-index/source-level2.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-source-level2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function level2(root, options) {
  const snapshot = createRepositorySnapshot(root);
  return buildSourceLevel2(root, snapshot.records, options);
}

test('Level 2 resolves Python imports through a nested python/<package> source layout', (t) => {
  const root = workspace(t);
  write(root, 'python/pkg/__init__.py', '');
  write(root, 'python/pkg/core.py', [
    'import pkg.util',
    'from . import helpers',
    'from .sub import thing',
    'import numpy',
    'import mystery_pkg.tools',
    '"""',
    'import fake_in_docstring',
    '"""',
  ].join('\n'));
  write(root, 'python/pkg/util.py', 'VALUE = 1\n');
  write(root, 'python/pkg/helpers.py', 'import importlib\n');
  write(root, 'python/pkg/sub/__init__.py', '');
  write(root, 'python/pkg/sub/thing.py', 'from ..util import VALUE\n');
  write(root, 'scripts/run.py', 'import pkg.core\n');

  const graph = level2(root);
  assert.equal(graph.name, 'source-import-graph');
  assert.equal(graph.sourceBodiesIncluded, true, 'runtime channel excerpts contain source lines');
  assert.equal(graph.truncated, false);

  const edge = graph.edges.find((entry) => entry.from === 'scripts' && entry.to === 'python/pkg');
  assert.ok(edge, 'the nested package resolves from a top-level script');
  assert.equal(edge.weight, 1);
  assert.deepEqual(edge.evidence, [{ file: 'scripts/run.py', line: 1, to: 'python/pkg/core.py' }]);

  const internal = graph.fileEdges.filter((entry) => entry.from === 'python/pkg/core.py');
  assert.deepEqual(internal.map((entry) => entry.to), ['python/pkg/util.py', 'python/pkg/helpers.py', 'python/pkg/sub/thing.py']);
  assert.ok(graph.fileEdges.some((entry) => entry.from === 'python/pkg/sub/thing.py' && entry.to === 'python/pkg/util.py'),
    'a parent-relative import resolves through the package chain');

  assert.equal(graph.unresolved.external, 2, 'numpy and mystery_pkg are third-party names');
  assert.equal(graph.unresolved.stdlib, 1, 'importlib is standard library, not a dependency');
  assert.equal(graph.unresolved.dynamic, 1, 'importlib usage is counted, not resolved');
  assert.equal(graph.unresolved.unknown, 0);
  assert.deepEqual(graph.unresolved.topUnknown, []);
  assert.deepEqual(graph.unresolved.topExternal.map((entry) => entry.name).sort(), ['mystery_pkg', 'numpy'],
    'external names are ranked so Level 3 can cross-check them against declared dependencies');
  assert.ok(!JSON.stringify(graph).includes('fake_in_docstring'), 'docstring text never registers as an import');

  const pkgModule = graph.modules.find((module) => module.path === 'python/pkg');
  assert.equal(pkgModule.fanIn, 1);
  assert.equal(pkgModule.fanOut, 0);
});

test('Level 2 resolves JavaScript relative imports and classifies bare and dynamic specifiers', (t) => {
  const root = workspace(t);
  write(root, 'src/app/entry.mjs', [
    "import { helper } from './util.mjs';",
    "import db from '../lib/db.mjs';",
    "export { schema } from '../lib/schema.mjs';",
    "import express from 'express';",
    "const lazy = await import('./lazy.mjs');",
    "const plugin = require(pluginName);",
    "// import commented from './commented.mjs';",
    "const text = \"import quoted from './quoted.mjs'\";",
  ].join('\n'));
  write(root, 'src/app/util.mjs', 'export const helper = 1;\n');
  write(root, 'src/app/lazy.mjs', 'export default 1;\n');
  write(root, 'src/lib/db.mjs', 'export default {};\n');
  write(root, 'src/lib/schema.mjs', 'export const schema = {};\n');

  const graph = level2(root);
  const edge = graph.edges.find((entry) => entry.from === 'src/app' && entry.to === 'src/lib');
  assert.equal(edge.weight, 2, 'import-from and export-from both count');
  assert.equal(graph.unresolved.external, 1, 'express is external');
  assert.equal(graph.unresolved.dynamic, 1, 'a non-literal require is dynamic');
  assert.ok(!graph.fileEdges.some((entry) => entry.to === 'src/app/commented.mjs'), 'comments are stripped');
  assert.ok(graph.fileEdges.some((entry) => entry.to === 'src/app/lazy.mjs'), 'a literal dynamic import resolves');
});

test('Level 2 resolves wrapped imports, re-exports and JavaScript specifiers backed by TypeScript', (t) => {
  const root = workspace(t);
  write(root, 'src/app/entry.ts', [
    'import {',
    '  helper,',
    "} from '../lib/helper.js';",
    'export type {',
    '  Schema,',
    "} from '../lib/schema.js';",
    "export * as namespace from '../lib/namespace.js';",
  ].join('\n'));
  write(root, 'src/lib/helper.ts', 'export const helper = 1;\n');
  write(root, 'src/lib/schema.ts', 'export type Schema = {};\n');
  write(root, 'src/lib/namespace.ts', 'export const value = 1;\n');
  const graph = level2(root);
  const edges = graph.fileEdges.filter((edge) => edge.from === 'src/app/entry.ts');
  assert.deepEqual(edges.map((edge) => edge.to), ['src/lib/helper.ts', 'src/lib/schema.ts', 'src/lib/namespace.ts']);
});

test('Level 2 covers every module under the file cap and truncates visibly', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 12; index += 1) write(root, `alpha/lib/a${index}.py`, 'VALUE = 1\n');
  for (let index = 0; index < 12; index += 1) write(root, `beta/lib/b${index}.py`, 'VALUE = 1\n');

  const graph = level2(root, { limits: { maximumFiles: 10 } });
  assert.equal(graph.truncated, true);
  assert.equal(graph.scannedFiles, 10);
  const scanned = new Map(graph.modules.map((module) => [module.path, module.scannedFiles]));
  assert.equal(scanned.get('alpha'), 5, 'round-robin keeps coverage even across modules');
  assert.equal(scanned.get('beta'), 5);
});

test('Level 2 caps edge evidence while keeping the full weight', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 8; index += 1) {
    write(root, `consumers/c${index}.py`, 'import shared.core\n');
  }
  write(root, 'shared/__init__.py', '');
  write(root, 'shared/core.py', 'VALUE = 1\n');

  const graph = level2(root);
  const edge = graph.edges.find((entry) => entry.from === 'consumers' && entry.to === 'shared');
  assert.equal(edge.weight, 8);
  assert.equal(edge.evidence.length, 5);
});

test('Level 2 splits a dominant package so subsystem edges stay visible', (t) => {
  const root = workspace(t);
  write(root, 'python/big/__init__.py', '');
  for (let index = 0; index < 20; index += 1) {
    write(root, `python/big/srt/s${index}.py`, 'import big.lang.base\n');
    write(root, `python/big/lang/l${index}.py`, 'VALUE = 1\n');
  }
  write(root, 'python/big/lang/base.py', 'VALUE = 1\n');
  write(root, 'python/big/lang/__init__.py', '');
  write(root, 'python/big/srt/__init__.py', '');

  const graph = level2(root);
  const modulePaths = graph.modules.map((module) => module.path);
  assert.ok(modulePaths.includes('python/big/srt') && modulePaths.includes('python/big/lang'),
    `the dominant package is refined into subpackages, got ${modulePaths.join(', ')}`);
  const edge = graph.edges.find((entry) => entry.from === 'python/big/srt' && entry.to === 'python/big/lang');
  assert.ok(edge, 'edges between the refined subpackages are reported');
  assert.equal(edge.weight, 20);
  assert.ok(graph.modules.find((module) => module.path === 'python/big/srt').scannedFiles > 0,
    'scans are credited to the refined module rather than their original directory key');
  const root2 = workspace(t);
  fs.cpSync(root, root2, { recursive: true });
  for (let index = 0; index < 6; index += 1) write(root2, `python/big/srt/test/test_s${index}.py`, 'VALUE = 1\n');
  const withTests = level2(root2);
  const srt = withTests.modules.find((module) => module.path === 'python/big/srt');
  assert.equal(srt.roles.test, 6, 'test files follow their refined subpackage');
  assert.equal(withTests.modules.find((module) => module.path === 'python/big')?.roles?.test, undefined,
    'the package root does not collect nested tests');
});

test('Level 2 counts unscannable source languages instead of dropping them', (t) => {
  const root = workspace(t);
  write(root, 'kernels/fast.cu', '__global__ void k() {}\n');
  write(root, 'kernels/fast.cuh', 'void k();\n');
  write(root, 'kernels/glue.cpp', 'int main() { return 0; }\n');
  write(root, 'api/server.py', 'VALUE = 1\n');

  const graph = level2(root);
  assert.deepEqual(graph.unscanned, { files: 3, byLanguage: { cpp: 1, cuda: 2 } });
  const kernels = graph.modules.find((module) => module.path === 'kernels');
  assert.deepEqual(kernels.unscannedLanguages, { cpp: 1, cuda: 2 });
});

test('Level 2 resolves imports through PEP 420 namespace subpackages instead of collapsing onto the package root', (t) => {
  const root = workspace(t);
  // Only the top package has __init__.py; srt/ and srt/layers/ are namespace
  // directories, the layout that made every sglang.srt.* import resolve to
  // python/sglang/__init__.py.
  write(root, 'python/pkg/__init__.py', '');
  write(root, 'python/pkg/srt/layers/activation.py', 'VALUE = 1\n');
  write(root, 'python/pkg/srt/managers/scheduler.py', [
    'from pkg.srt.layers.activation import VALUE',
    'from pkg.srt.layers import activation',
    'from ..layers.activation import VALUE as SAME',
  ].join('\n'));

  const graph = level2(root);
  const fromScheduler = graph.fileEdges.filter((entry) => entry.from === 'python/pkg/srt/managers/scheduler.py');
  assert.deepEqual(fromScheduler.map((entry) => entry.to), [
    'python/pkg/srt/layers/activation.py',
    'python/pkg/srt/layers/activation.py',
    'python/pkg/srt/layers/activation.py',
  ], 'absolute, from-package, and parent-relative forms all reach the file');
  assert.ok(!graph.fileEdges.some((entry) => entry.to === 'python/pkg/__init__.py'),
    'nothing collapses onto the package root');
  assert.equal(graph.unresolved.unknown, 0);
});

test('Level 2 separates standard-library imports from third-party names in both languages', (t) => {
  const root = workspace(t);
  write(root, 'app/main.py', [
    'from __future__ import annotations',
    'import os, typing',
    'import logging.handlers',
    'import requests',
  ].join('\n'));
  write(root, 'web/server.mjs', [
    "import fs from 'node:fs';",
    "const path = require('path');",
    "import express from 'express';",
    "import { thing } from '@scope/pkg/sub';",
  ].join('\n'));

  const graph = level2(root);
  assert.equal(graph.unresolved.stdlib, 6);
  assert.deepEqual(graph.unresolved.topExternal.map((entry) => entry.name).sort(), ['@scope/pkg', 'express', 'requests']);
});

test('Level 2 resolves a script-directory sibling import and keeps shadowed stdlib names as stdlib', (t) => {
  const root = workspace(t);
  write(root, 'scripts/run.py', 'import utils\nimport io\n');
  write(root, 'scripts/utils.py', 'VALUE = 1\n');
  // A local package named like a stdlib module must not turn `import io`
  // elsewhere into an unresolved internal name.
  write(root, 'tools/io/__init__.py', '');

  const graph = level2(root);
  assert.ok(graph.fileEdges.some((entry) => entry.from === 'scripts/run.py' && entry.to === 'scripts/utils.py'));
  assert.equal(graph.unresolved.unknown, 0);
  assert.equal(graph.unresolved.stdlib, 1);
});

test('Level 2 output is deterministic across runs and carries no timestamps', (t) => {
  const root = workspace(t);
  write(root, 'a/x.py', 'import b.y\n');
  write(root, 'b/__init__.py', '');
  write(root, 'b/y.py', 'VALUE = 1\n');

  const first = level2(root);
  const second = level2(root);
  assert.deepEqual(first, second);
  assert.ok(!JSON.stringify(first).match(/\d{4}-\d{2}-\d{2}T/), 'no timestamps in the graph');
});

test('inspect-repo batched output is unchanged by the Level 2 module', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ name: 'plain' }));
  write(root, 'src/app/main.mjs', 'export const main = 1;\n');
  const result = buildRepositoryIndex(root, { batchSize: 100 });
  assert.equal(result.policy.mode, 'filter-and-batch-v1');
  assert.equal(result.policy.ast, false);
  assert.ok(!('pack' in result));
});

test('Level 2 records channel candidates while the pack excludes support modules', (t) => {
  const root = workspace(t);
  write(root, 'server/app.js', [
    "import http from 'node:http';",
    "import { WebSocketServer } from 'ws';",
    'const server = http.createServer(handler);',
    'const wss = new WebSocketServer({ noServer: true });',
    "// spawn('ignored-in-comment')",
    "const child = spawn('agent', []);",
    "const token = fetch('https://example.test');",
  ].join('\n'));
  write(root, 'web/client.js', "const ws = new WebSocket('/ws');\nfetch('/api/state');\n");
  write(root, 'worker/job.py', 'import subprocess\nsubprocess.run(["git", "status"])\n');
  write(root, 'scripts/check.js', "spawn('node', ['check']);\n");

  const channels = level2(root).runtimeChannels;
  const kinds = channels.map((entry) => `${entry.module}:${entry.kind}`);
  for (const expected of ['server:http-server', 'server:websocket-server', 'server:process-spawn', 'web:websocket-client', 'web:http-client', 'worker:process-spawn']) {
    assert.ok(kinds.includes(expected), `${expected} in ${kinds.join(', ')}`);
  }
  assert.ok(kinds.includes('scripts:process-spawn'), 'the scanner does not discard a directory by name');
  assert.ok(!buildRepositoryEvidence(root).pack.runtimeChannels.items.some((entry) => entry.module === 'scripts'),
    'the pack excludes a support-only scripts module');
  const spawnSite = channels.find((entry) => entry.module === 'server' && entry.kind === 'process-spawn');
  assert.equal(spawnSite.count, 1, 'the commented spawn is skipped');
  assert.match(spawnSite.anchor, /^server\/app\.js:6$/);
  assert.deepEqual(spawnSite.excerpt, ["6: const child = spawn('agent', []);"], 'the credential line after the call is not copied');
  assert.ok(!channels.some((entry) => entry.module === 'server' && entry.kind === 'http-client'), 'a credential-looking line is skipped');
});

test('A runtime tools module keeps bare exec and WebSocket channels', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ name: 'runtime-tools', bin: { server: 'tools/server.mjs' } }));
  write(root, 'tools/server.mjs', [
    "import { exec } from 'node:child_process';",
    "exec('node worker.js');",
    'new WebSocketServer({ port: 8080 });',
  ].join('\n'));
  const channels = buildRepositoryEvidence(root).pack.runtimeChannels.items;
  assert.ok(channels.some((entry) => entry.module === 'tools' && entry.kind === 'process-spawn'));
  assert.ok(channels.some((entry) => entry.module === 'tools' && entry.kind === 'websocket-server'));
});

test('Level 2 records inter-process channels and what they reach', (t) => {
  const root = workspace(t);
  write(root, 'engine/launch.py', [
    'import multiprocessing as mp',
    'proc = mp.Process(',
    '    target=run_scheduler_process,',
    '    args=(1,),',
    ')',
    'tools = subprocess.check_output(["nvidia-smi"])',
  ].join('\n'));
  write(root, 'managers/ipc.py', [
    'import zmq',
    'sock = get_socket(context, zmq.PULL, port_args.scheduler_ipc_name)',
    'context.setsockopt(zmq.IPV6, 1)',
    'server = grpc.aio.server()',
    'channel = grpc.insecure_channel(address)',
  ].join('\n'));

  const channels = level2(root).runtimeChannels;
  const find = (module, kind) => channels.find((entry) => entry.module === module && entry.kind === kind);
  const spawn = find('engine', 'process-spawn');
  assert.deepEqual(spawn.targets.sort(), ['nvidia-smi', 'run_scheduler_process']);
  assert.equal(spawn.processTargets, 1, 'only the target= launch is an in-repository process');
  assert.deepEqual(find('managers', 'message-queue').targets, ['PULL port_args.scheduler_ipc_name'], 'socket options are not targets');
  assert.ok(find('managers', 'grpc-server'));
  assert.deepEqual(find('managers', 'grpc-client').targets, ['address']);
});
