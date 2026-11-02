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
  fs.writeFileSync(input, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Cards', output: 'out.html' }, components, connections: [], ...extra }));
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

test('unsized cards auto-size to their text; authored sizes are minimums', t => {
  const width = (html, id) => Number(node(html, id).match(/<rect x="[\d.-]+" y="[\d.-]+" width="([\d.]+)"[^>]*class="c-mask"/)[1]);
  const html = render(t, [
    { id: 'short', type: 'backend', label: 'API', pos: [40, 40] },
    { id: 'long', type: 'backend', label: 'Payment Reconciliation', sublabel: 'nightly ledger sync', pos: [40, 140] },
    { id: 'sized', type: 'backend', label: 'Gateway', sublabel: 'routes partner traffic', size: [140, 60], pos: [400, 40] },
    { id: 'compact', type: 'backend', label: 'Notify', sublabel: 'email', size: [64, 40], pos: [400, 140] },
  ]);
  assert.equal(width(html, 'short'), 120);
  assert.ok(width(html, 'long') > 120 && width(html, 'long') <= 240);
  // A layered card widens (to the 8px grid) only when its tile and one-line
  // context line do not fit; it grows symmetrically about its authored centre.
  const sized = width(html, 'sized');
  assert.ok(sized > 140 && sized <= 240 && sized % 8 === 0, `sized width ${sized}`);
  assert.doesNotMatch(node(html, 'sized'), /data-node-info/, 'context line fits after growing');
  // Compact cards keep the authored size exactly.
  assert.equal(width(html, 'compact'), 64);
  assert.match(node(html, 'compact'), /data-node-card="compact"/);
});

test('layered and compact cards ship light and dark card paint', t => {
  const html = render(t, [
    { id: 'big', type: 'backend', label: 'Big', pos: [40, 40] },
    { id: 'tiny', type: 'backend', label: 'Tiny', size: [60, 30], pos: [240, 40] },
  ]);
  assert.match(node(html, 'big'), /data-node-card="layered"/);
  assert.match(node(html, 'tiny'), /data-node-card="compact"/);
  assert.match(html, /\[data-theme="dark"\] svg\[data-node-ui\][^{]*\[data-node-card\] > rect\.node-card\.node-card \{ fill:/);
  assert.match(html, /svg\[data-node-ui\] \[data-node-card\] > rect\.node-card \{ fill: var\(--mask\)/);
});
