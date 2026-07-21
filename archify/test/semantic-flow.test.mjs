import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-flow-'));

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

test('all typed renderers inherit one selection-triggered Semantic Flow signal', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /function renderFlowOverlay\(entries\)/, mode);
    assert.match(html, /var MAX_LENS_FLOW_EDGES = 24/, mode);
    assert.match(html, /setAttribute\('class', 'semantic-lens-flow'\)/, mode);
    assert.match(html, /data-semantic-lens-overlay/, mode);
    assert.doesNotMatch(canonicalSvg(html), /semantic-lens-flow|semantic-lens-overlay|data-lens-flow/, mode);
  }
});

test('Semantic Flow clones only exact matched authored geometry and preserves direction', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /var matchedFlow = \[\]/);
  assert.match(html, /direction = fromKind === selectedKinds\[0\] \? 'forward' : 'reverse'/);
  assert.match(html, /fromKind === selectedKinds\[0\] && toKind !== selectedKinds\[0\] \? 'out'/);
  assert.match(html, /toKind === selectedKinds\[0\] && fromKind !== selectedKinds\[0\] \? 'in'/);
  assert.match(html, /matchedFlow\.push\(\{ edge: edge, direction: direction \}\)/);
  assert.match(html, /clone\.removeAttribute\('marker-end'\)/);
  assert.match(html, /clone\.removeAttribute\('data-edge-key'\)/);
  assert.match(html, /clone\.setAttribute\('pathLength', '1'\)/);
  assert.match(html, /wrapper\.setAttribute\('transform', entry\.edge\.members\[0\]\.getAttribute\('transform'\)\)/);
  assert.match(html, /svg\.setAttribute\('data-lens-flow-count', String\(entries\.length\)\)/);
  assert.match(html, /svg\.insertBefore\(overlay, firstNode\)/);
});

test('Semantic Flow has preset identities and motion-safe density boundaries', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /\.semantic-lens-flow\[data-direction="out"\],[\s\S]+var\(--frontend-stroke\)/);
  assert.match(html, /\.semantic-lens-flow\[data-direction="in"\],[\s\S]+var\(--database-stroke\)/);
  assert.match(html, /\.semantic-lens-flow\[data-direction="within"\][\s\S]+var\(--messagebus-stroke\)/);
  assert.match(html, /svg\[data-preset="signal-flow"\] \.semantic-lens-flow/);
  assert.match(html, /svg\[data-preset="blueprint"\] \.semantic-lens-flow/);
  assert.match(html, /@keyframes archify-semantic-lens-flow/);
  assert.match(html, /animation: archify-semantic-lens-flow 1\.35s linear 1 both/);
  assert.match(html, /entries\.length > MAX_LENS_FLOW_EDGES/);
  assert.match(html, /data-lens-flow-density', 'quiet'/);
  assert.match(html, /html\[data-embed="true"\] \.semantic-lens-overlay/);
  assert.match(html, /@media print \{[\s\S]+\.semantic-lens-overlay \{ display: none !important; \}/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+\.semantic-lens-flow \{[\s\S]+animation: none !important/);
});

test('Semantic Flow cleanup and exports remain canonical', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /function removeFlowOverlay\(\)/);
  assert.match(html, /svg\.querySelectorAll\('\[data-semantic-lens-overlay\]'\)/);
  assert.match(html, /svg\.removeAttribute\('data-lens-flow-count'\)/);
  assert.match(html, /svg\.removeAttribute\('data-lens-flow-density'\)/);
  assert.match(html, /clone\.removeAttribute\('data-lens-flow-count'\)/);
  assert.match(html, /clone\.removeAttribute\('data-lens-flow-density'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-semantic-lens-overlay\]'\)/);
  assert.match(html, /\[data-semantic-lens-overlay\],[^']*\[data-lens-match\]/);
  assert.doesNotMatch(canonicalSvg(html), /semantic-lens-flow|semantic-lens-overlay|data-lens-flow/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
