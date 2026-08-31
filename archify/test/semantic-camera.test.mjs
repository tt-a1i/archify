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
    assert.match(html, /function boundsFor\(ids, includeNeighbors\)/, mode);
    assert.match(html, /if \(seeds\[from\] \|\| seeds\[to\]\) \{ wanted\[from\] = true; wanted\[to\] = true; \}/, mode);
    assert.match(html, /contentScale = Math\.min\(svgWidth \/ viewBox\.width, svgHeight \/ viewBox\.height\)/, mode);
    assert.match(html, /minimumScale = compactExploration \? 0\.58 : 1/, mode);
    assert.match(html, /var fitScale = Math\.min\(\(right - left\) \/ bounds\.width, \(bottom - top\) \/ bounds\.height\) \* 0\.9/, mode);
    assert.match(html, /options\.fitAll === true[\s\S]+Math\.max\(0\.01, targetScale\)[\s\S]+Math\.max\(minimumScale, targetScale\)/, mode);
    assert.doesNotMatch(html, /explorationReason/, mode);
    assert.match(html, /function ensureFitAllContainerVisibility\(options, minimumVisibleHeight\)/, mode);
    assert.match(html, /var minimumVisibleHeight = window\.innerWidth > 720 \? 240 : 220/, mode);
    assert.match(html, /if \(ensureFitAllContainerVisibility\(options, minimumVisibleHeight\)\)/, mode);
    assert.match(html, /generation !== viewIntentGeneration/, mode);
    assert.match(html, /deferredRevealFrame = requestAnimationFrame/, mode);
    assert.match(html, /visibleTop = Math\.max\(0, -containerRect\.top\)/, mode);
    assert.match(html, /top = Math\.max\(top, visibleTop \+ padding\)/, mode);
    assert.match(html, /var semanticViewport = null/, mode);
    assert.match(html, /clampAxis\(state\.x, semanticViewport\.left, semanticViewport\.right, width \* state\.scale\)/, mode);
    assert.match(html, /semanticViewport = \{ left: left, right: right, top: top, bottom: bottom \}/, mode);
    assert.match(html, /function frameMobile\(ids, options\)/, mode);
    assert.match(html, /semanticViewport = \{ left: 0, right: width, top: top, bottom: bottom \}/, mode);
    assert.match(html, /availableWidth = Math\.max\(1, Math\.min\(width, container\.clientWidth \|\| width\) - padding \* 2\)/, mode);
    assert.match(html, /availableWidth \/ bounds\.width/, mode);
    assert.match(html, /data-camera-mode/, mode);
    assert.match(html, /data-camera-indicator/, mode);
    assert.match(html, /var resolvedLevel = semantic \? viewerText\('viewer\.nav\.level\.auto'\) : levelLabel/, mode);
    assert.match(html, /is-camera-moving/, mode);
    assert.match(html, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/, mode);
    assert.doesNotMatch(svg(html), /data-camera-mode|is-camera-moving|AUTO /, mode);
  }
});

test('semantic camera follows reader intent but yields to manual navigation', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /beginHandoff\(previousIndex, index, previous, view, outgoingBeatIndex, options\.playback === true \? 'playback' : 'guided'\)/);
  assert.match(html, /reveal\(\[id\], \{ includeNeighbors: true, reason: 'focus' \}\)/);
  assert.match(html, /reveal\(\[id\], \{[\s\S]*?avoidPassport: true,[\s\S]*?reason: 'relationship'/);
  assert.match(html, /reveal\(\[id\], \{ includeNeighbors: true, reason: 'finder' \}\)/);
  assert.match(html, /function interruptCamera\(reason\)/);
  assert.match(html, /if \(viewSyncFrame\) cancelAnimationFrame\(viewSyncFrame\)/);
  assert.match(html, /semanticSyncRequested = false/);
  assert.match(html, /semanticViewport = null/);
  assert.match(html, /Archify\.guidedViews\.pause\(\)/);
  assert.match(html, /container\.addEventListener\('pointerdown',[\s\S]+interruptCamera\(\)/);
  assert.match(html, /function semanticCanPan\(\)/);
  assert.match(html, /function clampManualOverviewAxis\(value, viewportExtent, contentExtent\)/);
  assert.match(html, /state\.mode === 'manual' && state\.scale <= 1\.001/);
  assert.match(html, /state\.mode === 'manual' && \(state\.scale < 0\.999 \|\| translated\)/);
  assert.match(html, /if \(!semanticCanPan\(\) \|\| event\.button !== 0/);
  assert.match(html, /\.overview-map, \.route-probe, \.semantic-lens/);
  assert.match(html, /window\.innerWidth <= 720 && container\.hasAttribute\('data-wide-diagram'\) && Date\.now\(\) > autoScrollUntil/);
  assert.match(html, /reset\(\{ automatic: true \}\)/);
  assert.match(html, /routeReceipt\.hasAttribute\('data-route-journey'\)/);
  assert.match(html, /receiptBottom \+ 24/);
  assert.doesNotMatch(html, /reason: 'relationship-preview(?:-clear)?'/);
  assert.match(html, /reason: 'relationship-sync'/);
  assert.match(html, /reason: 'reachability-sync'/);
  assert.ok(html.indexOf("reason: 'relationship-sync'") < html.indexOf("reason: 'focus-sync'"));
  assert.ok(html.indexOf("reason: 'reachability-sync'") < html.indexOf("reason: 'focus-sync'"));
});

test('semantic camera keeps mobile on its contained scroll model and respects reduced motion', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /if \(window\.innerWidth > 720\) return frameDesktop\(ids, options\)/);
  assert.match(html, /if \(!container\.hasAttribute\('data-wide-diagram'\)\) \{[\s\S]+cameraReceipt\(\{ scale: 1, x: 0, y: 0, mode: 'semantic' \}/);
  assert.match(html, /state\.scale = 1;[\s\S]+state\.x = 0;[\s\S]+state\.y = 0;[\s\S]+state\.mode = 'semantic';[\s\S]+apply\(\)/);
  assert.match(html, /autoScrollUntil = Date\.now\(\) \+ \(instant \? 250 : 1100\)/);
  assert.match(html, /container\.addEventListener\('scrollend', finishScroll/);
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
