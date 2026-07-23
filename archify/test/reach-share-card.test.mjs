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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reach-share-card-'));

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

test('all five renderers inherit one active-reach-only Reach Share Card item', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /data-action="reach-share-card"[^>]*hidden disabled[^>]*>Reach Share Card[\s\S]*?1200(?:&times;|×)630 PNG/, mode);
    assert.match(html, /function syncReachShareItem\(\)/, mode);
    assert.match(html, /reachShareItem\.hidden = !snapshot;/, mode);
    assert.match(html, /reachShareItem\.disabled = !snapshot;/, mode);
    assert.match(html, /function open\(focusLast\)[\s\S]*?syncReachShareItem\(\);/, mode);
    assert.doesNotMatch(html, /id="reach-share-card"|class="reach-share-card"/, mode);
    assert.doesNotMatch(canonicalSvg(html), /data-share-reach(?:-|=)/, mode);
  }
});

test('Reach Share Card snapshots copy the active authored closure without rerunning traversal', () => {
  const html = render('architecture', CASES.architecture);
  const start = html.indexOf('function reachabilitySnapshot() {');
  const end = html.indexOf('\n      function setPassportValue', start);
  const snapshotBlock = start >= 0 && end > start ? html.slice(start, end) : '';

  assert.match(snapshotBlock, /activeReachability\.nodeIds\.slice\(\)/);
  assert.match(snapshotBlock, /activeReachability\.edgeKeys\.slice\(\)/);
  assert.match(snapshotBlock, /activeReachability\.depths/);
  assert.match(snapshotBlock, /direction: reachabilityMode/);
  assert.match(snapshotBlock, /origin: \{ id: originId, label:/);
  assert.match(snapshotBlock, /maxDepth: activeReachability\.maxDepth/);
  assert.match(snapshotBlock, /seenNodeIds = Object\.create\(null\)/);
  assert.match(snapshotBlock, /seenEdgeKeys = Object\.create\(null\)/);
  assert.match(snapshotBlock, /drawableFragments = fragments\.filter\(hasDrawableGeometry\)/);
  assert.match(snapshotBlock, /drawableFragments\.length !== 1/);
  assert.match(snapshotBlock, /return null/);
  assert.doesNotMatch(snapshotBlock, /computeReachability|reachabilityFor|queue\s*=|shortestDirectedPath/);
  assert.match(html, /reachabilitySnapshot: reachabilitySnapshot/);
});

test('Reach variant decorates only a finite canonical clone with static authored identity', () => {
  const html = render('workflow', CASES.workflow);
  const start = html.indexOf('function applyReachSnapshot(clone, snapshot) {');
  const end = html.indexOf('\n      function serializeSvg', start);
  const applyBlock = start >= 0 && end > start ? html.slice(start, end) : '';

  assert.match(applyBlock, /snapshot\.direction !== 'upstream'/);
  assert.match(applyBlock, /snapshot\.direction !== 'downstream'/);
  assert.match(applyBlock, /snapshot\.nodeIds\.length < 2/);
  assert.match(applyBlock, /snapshot\.origin\.label\.trim\(\)/);
  assert.match(applyBlock, /nodeId === snapshot\.origin\.id \? depth !== 0 : depth < 1/);
  assert.match(applyBlock, /edge\.depth !== Math\.max\(snapshot\.depths\[edge\.from\], snapshot\.depths\[edge\.to\]\)/);
  assert.match(applyBlock, /matchedNodes\.length !== 1/);
  assert.match(applyBlock, /drawableMatches\.length !== 1/);
  assert.match(applyBlock, /data-share-reach-match/);
  assert.match(applyBlock, /data-share-reach-origin/);
  assert.match(applyBlock, /data-share-reach-depth/);
  assert.match(applyBlock, /clone\.setAttribute\('data-share-reach', snapshot\.direction\)/);
  assert.doesNotMatch(applyBlock, /setAttribute\('data-reach-(?:active|match|origin|depth)/);
  assert.doesNotMatch(applyBlock, /animation:|setTimeout|requestAnimationFrame/);
  assert.match(html, /canonicalStateClean && finiteSvgDimensions && !opts\.routeSnapshot && applyReachSnapshot\(clone, opts\.reachSnapshot\)/);
  assert.ok(html.indexOf('var canonicalStateClean =') < html.indexOf('applyReachSnapshot(clone, opts.reachSnapshot)'), 'canonical cleanup must precede reach decoration');
});

test('Reach styling preserves context, direction, and Blueprint restraint without motion', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /svg\[data-share-reach\] \[data-node-id\], svg\[data-share-reach\] \[data-edge-from\] \{ opacity: 0\.14; \}/);
  assert.match(html, /svg\[data-share-reach\] \[data-share-reach-match\] \{ opacity: 1; \}/);
  assert.match(html, /data-share-reach=\\?"upstream\\?"[\s\S]*?--database-stroke/);
  assert.match(html, /data-share-reach=\\?"downstream\\?"[\s\S]*?--backend-stroke/);
  assert.match(html, /data-preset=\\?"blueprint\\?"\]\[data-share-reach\][\s\S]*?filter: none/);
  const reachStyleBlock = html.match(/if \(opts\.reachSnapshot\) \{[\s\S]*?\n        \}/)?.[0] || '';
  assert.doesNotMatch(reachStyleBlock, /animation:|display:\s*none|transform:/);
});

test('Reach Share Card reuses the 1200x630 seam and publishes a truthful scoped receipt', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /options\.variant !== 'route' && options\.variant !== 'reach'/);
  assert.match(html, /Archify\.focus\.reachabilitySnapshot\(\)/);
  assert.match(html, /renderShareCard\(\{ reachSnapshot: snapshot \}\)/);
  assert.doesNotMatch(html, /function rasterizeReachShareCard|reachShareCard:/);
  assert.match(html, /'Authored ' \+ reachSnapshot\.direction \+ ' from ' \+ reachSnapshot\.origin\.label/);
  assert.match(html, /reachSnapshot\.nodeIds\.length - 1/);
  assert.match(html, /reachSnapshot\.edges\.length/);
  assert.match(html, /reachSnapshot\.maxDepth/);
  assert.match(html, /recordExportReceipt\('share-card', blob, false, \{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT \}, 'reach', false, true\)/);
  assert.match(html, /'-' \+ snapshot\.direction \+ '-reach-share-card\.png'/);
  assert.match(html, /data-last-export-reach-state-clean/);
  assert.match(html, /Trace authored reach before exporting a Reach Share Card/);
  assert.match(html, /downloadReachShareCard: runReachShareCard/);
});

test('Skill, product docs, and READMEs keep the optional truthful boundary explicit', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /Export → Reach Share Card/);
  assert.match(skill, /variant=reach/);
  assert.match(skill, /data-share-reach-\*/);
  assert.match(skill, /authored reachability/i);
  assert.match(skill, /download-only/i);

  for (const readme of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const text = fs.readFileSync(path.join(repoRoot, readme), 'utf8');
    assert.match(text, /Reach Share Card/, readme);
    assert.match(text, /docs\/assets\/mco-runtime-reach-share-card\.png/, readme);
  }
  const png = fs.readFileSync(path.join(repoRoot, 'docs/assets/mco-runtime-reach-share-card.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);

  const product = fs.readFileSync(path.join(repoRoot, 'PRODUCT.md'), 'utf8');
  const design = fs.readFileSync(path.join(repoRoot, 'DESIGN.md'), 'utf8');
  assert.match(product, /Reach Share Card/);
  assert.match(design, /Reach Share Card/);
  assert.match(design, /not (?:runtime )?(?:impact|causality|breakage)/i);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
