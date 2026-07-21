import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-intent-trace-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers inherit one geometry-neutral Intent Trace', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /Archify\.intentTrace = \(function \(\)/, mode);
    assert.match(html, /id="intent-trace-status" role="status" aria-live="polite" aria-atomic="true"/, mode);
    assert.match(html, /svg\.setAttribute\('data-intent-trace-active', id\)/, mode);
    assert.match(html, /data-intent-trace-overlay/, mode);
    assert.equal((html.match(/<svg\b/g) || []).length, 1, `${mode} keeps one static canonical SVG`);
    assert.doesNotMatch(canonicalSvg(html), /data-intent-trace|intent-trace-flow/, mode);
  }
});

test('Intent Trace derives exact one-hop direction from stable renderer relationships', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /function show\(id, options\)/);
  assert.match(html, /if \(from !== id && to !== id\) return/);
  assert.match(html, /direction = from === id && to === id \? 'loop' : \(from === id \? 'out' : 'in'\)/);
  assert.match(html, /related\[from\] = true/);
  assert.match(html, /related\[to\] = true/);
  assert.match(html, /edge\.setAttribute\('data-intent-trace-match', ''\)/);
  assert.match(html, /node\.setAttribute\('data-intent-trace-selected', ''\)/);
  assert.match(html, /clone\.setAttribute\('data-direction', direction\)/);
  assert.match(html, /counts\[direction\] \+= 1/);
});

test('Intent Trace separates hover, keyboard, touch, and committed focus', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /window\.matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(html, /event\.pointerType === 'touch'/);
  assert.match(html, /addEventListener\('pointerover'/);
  assert.match(html, /addEventListener\('pointerout'/);
  assert.match(html, /addEventListener\('focusin'/);
  assert.match(html, /addEventListener\('focusout'/);
  assert.match(html, /show\(node\.getAttribute\('data-node-id'\), \{ announce: true \}\)/);
  assert.match(html, /Press Enter for details/);
  assert.match(html, /html\.getAttribute\('data-embed'\) === 'true'/);
  assert.match(html, /container\.classList\.contains\('is-panning'\)/);
  assert.match(html, /svg\.hasAttribute\('data-story-active'\)/);
  assert.match(html, /svg\.hasAttribute\('data-relationship-preview-active'\)/);
  assert.match(html, /Archify\.focus\.active\(\)/);
  assert.match(html, /Archify\.intentTrace\.clear\(\{ announce: false \}\)/);
  assert.match(html, /e\.key === 'Escape' && Archify\.intentTrace\.active\(\)/);
});

test('Intent Trace normalizes motion, respects reduced motion, and exports cleanly', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /clone\.setAttribute\('pathLength', '1'\)/);
  assert.match(html, /\.intent-trace-flow\[data-direction="out"\]/);
  assert.match(html, /\.intent-trace-flow\[data-direction="in"\]/);
  assert.match(html, /\.intent-trace-flow\[data-direction="loop"\]/);
  assert.match(html, /@keyframes archify-intent-trace-flow/);
  assert.match(html, /animation: archify-intent-trace-flow 1\.15s linear 1 both/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+\.intent-trace-flow \{[\s\S]+animation: none !important/);
  assert.match(html, /clone\.removeAttribute\('data-intent-trace-active'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-intent-trace-overlay\]'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-intent-trace-match\], \[data-intent-trace-selected\]'\)/);
  assert.match(html, /!clone\.hasAttribute\('data-intent-trace-active'\)/);
  assert.doesNotMatch(canonicalSvg(html), /data-intent-trace|intent-trace-flow/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
