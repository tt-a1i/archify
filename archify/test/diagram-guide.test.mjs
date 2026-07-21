import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-diagram-guide-'));

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

test('all typed renderers inherit one viewer-only Diagram Guide', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="diagram-guide" hidden role="dialog" aria-modal="false" aria-labelledby="diagram-guide-title"/, mode);
    assert.match(html, /id="btn-diagram-guide"[^>]+aria-label="Open diagram guide"[^>]+aria-haspopup="dialog"[^>]+aria-expanded="false"/, mode);
    assert.match(html, /Archify\.guide = \(function \(\)/, mode);
    assert.match(html, /Diagram Guide — a factual command deck over existing interactions/, mode);
    assert.doesNotMatch(canonicalSvg(html), /diagram-guide|Archify\.guide|Explore this system/, mode);
  }
});

test('Diagram Guide reports compiled semantic facts and honest story availability', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /svg\.querySelectorAll\('\[data-node-id\]'\)\.length/);
  assert.match(html, /svg\.querySelectorAll\('\[data-edge-from\]\[data-edge-to\]'\)/);
  assert.match(html, /edge\.getAttribute\('data-edge-key'\)/);
  assert.match(html, /return Archify\.guidedViews && Number\(Archify\.guidedViews\.count\) \|\| 0/);
  assert.match(html, /storyBtn\.disabled = views === 0/);
  assert.match(html, /views \+ ' guided view'/);
  assert.match(html, /No authored guided story in this diagram/);
});

test('Diagram Guide delegates its task rows to existing production interactions', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /if \(action === 'find'\) return Archify\.finder\.open\(\)/);
  assert.match(html, /if \(action === 'route'\) return Archify\.routeProbe\.begin\(\{ focusNode: true \}\)/);
  assert.match(html, /if \(action === 'map'\) return Archify\.radar\.open\(\)/);
  assert.match(html, /if \(action === 'story'\) return Archify\.guidedViews\.play\(\)/);
  assert.match(html, /if \(action === 'present'\) return Archify\.presentation\.enter\(\)/);
  assert.match(html, /if \(action === 'export'\) return Archify\.exportMenu\.open\(\)/);
  assert.match(html, /if \(action === 'theme'\) return Archify\.theme\.toggle\(\)/);
  assert.match(html, /if \(action === 'reset'\) return Archify\.view\.reset\(\)/);
  assert.match(html, /Archify\.guidedViews\.pause\(\)/);
  assert.match(html, /Archify\.finder\.close\(\{ restoreFocus: false \}\)/);
  assert.match(html, /Archify\.radar\.close\(\{ restoreFocus: false \}\)/);
  assert.match(html, /event\.stopPropagation\(\);[\s\S]+execute\(button\.getAttribute\('data-guide-action'\)\)/);
});

test('Diagram Guide is keyboard-first, mobile-contained, motion-safe, and embed-clean', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /e\.key === '\?'/);
  assert.match(html, /Archify\.guide\.toggle\(\)/);
  assert.match(html, /event\.key === 'ArrowRight'/);
  assert.match(html, /event\.key === 'ArrowDown'/);
  assert.match(html, /event\.key === 'Home'/);
  assert.match(html, /event\.key === 'End'/);
  assert.match(html, /event\.key === 'Escape' \|\| event\.key === '\?'/);
  assert.match(html, /html\.setAttribute\('data-guide-open', 'true'\)/);
  assert.match(html, /html\.getAttribute\('data-guide-open'\) === 'true'/);
  assert.match(html, /html\[data-embed="true"\] \.diagram-guide/);
  assert.match(html, /data-wide-diagram="true"\] \.diagram-guide/);
  assert.match(html, /\.route-probe\[data-guide-open="true"\]/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+\.diagram-guide/);
  assert.match(html, /class="diagram-guide no-print"/);
  assert.doesNotMatch(canonicalSvg(html), /data-guide-open|diagram-guide/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
