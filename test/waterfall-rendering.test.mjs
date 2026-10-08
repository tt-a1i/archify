import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const renderer = path.join(skillRoot, 'renderers', 'waterfall', 'render-waterfall.mjs');
const checker = path.join(skillRoot, 'scripts', 'check-render-output.mjs');
const small = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'checkout-request.waterfall.json'), 'utf8'));
const large = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'example-rebuild.waterfall.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function run(diagram, extra = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-waterfall-'));
  const input = path.join(directory, 'candidate.waterfall.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  return { ...spawnSync(process.execPath, [renderer, input, output, ...extra], { cwd: directory, encoding: 'utf8' }), output };
}
function layoutOf(diagram) {
  const result = run(diagram, ['--layout-json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('waterfall: both examples render and pass the showcase artifact checks', () => {
  for (const diagram of [small, large]) {
    const result = run(diagram);
    assert.equal(result.status, 0, result.stderr);
    const root = fs.readFileSync(result.output, 'utf8').match(/<svg\b[^>]*>/)?.[0];
    assert.match(root, /data-reader-fit="width-first"/);
    assert.match(root, /data-reader-min-text="7\.5"/);
    const receipt = JSON.parse(spawnSync(process.execPath, [checker, result.output], { encoding: 'utf8' }).stdout);
    assert.equal(receipt.ok, true, JSON.stringify(receipt.checks.filter((entry) => !entry.ok)));
    assert.equal(receipt.composition.summary.errors, 0);
  }
});

test('waterfall: bar geometry is exactly the recorded timing on one axis', () => {
  const report = layoutOf(small);
  assert.equal(report.wall, 1200);
  const x = (t) => report.axis.x0 + t * report.pxPerUnit;
  for (const row of report.rows) {
    const span = small.spans.find((candidate) => candidate.id === row.id);
    const end = span.end ?? span.start + span.duration;
    assert.ok(Math.abs(row.x0 - x(span.start)) < 0.01, `${row.id} start`);
    assert.ok(Math.abs(row.x1 - x(end)) < 0.01, `${row.id} end`);
  }
  // Concurrent siblings overlap; the request bar spans the whole wall clock.
  const rows = Object.fromEntries(report.rows.map((row) => [row.id, row]));
  assert.ok(rows.discount.x0 === rows.inventory.x0 && rows.discount.x1 < rows.inventory.x1);
  assert.equal(rows.request.x1 - rows.request.x0, report.axis.x1 - report.axis.x0);
  // Children follow their parent, depth-first by start time.
  assert.deepEqual(report.rows.map((row) => row.id), ['request', 'auth', 'inventory', 'discount', 'payment', 'save']);
});

test('waterfall: percentages name their denominator and are never summed into the parent', () => {
  const html = fs.readFileSync(run(small).output, 'utf8');
  assert.match(html, /data-node-id="payment"[^>]*aria-label="[^"]*400–1,050 ms · 650 ms · 54% of 1,200 ms wall-clock/);
  assert.match(html, /data-waterfall-total="1200"[^>]*>Wall-clock 1,200 ms/);
  assert.match(html, /data-waterfall-evidence="illustrative"/);
});

test('waterfall: a short operation keeps its duration label beside the bar', () => {
  const diagram = clone(small);
  diagram.spans.push({ id: 'cache', name: 'Read cache', start: 400, duration: 4, parent: 'payment' });
  const row = layoutOf(diagram).rows.find((entry) => entry.id === 'cache');
  assert.equal(row.label, '4 ms');
  assert.notEqual(row.placement, 'inside');
});

test('waterfall: an incomplete span is an open lower bound, not a measured duration', () => {
  const diagram = clone(small);
  diagram.spans.push({ id: 'webhook', name: 'Await webhook', start: 1100, parent: 'request', status: 'incomplete' });
  const report = layoutOf(diagram);
  const row = report.rows.find((entry) => entry.id === 'webhook');
  assert.equal(row.open, true);
  assert.equal(row.end, report.wall);
  assert.equal(row.label, 'incomplete, ≥ 100 ms');
});

function failure(mutate) {
  const diagram = clone(small);
  mutate(diagram);
  const result = run(diagram);
  assert.notEqual(result.status, 0, 'renderer accepted invalid timing');
  return result.stderr;
}

test('waterfall: invalid timing and parent cycles are refused', () => {
  assert.match(failure((d) => { d.spans[1].end = -5; delete d.spans[1].duration; }), /\/spans\/1\/end/);
  assert.match(failure((d) => { d.spans[0].end = 900; d.spans[0].start = 1000; }), /waterfall\/invalid-timing/);
  assert.match(failure((d) => { d.spans[1].end = 500; }), /disagree/);
  assert.match(failure((d) => { delete d.spans[1].duration; }), /must be marked status "incomplete"/);
  assert.match(failure((d) => { d.spans[1].parent = 'missing'; }), /waterfall\/missing-parent/);
  assert.match(failure((d) => { d.spans[0].parent = 'auth'; }), /waterfall\/cycle/);
});
