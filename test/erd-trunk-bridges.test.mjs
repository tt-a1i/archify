import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSvgPath } from '../archify/renderers/shared/svg-path-analysis.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const epsilon = 0.0001;
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));

function fixture({ horizontal = false, conflict, dashed = false, offset = 0, width } = {}) {
  const table = (id, pos, rows = 3) => ({
    id, label: id, pos, width: rows * 20 + 36,
    attributes: Array.from({ length: rows }, (_, index) => ({ name: `f${index}`, type: 'int' })),
  });
  const document = {
    schema_version: 1, diagram_type: 'erd',
    meta: { title: 'Independent relationship beside a shared parent', locale: 'en', quality_profile: 'showcase', legend: { mode: 'hidden' } },
    entities: [table('hub', [40, 80], 4), table('a', [240, 0]), table('b', [240, 280]), table('c', [440, 0]), table('d', [440, 280])],
    relationships: [
      { id: 'a_hub', from: 'a', to: 'hub', fromCardinality: 'many', toCardinality: 'one', fromSide: 'left', toSide: 'right' },
      { id: 'b_hub', from: 'b', to: 'hub', fromCardinality: 'many', toCardinality: 'one', fromSide: 'left', toSide: 'right' },
    ],
  };
  if (conflict) {
    // 两条逻辑主干之间留下 24px 空隙；独立关系的显式 U 形路线进入该空隙。
    // 相切用 16px 回转段，圆角恰好在总线上相接；重叠用 20px 留下真正的直线墨迹。
    const x = conflict === 'crossing' ? 164 : 172 + offset;
    const [top, bottom] = width > 1.5 || conflict === 'touch' ? [130, 146] : [128, 148];
    document.relationships.push({
      id: 'c_d', from: 'c', to: 'd', fromCardinality: 'many', toCardinality: 'one',
      fromSide: 'left', toSide: 'left',
      via: [[400, 48], [400, top], [x, top], [x, bottom], [400, bottom], [400, 328]],
      ...(dashed ? { identifying: false } : {}),
      ...(width === undefined ? {} : { width }),
    });
  }
  if (horizontal) {
    // 方形实体的转置保留其尺寸，显式端口和途经点一起转置。
    document.entities.forEach(entity => { entity.pos.reverse(); });
    document.relationships.forEach(relationship => {
      const sides = { left: 'top', right: 'bottom' };
      relationship.fromSide = sides[relationship.fromSide];
      relationship.toSide = sides[relationship.toSide];
      relationship.via?.forEach(point => point.reverse());
    });
  }
  return document;
}

function render(t, document) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-bridge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.erd.json');
  const output = path.join(directory, 'output.html');
  const source = JSON.stringify(document);
  fs.writeFileSync(input, source);
  const result = spawnSync(process.execPath, [cli, 'render', 'erd', input, output], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(input, 'utf8'), source, '作者输入必须保持原样');
  const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0];
  const boxes = new Map([...svg.matchAll(/<g\b[^>]*data-node-id="([^"]+)"[^>]*>[\s\S]*?<rect\b([^>]*)>/g)]
    .map(match => [match[1], attributes(match[2])]));
  for (const entity of document.entities) {
    const box = boxes.get(entity.id);
    assert.deepEqual([Number(box.x), Number(box.y), Number(box.width)], [...entity.pos, entity.width], '显式实体坐标和宽度保持不变');
  }
  const paths = [...svg.matchAll(/<path\b[^>]*data-composition-points="[^"]+"[^>]*>/g)].map(match => {
    const attrs = attributes(match[0]);
    const parsed = analyzeSvgPath(attrs.d);
    assert.equal(parsed.ok, true, attrs.d);
    return { attrs, points: attrs['data-composition-points'].split(';').map(pair => pair.split(',').map(Number)),
      segments: parsed.subpaths.flatMap(subpath => subpath.segments) };
  });
  const trunks = paths.filter(route => Object.hasOwn(route.attrs, 'data-er-trunk'));
  const relationships = paths.filter(route => route.attrs['data-edge-id']);
  assert.ok(trunks.length, '安全的主干段仍然绘制');
  assert.equal(relationships.length, document.relationships.length, '所有关系及其基数均须保留');
  for (const authored of document.relationships) {
    const route = relationships.find(candidate => candidate.attrs['data-edge-id'] === authored.id);
    assert.deepEqual([route.attrs['data-edge-from'], route.attrs['data-edge-to']], [authored.from, authored.to]);
    assert.equal(route.attrs['marker-start'], `url(#er-${authored.fromCardinality}-start)`);
    assert.equal(route.attrs['marker-end'], `url(#er-${authored.toCardinality}-end)`);
    assert.equal(route.attrs.class, authored.identifying === false ? 'a-dashed' : 'a-default');
    if (authored.via) assert.deepEqual(route.points.slice(1, -1), authored.via, '显式途经点不能为了总线而移动');
  }
  return { trunks, relationships };
}

// 总线为轴对齐直线；从实际 d 的直线和曲线采样判断交叉、端点接触及正长度重叠。
// 不读逻辑 data-composition-points 来代替真实墨迹，否则会漏掉这次额外补出的桥接段。
function hitsTrunk({ start: a, end: b }, { start, end }) {
  const axis = Math.abs(a[0] - b[0]) < epsilon ? 0 : 1;
  const low = Math.min(a[1 - axis], b[1 - axis]);
  const high = Math.max(a[1 - axis], b[1 - axis]);
  if (Math.abs(start[axis] - end[axis]) < epsilon) {
    return Math.abs(start[axis] - a[axis]) < epsilon
      && Math.min(start[1 - axis], end[1 - axis]) <= high + epsilon
      && Math.max(start[1 - axis], end[1 - axis]) >= low - epsilon;
  }
  const amount = (a[axis] - start[axis]) / (end[axis] - start[axis]);
  const position = start[1 - axis] + amount * (end[1 - axis] - start[1 - axis]);
  return amount >= -epsilon && amount <= 1 + epsilon && position >= low - epsilon && position <= high + epsilon;
}

for (const scenario of [
  { conflict: 'crossing', dashed: true },
  { conflict: 'touch' },
  { conflict: 'overlap', horizontal: true },
]) {
  test(`ERD ${scenario.horizontal ? 'horizontal' : 'vertical'} trunk bridges avoid an independent ${scenario.conflict}`, t => {
    const { trunks, relationships } = render(t, fixture(scenario));
    const independent = relationships.find(route => route.attrs['data-edge-id'] === 'c_d');
    for (const trunk of trunks) {
      assert.ok(trunk.segments.every(bus => independent.segments.every(segment => !hitsTrunk(bus, segment))),
        '额外桥接不能把无关关系画成总线的分支');
    }
  });
}

test('ERD clear vertical and horizontal fan-in gaps retain one continuous shared trunk', t => {
  for (const horizontal of [false, true]) {
    const { trunks, relationships } = render(t, fixture({ horizontal }));
    const ports = relationships.map(route => route.points.at(-1));
    const along = horizontal ? 0 : 1;
    assert.ok(trunks.some(trunk => {
      const values = trunk.points.map(point => point[along]);
      return Math.min(...values) <= Math.min(...ports.map(point => point[along]))
        && Math.max(...values) >= Math.max(...ports.map(point => point[along]));
    }), '同一总线的合法分支间隙仍须连通');
  }
});

function pointDistance(point, { start, end }) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
}

function centerlineDistance(trunk, route) {
  if (hitsTrunk(trunk, route)) return 0;
  return Math.min(pointDistance(trunk.start, route), pointDistance(trunk.end, route),
    pointDistance(route.start, trunk), pointDistance(route.end, trunk));
}

for (const horizontal of [false, true]) {
  test(`ERD ${horizontal ? 'horizontal' : 'vertical'} bridge clearance covers both rendered stroke widths`, t => {
    for (const [offset, width] of [[0.1, undefined], [1.2, undefined], [1.5, undefined], [2.5, 4]]) {
      const { trunks, relationships } = render(t, fixture({ conflict: 'near', horizontal, offset, width }));
      const independent = relationships.find(route => route.attrs['data-edge-id'] === 'c_d');
      for (const trunk of trunks) {
        const separation = (Number(trunk.attrs['stroke-width']) + Number(independent.attrs['stroke-width'])) / 2;
        assert.ok(trunk.segments.every(bus => independent.segments.every(segment =>
          centerlineDistance(bus, segment) > separation + epsilon)),
        `距离 ${offset} 的实际描边不能被桥接连在一起，包含显式加粗关系`);
      }
    }
  });

  test(`ERD ${horizontal ? 'horizontal' : 'vertical'} bridges survive when nearby strokes remain separate`, t => {
    for (const [offset, width] of [[1.6, undefined], [2.85, 4]]) {
      const { trunks, relationships } = render(t, fixture({ conflict: 'near', horizontal, offset, width }));
      const ports = relationships.filter(route => route.attrs['data-edge-id'] !== 'c_d').map(route => route.points.at(-1));
      const along = horizontal ? 0 : 1;
      assert.ok(trunks.some(trunk => {
        const values = trunk.points.map(point => point[along]);
        return Math.min(...values) <= Math.min(...ports.map(point => point[along]))
          && Math.max(...values) >= Math.max(...ports.map(point => point[along]));
      }), '有足够描边间距时仍保留连通主干，不能用过大的固定间距一律删除桥接');
    }
  });
}
