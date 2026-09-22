import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const baseRuntime = path.join(repositoryRoot, 'archify');
const probeRoot = process.env.ARCHIFY_ROUTE_PREFERENCE_PROBE
  || fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-preference-test-'));
const patchedRuntime = path.join(probeRoot, 'runtime');
if (!process.env.ARCHIFY_ROUTE_PREFERENCE_PROBE) {
  fs.cpSync(baseRuntime, patchedRuntime, { recursive: true });
  const applied = spawnSync('git', ['apply', path.join(here, 'runtime.patch')], {
    cwd: patchedRuntime, encoding: 'utf8',
  });
  assert.equal(applied.status, 0, applied.stderr);
  after(() => fs.rmSync(probeRoot, { recursive: true, force: true }));
}
const sourceRoot = process.env.ARCHIFY_STUDY_REPOS
  || '/private/tmp/archify-semantic-firstdraft-20260921/repos';
const pRetryRepo = path.join(sourceRoot, 'p-retry');
const firstSnapshots = path.resolve(here, '../evidence/compact');
const { createRouter: createBaseRouter } = await import(pathToFileURL(
  path.join(baseRuntime, 'renderers/architecture/routing.mjs'),
).href);
const { createRouter: createPatchedRouter } = await import(pathToFileURL(
  path.join(patchedRuntime, 'renderers/architecture/routing.mjs'),
).href);

function run(runtime, command, input, extra = []) {
  const expectsJson = command !== 'render';
  const result = spawnSync(process.execPath, [
    path.join(runtime, 'bin/archify.mjs'), command, 'architecture', input, ...extra,
    ...(expectsJson ? ['--json'] : []),
  ], { cwd: runtime, encoding: 'utf8' });
  assert.equal(result.stderr, '', result.stderr);
  return { result, receipt: expectsJson ? JSON.parse(result.stdout) : null };
}

function routeDiagnostics(receipt) {
  return (receipt.diagnostics || []).filter(({ code }) => code.startsWith('composition/'));
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function measuredComponents(document) {
  return new Map(document.components.map(component => {
    const [x, y] = component.pos;
    const [width, height] = component.size;
    return [component.id, { ...component, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
  }));
}

function plannedRoutes(create, document) {
  const connections = structuredClone(document.connections);
  const router = create(measuredComponents(document), connections);
  return {
    routes: connections.map(connection => router.pathFor(connection).points),
    metrics: router.routingMetrics(),
  };
}

test('p-retry C1 frozen first candidate removes routing diagnostics but does not mask the four text constraints', () => {
  const input = path.join(firstSnapshots, 'p-retry-C1/snapshot-001.json');
  const frozenSha = sha256(input);
  const extra = ['--quality', 'showcase', '--repo-root', pRetryRepo];
  const baseline = run(baseRuntime, 'validate', input, extra);
  const candidate = run(patchedRuntime, 'validate', input, extra);

  assert.equal(baseline.result.status, 1);
  assert.equal(candidate.result.status, 1);
  assert.deepEqual(routeDiagnostics(baseline.receipt).map(({ code }) => code), [
    'composition/short-interior-segment',
    'composition/micro-segment',
    'composition/micro-segment',
    'composition/short-interior-segment',
  ]);
  assert.deepEqual(routeDiagnostics(candidate.receipt), []);
  assert.deepEqual((candidate.receipt.diagnostics || []).map(({ code }) => code), [
    'layout/constraint', 'layout/constraint', 'layout/constraint', 'layout/constraint',
  ]);
  assert.equal(sha256(input), frozenSha, 'the frozen candidate must remain byte-identical');
});

test('p-retry B1 frozen first candidate retains its schema failure exactly', () => {
  const input = path.join(firstSnapshots, 'p-retry-B1/snapshot-001.json');
  const extra = ['--quality', 'showcase', '--repo-root', pRetryRepo];
  const baseline = run(baseRuntime, 'validate', input, extra);
  const candidate = run(patchedRuntime, 'validate', input, extra);
  assert.equal(baseline.result.status, 1);
  assert.equal(candidate.result.status, 1);
  assert.deepEqual((baseline.receipt.diagnostics || []).map(({ code }) => code), ['schema/maxLength']);
  assert.deepEqual((candidate.receipt.diagnostics || []).map(({ code }) => code), ['schema/maxLength']);
});

test('a known passing showcase example still passes', () => {
  const extra = ['--quality', 'showcase'];
  const baseline = run(baseRuntime, 'validate', path.join(baseRuntime, 'examples/web-app.architecture.json'), extra);
  const candidate = run(patchedRuntime, 'validate', path.join(patchedRuntime, 'examples/web-app.architecture.json'), extra);
  assert.equal(baseline.result.status, 0, baseline.result.stdout);
  assert.equal(candidate.result.status, 0, candidate.result.stdout);
  assert.equal(baseline.receipt.ok, true);
  assert.equal(candidate.receipt.ok, true);
});

test('a normal first clear, rhythm-clean route remains identical and does not search the grid', () => {
  const document = {
    components: [
      { id: 'source', type: 'frontend', label: 'Source', pos: [60, 120], size: [120, 60] },
      { id: 'target', type: 'backend', label: 'Target', pos: [380, 120], size: [120, 60] },
    ],
    connections: [{ id: 'normal', from: 'source', to: 'target' }],
  };
  const baseline = plannedRoutes(createBaseRouter, document);
  const candidate = plannedRoutes(createPatchedRouter, document);
  assert.deepEqual(candidate.routes, baseline.routes);
  assert.equal(baseline.metrics.gridSearchCount, 0);
  assert.equal(candidate.metrics.gridSearchCount, 0);
});

test('the frozen C1 patch consumes more of the shared grid budget; downstream impact is unverified', () => {
  const document = JSON.parse(fs.readFileSync(path.join(firstSnapshots, 'p-retry-C1/snapshot-001.json'), 'utf8'));
  const baseline = plannedRoutes(createBaseRouter, document);
  const candidate = plannedRoutes(createPatchedRouter, document);
  assert.equal(baseline.metrics.gridSearchCount, 3);
  assert.equal(candidate.metrics.gridSearchCount, 10);
  assert.equal(baseline.metrics.gridVisitedNodeCount, 695);
  assert.equal(candidate.metrics.gridVisitedNodeCount, 2611);
  assert.equal(candidate.metrics.gridBudgetExhaustedCount, 0);
});

test('explicit architecture geometry remains byte-for-byte identical in rendered route data', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-preference-explicit-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const input = path.join(temporary, 'explicit.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Explicit route control', quality_profile: 'showcase', viewBox: [640, 360] },
    components: [
      { id: 'source', type: 'frontend', label: 'Source', pos: [60, 120], size: [120, 60] },
      { id: 'target', type: 'backend', label: 'Target', pos: [380, 120], size: [120, 60] },
    ],
    connections: [{
      id: 'author-route', from: 'source', to: 'target', fromSide: 'bottom', toSide: 'bottom',
      via: [[120, 240], [440, 240]],
    }],
  }));
  const baselineOutput = path.join(temporary, 'baseline.html');
  const patchedOutput = path.join(temporary, 'patched.html');
  const baseline = run(baseRuntime, 'render', input, [baselineOutput, '--quality', 'showcase']);
  const candidate = run(patchedRuntime, 'render', input, [patchedOutput, '--quality', 'showcase']);
  assert.equal(baseline.result.status, 0, baseline.result.stdout);
  assert.equal(candidate.result.status, 0, candidate.result.stdout);
  const routeData = html => html.match(/data-composition-points="([^"]+)"/g);
  assert.deepEqual(routeData(fs.readFileSync(patchedOutput, 'utf8')), routeData(fs.readFileSync(baselineOutput, 'utf8')));
});
