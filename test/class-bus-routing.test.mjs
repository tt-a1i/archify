import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const epsilon = 0.0001;
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

function diagram(ordinaryKind = 'realization', mixedBuses = false) {
  return {
    schema_version: 1,
    diagram_type: 'class',
    meta: { title: 'Interface extension and use' },
    types: mixedBuses ? [
      { id: 'base', label: 'Base', kind: 'interface', row: 0, col: 1.5 },
      { id: 'left', label: 'Left', kind: 'interface', row: 1, col: 0 },
      { id: 'right', label: 'Right', kind: 'interface', row: 1, col: 1 },
      { id: 'impl', label: 'Impl', kind: 'class', row: 1, col: 2 },
      { id: 'other', label: 'Other', kind: 'class', row: 1, col: 3 },
    ] : [
      { id: 'base', label: 'Base', kind: 'interface', row: 0, col: 1 },
      { id: 'left', label: 'Left', kind: 'interface', row: 1, col: 0 },
      { id: 'right', label: 'Right', kind: 'interface', row: 1, col: 2 },
      { id: 'impl', label: 'Impl', kind: 'class', row: 2, col: 1 },
    ],
    relationships: [
      { id: 'left_extends', from: 'left', to: 'base', kind: 'inheritance' },
      { id: 'right_extends', from: 'right', to: 'base', kind: 'inheritance' },
      { id: 'impl_relation', from: 'impl', to: 'base', kind: ordinaryKind },
      ...(mixedBuses ? [{ id: 'other_relation', from: 'other', to: 'base', kind: 'realization' }] : []),
    ],
  };
}

function interleavedHierarchy() {
  const document = diagram('realization', true);
  document.types.find(({ id }) => id === 'right').col = 2;
  document.types.find(({ id }) => id === 'impl').col = 1;
  // 抽象实现与接口同高，不能依赖两组节点的高度差来区分继承和实现线路。
  document.types.filter(({ id }) => id === 'impl' || id === 'other')
    .forEach((type) => { type.kind = 'abstract'; });
  return document;
}

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function render(t, document, quality = 'showcase') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-bus-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.class.json');
  const output = path.join(directory, 'output.html');
  const authoredInput = JSON.stringify(document);
  fs.writeFileSync(input, authoredInput);
  // The same class renderer and artifact checker run during validation.
  // Check the actual output once, then inspect the SVG from those checked bytes.
  run(['render', 'class', input, output, '--quality', quality], directory);
  const check = JSON.parse(run(['check', output, '--json'], directory));
  assert.equal(check.ok, true);
  assert.equal(fs.readFileSync(input, 'utf8'), authoredInput, '路由归一化不得改写作者输入');
  assert.equal(check.composition.profile, quality);
  assert.equal(check.composition.summary.errors, 0);
  const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, '渲染结果应包含 SVG');
  const viewBox = attrs(svg.match(/<svg\b[^>]*>/)[0]).viewBox.split(/[\s,]+/).map(Number);
  assert.equal(viewBox.length, 4);
  assert.ok(viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0, '画布范围必须有效');
  const [minX, minY, width, height] = viewBox;
  const routes = [...svg.matchAll(/<path\b[^>]*data-class-relationship=[^>]*>/g)]
    .map((match) => attrs(match[0])).filter((route) => route['data-edge-id'])
    .map((route) => ({
      id: route['data-edge-id'], from: route['data-edge-from'], to: route['data-edge-to'],
      kind: route['data-class-relationship'], attrs: route,
      points: route['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)),
    }));
  const boxes = new Map([...svg.matchAll(/<g\b[^>]*data-node-id="([^"]+)"[^>]*>[\s\S]*?<rect\b([^>]*)>/g)]
    .map((match) => {
      const rect = attrs(match[2]);
      return [match[1], Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Number(rect[key])]))];
    }));
  assert.equal(routes.length, document.relationships.length, '所有作者关系都必须保留');
  for (const authored of document.relationships) {
    const route = routes.find(({ id }) => id === authored.id);
    assert.ok(route, authored.id);
    assert.deepEqual([route.from, route.to, route.kind], [authored.from, authored.to, authored.kind]);
    for (const [x, y] of route.points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${route.id} 路径点必须有限`);
      assert.ok(x >= minX - epsilon && x <= minX + width + epsilon
        && y >= minY - epsilon && y <= minY + height + epsilon,
      `${route.id} 的路径点 [${x}, ${y}] 必须位于画布内，避免绕行被裁切`);
    }
    assert.ok(onSide(route.points[0], boxes.get(route.from)), `${route.id} 必须从来源类型出发`);
    assert.ok(onSide(route.points.at(-1), boxes.get(route.to)), `${route.id} 必须到达目标类型`);
    const marker = route.attrs['marker-end'] || route.attrs['marker-start'];
    assert.match(marker, authored.kind === 'dependency' ? /cl-open/ : /cl-triangle/);
    assert.equal(/\bcl-dashed\b/.test(route.attrs.class), authored.kind !== 'inheritance');
  }
  return { svg, routes, boxes };
}

function onSide([x, y], box, side) {
  const withinX = x >= box.x - epsilon && x <= box.x + box.width + epsilon;
  const withinY = y >= box.y - epsilon && y <= box.y + box.height + epsilon;
  const sides = {
    left: withinY && Math.abs(x - box.x) < epsilon,
    right: withinY && Math.abs(x - box.x - box.width) < epsilon,
    top: withinX && Math.abs(y - box.y) < epsilon,
    bottom: withinX && Math.abs(y - box.y - box.height) < epsilon,
  };
  return side ? sides[side] : Object.values(sides).some(Boolean);
}

// 只量同一条直线上的正长度重叠；正交交叉和一个公共点不算共享走廊。
function overlapLength([a, b], [c, d]) {
  const horizontal = Math.abs(a[1] - b[1]) < epsilon && Math.abs(c[1] - d[1]) < epsilon;
  const vertical = Math.abs(a[0] - b[0]) < epsilon && Math.abs(c[0] - d[0]) < epsilon;
  if (!horizontal && !vertical) return 0;
  const axis = horizontal ? 0 : 1;
  if (Math.abs(a[1 - axis] - c[1 - axis]) >= epsilon) return 0;
  return Math.max(0, Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
    - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])));
}

function assertDistinctNotation(routes) {
  for (const [index, left] of routes.entries()) {
    for (const right of routes.slice(index + 1)) {
      if (left.kind === right.kind) continue;
      if (left.to === right.to) {
        const a = left.points.at(-1);
        const b = right.points.at(-1);
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 16 - epsilon,
          `${left.id} 和 ${right.id} 的不同关系标记不可重叠`);
      }
      for (let i = 1; i < left.points.length; i += 1) {
        for (let j = 1; j < right.points.length; j += 1) {
          assert.ok(overlapLength([left.points[i - 1], left.points[i]], [right.points[j - 1], right.points[j]]) <= epsilon,
            `${left.id} 和 ${right.id} 不可共用正长度线段而混淆关系种类`);
        }
      }
    }
  }
}

for (const quality of ['standard', 'showcase']) {
  for (const [name, document] of [
    ['bus plus realization', diagram('realization')],
    ['bus plus dependency', diagram('dependency')],
    ['inheritance and realization buses', diagram('realization', true)],
    ['interleaved interfaces and abstract implementations', interleavedHierarchy()],
  ]) {
    test(`class ${quality}: ${name} keeps different relationship notations distinct in either authored order`, (t) => {
      for (const reverse of [false, true]) {
        const candidate = structuredClone(document);
        if (reverse) candidate.relationships.reverse();
        const result = render(t, candidate, quality);
        assertDistinctNotation(result.routes);
      }
    });
  }
}

for (const quality of ['standard', 'showcase']) {
  for (const kind of ['dependency', 'realization']) {
    test(`class ${quality}: empty via keeps ${kind} fallback equivalent to omitted waypoints`, (t) => {
      for (const reverse of [false, true]) {
        const omitted = diagram(kind);
        if (reverse) omitted.relationships.reverse();
        const expected = render(t, omitted, quality);
        for (const selection of ['one', 'hierarchy', 'all']) {
          const document = structuredClone(omitted);
          const members = document.relationships.filter((relation) => selection === 'all' || relation.kind === 'inheritance');
          for (const relation of selection === 'one' ? members.slice(0, 1) : members) relation.via = [];
          const actual = render(t, document, quality);
          assertDistinctNotation(actual.routes);
          assert.equal(actual.svg, expected.svg, `${selection}: 空 via 与省略字段应有相同渲染行为`);
        }
      }
    });
  }
}

for (const kind of ['inheritance', 'realization']) {
  test(`class: an isolated ${kind} hierarchy retains its shared bus`, (t) => {
    const document = diagram();
    document.types = document.types.filter(({ id }) => id !== 'impl');
    document.relationships = document.relationships.slice(0, 2).map((relation) => ({ ...relation, kind }));
    if (kind === 'realization') document.types.filter(({ id }) => id !== 'base').forEach((type) => { type.kind = 'class'; });
    const { routes } = render(t, document);
    assert.ok(routes.every((route) => route.attrs['data-class-bus'] === 'base'), '无冲突的同类关系仍应共用总线');
    assert.deepEqual(routes[0].points.at(-1), routes[1].points.at(-1), '同类总线保留同一个三角标记落点');
  });
}

test('class: a separate storage hierarchy keeps its bus while another hierarchy is repaired', (t) => {
  const document = diagram('dependency');
  document.types.push(
    { id: 'storage', label: 'StoragePort', kind: 'interface', row: 3, col: 0.5 },
    { id: 'disk', label: 'DiskStore', kind: 'class', row: 4, col: 0 },
    { id: 'cloud', label: 'CloudStore', kind: 'class', row: 4, col: 1 },
  );
  document.relationships.push(
    { id: 'disk_storage', from: 'disk', to: 'storage', kind: 'realization' },
    { id: 'cloud_storage', from: 'cloud', to: 'storage', kind: 'realization' },
  );
  for (const reverse of [false, true]) {
    const candidate = structuredClone(document);
    if (reverse) candidate.relationships.reverse();
    const { routes } = render(t, candidate);
    assertDistinctNotation(routes);
    const storage = routes.filter(({ to }) => to === 'storage');
    assert.ok(storage.every((route) => route.attrs['data-class-bus'] === 'storage'),
      '独立的同类总线不应因别处的线路冲突而拆散');
    assert.deepEqual(storage[0].points.at(-1), storage[1].points.at(-1));
  }
});

for (const [control, emptyVia] of ['via', 'sides', 'route', 'labelAt']
  .flatMap((control) => (control === 'via' ? [[control, false]] : [[control, false], [control, true]]))) {
  test(`class: bus coordination preserves authored ${control}${emptyVia ? ' with empty via' : ''}`, (t) => {
    const document = diagram('dependency');
    const relation = document.relationships.at(-1);
    if (emptyVia) relation.via = [];
    if (control === 'via') {
      Object.assign(relation, { fromSide: 'right', toSide: 'right', via: [[584, 313], [584, 62]] });
    } else if (control === 'sides') {
      Object.assign(relation, { fromSide: 'right', toSide: 'right' });
    } else if (control === 'route') {
      Object.assign(relation, { route: 'straight', fromSide: 'top', toSide: 'bottom' });
    } else {
      Object.assign(relation, { label: 'uses', labelAt: [600, 300] });
    }
    const { svg, routes, boxes } = render(t, document);
    const route = routes.find(({ id }) => id === relation.id);
    if (relation.fromSide) assert.ok(onSide(route.points[0], boxes.get(relation.from), relation.fromSide));
    if (relation.toSide) assert.ok(onSide(route.points.at(-1), boxes.get(relation.to), relation.toSide));
    if (relation.via?.length) assert.deepEqual(route.points.slice(1, -1), relation.via, '作者 via 点必须原样保留');
    if (relation.route === 'straight') assert.equal(route.points.length, 2, '作者要求的直线路由不能被自动绕行替代');
    if (relation.labelAt) {
      const labelGroup = [...svg.matchAll(/<g\b[^>]*data-edge-id="impl_relation"[^>]*>[\s\S]*?<\/g>/g)]
        .map((match) => match[0]).find((group) => group.includes('<text'));
      assert.ok(labelGroup, '作者关系标签必须保留');
      const label = attrs(labelGroup.match(/<text\b[^>]*>/)[0]);
      assert.deepEqual([Number(label.x), Number(label.y)], relation.labelAt);
    }
  });
}
