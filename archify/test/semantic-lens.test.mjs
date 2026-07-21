import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-lens-'));

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

test('all typed renderers inherit one viewer-only Semantic Lens', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="semantic-lens" hidden role="dialog" aria-modal="false" aria-labelledby="semantic-lens-title"/, mode);
    assert.match(html, /id="btn-semantic-lens"[^>]+aria-label="Open semantic lens"[^>]+aria-expanded="false"[^>]+aria-controls="semantic-lens"/, mode);
    assert.match(html, /Archify\.semanticLens = \(function \(\)/, mode);
    assert.match(html, /svg\.querySelectorAll\('\[data-node-id\]\[data-node-kind\]'\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /semantic-lens-overlay|data-lens-active|data-lens-match/, mode);
  }
});

test('Semantic Lens derives honest kind counts and compares at most two roles', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /function collectKinds\(\)/);
  assert.match(html, /kind\.nodes\.push\(node\)/);
  assert.match(html, /Choose up to two semantic kinds/);
  assert.match(html, /if \(selectedKinds\.length >= 2\) return false/);
  assert.match(html, /var crossKind = selectedKinds\.length === 2/);
  assert.match(html, /fromKind === selectedKinds\[0\] && toKind === selectedKinds\[1\]/);
  assert.match(html, /fromKind === selectedKinds\[1\] && toKind === selectedKinds\[0\]/);
  assert.match(html, /direct relationship/);
  assert.match(html, /data-lens-peer/);
  assert.match(html, /data-lens-selected/);
});

test('Semantic Lens is shareable and yields cleanly to stronger reader intent', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /#lens=/);
  assert.match(html, /params\.get\('lens'\)/);
  assert.match(html, /window\.addEventListener\('hashchange', syncFromHash\)/);
  assert.match(html, /event\.composedPath\(\)/);
  assert.match(html, /eventPath\.indexOf\(panel\) >= 0/);
  assert.match(html, /Archify\.semanticLens\.clear\(\{ updateUrl: false/);
  assert.match(html, /Archify\.focus\.clear\(\{ updateUrl: false, preserveView: true \}\)/);
  assert.match(html, /Archify\.routeProbe\.clear\(\{ updateUrl: false, restoreFocus: false \}\)/);
  assert.match(html, /Archify\.guidedViews\.showAll\(\{ clearFocus: false, updateUrl: false \}\)/);
  assert.match(html, /if \(action === 'lens'\) return Archify\.semanticLens\.open\(\)/);
  assert.match(html, /e\.key === 'l' \|\| e\.key === 'L'/);
  assert.match(html, /e\.key === 'Escape' && Archify\.semanticLens\.isOpen\(\)/);
  assert.match(html, /e\.key === 'Escape' && Archify\.semanticLens\.active\(\)/);
});

test('Semantic Lens preserves Reading Depth, mobile containment, print, embed, and export boundaries', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /svg\[data-lens-active\] \[data-lens-match\] \[data-detail\]/);
  assert.match(html, /svg\[data-lens-active\] \[data-lens-match\] \[data-detail-anchor\]/);
  assert.match(html, /html\[data-embed="true"\] \.semantic-lens/);
  assert.match(html, /data-wide-diagram="true"\] \.semantic-lens/);
  assert.match(html, /@media print \{[\s\S]+svg\[data-lens-active\] \[data-node-id\][\s\S]+opacity: 1 !important/);
  assert.match(html, /clone\.removeAttribute\('data-lens-active'\)/);
  assert.match(html, /\[data-lens-match\], \[data-lens-selected\], \[data-lens-peer\]/);
  assert.match(html, /clone\.querySelectorAll\('[^']*\[data-lens-match\][^']*\[data-lens-selected\][^']*\[data-lens-peer\][^']*'\)\.length === 0/);
  assert.match(html, /class="semantic-lens no-print"/);
  assert.doesNotMatch(canonicalSvg(html), /data-lens-active|data-lens-match|data-lens-selected|data-lens-peer/);
});

test('Semantic Lens docks away from selected nodes without breaking mobile containment', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /function overlapArea\(a, b\)/);
  assert.match(html, /function dockPanel\(byId\)/);
  assert.match(html, /selectedKinds\.indexOf\(byId\[id\]\.getAttribute\('data-node-kind'\)/);
  assert.match(html, /var side = leftScore < rightScore \? 'left' : 'right'/);
  assert.match(html, /panel\.setAttribute\('data-dock-side', side\)/);
  assert.match(html, /\.semantic-lens\[data-dock-side="left"\]/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]+\.semantic-lens\[data-dock-side\] \{ left: auto; right: 0\.5rem; \}/);
  assert.match(html, /window\.addEventListener\('resize'/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
