import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-subarchitecture-viewer-'));
const output = path.join(scratch, 'transformer.html');

function renderFixture() {
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'architecture', 'render-architecture.mjs'),
    path.join(skillRoot, 'test', 'fixtures', 'transformer-subarchitecture.architecture.json'),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

test('parent Semantic Passport is the only opt-in internals entry and the drawer stays external', () => {
  const html = renderFixture();
  assert.match(html, /id="btn-focus-internals"[^>]+aria-expanded="false"[^>]+aria-controls="subarchitecture-drawer"[^>]+hidden/);
  assert.match(html, /id="subarchitecture-drawer"[^>]+hidden[^>]+role="region"[^>]+aria-labelledby="subarchitecture-title"/);
  assert.match(html, /id="subarchitecture-mount"/);
  assert.match(html, /id="subarchitecture-passport"/);
  assert.ok(
    html.indexOf('</div>\n\n    <template data-subarchitecture-parent=') <
      html.indexOf('id="subarchitecture-drawer"'),
    'the inert child template and drawer remain outside the canonical diagram container',
  );
  assert.match(html, /html\[data-embed="true"\] \.subarchitecture-drawer/);
  assert.doesNotMatch(html, /subarchitecture-disclosures|data-subarchitecture-disclosure/);
  assert.match(html, /\.subarchitecture-drawer-content\s*\{[\s\S]*grid-template-columns:/);
  assert.match(html, /@media \(max-width: 720px\)[\s\S]*\.subarchitecture-drawer-content\s*\{[\s\S]*grid-template-columns: 1fr/);
});

test('local controller mounts one precompiled SVG and supports bounded open and collapse', () => {
  const html = renderFixture();
  assert.match(html, /Archify\.subarchitecture = \(function \(\) \{/);
  assert.match(html, /function inspectSubarchitectureTemplate\(parentId\)/);
  assert.match(html, /if \(matches\.length !== 1\) return null/);
  assert.match(html, /roots\.length !== 1/);
  assert.match(html, /if \(!nodeId \|\| nodeIds\[nodeId\]\) return null/);
  assert.match(html, /if \(!from \|\| !to \|\| !nodeIds\[from\] \|\| !nodeIds\[to\]\) return null/);
  assert.match(html, /inspected\.svg\.cloneNode\(true\)/);
  assert.match(html, /mount\.replaceChildren\(nextSvg\)/);
  assert.match(html, /trigger\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(html, /function open\(parentId, options\)/);
  assert.match(html, /function close\(options\)/);
  assert.match(html, /function destroy\(\)/);
  assert.match(html, /record\.target\.removeEventListener/);
  assert.match(html, /function escape\(\)/);
  assert.match(html, /if \(activeChildId\) \{[\s\S]*clearLocalFocus/);
  assert.match(html, /drawer\.hidden = true/);
  assert.doesNotMatch(html, /buildDisclosures|positionDisclosures|scheduleDisclosurePosition/);
});

test('local nodes own one-hop focus, Passport facts, exact local relationships, and links', () => {
  const html = renderFixture();
  assert.match(html, /mountedSvg\.querySelectorAll\('\[data-node-id\]'\)/);
  assert.match(html, /mountedSvg\.querySelectorAll\('\[data-edge-from\]\[data-edge-to\]'\)/);
  assert.match(html, /edge\.setAttribute\('data-focus-match', ''\)/);
  assert.match(html, /node\.setAttribute\('data-focus-selected', ''\)/);
  assert.match(html, /function renderLocalPassport\(id, node\)/);
  assert.match(html, /data-local-passport="kind"/);
  assert.match(html, /data-local-passport="context"/);
  assert.match(html, /data-local-passport="tag"/);
  assert.match(html, /data-local-passport="brand"/);
  assert.match(html, /data-local-passport="id"/);
  assert.match(html, /direction = from === id && to === id \? 'loop' : \(from === id \? 'out' : 'in'\)/);
  assert.match(html, /viewer\.passport\.relationship\.group\.out/);
  assert.match(html, /viewer\.passport\.relationship\.group\.in/);
  assert.match(html, /viewer\.passport\.relationship\.group\.loop/);
  assert.match(html, /button\.className = 'relationship-lens-row';\s+button\.setAttribute\('data-direction', relationship\.direction\);\s+button\.setAttribute\('data-local-relationship-target'/);
  assert.match(html, /button\.setAttribute\('aria-label', viewerText\('viewer\.passport\.relationship\.row'/);
  assert.match(html, /direction\.className = 'relationship-lens-direction';\s+direction\.setAttribute\('aria-hidden', 'true'\);/);
  assert.match(html, /\.relationship-lens-row\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?font: inherit;[\s\S]*?cursor: pointer;/);
  assert.match(html, /\.subarchitecture-passport\s*\{[\s\S]*?border-color: var\(--frontend-stroke\);/);
  assert.match(html, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(html, /function subarchitectureHash\(parentId, childId\)/);
  assert.match(html, /subarchitectureHash\(activeParentId, activeChildId\)/);
  assert.match(html, /params\.getAll\('subgraph'\)/);
  assert.match(html, /params\.getAll\('subfocus'\)/);
  assert.match(html, /parents\.length !== 1 \|\| children\.length > 1/);
});

test('local nodes reuse the official Intent Trace motion and direction contract', () => {
  const html = renderFixture();
  assert.match(html, /id="subarchitecture-intent-trace-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /function showLocalIntentTrace\(id, options\)/);
  assert.match(html, /clone\.setAttribute\('class', 'intent-trace-flow'\)/);
  assert.match(html, /clone\.setAttribute\('data-direction', direction\)/);
  assert.match(html, /clone\.setAttribute\('pathLength', '1'\)/);
  assert.match(html, /direction = from === id && to === id \? 'loop' : \(from === id \? 'out' : 'in'\)/);
  assert.match(html, /mountedSvg\.setAttribute\('data-intent-trace-active', id\)/);
  assert.match(html, /scheduleLocalIntentTrace\(node\)/);
  assert.match(html, /reducedMotion\(\) \? 0 : 90/);
  assert.match(html, /event\.pointerType === 'touch'/);
  assert.match(html, /\.intent-trace-flow\s*\{[\s\S]*animation: archify-intent-trace-flow 1\.15s linear 1 both;/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.intent-trace-flow[\s\S]*animation: none !important;/);
});

test('export target stays additive and serializes only the selected graph', () => {
  const html = renderFixture();
  assert.match(html, /id="export-target-selector"[^>]+role="group"[^>]+hidden/);
  assert.match(html, /data-export-target="main"[^>]+role="menuitemradio"[^>]+aria-checked="true"/);
  assert.match(html, /data-export-target="subarchitecture"[^>]+role="menuitemradio"[^>]+aria-checked="false"/);
  assert.match(html, /function subarchitectureExportDescriptor\(\)/);
  assert.match(html, /mount\.children\.length !== 1/);
  assert.match(html, /roots\.length !== 1 \|\| !roots\[0\]\.isConnected/);
  assert.match(html, /target: 'subarchitecture',[\s\S]*sourceSvg: roots\[0\]/);
  assert.match(html, /serializeSvg\(1, \{ autoTheme: true, sourceSvg: descriptor\.sourceSvg \}\)/);
  assert.match(html, /rasterize\(format, \{ sourceSvg: descriptor\.sourceSvg \}\)/);
  assert.match(html, /renderShareCard\(\{[\s\S]*sourceSvg: descriptor\.sourceSvg/);
  assert.match(html, /data-last-export-target/);
  assert.match(html, /syncTarget: syncExportTarget/);
  assert.match(html, /selectTarget: selectExportTarget/);
  assert.doesNotMatch(html, /combined-export-section/);
  assert.doesNotMatch(html, /data-combined-format/);
  assert.doesNotMatch(html, /runCombinedExport/);
  assert.match(html, /function canonicalDiagramSvg\(\)/);
  assert.match(html, /document\.querySelector\('\.diagram-container > svg'\)/);
  assert.doesNotMatch(html, /document\.querySelector\('\.diagram-container svg'\)/);
});

process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
