import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { advise } from './layout-advisor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const skill = path.join(root, 'archify');
const routeGeometry = new Set(['via', 'route', 'fromSide', 'toSide', 'channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment']);

function authorGrid(source) {
  const input = structuredClone(source);
  const xs = [...new Set(input.components.map((component) => component.pos[0]))].sort((a, b) => a - b);
  const ys = [...new Set(input.components.map((component) => component.pos[1]))].sort((a, b) => a - b);
  input.layout = { mode: 'grid', cols: xs.length };
  delete input.meta.viewBox;
  for (const component of input.components) {
    const [x, y] = component.pos;
    delete component.pos;
    delete component.size;
    component.row = ys.indexOf(y);
    component.col = xs.indexOf(x);
  }
  // The advice input is semantic plus author-selected cells. Existing example
  // route-control coordinates are intentionally excluded from this test input;
  // automatic routing is then exercised by the real renderer.
  for (const connection of input.connections ?? []) {
    for (const key of routeGeometry) delete connection[key];
  }
  return input;
}

function validate(input) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-advisor-test-'));
  const file = path.join(temp, 'input.json');
  fs.writeFileSync(file, JSON.stringify(input));
  try {
    return spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'validate', 'architecture', file, '--quality', 'showcase', '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const fixtures = ['starter', 'web-app', 'production-deployment'];
const records = [];
for (const name of fixtures) {
  const source = JSON.parse(fs.readFileSync(path.join(skill, 'examples', `${name}.architecture.json`), 'utf8'));
  const defaultGrid = authorGrid(source);
  const defaultResult = validate(defaultGrid);
  const advice = advise(defaultGrid);
  records.push({ name, defaultExit: defaultResult.status, status: advice.status });
  assert.equal(advice.status, 'advised', `${name}: ${advice.reasons?.join(' ')}`);
  assert.equal(advice.quality.layout.exitCode, 0);
  assert.equal(advice.quality.validation.exitCode, 0);
}

const cjk = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Long CJK node', locale: 'zh-CN', quality_profile: 'showcase' },
  layout: { mode: 'grid', cols: 2 },
  components: [
    { id: 'entry', type: 'frontend', label: '跨租户审计日志导出入口', row: 0, col: 0 },
    { id: 'audit', type: 'database', label: 'Audit Store', row: 0, col: 1 },
  ],
  connections: [{ id: 'export', from: 'entry', to: 'audit', label: 'encrypted export' }],
};
const cjkDefault = validate(cjk);
assert.notEqual(cjkDefault.status, 0, 'the long CJK counterexample must falsify default grid sizing');
const cjkAdvice = advise(cjk);
assert.equal(cjkAdvice.status, 'advised', cjkAdvice.reasons?.join(' '));
assert.equal(cjkAdvice.candidate.components[0].size[0] >= 145, true);
records.push({ name: 'long-cjk', defaultExit: cjkDefault.status, status: cjkAdvice.status, entrySize: cjkAdvice.candidate.components[0].size });

for (const bad of [{ components: {} }, { components: 'bad' }, { components: [], connections: {} }]) {
  assert.equal(advise({ diagram_type: 'architecture', ...bad }).status, 'declined');
}
const malformed = advise({ diagram_type: 'architecture', components: [null] });
assert.equal(malformed.status, 'declined');
assert.match(malformed.reasons.join(' '), /component must be an object/);
const duplicateId = advise({ diagram_type: 'architecture', components: [
  { id: 'same', row: 0, col: 0 }, { id: 'same', row: 0, col: 1 },
] });
assert.equal(duplicateId.status, 'declined');
assert.match(duplicateId.reasons.join(' '), /share id/);
const pinnedRoute = advise({ ...cjk, connections: [{ ...cjk.connections[0], via: [[99, 99]] }] });
assert.equal(pinnedRoute.status, 'declined');
assert.match(pinnedRoute.reasons.join(' '), /absolute coordinate controls/);

const sourceFixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-advisor-source-'));
const sourceFixture = path.join(sourceFixtureParent, 'fixture-repo');
try {
  const prepared = spawnSync(process.execPath, [path.join(skill, 'examples/source-to-diagram/prepare-fixture.mjs'), sourceFixture], { cwd: root, encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const sourceDiagram = authorGrid(JSON.parse(fs.readFileSync(path.join(skill, 'examples/source-to-diagram/source-to-diagram.architecture.json'), 'utf8')));
  const noRoot = advise(sourceDiagram);
  assert.equal(noRoot.status, 'declined');
  const withRoot = advise(sourceDiagram, { repoRoot: sourceFixture });
  assert.equal(withRoot.status, 'advised', withRoot.reasons?.join(' '));
  assert.equal(withRoot.quality.checks.profile, 'showcase');
  records.push({ name: 'source-backed', withoutRoot: noRoot.status, withRoot: withRoot.status });
} finally {
  fs.rmSync(sourceFixtureParent, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, records }, null, 2));
