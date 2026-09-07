// The semantic sigil sits inset in a node's top corner and the node label is
// drawn text-anchor="middle" in the same vertical band, so a label wide enough
// to reach the corner paints over the icon while validation still reports a
// clean receipt (#199).
//
// This locks the geometric invariant on the FINAL SVG for every renderer that
// puts its label at a fixed offset from the node top. Architecture is excluded
// on purpose: it centres the label vertically (c.y + height/2), so its label
// only shares the sigil band on very short components and a blanket reserve
// there would shrink labels that never collide.
//
//   node --test test/semantic-sigil-clearance.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textUnits } from '../renderers/shared/utils.mjs';
import { nodeTextFit } from '../renderers/shared/text-fit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sigil-'));

// [mode, example, collection, a label long enough to reach the sigil corner]
// Widths differ per renderer, so each label is chosen to actually collide on
// that renderer — otherwise the assertion would pass vacuously. Lifecycle puts
// its sigil in the top-RIGHT corner when a state carries no brand mark, so it
// covers the mirrored case.
//
// Workflow is absent on purpose: the fixed-v1 contract freezes that compiler's
// SVG byte-for-byte, so its label is not re-centred and the rule is enforced by
// validateWorkflow instead (see test/layout-rules.test.mjs).
const CASES = [
  ['dataflow', 'product-analytics.dataflow.json', 'nodes', 'Prompt Compiler'],
  ['lifecycle', 'agent-run.lifecycle.json', 'states', 'Prompt Compiler'],
  ['sequence', 'cache-miss-request.sequence.json', 'participants', 'PromptScript'],
];

function render(mode, doc) {
  const stem = path.join(tmp, `${mode}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const input = `${stem}.json`;
  const outPath = `${stem}.html`;
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync('node', [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    input,
    outPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outPath, 'utf8');
}

// The <g> block for the node carrying `label`, so the sigil and the label are
// read from the same node. The sigil is itself a nested <g>, so the block is
// bounded by the next node group rather than by the first closing tag.
function nodeGroup(html, label) {
  const start = html.indexOf(`data-node-label="${label}"`);
  assert.notEqual(start, -1, `expected a node group for "${label}"`);
  const open = html.lastIndexOf('<g id="node-', start);
  assert.notEqual(open, -1, 'expected a node group opening tag');
  const nextOpen = html.indexOf('<g id="node-', start + 1);
  return html.slice(open, nextOpen === -1 ? html.length : nextOpen);
}

for (const [mode, example, collection, label] of CASES) {
  test(`${mode}: a node label never paints over its semantic sigil`, () => {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    doc[collection][0].label = label;
    delete doc[collection][0].brand; // isolate the sigil constraint from the brand top rail

    const group = nodeGroup(render(mode, doc), label);

    const sigil = group.match(/data-semantic-sigil="[^"]*"[^>]*transform="translate\(([-\d.]+) [-\d.]+\) scale\(([-\d.]+)\)"/);
    assert.ok(sigil, `${mode}: expected a semantic sigil in the node group`);
    const sigilX = Number(sigil[1]);
    const sigilRight = sigilX + 16 * Number(sigil[2]);

    const text = group.match(/<text data-node-label=""[^>]*?x="([-\d.]+)"[^>]*?font-size="([\d.]+)"/);
    assert.ok(text, `${mode}: expected a node label <text> in the node group`);
    const cx = Number(text[1]);
    const fontSize = Number(text[2]);
    const width = textUnits(label) * fontSize * nodeTextFit.widthFactor;
    const labelLeft = cx - width / 2;
    const labelRight = cx + width / 2;

    // The sigil is inset from one corner; whichever side it is on, the label
    // must stay clear of it.
    const clears = sigilX < cx ? labelLeft >= sigilRight : labelRight <= sigilX;
    assert.ok(
      clears,
      `${mode}: label "${label}" spans ${labelLeft.toFixed(1)}..${labelRight.toFixed(1)} `
      + `but the sigil occupies ${sigilX.toFixed(1)}..${sigilRight.toFixed(1)} `
      + `(font ${fontSize}px) — they overlap`,
    );
  });
}
