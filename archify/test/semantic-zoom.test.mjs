import { viewerContractSource } from './helpers/viewer-contract-source.mjs';
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
  return viewerContractSource(fs.readFileSync(output, 'utf8'));
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers preserve authored context hooks without hiding primary text', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example), diagram = svg(html);
    assert.match(diagram, /data-detail="context"/, mode);
    assert.match(diagram, /data-detail-anchor/, mode);
    assert.doesNotMatch(diagram, /<text[^>]*data-detail="(?:context|fine)"[^>]*class="t-primary"/, mode);
    assert.match(diagram, /data-node-id=/, mode);
    if (mode === 'architecture') assert.match(diagram, /data-detail="fine"/);
  }
});

test('camera help no longer promises labels only after zooming', () => {
  const html = render('workflow', CASES.workflow);
  assert.doesNotMatch(html, /Zoom in to reveal relationship labels and node context/);
  assert.doesNotMatch(html, /Zoom in again to reveal tags and annotations/);
  assert.match(html, /Full diagram detail/);
});

test('no reading-depth CSS hides authored labels or displaces their anchors', () => {
  const html = render('architecture', CASES.architecture);
  // Browser coverage checks effective styles and ancestors at real camera scales.
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  assert.doesNotMatch(styles, /\[data-detail-level="(?:map|read)"\][^{]*\[data-detail(?:=|\])/);
  assert.doesNotMatch(styles, /\[data-detail-level="map"\][^{]*\[data-detail-anchor\]/);
});

test('semantic zoom is motion-safe and full-fidelity in print and export', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /@media print \{[\s\S]+\.diagram-container svg \[data-detail\] \{[\s\S]+opacity: 1 !important/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+svg \[data-detail\]/);
  assert.match(html, /clone\.querySelectorAll\('\[data-detail\], \[data-detail-anchor\]'\)/);
  assert.match(html, /el\.removeAttribute\('data-detail'\)/);
  assert.match(html, /el\.removeAttribute\('data-detail-anchor'\)/);
  assert.match(html, /clone\.querySelectorAll\('[^']*\[data-detail\][^']*\[data-detail-anchor\][^']*'\)\.length === 0/);
  assert.doesNotMatch(svg(html), /data-detail-level=/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
