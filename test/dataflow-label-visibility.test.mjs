import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { rectsOverlap, segmentRectClearanceWithin } from '../archify/renderers/shared/geometry.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/dataflow-label-visibility.json', import.meta.url)));
function render(t, diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-label-visibility-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'source.json');
  const output = path.join(directory, 'diagram.html');
  const source = JSON.stringify(diagram);
  fs.writeFileSync(input, source);
  const env = { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
  delete env.ARCHIFY_QUALITY_PROFILE;
  const result = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(input, 'utf8'), source);
  return fs.readFileSync(output, 'utf8');
}
function flow(html, id = 'launch') {
  const points = html.match(new RegExp(`<path[^>]*data-edge-id="${id}"[^>]*data-composition-points="([^"]+)"`))[1]
    .split(';').map(point => point.split(',').map(Number));
  const mask = html.match(new RegExp(`<g data-detail="context"[^>]*data-edge-id="${id}"[^>]*>\\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`));
  const [x, y, width, height] = mask.slice(1).map(Number);
  return { points, mask: { x, y, width, height } };
}
function clearRoute(mask, points) {
  return points.slice(1).every((end, index) => segmentRectClearanceWithin({ start: points[index], end }, mask, 4) >= 4);
}
for (const quality of ['standard', 'showcase']) {
  for (const authoredCanvas of [true, false]) {
    test(`${quality} ${authoredCanvas ? 'authored' : 'automatic'} canvas keeps the entire two-line label above its short connector`, t => {
      const diagram = structuredClone(fixture);
      diagram.meta.quality_profile = quality;
      if (!authoredCanvas) delete diagram.meta.viewBox;
      const html = render(t, diagram);
      const { points, mask } = flow(html);
      assert.deepEqual(points, [[156, 157], [259, 157]]);
      assert.equal(mask.height, 27);
      assert.ok(clearRoute(mask, points), JSON.stringify({ mask, points }));
      assert.match(html, /font-size="8"[^>]*>argv \/ JSON-RPC<\/text>/);
      assert.match(html, /font-size="7"[^>]*>Native flags<\/text>/);
      if (authoredCanvas) assert.match(html, /viewBox="0 0 600 360"/);
    });
  }
}
for (const pin of [{ labelAt: [207.5, 147] }, { labelDx: 0 }, { labelDy: 0 }, { labelSegment: 0 }]) {
  test(`explicit ${Object.keys(pin)[0]} retains the authored label geometry, including zero`, t => {
    const diagram = structuredClone(fixture);
    Object.assign(diagram.flows[0], pin);
    const { points, mask } = flow(render(t, diagram));
    assert.deepEqual(points, [[156, 157], [259, 157]]);
    assert.deepEqual(mask, { x: 164.75, y: 136, width: 85.5, height: 27 });
  });
}
test('single-line labels retain their existing geometry', t => {
  const diagram = structuredClone(fixture);
  delete diagram.flows[0].classification;
  assert.deepEqual(flow(render(t, diagram)).mask, { x: 164.75, y: 136, width: 85.5, height: 16 });
});
test('a neighboring pinned label does not push the two-line label back over its connector', t => {
  const diagram = structuredClone(fixture);
  diagram.flows.push({ id: 'neighbor', from: 'adapter', to: 'provider', label: 'neighbor', labelAt: [207.5, 123] });
  const html = render(t, diagram);
  const launch = flow(html);
  const neighbor = flow(html, 'neighbor');
  assert.ok(!rectsOverlap(launch.mask, neighbor.mask), JSON.stringify({ launch, neighbor }));
  assert.ok(clearRoute(launch.mask, launch.points), JSON.stringify(launch));
});
test('two-line labels respect stage titles and nodes with authored routes', t => {
  const diagram = structuredClone(fixture);
  diagram.flows[0].via = [[156, 90], [259, 90]];
  const html = render(t, diagram);
  const { points, mask } = flow(html);
  assert.deepEqual(points, [[156, 157], [156, 90], [259, 90], [259, 157]]);
  assert.ok(clearRoute(mask, points), JSON.stringify({ mask, points }));
  for (const x of [16, 231]) assert.ok(!rectsOverlap(mask, { x, y: 46, width: 168, height: 36 }), JSON.stringify(mask));
  for (const x of [44, 259]) assert.ok(!rectsOverlap(mask, { x, y: 128, width: 112, height: 58 }), JSON.stringify(mask));
});
test('a neighboring route cannot push the two-line label back over either connector', t => {
  const diagram = structuredClone(fixture);
  diagram.flows.push({ id: 'neighbor', from: 'adapter', to: 'provider', label: 'neighbor',
    labelAt: [400, 100], via: [[156, 136], [259, 136]] });
  const html = render(t, diagram);
  const launch = flow(html);
  const neighbor = flow(html, 'neighbor');
  assert.ok(clearRoute(launch.mask, launch.points), JSON.stringify(launch));
  assert.ok(clearRoute(launch.mask, neighbor.points), JSON.stringify({ launch, neighbor }));
});
test('a classified vertical label already beside its own connector retains its placement', t => {
  const diagram = structuredClone(fixture);
  delete diagram.meta.viewBox;
  diagram.meta.quality_profile = 'showcase';
  diagram.nodes[1].stage = 0;
  diagram.nodes[1].row = 1;
  const result = flow(render(t, diagram));
  assert.deepEqual(result.points, [[100, 186], [100, 242]]);
  assert.deepEqual(result.mask, { x: 8.5, y: 207, width: 85.5, height: 27 });
});
test('an authored two-line interruption on a long connector remains valid and unchanged', t => {
  const diagram = structuredClone(fixture);
  diagram.meta.viewBox = [1080, 360];
  diagram.stages.push({ label: 'Middle' }, { label: 'End' });
  diagram.nodes[1].stage = 3;
  diagram.flows[0].labelAt = [422.5, 157];
  const result = flow(render(t, diagram));
  assert.deepEqual(result.points, [[156, 157], [689, 157]]);
  assert.deepEqual(result.mask, { x: 379.75, y: 146, width: 85.5, height: 27 });
  assert.ok(!clearRoute(result.mask, result.points), 'the intentionally interrupted own line must remain accepted');
});
test('an exhausted label search preserves the previous accepted placement instead of adding a collision', t => {
  const diagram = structuredClone(fixture);
  const anchors = [[100, 100], [100, 220], [207.5, 123], [207.5, 200], [315, 100], [315, 220]];
  diagram.flows.push(...anchors.map((labelAt, index) => ({
    id: `block${index}`, from: 'adapter', to: 'provider', label: 'neighbor label',
    labelAt, via: [[156, 310], [259, 310]],
  })));
  const html = render(t, diagram);
  const launch = flow(html);
  assert.deepEqual(launch.points, [[156, 157], [259, 157]]);
  assert.deepEqual(launch.mask, { x: 164.75, y: 136, width: 85.5, height: 27 });
  for (const index of anchors.keys()) assert.ok(!rectsOverlap(launch.mask, flow(html, `block${index}`).mask, -2));
});
