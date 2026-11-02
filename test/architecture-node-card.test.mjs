import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'archify/bin/archify.mjs');

function render(t, components, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-card-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Cards', output: 'out.html', cardSizing: 'uniform' }, components, connections: [], ...extra }));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(output, 'utf8');
}

function node(html, id) {
  const m = html.match(new RegExp(`<g [^>]*data-node-id="${id}"[^>]*>[\\s\\S]*?\\n        </g>`));
  assert.ok(m, `node ${id} rendered`);
  return m[0];
}

test('an explanation adds the ⓘ affordance without putting its prose in the SVG', t => {
  const prose = 'Owns order state transitions and emits domain events.';
  const html = render(t, [
    { id: 'orders', type: 'backend', label: 'Orders', sublabel: 'API', pos: [40, 40], explanation: prose },
    { id: 'plain', type: 'backend', label: 'Plain', sublabel: 'API', pos: [240, 40] },
  ]);
  assert.match(node(html, 'orders'), /data-node-info=""/);
  assert.doesNotMatch(node(html, 'plain'), /data-node-info=""/);
  const svg = html.match(/<svg[\s\S]*<\/svg>/)[0];
  assert.ok(!svg.includes(prose), 'explanation stays in the passport');
});

test('near-white brand colours get an ink plate; coloured brands keep the light plate', t => {
  const html = render(t, [
    { id: 'gh', type: 'external', label: 'GitHub', brand: 'github', pos: [40, 40] },
    { id: 'pg', type: 'database', label: 'Postgres', brand: 'postgresql', pos: [260, 40] },
  ]);
  assert.match(html, /\.brand-mark\.brand-mark-ink \.brand-mark-badge \{ fill: #1f2937; \}/);
  const pg = node(html, 'pg');
  assert.match(pg, /class="brand-mark[^"]*"/);
  assert.doesNotMatch(pg, /brand-mark-ink/);
});

const box = (html, id) => {
  const m = node(html, id).match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"[^>]*class="c-mask"/);
  return { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
};

test('cards share one grid-aligned width that fits the widest label and context line', t => {
  const html = render(t, [
    { id: 'short', type: 'backend', label: 'API', pos: [40, 40] },
    { id: 'long', type: 'backend', label: 'Payment Reconciliation', sublabel: 'nightly ledger sync', pos: [40, 160] },
    { id: 'sized', type: 'backend', label: 'Gateway', sublabel: 'routes partner traffic', size: [140, 60], pos: [400, 40] },
    { id: 'compact', type: 'backend', label: 'Notify', sublabel: 'email', size: [64, 40], pos: [400, 160] },
  ]);
  const widths = ['short', 'long', 'sized', 'compact'].map((id) => box(html, id).width);
  assert.equal(new Set(widths).size, 1, `uniform width ${widths}`);
  assert.ok(widths[0] % 8 === 0 && widths[0] > 140 && widths[0] <= 240, `width ${widths[0]}`);
  // An authored compact size becomes the same card, never a text-only box.
  assert.match(node(html, 'compact'), /data-node-card="layered"/);
  for (const id of ['short', 'long', 'sized', 'compact']) assert.doesNotMatch(node(html, id), /data-node-info/, `${id} fits without truncation`);
});

test('every layered card has the same height and an icon tile, with no corner sigil', t => {
  const html = render(t, [
    { id: 'users', type: 'external', label: 'Users', sublabel: 'Browser', size: [130, 68], pos: [40, 40] },
    { id: 'next', type: 'frontend', label: 'Next.js', sublabel: 'App Router UI', brand: 'next-js', size: [140, 68], pos: [260, 40] },
    { id: 'api', type: 'backend', label: 'Route handlers', sublabel: 'Server actions / API', size: [150, 68], pos: [480, 40] },
    { id: 'notify', type: 'backend', label: 'Notify', size: [64, 40], pos: [480, 200] },
  ]);
  const heights = new Set();
  for (const id of ['users', 'next', 'api', 'notify']) {
    const card = node(html, id);
    heights.add(box(html, id).height);
    assert.match(card, /data-node-card="layered"/, `${id} is layered`);
    assert.match(card, /data-brand-logo|class="node-card-tile"/, `${id} has an icon tile`);
    assert.doesNotMatch(card, /data-semantic-sigil/, `${id} has no corner sigil`);
    assert.ok((card.match(/<g [^>]*data-brand-(?:mark|logo)/g) || []).length <= 1, `${id} has no extra corner badge`);
  }
  assert.equal(heights.size, 1, `uniform height ${[...heights]}`);
  assert.match(node(html, 'api'), /data-generic-icon="api"/, 'route handlers use the API icon');
});

test('a diagram of only small authored cards renders uniform small cards with a tile', t => {
  const html = render(t, [
    { id: 'a', type: 'backend', label: 'Auth', size: [80, 40], pos: [40, 40] },
    { id: 'b', type: 'backend', label: 'Mail', size: [64, 36], pos: [240, 40] },
  ]);
  assert.equal(box(html, 'a').height, 48);
  assert.equal(box(html, 'b').height, 48);
  assert.match(node(html, 'b'), /class="node-card-tile"/);
});

test('the info marker is a 16px outlined i with a localized Details tooltip', t => {
  const html = render(t, [{ id: 'o', type: 'backend', label: 'Orders', pos: [40, 40], explanation: 'Owns orders.' }]);
  assert.match(node(html, 'o'), /data-node-info=""[^>]*><title>Details<\/title><circle r="7.5"\/>/);
  const zh = render(t, [{ id: 'o', type: 'backend', label: '订单', pos: [40, 40], explanation: '负责订单。' }],
    { meta: { title: 'Cards', output: 'out.html', locale: 'zh-CN', cardSizing: 'uniform' } });
  assert.match(node(zh, 'o'), /<title>详情<\/title>/);
  assert.match(html, /\.node-card-info:hover/);
});

test('layered cards ship light and dark card paint', t => {
  const html = render(t, [
    { id: 'big', type: 'backend', label: 'Big', pos: [40, 40] },
    { id: 'tiny', type: 'backend', label: 'Tiny', size: [60, 30], pos: [240, 40] },
  ]);
  assert.match(node(html, 'big'), /data-node-card="layered"/);
  assert.match(node(html, 'tiny'), /data-node-card="layered"/);
  assert.match(html, /\[data-theme="dark"\] svg\[data-node-ui\][^{]*\[data-node-card\] > rect\.node-card\.node-card \{ fill:/);
  assert.match(html, /svg\[data-node-ui\] \[data-node-card\] > rect\.node-card \{ fill: var\(--mask\)/);
});

test('authored card sizing (the default) keeps authored geometry but still draws a tile', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-card-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Cards', output: 'out.html' },
    components: [{ id: 'a', type: 'backend', label: 'API', pos: [40, 40], size: [130, 60] }], connections: [] }));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const card = node(html, 'a');
  assert.match(card, /width="130"/);
  assert.match(card, /node-card-tile/);
});

function uniformGeometry(t, example) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-uniform-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const diagram = JSON.parse(fs.readFileSync(path.join(root, 'archify/examples', example), 'utf8'));
  diagram.meta.cardSizing = 'uniform';
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const num = (v) => Number(v);
  const cards = new Map();
  for (const m of html.matchAll(/data-node-id="([^"]+)"[\s\S]*?<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" rx="([-\d.]+)" class="c-mask"/g)) {
    if (!cards.has(m[1])) cards.set(m[1], { x: num(m[2]), y: num(m[3]), w: num(m[4]), h: num(m[5]), rx: num(m[6]) });
  }
  const frames = [...html.matchAll(/data-graph-role="structural-frame"[^>]*data-composition-frame-label="([^"]*)" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
    .map((m) => ({ label: m[1], x: num(m[2]), y: num(m[3]), w: num(m[4]), h: num(m[5]) }));
  const edges = [...html.matchAll(/<path data-edge-from="([^"]+)" data-edge-to="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
    .map((m) => ({ from: m[1], to: m[2], points: m[3].split(';').map((p) => p.split(',').map(Number)) }));
  return { diagram, cards, frames, edges };
}

// The segment touching a card must meet its side head-on: vertical into the
// top/bottom edge, horizontal into the left/right edge.
function meetsSideSquarely([px, py], [qx, qy], c) {
  const e = 0.5;
  if (Math.abs(py - c.y) <= e || Math.abs(py - (c.y + c.h)) <= e) return Math.abs(px - qx) <= e;
  return Math.abs(py - qy) <= e;
}

function onCardSide([px, py], c) {
  const e = 0.5;
  const inX = px >= c.x + c.rx - e && px <= c.x + c.w - c.rx + e;
  const inY = py >= c.y + c.rx - e && py <= c.y + c.h - c.rx + e;
  return ((Math.abs(py - c.y) <= e || Math.abs(py - (c.y + c.h)) <= e) && inX)
    || ((Math.abs(px - c.x) <= e || Math.abs(px - (c.x + c.w)) <= e) && inY);
}

for (const example of ['production-deployment.architecture.json', 'web-app.architecture.json']) {
  test(`uniform ${example}: edges land on straight card sides, never run along a frame, and frames keep 16px padding`, t => {
    const { diagram, cards, frames, edges } = uniformGeometry(t, example);
    assert.ok(edges.length > 0 && frames.length > 0);
    for (const edge of edges) {
      const [first, last] = [edge.points[0], edge.points.at(-1)];
      assert.ok(onCardSide(first, cards.get(edge.from)), `${edge.from}->${edge.to} leaves ${edge.from} at ${first} off its straight sides`);
      assert.ok(onCardSide(last, cards.get(edge.to)), `${edge.from}->${edge.to} enters ${edge.to} at ${last} off its straight sides`);
      assert.ok(meetsSideSquarely(first, edge.points[1], cards.get(edge.from)), `${edge.from}->${edge.to} leaves ${edge.from} along its side`);
      assert.ok(meetsSideSquarely(last, edge.points.at(-2), cards.get(edge.to)), `${edge.from}->${edge.to} enters ${edge.to} along its side`);
      for (let i = 1; i < edge.points.length; i += 1) {
        const [[ax, ay], [bx, by]] = [edge.points[i - 1], edge.points[i]];
        for (const f of frames) {
          const xs = [f.x, f.x + f.w];
          const ys = [f.y, f.y + f.h];
          let overlap = 0;
          if (Math.abs(ax - bx) < 0.5 && xs.some((x) => Math.abs(x - ax) < 2)) {
            overlap = Math.min(Math.max(ay, by), f.y + f.h) - Math.max(Math.min(ay, by), f.y);
          } else if (Math.abs(ay - by) < 0.5 && ys.some((y) => Math.abs(y - ay) < 2)) {
            overlap = Math.min(Math.max(ax, bx), f.x + f.w) - Math.max(Math.min(ax, bx), f.x);
          }
          assert.ok(overlap <= 0, `${edge.from}->${edge.to} runs ${overlap}px along frame "${f.label}"`);
        }
      }
    }
    for (const b of diagram.boundaries ?? []) {
      const f = frames.find((frame) => frame.label === b.label);
      assert.ok(f, b.label);
      for (const id of b.wraps) {
        const c = cards.get(id);
        const pad = Math.min(c.x - f.x, f.x + f.w - (c.x + c.w), c.y - f.y, f.y + f.h - (c.y + c.h));
        assert.ok(pad >= 16, `${id} sits ${pad}px from frame "${b.label}"`);
      }
      for (const [id, c] of cards) {
        if (b.wraps.includes(id)) continue;
        const gap = Math.max(f.x - (c.x + c.w), c.x - (f.x + f.w), f.y - (c.y + c.h), c.y - (f.y + f.h));
        const inside = c.x > f.x && c.x + c.w < f.x + f.w && c.y > f.y && c.y + c.h < f.y + f.h;
        assert.ok(inside || gap >= 16, `${id} sits ${gap}px from frame "${b.label}" it does not belong to`);
      }
    }
  });
}
