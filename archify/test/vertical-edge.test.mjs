import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const bin = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-vertical-edge-'));

const REPRO = {
  schema_version: 1,
  diagram_type: 'dataflow',
  meta: { title: 'Vertical edge arrowhead repro', quality_profile: 'showcase' },
  stages: [{ label: 'Parse' }, { label: 'Store' }],
  nodes: [
    { id: 'extract', type: 'backend', label: 'Extract', stage: 0, row: 0 },
    { id: 'parse', type: 'backend', label: 'Parse', stage: 0, row: 3 },
    { id: 'store', type: 'database', label: 'Store', stage: 1, row: 1 },
  ],
  flows: [
    { id: 'vertical-edge', from: 'extract', to: 'parse', label: 'chunks', variant: 'emphasis', labelDy: 40 },
    { id: 'horizontal-edge', from: 'parse', to: 'store', label: 'rows', variant: 'emphasis' },
  ],
};

function render(d) {
  const inPath = path.join(tmp, 'in.dataflow.json');
  const outPath = path.join(tmp, 'out.html');
  fs.writeFileSync(inPath, JSON.stringify(d));
  execFileSync('node', [bin, 'render', 'dataflow', inPath, outPath, '--quality', 'showcase'], { encoding: 'utf8' });
  return fs.readFileSync(outPath, 'utf8');
}

function edgePath(html, edgeId) {
  const re = new RegExp(`data-edge-id="${edgeId}"[^>]*\\sd="([^"]*)"`);
  const m = html.match(re);
  return m ? m[1] : null;
}

function segments(d) {
  const pts = [...d.matchAll(/[ML] ([-\d.]+ [-\d.]+)/g)].map((m) => m[1]);
  const segs = [];
  for (let i = 1; i < pts.length; i += 1) segs.push(pts[i - 1] !== pts[i]);
  return segs;
}

test('vertical auto-routed dataflow edge has no zero-length final segment (#169)', () => {
  const html = render(REPRO);
  const d = edgePath(html, 'vertical-edge');
  assert.ok(d, 'vertical-edge path should exist');
  const segs = segments(d);
  // The final segment must have real length so marker-end orients correctly.
  assert.ok(segs.at(-1) === true, `last segment must be non-zero length, got d="${d}"`);
  // No segment may be zero-length (degenerate path confuses marker orientation).
  assert.ok(segs.every(Boolean), `no segment may be zero-length, got d="${d}"`);
});

test('horizontal edge still renders with a real final segment (#169)', () => {
  const html = render(REPRO);
  const d = edgePath(html, 'horizontal-edge');
  assert.ok(d, 'horizontal-edge path should exist');
  const segs = segments(d);
  assert.ok(segs.at(-1) === true, `last segment must be non-zero length, got d="${d}"`);
});
