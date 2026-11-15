import { test } from 'node:test';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
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
  const directory = createScratchDirectory(path.join(os.tmpdir(), 'archify-waterfall-'));
  const input = path.join(directory, 'candidate.waterfall.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  return { ...spawnSync(process.execPath, [renderer, input, output, ...extra], { cwd: directory, encoding: 'utf8', timeout: 10000 }), input, output };
}
function layoutOf(diagram) {
  const result = run(diagram, ['--layout-json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('waterfall: nonzero origins preserve distinct ticks and accessible timing', () => {
  const diagram = clone(small);
  diagram.spans = [{ id: 'request', name: 'Request', start: 0.0091, duration: 0.000004 }];
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const labels = [...html.matchAll(/class="t-muted wf-num"[^>]*text-anchor="middle">([^<]+)<\/text>/g)].map(match => match[1]);
  assert.ok(labels.length >= 2);
  assert.equal(new Set(labels).size, labels.length);
  const values = labels.map(label => Number(label.replace(/ ms$/, '').replaceAll(',', '')));
  assert.ok(values.every((value, index) => value >= 0.0091 && value <= 0.009104000000000001 && (!index || value > values[index - 1])));
  assert.match(html, /aria-label="[^"]*0\.0091–0\.009104 ms/);
});

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

test('waterfall: large timestamps terminate when tick increments are below floating-point resolution', () => {
  const diagram = clone(small);
  diagram.spans = [{ id: 'request', name: 'Request', start: 1e16, end: 1e16 + 2 }];
  const result = run(diagram, ['--layout-json']);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const report = JSON.parse(result.stdout);
  assert.equal(report.wall, 2);
  assert.equal(report.rows[0].label, '2 ms');
  assert.ok(Number.isFinite(report.rows[0].x0));
  assert.ok(Number.isFinite(report.rows[0].x1));
  assert.ok(report.rows[0].x1 > report.rows[0].x0);
});

test('waterfall: unrepresentable derived timing is rejected without writing invalid geometry', () => {
  for (const span of [
    { id: 'request', name: 'Request', start: 1e308, duration: 1e308 },
    { id: 'request', name: 'Request', start: 0, duration: Number.MIN_VALUE },
  ]) {
    const diagram = clone(small);
    diagram.spans = [span];
    const result = run(diagram);
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    assert.match(result.stderr, /finite/);
    assert.equal(fs.existsSync(result.output), false);
    const cli = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'validate', 'waterfall', result.input, '--json'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(cli.status, 1, cli.stderr || cli.stdout);
    const receipt = JSON.parse(cli.stdout);
    const diagnostic = receipt.diagnostics.find(({ code }) => code === 'waterfall/invalid-timing');
    assert.ok(diagnostic, cli.stdout);
    assert.ok(diagnostic.supportedFixes.length > 0, cli.stdout);
  }
});

test('waterfall: finite very large timing labels do not overflow while formatting', () => {
  for (const timing of [{ start: 1e307, end: 1.1e307 }, { start: 0, end: Number.MAX_VALUE }]) {
    const diagram = clone(small);
    diagram.spans = [{ id: 'request', name: 'Request', ...timing }];
    const result = run(diagram);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const html = fs.readFileSync(result.output, 'utf8');
    assert.doesNotMatch(html, /(?:NaN|Infinity|∞)/);
  }
});

test('waterfall: percentages name their denominator and are never summed into the parent', () => {
  const html = fs.readFileSync(run(small).output, 'utf8');
  assert.match(html, /data-node-id="payment"[^>]*aria-label="[^"]*400–1,050 ms · 650 ms · 54% of 1,200 ms wall-clock/);
  assert.match(html, /data-waterfall-total="1200"[^>]*>Wall-clock 1,200 ms/);
  assert.match(html, /data-waterfall-evidence="illustrative"/);
});

test('waterfall: small fractional values keep nonzero duration labels', () => {
  for (const duration of [0.004, 0.00004, 1e-8]) {
    const diagram = clone(small);
    diagram.spans = [{ id: 'request', name: 'Request', start: 0, duration }];
    const result = run(diagram);
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(result.output, 'utf8');
    const durationText = `${String(duration).replace('.', '\\.')} ms`;
    assert.match(html, new RegExp(durationText));
    assert.match(html, new RegExp(`data-node-id="request"[^>]*aria-label="[^"]*${durationText}[^"]*"`));
    const tickLabels = [...html.matchAll(/class="t-muted wf-num"[^>]*text-anchor="middle">([^<]+)<\/text>/g)].map((match) => match[1]);
    assert.ok(tickLabels.length > 1, 'axis must render tick labels');
    for (let i = 1; i < tickLabels.length; i += 1) {
      assert.notEqual(tickLabels[i], tickLabels[i - 1], 'adjacent ticks must have distinct labels');
    }
    assert.ok(new Set(tickLabels).size > 1, 'distinct positive ticks must not all round to zero');
    const report = layoutOf(diagram);
    assert.notEqual(report.rows[0].label, '0 ms');
  }
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

test('waterfall: services past the five colours share a legend entry instead of a duplicated colour', () => {
  const services = ['gateway', 'auth', 'cart', 'pricing', 'tax', 'inventory', 'postgres'];
  const diagram = clone(small);
  diagram.spans = [
    { id: 'root', name: 'POST /checkout', service: services[0], start: 0, duration: 700 },
    ...services.slice(1).map((service, index) => ({ id: `s${index}`, name: `${service} call`, service, parent: 'root', start: index * 100, duration: 80 })),
  ];
  const result = run(diagram);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(result.output, 'utf8');
  const labels = [...html.matchAll(/data-legend-semantic-kind="service:[^"]*"[\s\S]*?<text[^>]*>([^<]+)<\/text>/g)].map((match) => match[1]);
  assert.equal(labels.length, 5, labels.join(' | '));
  assert.ok(labels.includes('gateway · inventory'), labels.join(' | '));
  assert.ok(labels.includes('auth · postgres'), labels.join(' | '));
  assert.ok(labels.includes('cart'), labels.join(' | '));
});
