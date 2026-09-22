import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const base = path.join(root, 'archify');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-rhythm-v2-test-'));
const patched = path.join(temporary, 'runtime');
fs.cpSync(base, patched, { recursive: true });
const applied = spawnSync('git', ['apply', path.join(here, 'runtime.patch')], {
  cwd: patched, encoding: 'utf8',
});
assert.equal(applied.status, 0, applied.stderr);
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const fixtures = path.resolve(here, '../../evidence/compact');
const repos = process.env.ARCHIFY_STUDY_REPOS
  || '/private/tmp/archify-semantic-firstdraft-20260921/repos';
const { createRouter: baseRouter } = await import(pathToFileURL(path.join(base, 'renderers/architecture/routing.mjs')));
const { createRouter: patchedRouter } = await import(pathToFileURL(path.join(patched, 'renderers/architecture/routing.mjs')));

function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validate(runtime, input, repository) {
  const result = spawnSync(process.execPath, [path.join(runtime, 'bin/archify.mjs'),
    'validate', 'architecture', input, '--repo-root', path.join(repos, repository),
    '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(result.stderr, '');
  return { code: result.status, receipt: JSON.parse(result.stdout) };
}

function plan(create, document) {
  const components = new Map(document.components.map(component => {
    const [x, y] = component.pos;
    const [width, height] = component.size;
    return [component.id, { ...component, x, y, width, height,
      cx: x + width / 2, cy: y + height / 2 }];
  }));
  const connections = structuredClone(document.connections);
  const router = create(components, connections);
  const routes = Object.fromEntries(connections.map(connection => [connection.id, {
    points: router.pathFor(connection).points,
    sides: router.connectionSides(connection),
  }]));
  return { routes, metrics: router.routingMetrics() };
}

test('real cache candidate passes unchanged after the original automatic 4px segment rejection', () => {
  const input = path.join(fixtures, 'quick-lru-B1/diagram.architecture.json');
  const before = digest(input);
  const original = validate(base, input, 'quick-lru');
  const candidate = validate(patched, input, 'quick-lru');
  assert.equal(original.code, 1);
  assert.deepEqual(original.receipt.diagnostics.map(item => item.code), ['composition/micro-segment']);
  assert.equal(candidate.code, 0, JSON.stringify(candidate.receipt));
  assert.equal(candidate.receipt.ok, true);
  assert.equal(digest(input), before);
});

test('real retry candidate removes short routes while retaining all unrelated width failures', () => {
  const input = path.join(fixtures, 'p-retry-C1/snapshot-001.json');
  const original = validate(base, input, 'p-retry');
  const candidate = validate(patched, input, 'p-retry');
  assert.equal(original.code, 1);
  assert.equal(candidate.code, 1);
  assert.equal(original.receipt.diagnostics.filter(item => item.code.startsWith('composition/')).length, 4);
  assert.deepEqual(candidate.receipt.diagnostics.map(item => item.code),
    ['layout/constraint', 'layout/constraint', 'layout/constraint', 'layout/constraint']);
});

test('dense preference probes retain budget for a later route that needs the obstacle grid', () => {
  const input = path.resolve(here, '../evidence/seven-c1-plus-grid-suffix.json');
  assert.equal(digest(input), '0870c66c90dba343c31817d1b7485d0c07bd12a453c0498630b8dbd44d5c7be8');
  const document = JSON.parse(fs.readFileSync(input, 'utf8'));
  const original = plan(baseRouter, document);
  const candidate = plan(patchedRouter, document);
  assert.equal(original.metrics.gridSearchCount, 22);
  assert.equal(candidate.metrics.gridSearchCount, original.metrics.gridSearchCount);
  assert.equal(candidate.metrics.gridBudgetExhaustedCount, 0);
  assert.deepEqual(candidate.routes['suffix-grid-route'], original.routes['suffix-grid-route']);
  assert.equal(candidate.routes['suffix-grid-route'].points.length, 6);
});
