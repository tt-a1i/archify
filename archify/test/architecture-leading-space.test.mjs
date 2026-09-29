import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');
const checker = path.join(root, 'scripts/check-render-output.mjs');

function run(args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

function fixture(t, changes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-leading-space-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'diagram.json');
  const output = path.join(dir, 'diagram.html');
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Leading space', quality_profile: 'standard', output: 'diagram.html', ...changes.meta },
    components: [
      { id: 'a', type: 'backend', label: 'A', pos: [40, 225], size: [120, 60] },
      { id: 'b', type: 'backend', label: 'B', pos: [300, 225], size: [120, 60] },
    ],
    connections: changes.connections || [{ from: 'a', to: 'b', label: 'request' }],
    ...(changes.boundaries ? { boundaries: changes.boundaries } : {}),
  };
  fs.writeFileSync(source, JSON.stringify(diagram));
  const rendered = spawnSync(process.execPath, [cli, 'render', 'architecture', source, output], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  return { source, output, read: () => run([checker, output]) };
}

test('automatic Architecture reports visible leading space as review evidence only', t => {
  const { read } = fixture(t);
  const report = read();
  const space = report.composition.leadingSpace;
  assert.equal(space.measured, true);
  assert.equal(space.reviewSuggested, true);
  assert.ok(space.emptyTopPx > 120);
  assert.ok(space.emptyTopRatio > 0.2);
  assert.ok(space.occupiedTop <= 225);
  assert.deepEqual(report.composition.summary, { errors: 0, warnings: 0 });
  assert.equal(report.composition.status, 'pass');
  assert.equal(report.composition.issues.length, 0);
});

test('a top return route occupies the space before the first node', t => {
  const { read } = fixture(t, { connections: [
    { from: 'a', to: 'b', label: 'request' },
    { from: 'b', to: 'a', fromSide: 'top', toSide: 'top', via: [[360, 72], [100, 72]], label: 'return' },
  ] });
  const space = read().composition.leadingSpace;
  assert.equal(space.measured, true);
  assert.ok(space.occupiedTop < 100);
  assert.equal(space.reviewSuggested, false);
});

test('boundary frame and its title occupy the top region', t => {
  const { read, output } = fixture(t);
  let html = fs.readFileSync(output, 'utf8');
  html = html.replace('<!-- Boundaries (behind everything) -->', `<!-- Boundaries (behind everything) -->
    <rect data-graph-role="structural-frame" data-composition-frame-kind="region" data-composition-frame-id="0" x="20" y="30" width="420" height="280"/>
    <g data-graph-role="structural-frame-label"><rect data-graph-role="structural-frame-label-mask" x="30" y="18" width="70" height="14"/></g>`);
  fs.writeFileSync(output, html);
  const space = read().composition.leadingSpace;
  assert.equal(space.measured, true);
  assert.ok(space.occupiedTop < 40);
  assert.equal(space.reviewSuggested, false);
});

test('authored viewBox and transformed SVGs are not suggested for automatic review', t => {
  const authored = fixture(t, { meta: { viewBox: [500, 400] } });
  assert.equal(authored.read().composition.leadingSpace.reviewSuggested, false);
  const automatic = fixture(t);
  let html = fs.readFileSync(automatic.output, 'utf8');
  html = html.replace('<svg viewBox=', '<svg transform="translate(0 1)" viewBox=');
  fs.writeFileSync(automatic.output, html);
  assert.equal(automatic.read().composition.leadingSpace.reviewSuggested, false);
  html = html.replace('data-reader-primary-text="14"', 'data-reader-primary-text="12"');
  html = html.replace('transform="translate(0 1)" ', '');
  fs.writeFileSync(automatic.output, html);
  assert.equal(automatic.read().composition.leadingSpace.reviewSuggested, false, 'other diagram modes do not qualify');
});

test('automatic Architecture reports a node side facing more neighbours than it has ports', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-crowded-side-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const render = (hubHeight) => {
    const source = path.join(dir, `hub-${hubHeight}.json`);
    const output = path.join(dir, `hub-${hubHeight}.html`);
    fs.writeFileSync(source, JSON.stringify({
      schema_version: 1, diagram_type: 'architecture',
      meta: { title: 'Crowded side', quality_profile: 'standard', output: path.basename(output) },
      components: [
        { id: 'hub', type: 'backend', label: 'Hub', pos: [40, 190], size: [140, hubHeight] },
        ...[0, 1, 2, 3].map((index) => ({ id: `n${index}`, type: 'backend', label: `N${index}`, pos: [420, 40 + index * 110], size: [120, 60] })),
      ],
      connections: [0, 1, 2, 3].map((index) => ({ from: 'hub', to: `n${index}` })),
    }));
    const rendered = spawnSync(process.execPath, [cli, 'render', 'architecture', source, output], { encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
    return run([checker, output]).composition.routeReview.crowdedSides;
  };
  assert.deepEqual(render(64), [{ node: 'hub', label: 'Hub', side: 'right', relationships: 4, sidePx: 64, neededPx: 74 }]);
  assert.equal(render(80), undefined);
});
