// Multi-line dataflow sublabels and the viewBox-derived row grid.
//
// A sublabel may carry "\n" to render one <text> line per segment, and the
// row grid grows with meta.viewBox[1] instead of stopping at the historical
// five rows. These regressions pin the public renderer behavior: tall
// canvases place rows past row 4, multi-line sublabels render every line,
// the validator rejects lines that cannot fit horizontally or vertically,
// and single-line sublabels keep their historical geometry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(__dirname, '..', 'renderers', 'dataflow', 'render-dataflow.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-multiline-'));

function renderDoc(doc) {
  const input = path.join(tmp, `in-${Math.random().toString(36).slice(2)}.json`);
  const out = path.join(tmp, 'out.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  if (fs.existsSync(out)) fs.rmSync(out);
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [renderer, input, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    code = err.status ?? 1;
    stderr = String(err.stderr || '');
  }
  const html = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  return { code, stderr, html };
}

function spec({ nodes, viewBox = [940, 720] }) {
  return {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Multiline fixture', viewBox, quality_profile: 'standard' },
    stages: [{ label: 'Producers' }, { label: 'Consumers' }],
    nodes,
    flows: [{ id: 'f1', from: 'src', to: nodes[1].id, label: 'feeds' }],
  };
}

const src = { id: 'src', type: 'backend', label: 'Source', stage: 0, row: 0 };

test('a taller canvas places rows beyond the historical fifth', () => {
  const far = { id: 'far', type: 'backend', label: 'Row seven', stage: 1, row: 7 };
  const { code, stderr, html } = renderDoc(spec({ nodes: [src, far], viewBox: [940, 1094] }));
  assert.equal(code, 0, stderr);
  // rowY(7) = 128 + 7 * 114 — a fixed five-row grid had no row 7 at all.
  assert.ok(html.includes('y="926"'), 'expected the row-7 node at y=926');
});

test('a five-row canvas keeps the historical grid unchanged', () => {
  const { code, stderr, html } = renderDoc(spec({ nodes: [src, { ...far5() }] }));
  assert.equal(code, 0, stderr);
  assert.ok(html.includes('y="584"'), 'expected the row-4 node at its historical y=584');
  // A 720px canvas must reject a sixth row rather than silently grow one
  // into the footer. yOffset keeps the node on-canvas, so only the row
  // grid itself can reject it — an output-based check would not notice a
  // grid that wrongly gained a row, since unused rows emit no SVG.
  const sixth = { id: 'sixth', type: 'backend', label: 'Row five', stage: 1, row: 5, yOffset: -114 };
  const over = renderDoc(spec({ nodes: [src, sixth] }));
  assert.equal(over.code, 1, 'a 720px canvas must reject row 5');
  assert.match(over.stderr, /valid rows are 0\.\.4/);
});
const far5 = () => ({ id: 'far5', type: 'backend', label: 'Row four', stage: 1, row: 4 });

test('a multi-line sublabel renders one text element per line', () => {
  const multi = {
    id: 'multi', type: 'backend', label: 'Consumer',
    sublabel: 'upserts the identity row\nfrom key and payload\nthe tombstone deletes it',
    width: 150, height: 84, stage: 1, row: 0,
  };
  const { code, stderr, html } = renderDoc(spec({ nodes: [src, multi] }));
  assert.equal(code, 0, stderr);
  // Lines ride a 12px pitch from y+37: row 0 starts at 128 → 165, 177, 189.
  for (const y of [165, 177, 189]) {
    assert.ok(html.includes(`y="${y}"`), `expected a sublabel line at y=${y}`);
  }
  assert.equal(html.split('>the tombstone deletes it</text>').length - 1, 1);
});

test('a single-line sublabel keeps its historical geometry', () => {
  const one = { id: 'one', type: 'backend', label: 'Consumer', sublabel: 'plain line', width: 150, stage: 1, row: 0 };
  const { code, stderr, html } = renderDoc(spec({ nodes: [src, one] }));
  assert.equal(code, 0, stderr);
  assert.ok(html.includes('y="165"'), 'the single line stays at y+37');
  assert.ok(!html.includes('y="177"'), 'no second line appears');
});

test('an overlong sublabel line is rejected with a repairable message', () => {
  const wide = {
    id: 'wide', type: 'backend', label: 'Consumer',
    sublabel: 'short line\nthis sublabel line is far too wide for the node at any legible font size',
    width: 150, height: 84, stage: 1, row: 0,
  };
  const { code, stderr } = renderDoc(spec({ nodes: [src, wide] }));
  assert.equal(code, 1);
  assert.match(stderr, /Sublabel line .*needs ~\d+px at the \d+px legible minimum/);
});

test('a multi-line sublabel in a too-short node is rejected', () => {
  const squat = {
    id: 'squat', type: 'backend', label: 'Consumer',
    sublabel: 'first line\nsecond line\nthird line',
    width: 150, height: 58, stage: 1, row: 0,
  };
  const { code, stderr } = renderDoc(spec({ nodes: [src, squat] }));
  assert.equal(code, 1);
  assert.match(stderr, /needs height ≥ \d+ for its 3 lines/);
});
