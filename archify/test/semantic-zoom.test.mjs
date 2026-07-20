import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-zoom-'));

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

test('all typed renderers emit explicit context and fine reading-depth semantics', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /data-detail="context"/, mode);
    assert.match(html, /data-detail="fine"/, mode);
    assert.match(html, /data-detail-anchor/, mode);
    assert.doesNotMatch(html, /<text[^>]*data-detail="(?:context|fine)"[^>]*class="t-primary"/, mode);
    assert.match(html, /class="diagram-container" data-detail-level="map"/, mode);
  }
});

test('semantic zoom exposes MAP, READ, and FULL at deterministic thresholds', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /function detailLevel\(\)/);
  assert.match(html, /if \(state\.mode === 'semantic'\) return 'full'/);
  assert.match(html, /if \(state\.scale >= 1\.75\) return 'full'/);
  assert.match(html, /if \(state\.scale >= 1\.25\) return 'read'/);
  assert.match(html, /return 'map'/);
  assert.match(html, /container\.setAttribute\('data-detail-level', detail\)/);
  assert.match(html, /detail === 'map' \? 'MAP ' : detail === 'read' \? 'READ ' : 'FULL '/);
  assert.match(html, /Zoom in to reveal relationship labels and node context/);
  assert.match(html, /Zoom in again to reveal tags and annotations/);
  assert.match(html, /Full diagram detail/);
});

test('reading depth stays quiet at overview and yields to semantic intent', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /\.diagram-container\[data-detail-level="map"\] svg \[data-detail="context"\]/);
  assert.match(html, /\.diagram-container\[data-detail-level="map"\] svg \[data-detail="fine"\]/);
  assert.match(html, /\.diagram-container\[data-detail-level="read"\] svg \[data-detail="fine"\]/);
  assert.match(html, /\.diagram-container\[data-detail-level="map"\] svg \[data-detail-anchor\]/);
  assert.match(html, /svg\[data-focus-active\] \[data-focus-match\] \[data-detail\]/);
  assert.match(html, /svg\[data-intent-trace-active\] \[data-intent-trace-match\] \[data-detail\]/);
  assert.match(html, /svg\[data-route-active\] \[data-route-match\] \[data-detail\]/);
  assert.match(html, /svg\[data-story-active\] \[data-story-step\] \[data-detail\]/);
  assert.match(html, /svg\[data-relationship-preview-active\] \[data-relationship-preview\] \[data-detail\]/);
});

test('semantic zoom is motion-safe and full-fidelity in print and export', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /\[data-detail\] \{ transition: opacity 160ms ease/);
  assert.match(html, /@media print \{[\s\S]+\.diagram-container svg \[data-detail\] \{[\s\S]+opacity: 1 !important/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+svg \[data-detail\]/);
  assert.match(html, /clone\.querySelectorAll\('\[data-detail\], \[data-detail-anchor\]'\)/);
  assert.match(html, /el\.removeAttribute\('data-detail'\)/);
  assert.match(html, /el\.removeAttribute\('data-detail-anchor'\)/);
  assert.match(html, /clone\.querySelectorAll\('[^']*\[data-detail\][^']*\[data-detail-anchor\][^']*'\)\.length === 0/);
  assert.doesNotMatch(svg(html), /data-detail-level=/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
