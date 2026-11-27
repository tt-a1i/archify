import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { createArchitectureRouter } from '../archify/renderers/architecture/routing.mjs';
import { properSegmentIntersection } from '../archify/renderers/shared/geometry.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-auto-placement-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  function run(args, expectedStatus) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd: directory,
      env: { ...process.env, ARCHIFY_CHROME: path.join(directory, 'missing-chrome') },
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }
  return { input, output, run };
}

function mixedPlacementSpec() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Request processing', output: 'diagram.html', quality_profile: 'showcase' },
    layout: { mode: 'auto' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [48, 70], size: [140, 72] },
      { id: 'api', type: 'backend', label: 'API', pos: [390, 70], size: [140, 72] },
      { id: 'store', type: 'database', label: 'Store', size: [154, 72] },
    ],
    connections: [
      { from: 'client', to: 'api', fromSide: 'right', toSide: 'left', via: [[250, 106]], label: 'Read', labelAt: [285, 92] },
      { from: 'api', to: 'store', label: 'Fetch' },
    ],
  };
}

test('architecture placement resolves missing positions through inspect and finalize', t => {
  const { input, output, run } = workspace(t);
  const spec = mixedPlacementSpec();
  const bytes = JSON.stringify(spec);
  fs.writeFileSync(input, bytes);

  const layout = run(['inspect', 'architecture', input, '--quality', 'showcase'], 0);
  assert.equal(layout.ok, true);
  assert.deepEqual(layout.layout, { mode: 'auto' });
  for (const [index, component] of spec.components.entries()) {
    const box = layout.components[index];
    assert.equal(box.id, component.id);
    assert.deepEqual([box.width, box.height], component.size);
    if (component.pos) {
      assert.deepEqual([box.x, box.y], component.pos);
      assert.deepEqual(box.pos, component.pos);
    } else {
      assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y));
      assert.equal(Object.hasOwn(box, 'pos'), false);
    }
  }
  assert.deepEqual(layout.connections[0].points, [[188, 106], [250, 106], [390, 106]]);
  assert.deepEqual(layout.connections[0].labelAt, spec.connections[0].labelAt);

  const summary = run(['finalize', 'architecture', input, output, '--quality', 'showcase'], 2);
  assert.deepEqual(summary.gates, {
    validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'skipped',
  });
  const html = fs.readFileSync(output, 'utf8');
  for (const { id } of spec.components) assert.ok(html.includes(`data-node-id="${id}"`));
  assert.equal(fs.readFileSync(input, 'utf8'), bytes);
  const provenance = JSON.parse(fs.readFileSync(output.replace(/\.html$/, '.delivery.json'), 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.equal(provenance.specification.sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('automatic architecture keeps reciprocal elbows separate on a shared endpoint side', t => {
  const { input, run } = workspace(t);
  const spec = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Hive 本地任务运行时', locale: 'zh-CN', output: 'diagram.html', quality_profile: 'showcase' },
    layout: { mode: 'auto' },
    components: [
      ['runtime', 'Hive runtime', '本机服务：派发、状态与 PTY'],
      ['orchestrator', 'Orchestrator', '独立 CLI 进程：规划与协调'],
      ['worker', 'Worker', '独立 CLI 进程：执行任务'],
    ].map(([id, label, sublabel]) => ({ id, label, sublabel, type: 'backend' })),
    connections: [
      ['input-pty', 'runtime', 'orchestrator', '写入 PTY'],
      ['send', 'orchestrator', 'runtime', 'team send · HTTP'],
      ['dispatch', 'runtime', 'worker', '启动并写入任务'],
      ['report', 'worker', 'runtime', 'team report · HTTP'],
      ['return', 'runtime', 'orchestrator', '转发报告'],
    ].map(([id, from, to, label]) => ({ id, from, to, label })),
  };
  fs.writeFileSync(input, JSON.stringify(spec));

  const { connections } = run(['inspect', 'architecture', input], 0);
  assert.deepEqual(connections.map(({ from, to, label }) => ({ from, to, label })),
    spec.connections.map(({ from, to, label }) => ({ from, to, label })));
  const [outgoing, incoming] = connections.map(edge => edge.points);
  assert.ok(!outgoing.slice(1).some((end, index) => incoming.slice(1).some((otherEnd, otherIndex) =>
    properSegmentIntersection(outgoing[index], end, incoming[otherIndex], otherEnd))));
});

test('architecture placement reports conflicting grid fields before publishing an artifact', t => {
  const { input, output, run } = workspace(t);
  const spec = mixedPlacementSpec();
  spec.layout.gapX = 80;
  spec.components[0].col = 0;
  spec.components[2].row = 1;
  fs.writeFileSync(input, JSON.stringify(spec));
  const oldArtifact = '<!doctype html><title>Previous artifact</title>\n';
  fs.writeFileSync(output, oldArtifact);

  const receipt = run(['deliver', 'architecture', input, output], 1);
  assert.equal(receipt.ok, false);
  for (const [pointer, field] of [['/layout', 'gapX'], ['/components/0/col', 'col'], ['/components/2/row', 'row']]) {
    const issue = receipt.diagnostics.find(entry => entry.subject?.path === pointer);
    assert.ok(issue, JSON.stringify(receipt.diagnostics));
    assert.ok(issue.supportedFixes.some(fix => fix.includes(field)));
  }
  assert.equal(fs.readFileSync(output, 'utf8'), oldArtifact);
});

test('architecture placement still rejects overlapping pins and missing free coordinates', t => {
  const { input, run } = workspace(t);
  const spec = mixedPlacementSpec();
  spec.components[1].pos = spec.components[0].pos;
  fs.writeFileSync(input, JSON.stringify(spec));
  const overlap = run(['validate', 'architecture', input, '--layout-json'], 1);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.layout.mode, 'auto');
  const issue = overlap.diagnostics.find(entry => entry.code === 'layout/component-overlap');
  assert.ok(issue, JSON.stringify(overlap.diagnostics));
  assert.equal(issue.subject.nodeId, 'client');
  assert.equal(issue.evidence.otherId, 'api');

  delete spec.layout;
  spec.components = [spec.components[2]];
  spec.connections = [];
  fs.writeFileSync(input, JSON.stringify(spec));
  const free = run(['validate', 'architecture', input], 1);
  assert.equal(free.ok, false);
  assert.ok(free.diagnostics.some(entry => /Component "store" must include pos/.test(entry.message)));
});

test('architecture straight chains honor explicit sides around pinned endpoints', t => {
  const { input, run } = workspace(t);
  const pin = [600, 600];
  const spec = mixedPlacementSpec();
  const directions = [
    ['left', 'right', 0, -1], ['right', 'left', 0, 1],
    ['top', 'bottom', 1, -1], ['bottom', 'top', 1, 1],
  ];
  function assertStraight(points, axis, sign, label) {
    assert.equal(points.length, 2, label);
    const [start, end] = points;
    assert.equal(start[1 - axis], end[1 - axis], label);
    assert.ok((end[axis] - start[axis]) * sign > 0, `${label}: ${JSON.stringify(points)}`);
  }
  for (const [directionIndex, [fromSide, toSide, axis, sign]] of directions.entries()) {
    for (const [pinIndex, pinned] of [null, 'a', 'b'].entries()) {
      spec.components = ['a', 'b'].map(id => ({
        id, type: 'backend', label: id, size: [120, 60], ...(id === pinned ? { pos: pin } : {}),
      }));
      for (const [sideIndex, sides] of [{ fromSide, toSide }, { fromSide }, { toSide }].entries()) {
        const connection = { from: 'a', to: 'b', route: 'straight', ...sides };
        spec.connections = [connection];
        const label = `${fromSide}, ${pinned} pinned, ${JSON.stringify(sides)}`;
        const positions = automaticComponentPositions(spec);
        if (pinned) assert.deepEqual(positions.get(pinned), pin, label);
        const boxes = new Map(spec.components.map(({ id, size: [width, height] }) => {
          const [x, y] = positions.get(id);
          return [id, { x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
        }));
        const router = createArchitectureRouter(boxes, spec.connections);
        assertStraight(router.pathFor(connection).points, axis, sign, label);

        // Exercise the public receipt in every direction and pin state. Rotate
        // which side options it uses; the router above checks every combination.
        if (sideIndex === (directionIndex + pinIndex) % 3) {
          fs.writeFileSync(input, JSON.stringify(spec));
          const report = run(['inspect', 'architecture', input], 0);
          if (pinned) {
            const fixed = report.components.find(card => card.id === pinned);
            assert.deepEqual([fixed.x, fixed.y], pin, label);
          }
          assertStraight(report.connections[0].points, axis, sign, label);
        }
      }
    }
  }

  spec.connections = [{ from: 'a', to: 'b', route: 'straight', fromSide: 'left', toSide: 'left' }];
  fs.writeFileSync(input, JSON.stringify(spec));
  const conflictingSides = run(['inspect', 'architecture', input], 1);
  assert.ok(conflictingSides.diagnostics.some(issue => issue.code === 'clean-flow/endpoint-side-direction'));

  spec.components = [
    { id: 'a', type: 'backend', label: 'A', size: [120, 60], pos: [800, 200] },
    { id: 'b', type: 'backend', label: 'B', size: [120, 60] },
    { id: 'c', type: 'backend', label: 'C', size: [120, 60], pos: [376, 200] },
  ];
  spec.connections = [['a', 'b'], ['b', 'c']].map(([from, to]) => ({
    from, to, route: 'straight', fromSide: 'left', toSide: 'right',
  }));
  fs.writeFileSync(input, JSON.stringify(spec));
  const compatible = run(['inspect', 'architecture', input], 0);
  for (const card of compatible.components) {
    const authored = spec.components.find(component => component.id === card.id);
    if (authored.pos) assert.deepEqual([card.x, card.y], authored.pos);
  }
  for (const { points } of compatible.connections) {
    assert.equal(points.length, 2);
    assert.equal(points[0][1], points[1][1]);
    assert.ok(points[0][0] > points[1][0]);
  }

  spec.components[2].pos = [1100, 200];
  fs.writeFileSync(input, JSON.stringify(spec));
  const incompatible = run(['inspect', 'architecture', input], 1);
  assert.deepEqual(incompatible.components.find(card => card.id === 'c').pos, [1100, 200]);
  assert.ok(incompatible.diagnostics.some(issue => issue.code === 'clean-flow/endpoint-side-direction'));
});

test('architecture sizes unmeasured auto cards for multilingual text and footers', t => {
  const { input, run } = workspace(t);
  const spec = mixedPlacementSpec();
  const pinned = {
    id: 'local', type: 'backend', label: '本地策略与模拟执行器',
    sublabel: 'results.jsonl · run-metadata.json', tag: '项目 · 内部测试', brand: 'github',
    href: 'details.html', pos: [48, 70],
  };
  spec.components = [pinned, { id: 'report', type: 'database', label: 'HiveBench 报告生成器' }];
  spec.connections = [{ from: 'local', to: 'report', label: '追加结果' }];
  const inspect = (expectedStatus) => {
    fs.writeFileSync(input, JSON.stringify(spec));
    return run(['inspect', 'architecture', input, '--quality', 'showcase'], expectedStatus);
  };

  const fitted = inspect(0);
  assert.deepEqual(fitted.components[0].pos, pinned.pos);
  assert.ok(fitted.components[0].width > 120 && fitted.components[0].height > 60);
  assert.ok(fitted.components[1].width > 120);

  pinned.size = [120, 60];
  const explicit = inspect(1);
  assert.deepEqual([explicit.components[0].width, explicit.components[0].height], pinned.size);
  assert.ok(explicit.diagnostics.some(issue => issue.code === 'architecture/component-label-overflow'
    && issue.subject.nodeId === pinned.id));

  delete pinned.size;
  const label = pinned.label;
  pinned.label = '超长的体系结构说明'.repeat(10);
  const oversized = inspect(1);
  assert.ok(oversized.components[0].width < 320);
  assert.ok(oversized.diagnostics.some(issue => issue.code === 'architecture/component-label-overflow'
    && issue.subject.nodeId === pinned.id));

  pinned.label = label;
  delete spec.layout;
  spec.components[1].pos = [390, 70];
  const free = inspect(1);
  assert.deepEqual([free.components[0].width, free.components[0].height], [120, 60]);
  assert.ok(free.diagnostics.some(issue => issue.code === 'architecture/component-label-overflow'
    && issue.subject.nodeId === pinned.id));
});

test('architecture auto placement keeps mixed pins, inferred cards, and ownership frames separate', t => {
  const { input, run } = workspace(t);
  const spec = mixedPlacementSpec();
  const card = (id, pos) => ({ id, type: 'backend', label: id, ...(pos ? { pos } : {}) });
  const inspect = () => {
    fs.writeFileSync(input, JSON.stringify(spec));
    const report = run(['inspect', 'architecture', input, '--quality', 'showcase'], 0);
    for (const { id, pos } of spec.components.filter(component => component.pos)) {
      assert.deepEqual(report.components.find(box => box.id === id).pos, pos);
    }
    return report;
  };
  const boundary = { kind: 'region', label: 'System', wraps: ['a', 'b'], pad: 60 };
  spec.boundaries = [boundary];
  spec.components = [card('a', [100, 200]), card('b')];
  spec.connections = [{ from: 'b', to: 'a' }];
  const inside = inspect();
  assert.ok(inside.boundaries[0].x >= 0 && inside.boundaries[0].y >= 0);

  function assertOutsiderIsSeparate(report) {
    const [, , outsider] = report.components;
    const frame = report.boundaries[0];
    assert.equal(outsider.id, 'c');
    assert.ok(outsider.x >= frame.x + frame.width || outsider.x + outsider.width <= frame.x
      || outsider.y >= frame.y + frame.height || outsider.y + outsider.height <= frame.y);
  }

  boundary.pad = 80;
  spec.components = [card('a', [85, 120]), card('b', [800, 120]), card('c')];
  spec.connections = [];
  assertOutsiderIsSeparate(inspect());

  boundary.pad = 60;
  spec.components = [card('a', [204, 200]), card('b'), card('c', [495, 200])];
  spec.connections = [{ from: 'a', to: 'b' }];
  assertOutsiderIsSeparate(inspect());

  spec.components = [card('a', [204, 200]), card('b'), card('c')];
  spec.connections = [{ from: 'c', to: 'a' }, { from: 'a', to: 'b' }];
  assertOutsiderIsSeparate(inspect());

  spec.boundaries.push({ kind: 'security-group', label: 'Outer system', wraps: ['a', 'b', 'c'], pad: 100 });
  assertOutsiderIsSeparate(inspect());
});

test('architecture auto placement clears authored vias and absolute label positions', t => {
  const { input, run } = workspace(t);
  const spec = mixedPlacementSpec();
  spec.components = [
    { id: 'a', type: 'backend', label: 'A', pos: [80, 200] },
    { id: 'b', type: 'backend', label: 'B', pos: [650, 200] },
    { id: 'c', type: 'backend', label: 'C' },
  ];
  const route = { from: 'a', to: 'b' };
  const position = [490, 70];
  const inspect = () => {
    fs.writeFileSync(input, JSON.stringify(spec));
    return run(['inspect', 'architecture', input, '--quality', 'showcase'], 0);
  };

  spec.connections = [{ ...route, via: [position] }];
  assert.deepEqual(inspect().connections[0].points.slice(1, -1), [position]);

  spec.connections = [{ ...route, label: 'Authored label', labelAt: position }];
  assert.deepEqual(inspect().connections[0].labelAt, position);

  for (const component of spec.components) delete component.pos;
  const report = inspect();
  const [{ x, y, width, height }] = report.labels;
  assert.deepEqual(report.connections[0].labelAt, position);
  for (const card of report.components) {
    assert.ok(card.x >= x + width || card.x + card.width <= x
      || card.y >= y + height || card.y + card.height <= y);
  }
});

test('architecture auto placement keeps overlapping scopes on the canvas', t => {
  const { input, run } = workspace(t);
  const spec = mixedPlacementSpec();
  spec.components = ['a', 'b', 'c'].map(id => ({ id, type: 'backend', label: id }));
  spec.connections = [];
  spec.boundaries = [
    { kind: 'region', label: 'System', wraps: ['a', 'c'], pad: 30 },
    { kind: 'region', label: 'Other', wraps: ['b', 'c'], pad: 130 },
  ];
  fs.writeFileSync(input, JSON.stringify(spec));
  const report = run(['inspect', 'architecture', input, '--quality', 'showcase'], 0);
  assert.deepEqual(report.boundaries.map(frame => frame.wraps), spec.boundaries.map(frame => frame.wraps));
  assert.ok(report.boundaries.every(frame => frame.x >= 0 && frame.y >= 0));
  assert.ok(report.components.every(card => !Object.hasOwn(card, 'pos')));
});

test('architecture auto placement contains deployment frames whose child needs larger padding', t => {
  const { input, run } = workspace(t);
  const spec = mixedPlacementSpec();
  spec.meta.engineering_profile = 'deployment-ownership';
  spec.components = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, type: 'backend', label: id, tag: 'OPS' }));
  spec.connections = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'HTTP' },
    { from: 'c', to: 'd', label: 'HTTP' }, { from: 'd', to: 'e' },
  ];
  spec.boundaries = [
    { kind: 'region', label: 'System', wraps: spec.components.map(({ id }) => id), pad: 30 },
    { kind: 'security-group', label: 'Inner', wraps: ['c'], pad: 48 },
  ];
  fs.writeFileSync(input, JSON.stringify(spec));
  const report = run(['inspect', 'architecture', input, '--quality', 'showcase'], 0);
  const [outer, inner] = report.boundaries;
  assert.ok(outer.x < inner.x && outer.y < inner.y);
  assert.ok(outer.x + outer.width > inner.x + inner.width && outer.y + outer.height > inner.y + inner.height);
  assert.deepEqual(report.boundaries.map(frame => frame.wraps), spec.boundaries.map(frame => frame.wraps));
});
