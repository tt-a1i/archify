import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const repoRoot = path.resolve(skillRoot, '..');
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

test('all five renderers expose one explicit 1200x630 Share Card export', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /data-format="share-card"/, mode);
    assert.match(html, /Share Card[\s\S]*?1200(?:&times;|×)630 PNG/, mode);
    assert.match(html, /var SHARE_CARD_WIDTH = 1200;/, mode);
    assert.match(html, /var SHARE_CARD_HEIGHT = 630;/, mode);
    assert.match(html, /function rasterizeShareCard\(\)/, mode);
    assert.match(html, /format === 'share-card'/, mode);
  }
});

test('Share Card uses contain-only canonical geometry with fixed safe areas', () => {
  const html = render('architecture');
  assert.match(html, /var availableWidth = SHARE_CARD_WIDTH - SHARE_CARD_PADDING \* 2;/);
  assert.match(html, /var availableHeight = SHARE_CARD_HEIGHT - SHARE_CARD_HEADER - SHARE_CARD_PADDING;/);
  assert.match(html, /var fit = Math\.min\(availableWidth \/ data\.width, availableHeight \/ data\.height\);/);
  assert.match(html, /ctx\.drawImage\(img, drawX, drawY, drawWidth, drawHeight\);/);
  assert.match(html, /serializeSvg\(sourceScale\)/);
  assert.match(html, /fitCanvasText\(ctx, title, [^)]+\)/);
  assert.match(html, /ARCHIFY ·/);
  assert.doesNotMatch(svgBlock(html), /share-card|Share Card|ARCHIFY ·/);
});

test('Share Card is a canonical PNG with exact receipt dimensions and filename', () => {
  const html = render('workflow');
  assert.match(html, /recordExportReceipt\('share-card', blob, true, \{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT \}\)/);
  assert.match(html, /base \+ '-share-card\.png'/);
  assert.match(html, /data-last-export-width/);
  assert.match(html, /data-last-export-height/);
  assert.match(html, /shareCard: rasterizeShareCard/);
  assert.match(html, /if \(format === 'share-card'\) return true;/);
});

test('Share Card stays viewer-only and reuses export cleanup instead of source state', () => {
  const html = render('sequence');
  assert.match(html, /html\[data-embed="true"\] \.toolbar/);
  assert.match(html, /@media print[\s\S]*?\.toolbar/);
  assert.match(html, /function rasterizeShareCard\(\)[\s\S]*?serializeSvg\(sourceScale\)/);
  assert.match(html, /if \(!data\.canonicalStateClean\) return Promise\.reject\(new Error\('Share Card export could not remove temporary viewer state'\)\);/);
  assert.match(html, /canonicalStateClean/);
  assert.doesNotMatch(svgBlock(html), /data-last-export-|data-format="share-card"/);
});

test('the skill and every README make the optional Share Card discoverable', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /optional 1200(?:×|x)630 Share Card PNG/i);
  assert.match(skill, /current theme and visual preset/i);
  assert.match(skill, /never claim(?:s|ing)? validation/i);

  for (const readme of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const text = fs.readFileSync(path.join(repoRoot, readme), 'utf8');
    assert.match(text, /Share Card/i, readme);
    assert.match(text, /1200(?:×|x)630/, readme);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
