import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-share-card-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', CASES[mode]),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function svgBlock(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all five renderers remove ordinary share cards while retaining other export entries', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.doesNotMatch(html, /data-format="share-card"|data-action="copy-share-card"|copyShareCard|runCopyShareCard/, mode);
    assert.deepEqual([...html.matchAll(/<button data-format="([^"]+)"/g)].map(match => match[1]),
      ['png', 'jpeg', 'webp', 'svg', 'svg-light', 'svg-dark', 'webm'], mode);
    for (const action of ['copy', 'route-share-card', 'reach-share-card']) {
      assert.ok(html.includes('data-action="' + action + '"'), mode);
    }
  }
});

test('README architecture examples do not retain ordinary share-card entries', () => {
  for (const file of ['archify-repo.html', 'archify-repo-grid.html', 'maka-architecture.html']) {
    const html = fs.readFileSync(path.join(skillRoot, '..', 'examples', file), 'utf8');
    assert.equal(/data-format="share-card"|data-action="copy-share-card"/.test(html), false,
      `${file}: regenerate this README example to remove the old share-card entries`);
  }
});

test('Share Card uses contain-only canonical geometry with fixed safe areas', () => {
  const html = render('architecture');
  assert.match(html, /var panelWidth = SHARE_CARD_WIDTH - SHARE_CARD_PADDING \* 2;[\s\S]*?var availableWidth = panelWidth - inset \* 2;/);
  assert.match(html, /var panelHeight = SHARE_CARD_HEIGHT - SHARE_CARD_HEADER - SHARE_CARD_PADDING;[\s\S]*?var availableHeight = panelHeight - inset \* 2;/);
  assert.match(html, /var fit = Math\.min\(availableWidth \/ data\.width, availableHeight \/ data\.height\);/);
  assert.match(html, /ctx\.drawImage\(img, drawX, drawY, drawWidth, drawHeight\);/);
  assert.match(html, /function canvas2dOrThrow\(canvas, label\)/);
  assert.match(html, /throw exportError\('viewer\.export\.error\.contextUnavailable'/);
  assert.match(html, /throw exportError\('viewer\.export\.error\.toBlobUnavailable'/);
  assert.match(html, /img\.onload = function \(\) \{\s*try \{/);
  assert.match(html, /function renderShareCard\(options\)[\s\S]*?serializeSvg\(sourceScale, \{ routeSnapshot: routeSnapshot, reachSnapshot: reachSnapshot, figure: true \}\)/);
  assert.match(html, /fitCanvasText\(ctx, title, [^)]+\)/);
  assert.doesNotMatch(svgBlock(html), /share-card|Share Card|ARCHIFY ·/);
});

test('ordinary Copy PNG keeps its existing full-diagram raster path', () => {
  const html = render('sequence');
  assert.match(html, /function runCopy\(\)[\s\S]*?var blobPromise = rasterize\('png'\);/);
  assert.match(html, /runCopy\(\)[\s\S]*?writePngToClipboard\(blobPromise\)/);
  assert.doesNotMatch(svgBlock(html), /copy-share-card|Copy Share Card/);
});

test('Share Card stays viewer-only and reuses export cleanup instead of source state', () => {
  const html = render('sequence');
  assert.match(html, /html\[data-embed="true"\] \.toolbar/);
  assert.match(html, /@media print[\s\S]*?\.toolbar/);
  assert.match(html, /function renderShareCard\(options\)[\s\S]*?serializeSvg\(sourceScale, \{ routeSnapshot: routeSnapshot, reachSnapshot: reachSnapshot, figure: true \}\)/);
  assert.match(html, /if \(!data\.canonicalStateClean\) return Promise\.reject\(exportError\('viewer\.export\.error\.viewerState'\)\);/);
  assert.match(html, /canonicalStateClean/);
  assert.doesNotMatch(svgBlock(html), /data-last-export-|data-format="share-card"/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
