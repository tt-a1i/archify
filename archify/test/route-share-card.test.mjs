import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-share-card-'));

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

test('all five renderers inherit one resolved-only Route Share Card Export item', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /data-action="route-share-card"[^>]*hidden disabled[^>]*>Route Share Card[\s\S]*?1200(?:&times;|×)630 PNG/, mode);
    assert.match(html, /function syncRouteShareItem\(\)/, mode);
    assert.match(html, /routeShareItem\.hidden = !snapshot;/, mode);
    assert.match(html, /routeShareItem\.disabled = !snapshot;/, mode);
    assert.match(html, /\.toolbar \.export-menu button\[hidden\] \{ display: none; \}/, mode);
    assert.doesNotMatch(html, /id="route-probe-share"|class="route-probe-share"/, mode);
    assert.doesNotMatch(canonicalSvg(html), /data-share-route(?:-|=)/, mode);
  }
});

test('Route Share Card menu lifecycle excludes hidden state from keyboard navigation', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /function open\(focusLast\)[\s\S]*?syncRouteShareItem\(\);/);
  assert.match(html, /items\(\)\.filter\(function \(i\) \{ return !i\.hidden && !i\.disabled; \}\)/);
  assert.match(html, /function clear\(options\)[\s\S]*?Archify\.exportMenu\.syncRouteShare\(\)/);
  assert.match(html, /function showResult\(result, options\)[\s\S]*?Archify\.exportMenu\.syncRouteShare\(\)/);
  assert.match(html, /html\[data-embed="true"\] \.toolbar/);
  assert.match(html, /@media print[\s\S]*?\.toolbar/);
});

test('Route Share Card snapshots copy exact resolved node and relationship identity without rerouting', () => {
  const html = render('architecture', CASES.architecture);
  const snapshotBlock = html.match(/function exportSnapshot\(\) \{[\s\S]*?\n      \}/)?.[0] || '';
  const geometryBlock = html.match(/function hasDrawableGeometry\(element\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(snapshotBlock, /nodeIds: activeNodeIds\.slice\(\)/);
  assert.match(snapshotBlock, /hops: activeEdges\.length/);
  assert.match(snapshotBlock, /edges: activeEdges\.map\(function \(edge\) \{/);
  assert.match(snapshotBlock, /key: edge\.getAttribute\('data-edge-key'\)/);
  assert.match(snapshotBlock, /seenNodeIds = Object\.create\(null\)/);
  assert.match(snapshotBlock, /seenEdgeKeys = Object\.create\(null\)/);
  assert.match(snapshotBlock, /fragment\.getAttribute\('data-edge-from'\) === activeNodeIds\[index\]/);
  assert.match(snapshotBlock, /drawableFragments = fragments\.filter\(hasDrawableGeometry\)/);
  assert.match(snapshotBlock, /drawableFragments\.length !== 1/);
  assert.match(snapshotBlock, /drawableFragments\[0\] !== edge/);
  assert.match(geometryBlock, /geometry\.getTotalLength/);
  assert.match(geometryBlock, /Number\.isFinite\(length\) && length > 0/);
  assert.match(geometryBlock, /nan\|infinity/i);
  assert.match(html, /exportSnapshot: exportSnapshot/);
  assert.doesNotMatch(snapshotBlock, /shortestDirectedPath|outgoingByNode|reachableFrom|labelAt|nearest/i);
});

test('Route Share Card snapshot fails closed when the resolved DOM becomes stale or conflicting', () => {
  const html = render('workflow', CASES.workflow);
  const snapshotBlock = html.match(/function exportSnapshot\(\) \{[\s\S]*?\n      \}/)?.[0] || '';
  assert.match(snapshotBlock, /activeNodeIds\.length < 2/);
  assert.match(snapshotBlock, /activeEdges\.length !== activeNodeIds\.length - 1/);
  assert.match(snapshotBlock, /allNodes\.filter\(function \(node\)/);
  assert.match(snapshotBlock, /!edge \|\| !svg\.contains\(edge\)/);
  assert.match(snapshotBlock, /!edgeKey \|\| seenEdgeKeys\[edgeKey\]/);
  assert.match(snapshotBlock, /!fragments\.every/);
  assert.match(snapshotBlock, /return null/);
});

test('Route variant decorates only a finite canonical clone with dedicated static attributes', () => {
  const html = render('architecture', CASES.architecture);
  const applyBlock = html.match(/function applyRouteSnapshot\(clone, snapshot\) \{[\s\S]*?\n      \}/)?.[0] || '';
  assert.match(applyBlock, /snapshot\.edges\.length !== snapshot\.nodeIds\.length - 1/);
  assert.match(applyBlock, /snapshot\.hops !== snapshot\.edges\.length/);
  assert.match(applyBlock, /matchedNodes\.length !== 1/);
  assert.match(applyBlock, /matchedEdges\.every/);
  assert.match(applyBlock, /drawableMatches = matchedEdges\.filter\(hasDrawableGeometry\)/);
  assert.match(applyBlock, /drawableMatches\.length !== 1/);
  assert.match(applyBlock, /data-share-route-match/);
  assert.match(applyBlock, /data-share-route-start/);
  assert.match(applyBlock, /data-share-route-middle/);
  assert.match(applyBlock, /data-share-route-end/);
  assert.match(applyBlock, /clone\.removeAttribute\('data-animation'\)/);
  assert.doesNotMatch(applyBlock, /setAttribute\('data-route-(?:match|step|start|end|active|journey)/);
  assert.match(html, /canonicalStateClean && finiteSvgDimensions && applyRouteSnapshot\(clone, opts\.routeSnapshot\)/);
  assert.match(html, /Number\.isFinite\(vb\.width\)[\s\S]*?vb\.width > 0 && vb\.height > 0/);
  assert.ok(html.indexOf('var canonicalStateClean =') < html.indexOf('applyRouteSnapshot(clone, opts.routeSnapshot)'), 'canonical cleanup must precede route decoration');
});

test('clone-only Route styling retains context and distinguishes start, middle, and end without motion', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /svg\[data-share-route\] \[data-node-id\], svg\[data-share-route\] \[data-edge-from\] \{ opacity: 0\.18; \}/);
  assert.match(html, /svg\[data-share-route\] \[data-share-route-match\] \{ opacity: 1; \}/);
  assert.match(html, /data-share-route-start[\s\S]*?stroke-dasharray: 5 3/);
  assert.match(html, /data-share-route-middle[\s\S]*?stroke-width: 2\.2/);
  assert.match(html, /data-share-route-end[\s\S]*?stroke-width: 3\.4/);
  assert.doesNotMatch(html.match(/if \(opts\.routeSnapshot\) \{[\s\S]*?\n        \}/)?.[0] || '', /display:\s*none|animation:|filter:|transform:/);
});

test('Route Share Card reuses one 1200x630 variant seam and publishes a truthful receipt', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /function rasterizeShareCard\(options\)/);
  assert.match(html, /options\.variant !== 'route'/);
  assert.match(html, /var snapshot = Archify\.routeProbe && Archify\.routeProbe\.exportSnapshot\(\)/);
  assert.match(html, /renderShareCard\(\{ routeSnapshot: snapshot \}\)/);
  assert.doesNotMatch(html, /function rasterizeRouteShareCard|routeShareCard:/);
  assert.match(html, /var title = titleNode \? titleNode\.textContent : document\.title;/);
  assert.match(html, /'Route: ' \+ routeSnapshot\.source\.label \+ ' → ' \+ routeSnapshot\.target\.label \+ ' · ' \+ routeSnapshot\.hops \+ ' directed hops'/);
  assert.match(html, /recordExportReceipt\('share-card', blob, false, \{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT \}, 'route', true\)/);
  assert.match(html, /diagramFilename\(\) \+ '-route-share-card\.png'/);
  assert.match(html, /data-last-export-variant/);
  assert.match(html, /data-last-export-route-state-clean/);
  assert.match(html, /clearExportReceipt\(\);[\s\S]*?var snapshot = Archify\.routeProbe/);
  assert.match(html, /function runExport\(format\)[\s\S]*?clearExportReceipt\(\);/);
  assert.match(html, /var ctx = canvas2dOrThrow\(canvas, 'Share Card'\)/);
});

test('skill and READMEs describe the optional Export variant and show one real card without changing the hero', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /Export → Route Share Card/);
  assert.match(skill, /format=share-card/);
  assert.match(skill, /variant=route/);
  assert.match(skill, /data-share-route-\*/);
  assert.match(skill, /download-only/i);

  for (const readme of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const text = fs.readFileSync(path.join(repoRoot, readme), 'utf8');
    assert.match(text, /Export → Route Share Card/, readme);
    assert.match(text, /docs\/assets\/archify-route-share-card\.png/, readme);
  }

  const png = fs.readFileSync(path.join(repoRoot, 'docs/assets/archify-route-share-card.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);

  const buildZip = fs.readFileSync(path.join(repoRoot, 'scripts/build-zip.sh'), 'utf8');
  assert.match(buildZip, /--exclude '\.validator-check-\*'/, 'concurrent validator scratch must never leak into archify.zip');
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
