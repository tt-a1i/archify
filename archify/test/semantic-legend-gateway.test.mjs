import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-legend-'));

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

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function values(svg, attribute) {
  const pattern = new RegExp(`${attribute}="([^"]+)"`, 'g');
  return [...svg.matchAll(pattern)].map((match) => match[1]);
}

test('only legends with an exact node-kind meaning publish bridge entries', () => {
  const architecture = canonicalSvg(render('architecture'));
  const architectureKinds = [...new Set(values(architecture, 'data-node-kind'))];
  assert.deepEqual(values(architecture, 'data-legend-kind'), architectureKinds);
  assert.equal((architecture.match(/data-legend-bridge(?:\s|>)/g) || []).length, 1);

  const workflow = canonicalSvg(render('workflow'));
  assert.deepEqual(values(workflow, 'data-legend-kind'), [
    'frontend', 'backend', 'security', 'messagebus', 'database',
  ]);

  const lifecycle = canonicalSvg(render('lifecycle'));
  assert.deepEqual(values(lifecycle, 'data-legend-kind'), [
    'active', 'waiting', 'success', 'failure',
  ]);

  for (const mode of ['sequence', 'dataflow']) {
    const svg = canonicalSvg(render(mode));
    assert.doesNotMatch(svg, /data-legend-bridge|data-legend-kind/, mode);
    assert.match(svg, />Legend</, mode);
  }
});

test('runtime decoration derives counts from compiled node facts and stays viewer-only', () => {
  const html = render('architecture');
  const svg = canonicalSvg(html);
  assert.match(html, /collectKinds\(\)\.forEach\(function \(kind\) \{ facts\[kind\.id\] = kind; \}\)/);
  assert.match(html, /var count = fact \? fact\.nodes\.length : 0/);
  assert.match(html, /data-legend-bridge-runtime/);
  assert.match(html, /data-legend-count-badge/);
  assert.match(html, /entry\.setAttribute\('role', 'button'\)/);
  assert.match(html, /legendBridge\.setAttribute\('role', legendEntries\.length >= 3 \? 'toolbar' : 'group'\)/);
  assert.match(html, /entry\.setAttribute\('aria-label', 'Inspect ' \+ fact\.label/);
  assert.match(html, /if \(!legendBridge \|\| html\.getAttribute\('data-embed'\) === 'true'\) return false/);
  assert.doesNotMatch(svg, /data-legend-bridge-runtime|data-legend-count=|role="toolbar"/);
  assert.doesNotMatch(svg, /data-legend-kind="[^"]+"[^>]+(?:role=|aria-pressed=)/);
});

test('preview is soft, input-aware, and yields to stronger exploration owners', () => {
  const html = render('workflow');
  const preview = html.slice(
    html.indexOf('function previewLegendKind'),
    html.indexOf('function syncLegendPreview'),
  );
  assert.match(html, /window\.matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(html, /event\.pointerType === 'touch' \|\| \(finePointerQuery && !finePointerQuery\.matches\)/);
  assert.match(html, /legendBridge\.addEventListener\('focusin'/);
  assert.match(html, /legendBridge\.addEventListener\('focusout'/);
  assert.match(preview, /data-legend-preview-match/);
  assert.match(preview, /data-legend-preview-peer/);
  assert.doesNotMatch(preview, /renderFlowOverlay|data-semantic-lens-overlay/);
  assert.match(html, /selectedKinds\.length > 0 \|\| !panel\.hidden \|\| html\.getAttribute\('data-present'\) === 'true'/);
  assert.match(html, /data-focus-active.*data-intent-trace-active/s);
  assert.match(html, /data-route-picking.*data-story-active.*data-relationship-preview-active/s);
  assert.match(html, /svg\[data-legend-preview-active\] \[data-node-id\]/);
});

test('activation delegates to Semantic Lens and supports roving keyboard navigation', () => {
  const html = render('lifecycle');
  const activation = html.slice(
    html.indexOf('function activateLegendEntry'),
    html.indexOf('function removeFlowOverlay'),
  );
  assert.match(activation, /select\(entry\.getAttribute\('data-legend-kind'\)\)/);
  assert.match(activation, /open\(\{ opener: entry \}\)/);
  assert.match(html, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(html, /event\.key === 'ArrowRight'/);
  assert.match(html, /event\.key === 'ArrowLeft'/);
  assert.match(html, /event\.key === 'Home'/);
  assert.match(html, /event\.key === 'End'/);
  assert.match(html, /lensOpener\.focus\(\)/);
  assert.match(html, /entry\.setAttribute\('aria-pressed', selected \? 'true' : 'false'\)/);
});

test('bridge state is print-safe, reduced-motion-safe, and absent from canonical export', () => {
  const html = render('architecture');
  assert.match(html, /\[data-legend-bridge-runtime\] \{ display: none !important; \}/);
  assert.match(html, /html:not\(\[data-embed="true"\]\) \.diagram-container \{\s*padding: 0\.75rem 0\.75rem 4\.25rem;/);
  assert.match(html, /data-legend-hit[^}]*transition/s);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*\[data-legend-hit\]/);
  assert.match(html, /clone\.removeAttribute\('data-legend-preview-active'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-legend-bridge-runtime\]'\)/);
  assert.match(html, /el\.removeAttribute\('data-legend-kind'\)/);
  assert.match(html, /el\.removeAttribute\('data-legend-bridge'\)/);
  assert.match(html, /\[data-legend-preview-match\], \[data-legend-preview-selected\], \[data-legend-preview-peer\]/);
  assert.match(html, /\[data-legend-bridge\], \[data-legend-kind\], \[data-legend-bridge-runtime\]/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
