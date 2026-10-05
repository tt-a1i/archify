import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../archify/bin/preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../archify');
const cli = path.join(root, 'bin/archify.mjs');
const example = path.join(root, 'examples/storage.interval.json');

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-interval-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function input(t, doc) {
  const file = path.join(scratch(t), 'input.interval.json');
  fs.writeFileSync(file, JSON.stringify(doc));
  return file;
}

function base() {
  return JSON.parse(fs.readFileSync(example, 'utf8'));
}

function receipt(result) {
  assert.ok(result.stdout, result.stderr);
  return JSON.parse(result.stdout);
}

test('public interval example renders, validates, and delivers through the Archify CLI', t => {
  const dir = scratch(t);
  const rendered = path.join(dir, 'rendered.html');
  const delivered = path.join(dir, 'delivered.html');

  const render = run('render', 'interval', example, rendered);
  assert.equal(render.status, 0, render.stderr || render.stdout);
  const html = fs.readFileSync(rendered, 'utf8');
  assert.match(html, /<svg\b/);
  for (const label of ['Capture', 'Storage', 'Collecting', 'Stored', 'Commit']) {
    assert.ok(html.includes(label), `missing ${label}`);
  }
  const embedded = html.match(/<script id="archify-interval-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(embedded, 'editor source JSON is available in the artifact');
  assert.deepEqual(JSON.parse(embedded[1]).spec, base(), 'editor retains Archify metadata and interval coordinates');

  const validate = run('validate', 'interval', example, '--json');
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  assert.equal(receipt(validate).ok, true);

  const deliver = run('deliver', 'interval', example, delivered, '--json');
  assert.equal(deliver.status, 0, deliver.stderr || deliver.stdout);
  const result = receipt(deliver);
  assert.equal(result.ok, true);
  assert.equal(result.artifact.sha256, createHash('sha256').update(fs.readFileSync(delivered)).digest('hex'));
});

test('directed mixed-unit arrows and named anchors remain visible in rendered geometry', t => {
  const doc = base();
  doc.tracks[1].arrows = [{ from: '90%', to: '20u', label: 'Reverse' }];
  doc.tracks[0].spans = [{ from: 0, to: 'commit', label: 'To commit' }];
  const output = path.join(scratch(t), 'directed.html');
  const result = run('render', 'interval', input(t, doc), output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /To commit/);
  assert.match(html, /Reverse/);
  assert.match(html, /data-kind="anchor"/);
  const arrow = html.match(/<g\b[^>]*data-kind="arrow"[^>]*>[\s\S]*?<path\b[^>]*\bd="([^"]+)"/);
  assert.ok(arrow, 'arrow path is present');
  const horizontal = arrow[1].match(/M\s*([\d.-]+)\s+[\d.-]+[^<]*H\s*([\d.-]+)/);
  assert.ok(horizontal, `expected a directed orthogonal arrow, got ${arrow[1]}`);
  assert.ok(Number(horizontal[1]) > Number(horizontal[2]), 'reversed arrow points toward a lower x');
});

test('explicit unit width keeps overflow renderable and warns about the exceeded range', t => {
  const doc = base();
  doc.tracks[0].spans = [{ from: 0, to: 150, label: 'Beyond declared range' }];
  const output = path.join(scratch(t), 'overflow.html');
  const source = input(t, doc);
  const result = run('render', 'interval', source, output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /Beyond declared range/);
  assert.match(result.stderr, /outside.*(?:global range|lifetime)/i);
  const validate = run('validate', 'interval', source, '--json');
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  const resultReceipt = receipt(validate);
  assert.ok(resultReceipt.diagnostics?.some(item => item.code === 'interval/layout-warning' && item.severity === 'warning'));
  const deliver = run('deliver', 'interval', source, output, '--json');
  assert.equal(deliver.status, 0, deliver.stderr || deliver.stdout);
  const delivered = receipt(deliver);
  assert.ok(delivered.validation.warnings > 0);
  assert.ok(delivered.diagnostics?.some(item => item.code === 'interval/layout-warning'
    && /outside.*(?:global range|lifetime)/i.test(item.message)));
});

test('bad references and schema violations return structured CLI diagnostics', t => {
  for (const [index, change] of [
    doc => { doc.tracks[0].points = [{ at: 'missing-anchor' }]; },
    doc => { doc.tracks[1].arrows = [{ from: 10, to: { at: 20, track: 'missing-track' } }]; },
    doc => { doc.unitWidth = -1; },
  ].entries()) {
    const doc = base();
    change(doc);
    const result = run('validate', 'interval', input(t, doc), '--json');
    assert.notEqual(result.status, 0, 'invalid input must fail');
    const failure = receipt(result);
    assert.equal(failure.ok, false);
    assert.equal(failure.command, 'validate');
    assert.ok(failure.diagnostics?.length, 'a structured diagnostic is required');
    assert.ok(failure.diagnostics.every(item => typeof item.code === 'string' && typeof item.message === 'string'));
    if (index < 2) assert.ok(failure.diagnostics?.some(item => item.evidence && item.supportedFixes?.length),
      'invalid references provide evidence and an actionable fix');
  }
});

test('unsafe label text stays inert in the standalone artifact', t => {
  const doc = base();
  doc.tracks[0].spans[0].label = '</script><script>alert(1)</script>';
  const output = path.join(scratch(t), 'safe.html');
  const result = run('render', 'interval', input(t, doc), output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);
});

test('failed delivery preserves an existing output byte for byte', t => {
  const output = path.join(scratch(t), 'existing.html');
  const original = Buffer.from('existing artifact\n');
  fs.writeFileSync(output, original);
  const doc = base();
  doc.tracks[0].points = [{ at: 'missing-anchor' }];
  const result = run('deliver', 'interval', input(t, doc), output, '--json');
  assert.notEqual(result.status, 0);
  assert.equal(receipt(result).ok, false);
  assert.deepEqual(fs.readFileSync(output), original);
});

test('interval CLI rejects the unsupported showcase quality profile', () => {
  const result = run('validate', 'interval', example, '--quality', 'showcase', '--json');
  assert.notEqual(result.status, 0);
  const failure = receipt(result);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'validate');
  assert.match(failure.error, /interval.*standard quality profile/i);
  assert.ok(failure.diagnostics?.some(item => item.code === 'interval/unsupported-quality-profile'));
});

test('interval participates in live preview and preserves the last verified revision on invalid edits', { timeout: 30000 }, async t => {
  const dir = scratch(t);
  const source = path.join(dir, 'storage.interval.json');
  const output = path.join(dir, 'storage.html');
  fs.copyFileSync(example, source);
  const preview = await startPreview({ type: 'interval', input: source, output, open: false, debounceMs: 10, pollMs: 40 });
  t.after(() => preview.stop());

  async function waitFor(predicate) {
    let state;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      state = await (await fetch(new URL('/state', preview.url))).json();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.fail(`preview did not settle: ${JSON.stringify(state)}`);
  }

  const verified = await waitFor(state => state.status === 'verified');
  assert.equal(verified.revision, 1);
  const first = await (await fetch(new URL('/artifact.html', preview.url))).text();
  assert.match(first, /Capture/);

  const invalid = base();
  invalid.tracks[0].points = [{ at: 'missing-anchor' }];
  fs.writeFileSync(source, JSON.stringify(invalid));
  const failed = await waitFor(state => state.status === 'needs-fix');
  assert.equal(failed.revision, 1);
  assert.match(failed.failure.message, /missing-anchor/);
  assert.equal(await (await fetch(new URL('/artifact.html', preview.url))).text(), first);
});

test('horizontal scaling preserves fonts and Y geometry while narrow labels use a leader', t => {
  const doc = { schema_version: 1, diagram_type: 'interval', meta: { title: 'Dense timing', output: 'diagram.html' },
    unitWidth: 100, tracks: [{ id: 'work', spans: [{ from: 10, to: 20, label: 'Pending' }] }] };
  const source = input(t, doc);
  const before = path.join(scratch(t), 'before.html');
  assert.equal(run('render', 'interval', source, before).status, 0);
  const unscaled = fs.readFileSync(before, 'utf8');
  assert.match(unscaled, /data-kind="label-leader"/);
  assert.match(unscaled, /data-layout-offset="\[[^\]]+\]"[^>]*>Pending<\/text>/);
  doc.horizontalScale = 2;
  const after = path.join(scratch(t), 'after.html');
  const scaledSource = input(t, doc);
  assert.equal(run('render', 'interval', scaledSource, after).status, 0);
  const a = fs.readFileSync(before, 'utf8'), b = fs.readFileSync(after, 'utf8');
  const span = html => html.match(/data-kind="span"[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/).slice(1).map(Number);
  const old = span(a), next = span(b);
  assert.equal(next[0] - 160, 2 * (old[0] - 160));
  assert.equal(next[2], 2 * old[2]);
  assert.equal(next[1], old[1]);
  assert.equal(next[3], old[3]);
  assert.match(b, /data-x-scale="14.4"/);
  assert.match(b, /font-size="20"[^>]*>Pending<\/text>/);
  assert.ok(!receipt(run('validate', 'interval', scaledSource, '--json')).diagnostics?.some(d => /no clear bounded placement/.test(d.message)));
  doc.horizontalScale = 0;
  assert.notEqual(run('validate', 'interval', input(t, doc), '--json').status, 0);
  doc.horizontalScale = 1;
  doc.tracks[0].spans[0].to = 10;
  assert.equal(run('render', 'interval', input(t, doc), after).status, 0);
  assert.match(fs.readFileSync(after, 'utf8'), /data-kind="label-leader"/);
});

test('outside label leader stays visible when span border is absent', t => {
  const doc = { schema_version: 1, diagram_type: 'interval', meta: { title: 'Thin span', output: 'diagram.html' },
    showAxis: false, tracks: [{ id: 'work', spans: [{ from: 10, to: 10,
      label: 'Target', style: { stroke: 'none' } }] }] };
  const output = path.join(scratch(t), 'leader.html');
  const result = run('render', 'interval', input(t, doc), output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  const leader = html.match(/data-kind="label-leader"[^>]*><path\b[^>]*>/);
  assert.ok(leader, 'narrow label has a leader');
  assert.doesNotMatch(leader[0], /stroke="none"/);
});

test('labels nudge inside a span around a guide before leaving their owner', t => {
  const doc = { schema_version: 1, diagram_type: 'interval', meta: { title: 'Guide clearance', output: 'diagram.html' },
    showAxis: false, anchors: { gate: { at: 30, across: ['first', 'second'] } },
    tracks: [
      { id: 'first', spans: [{ from: 20, to: 40, label: 'B2' }] },
      { id: 'second', gapBefore: 80 },
    ] };
  const output = path.join(scratch(t), 'nudge.html');
  const source = input(t, doc);
  assert.equal(run('render', 'interval', source, output).status, 0);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-layout-offset="\[(?:24|-24),0\]"[^>]*>B2<\/text>/);
  assert.doesNotMatch(html, /data-kind="label-leader"/);
  assert.ok(!receipt(run('validate', 'interval', source, '--json')).diagnostics?.some(d => /B2.*no clear bounded/.test(d.message)));
});

test('start-labelled arrow moves its tail and label together across tracks', t => {
  const doc = { schema_version: 1, diagram_type: 'interval', meta: { title: 'Probe annotation', output: 'diagram.html' },
    showAxis: false, tracks: [
      { id: 'probe', height: 32, arrows: [{ from: { at: 20, edge: 'bottom' },
        to: { at: 60, track: 'target', edge: 'top' }, label: 'Page 0 probe',
        labelPlacement: 'start', startXOffset: 12, startYOffset: 8,
        labelOffset: [5, -3], style: { text: '#123456', fontWeight: 'bold' } }] },
      { id: 'target', gapBefore: 80, height: 32, spans: [{ from: 55, to: 65, style: 'emphasis' }] },
    ] };
  const output = path.join(scratch(t), 'arrow.html');
  const result = run('render', 'interval', input(t, doc), output);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-kind="arrow"[^>]*><path d="M316 130V/);
  assert.match(html, /<text x="321" y="115"[^>]*font-weight="bold" fill="#123456"[^>]*>Page 0 probe<\/text>/);
  assert.match(html, /H592V/); // target remains at x=160+0.6*720
});

test('illustrative intervals can hide the numeric axis without moving geometry', t => {
  const doc = base();
  doc.showAxis = false;
  const out = path.join(scratch(t), 'hidden-axis.html');
  assert.equal(run('render', 'interval', input(t, doc), out).status, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(!html.includes('data-kind="axis"'));
  assert.match(html, /data-x-scale="7.2"/);
});

test('interval labels clear crossing strokes without repainting translucent fills', t => {
  const doc = base();
  doc.anchors.guide = {at:31, across:['capture','storage']};
  const out = path.join(scratch(t), 'masked.html');
  assert.equal(run('render', 'interval', input(t, doc), out).status, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<mask id="interval-stroke-/);
  const label = html.match(/<g data-kind="span-label"[^>]*>([\s\S]*?)<\/g>/)[1];
  assert.ok(!label.includes('<rect'), 'label must not stack a second fill on the span');
  assert.match(html, /fill="none"[^>]+mask="url\(#interval-stroke-/);
});
