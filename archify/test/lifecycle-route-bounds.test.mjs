import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/archify.mjs');
const pairs = ['ac', 'ad', 'bd', 'ca', 'da', 'db'];

function document({ count = 6, col = 0, right = false, pinned = false, viewBox, width, quality = 'showcase' } = {}) {
  const lanes = ['main', 'wait', 'retry', 'terminal'];
  return {
    schema_version: 2,
    diagram_type: 'lifecycle',
    meta: { title: 'Outer loops', output: 'outer-loops.html', quality_profile: quality, ...(viewBox ? { viewBox } : {}) },
    lanes: lanes.map(id => ({ id, label: id })),
    states: [
      ...lanes.map((lane, index) => ({ id: 'abcd'[index], type: 'active', label: 'abcd'[index], lane, col })),
      ...(right ? [{ id: 'left', type: 'neutral', label: 'Left', lane: 'main', col: 0 }] : []),
    ],
    transitions: Array.from({ length: count }, (_, index) => {
      const [from, to] = pairs[index % pairs.length];
      const side = right ? 'right' : 'left';
      return { id: `t${index}`, from, to, ...(pinned ? { fromSide: side, toSide: side } : {}), ...(width ? { width } : {}) };
    }),
  };
}

function deliver(t, doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-bounds-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'input.json');
  const output = path.join(tmp, 'output.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [cli, 'deliver', 'lifecycle', input, output, '--json'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true, result.stdout);
  const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0];
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const routes = [...svg.matchAll(/<path\b[^>]*data-edge-id="([^"]+)"[^>]*data-composition-points="([^"]+)"[^>]*stroke-width="([\d.]+)"/g)]
    .map(([, id, encoded, stroke]) => ({ id, points: encoded.split(';').map(point => point.split(',').map(Number)), stroke: Number(stroke) }));
  const nodes = Object.fromEntries([...svg.matchAll(/data-node-id="([^"]+)"[\s\S]*?<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" rx="7" class="c-mask"/g)]
    .map(([, id, x, y, width, height]) => [id, { x: Number(x), y: Number(y), width: Number(width), height: Number(height) }]));
  return { svg, viewBox, routes, nodes };
}

function contained(result, doc) {
  assert.equal(result.routes.length, doc.transitions.length, '每条作者关系都保留一个主路径');
  assert.deepEqual(result.viewBox.slice(0, 2), [0, 0], '保留 origin-zero 画布');
  for (const route of result.routes) {
    // 自动路径还有比主描边宽 4px 的 crossover halo。
    const inset = (route.stroke + 4) / 2;
    for (const [x] of route.points) {
      assert.ok(x >= inset - 1e-8 && x <= result.viewBox[2] - inset + 1e-8,
        `${route.id}: x=${x}, halo=${inset}, canvas=${result.viewBox[2]}`);
    }
    const relation = doc.transitions.find(transition => transition.id === route.id);
    const from = result.nodes[relation.from];
    const to = result.nodes[relation.to];
    assert.ok(route.points[0][0] === from.x || route.points[0][0] === from.x + from.width);
    assert.ok(route.points.at(-1)[0] === to.x || route.points.at(-1)[0] === to.x + to.width);
    if (relation.fromSide) assert.equal(route.points[0][0], relation.fromSide === 'left' ? from.x : from.x + from.width);
    if (relation.toSide) assert.equal(route.points.at(-1)[0], relation.toSide === 'left' ? to.x : to.x + to.width);
  }
  // 每个嵌套外绕的长竖线必须保持独立，halo 之间至少留 1px。
  const tracks = result.routes.map(route => ({ x: route.points[1][0], stroke: route.stroke })).sort((a, b) => a.x - b.x);
  for (let index = 1; index < tracks.length; index += 1) {
    const a = tracks[index - 1];
    const b = tracks[index];
    assert.ok(b.x - a.x >= (a.stroke + b.stroke) / 2 + 5 - 1e-8, `外绕轨道不能压到一起: ${a.x}, ${b.x}`);
  }
}

for (const options of [
  { count: 6 },
  { count: 6, quality: 'standard' },
  { count: 6, viewBox: [1000, 800] },
  { count: 6, width: 4 },
  { count: 6, width: 6 },
  { count: 8 },
  { count: 10 },
  { count: 6, col: 4, right: true },
  { count: 6, col: 4, right: true, viewBox: [1044, 800] },
]) {
  test(`v2 外绕路径完整落在原画布内: ${JSON.stringify(options)}`, t => {
    const doc = document(options);
    const result = deliver(t, doc);
    contained(result, doc);
    assert.equal(result.nodes.a.x, options.right ? 876 : 60, '不能为修复路由移动节点');
    assert.deepEqual(result.viewBox, options.viewBox ? [0, 0, ...options.viewBox] : [0, 0, options.right ? 1076 : 640, 768]);
  });
}

test('越界回线重排后不进入泳道标题占用的左侧区域', t => {
  const doc = document();
  const result = deliver(t, doc);
  contained(result, doc);
  const titles = [...result.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*writing-mode="vertical-rl"[^>]*>([^<]+)<\/text>/g)];
  assert.equal(titles.length, doc.lanes.length);
  for (const route of result.routes) {
    const inset = (route.stroke + 4) / 2;
    for (const [, x, y, font, label] of titles) {
      // 读取最终 SVG 标题位置，以现有 14px 标题宽度检查可见笔画和 halo。
      const title = { left: Number(x) - Number(font) * 0.7, right: Number(x) + Number(font) * 0.7,
        top: Number(y) - label.length * 3.1, bottom: Number(y) + label.length * 3.1 };
      for (let index = 1; index < route.points.length; index += 1) {
        const a = route.points[index - 1], b = route.points[index];
        assert.ok(Math.max(a[0], b[0]) + inset < title.left || Math.min(a[0], b[0]) - inset > title.right
          || Math.max(a[1], b[1]) + inset < title.top || Math.min(a[1], b[1]) - inset > title.bottom,
        `${route.id} 与泳道标题 ${label} 重叠`);
      }
    }
  }
});

test('标题与固定侧边不能同时容纳六条轨道时保留作者端口', t => {
  const doc = document({ pinned: true });
  const result = deliver(t, doc);
  assert.equal(result.routes.length, doc.transitions.length);
  for (const route of result.routes) {
    const relation = doc.transitions.find(transition => transition.id === route.id);
    assert.equal(route.points[0][0], result.nodes[relation.from].x);
    assert.equal(route.points.at(-1)[0], result.nodes[relation.to].x);
  }
});

for (let count = 1; count <= 5; count += 1) {
  test(`v2 少量外绕关系控制组: ${count}`, t => {
    const doc = document({ count });
    const result = deliver(t, doc);
    contained(result, doc);
    assert.equal(result.nodes.a.x, 60);
    if (count <= 4) assert.deepEqual(result.routes.map(route => route.points[1][0]).sort((a, b) => a - b),
      Array.from({ length: count }, (_, index) => 42 - index * 10).reverse(), '没有越界时保持原轨道');
  });
}

for (const col of [1, 4]) {
  test(`v2 空余左侧空间足够时保留原路由: col=${col}`, t => {
    const doc = document({ col });
    const result = deliver(t, doc);
    contained(result, doc);
    assert.equal(Math.min(...result.routes.flatMap(route => route.points.map(point => point[0]))), col === 1 ? 196 : 808);
  });
}

test('显式 via/channel 坐标不随旁边的自动外绕轨道调整', t => {
  const doc = document();
  doc.states.push(
    { id: 'e', type: 'active', label: 'E', lane: 'main', col: 1 },
    { id: 'f', type: 'active', label: 'F', lane: 'wait', col: 1 },
  );
  doc.transitions.push({ id: 'authored', from: 'e', to: 'f', fromSide: 'bottom', toSide: 'top', via: [[334, 180]], channelY: 180 });
  const result = deliver(t, doc);
  assert.deepEqual(result.routes.find(route => route.id === 'authored').points, [[334, 120], [334, 180], [334, 240]]);
  contained({ ...result, routes: result.routes.filter(route => route.id !== 'authored') }, { ...doc, transitions: doc.transitions.slice(0, -1) });
});

test('左右两组外绕同时越界时，换侧关系只布局一次', t => {
  const doc = document({ count: 10 });
  const right = document({ count: 6, col: 4 });
  const rename = id => `right-${id}`;
  doc.states.push(...right.states.map(state => ({ ...state, id: rename(state.id) })));
  doc.transitions.push(...right.transitions.map(transition => ({ ...transition,
    id: rename(transition.id), from: rename(transition.from), to: rename(transition.to) })));
  contained(deliver(t, doc), doc);
});

test('显式 bottom-channel 的坐标保持原值', t => {
  const doc = document();
  doc.states.push(
    { id: 'e', type: 'active', label: 'E', lane: 'main', col: 1 },
    { id: 'f', type: 'active', label: 'F', lane: 'main', col: 2 },
  );
  doc.transitions.push({ id: 'authored', from: 'e', to: 'f', fromSide: 'bottom', toSide: 'bottom', route: 'bottom-channel', channelY: 180 });
  const result = deliver(t, doc);
  assert.deepEqual(result.routes.find(route => route.id === 'authored').points, [[334, 120], [334, 180], [538, 180], [538, 120]]);
  contained({ ...result, routes: result.routes.filter(route => route.id !== 'authored') }, { ...doc, transitions: doc.transitions.slice(0, -1) });
});

test('start 状态初始标记保持可用，外绕仍避开其左侧', t => {
  const doc = document({ col: 4, right: true });
  doc.states[0].type = 'start';
  // 左侧有初始标记，不能为了调整轨道把路径移到标记上。
  const result = deliver(t, doc);
  contained(result, doc);
  assert.match(result.svg, /<circle cx="854" cy="88" r="4\.5"/);
  for (const route of result.routes) assert.ok(route.points[1][0] > result.nodes.a.x + result.nodes.a.width);
});

test('换侧走廊避开其他列的初始圆点和箭线，并保留可见轨道间距', t => {
  const doc = document({ count: 10 });
  doc.states = [...doc.states.slice(0, 3),
    { id: 'marker', type: 'start', label: 'M', lane: 'wait', col: 1, width: 48 },
    { id: 'wide', type: 'active', label: 'Wide', lane: 'terminal', col: 1, width: 160 },
  ];
  doc.transitions = doc.transitions.map((transition, index) => ({ ...transition,
    from: index % 2 ? 'c' : 'a', to: index % 2 ? 'a' : 'c' }));
  const result = deliver(t, doc);
  contained(result, doc);
  const [dotX, dotY, radius] = result.svg.match(/data-lifecycle-initial-marker=""[^>]*>\s*<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/).slice(1).map(Number);
  assert.deepEqual([dotX, dotY, radius], [298, 272, 4.5], '固定实际渲染标记的几何');
  for (const route of result.routes) {
    const inset = (route.stroke + 4) / 2;
    const [start, end] = route.points.slice(1, 3);
    assert.ok(Math.min(start[1], end[1]) < dotY && Math.max(start[1], end[1]) > dotY);
    assert.ok(start[0] + inset < dotX - radius || start[0] - inset > result.nodes.marker.x - 1,
      `${route.id} 外绕轨道与其他列的初始标记重叠: ${start[0]}`);
  }
});

test('左右两组都需要换到内侧时，不形成新的共享水平走廊', t => {
  const doc = document({ count: 10, viewBox: [554, 800] });
  doc.states = doc.states.slice(0, 3);
  doc.transitions = doc.transitions.map((transition, index) => ({ ...transition,
    from: index % 2 ? 'c' : 'a', to: index % 2 ? 'a' : 'c' }));
  const rename = id => ({ a: 'x', b: 'y', c: 'z' })[id];
  doc.states.push(...doc.states.map(state => ({ ...state, id: rename(state.id), col: 1 })));
  doc.transitions.push(...doc.transitions.map(transition => ({ ...transition,
    id: `right-${transition.id}`, from: rename(transition.from), to: rename(transition.to) })));
  doc.transitions.push({ id: 'space', from: 'a', to: 'x', label: 'abcdefghijklmnopqrstuvwx' });
  const result = deliver(t, doc);
  contained(result, doc);
  const left = result.routes.filter(route => /^t\d+$/.test(route.id));
  const right = result.routes.filter(route => route.id.startsWith('right-'));
  assert.ok(Math.max(...left.map(route => route.points[1][0] + (route.stroke + 4) / 2))
    < Math.min(...right.map(route => route.points[1][0] - (route.stroke + 4) / 2)),
  '两组相向的水平线段及 halo 之间必须留有间隔');
});

function wideMiddleDocument(side) {
  const doc = document({ count: 10, col: side === 'left' ? 1 : 0,
    ...(side === 'left' ? { viewBox: [532, 800] } : {}) });
  doc.states = doc.states.slice(0, 3);
  doc.states[1].width = 240;
  // 跨度外的另一列仍决定最外列，但不能扩大本组的换侧包络。
  doc.states.push({ id: 'outside', type: 'active', label: 'Outside', lane: 'terminal',
    col: side === 'left' ? 0 : 1, width: side === 'left' ? 140 : 300 });
  doc.transitions = doc.transitions.map((transition, index) => ({ ...transition,
    from: index % 2 ? 'c' : 'a', to: index % 2 ? 'a' : 'c' }));
  return doc;
}

for (const side of ['right', 'left']) {
  test(`宽中间状态仍有可用空间时，外绕关系可换到${side}侧`, t => {
    const doc = wideMiddleDocument(side);
    const result = deliver(t, doc);
    contained(result, doc);
    const obstacle = result.nodes.b;
    for (const route of result.routes) {
      const inset = (route.stroke + 4) / 2;
      assert.ok(side === 'left' ? route.points[1][0] + inset < obstacle.x
        : route.points[1][0] - inset > obstacle.x + obstacle.width,
      `${route.id} 必须经过宽中间状态外侧的可用走廊`);
    }
    assert.equal(obstacle.width, 240, '不能靠缩小中间状态释放空间');
  });

  test(`宽中间状态不能覆盖作者固定的${side === 'left' ? 'right' : 'left'}侧端口`, t => {
    const doc = wideMiddleDocument(side);
    const pinned = side === 'left' ? 'right' : 'left';
    for (const transition of doc.transitions) transition.fromSide = transition.toSide = pinned;
    const result = deliver(t, doc);
    assert.equal(result.routes.length, doc.transitions.length);
    for (const route of result.routes) {
      const relation = doc.transitions.find(transition => transition.id === route.id);
      for (const [point, node] of [[route.points[0], result.nodes[relation.from]], [route.points.at(-1), result.nodes[relation.to]]]) {
        assert.equal(point[0], pinned === 'left' ? node.x : node.x + node.width);
      }
    }
    // 原侧空间不足仍保留显式约束；不把交付成功误当作几何已完整入画。
    assert.ok(result.routes.some(route => route.points.some(([x]) => x < 0 || x > result.viewBox[2])));
  });
}

test('同列跨度外的宽状态不挤占换侧走廊', t => {
  const doc = wideMiddleDocument('right');
  Object.assign(doc.states.at(-1), { col: 0, width: 900 });
  const result = deliver(t, doc);
  contained(result, doc);
  assert.ok(result.routes.every(route => route.points[1][0] > result.nodes.b.x + result.nodes.b.width
    && route.points[1][0] < result.nodes.outside.x + result.nodes.outside.width));
});

test('同组不同跨度保留原本已避开宽节点及邻列的换侧候选', t => {
  const doc = document({ count: 10 });
  doc.states.push(
    { id: 'wide', type: 'active', label: 'Wide', lane: 'retry', col: 0, width: 240, yOffset: 96 },
    { id: 'neighbor', type: 'active', label: 'N', lane: 'retry', col: 1, yOffset: 96 },
  );
  doc.transitions = doc.transitions.map((transition, index) => ({ ...transition,
    from: index % 2 ? (index < 5 ? 'c' : 'd') : 'a',
    to: index % 2 ? 'a' : (index < 5 ? 'c' : 'd') }));
  const result = deliver(t, doc);
  contained(result, doc);
  assert.deepEqual(result.routes.map(route => route.points[1][0]),
    Array.from({ length: 10 }, (_, index) => 268 + index * 10), '已无碰撞的短长嵌套分配保持原值');
});
