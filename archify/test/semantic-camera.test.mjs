import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-camera-'));

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

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers ship the same geometry-neutral semantic camera', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /function frameDesktop\(ids, options\)/, mode);
    assert.match(html, /function semanticIds\(ids, includeNeighbors\)/, mode);
    assert.match(html, /if \(seeds\[from\] \|\| seeds\[to\]\) \{ wanted\[from\] = true; wanted\[to\] = true; \}/, mode);
    assert.match(html, /contentScale = Math\.min\(svgWidth \/ viewBox\.width, svgHeight \/ viewBox\.height\)/, mode);
    assert.match(html, /targetScale = Math\.max\(1, Math\.min\(maxScale, targetScale\)\)/, mode);
    assert.match(html, /visibleTop = Math\.max\(0, -containerRect\.top\)/, mode);
    assert.match(html, /visibleBottom - visibleTop >= 240/, mode);
    assert.match(html, /data-camera-mode/, mode);
    assert.match(html, /data-camera-indicator/, mode);
    assert.match(html, /semantic \? 'AUTO ' : levelLabel/, mode);
    assert.match(html, /is-camera-moving/, mode);
    assert.match(html, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/, mode);
    assert.doesNotMatch(svg(html), /data-camera-mode|is-camera-moving|AUTO /, mode);
  }
});

test('semantic camera follows reader intent but yields to manual navigation', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /beginHandoff\(previousIndex, index, previous, view, outgoingBeatIndex, options\.playback === true \? 'playback' : 'guided'\)/);
  assert.match(html, /reveal\(\[id\], \{ includeNeighbors: true, reason: 'focus' \}\)/);
  assert.match(html, /reveal\(\[id\], \{ includeNeighbors: true, reason: 'relationship' \}\)/);
  assert.match(html, /reveal\(\[id\], \{ includeNeighbors: true, reason: 'finder' \}\)/);
  assert.match(html, /function interruptCamera\(reason\)/);
  assert.match(html, /Archify\.guidedViews\.pause\(\)/);
  assert.match(html, /container\.addEventListener\('pointerdown',[\s\S]+interruptCamera\(\)/);
  assert.match(html, /\.overview-map, \.route-probe, \.semantic-lens/);
  assert.match(html, /window\.innerWidth <= 720 && container\.hasAttribute\('data-wide-diagram'\) && Date\.now\(\) > autoScrollUntil/);
  assert.match(html, /reset\(\{ automatic: true \}\)/);
  assert.match(html, /routeReceipt\.hasAttribute\('data-route-journey'\)/);
  assert.match(html, /receiptBottom \+ 24/);
});

test('semantic camera keeps mobile on its contained scroll model and respects reduced motion', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /if \(window\.innerWidth > 720\) return frameDesktop\(ids, options\)/);
  assert.match(html, /if \(!container\.hasAttribute\('data-wide-diagram'\)\) \{[\s\S]+cameraReceipt\(\{ scale: 1, x: 0, y: 0, mode: 'semantic' \}/);
  assert.match(html, /state\.scale = 1;[\s\S]+state\.x = 0;[\s\S]+state\.y = 0;[\s\S]+state\.mode = 'semantic';[\s\S]+apply\(\)/);
  assert.match(html, /autoScrollUntil = Date\.now\(\) \+ \(instant \? 50 : 470\)/);
  assert.match(html, /behavior: instant \? 'auto' : 'smooth'/);
  assert.match(html, /svg \[data-node-id\], svg \[data-edge-from\], svg \[data-detail\], svg \[data-detail-anchor\], svg \[data-legend-hit\], svg \{ transition: none !important; \}/);
});

test('semantic camera remains outside canonical SVG export state', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /clone\.style\.removeProperty\('transform'\)/);
  assert.match(html, /clone\.removeAttribute\('data-view-scale'\)/);
  assert.match(html, /!clone\.style\.getPropertyValue\('transform'\)/);
  assert.doesNotMatch(svg(html), /style="[^"]*transform|data-view-scale|data-camera-mode/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
