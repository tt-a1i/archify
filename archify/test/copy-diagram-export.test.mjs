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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-copy-diagram-'));

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

function shareSection(html) {
  return html.match(/<div class="export-menu-section" role="group" aria-label="Share">[\s\S]*?<\/div>/)?.[0] || '';
}

test('all five renderers expose only Copy diagram in the Share section', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    const section = shareSection(html);
    assert.ok(section, `${mode}: missing Share section`);
    assert.equal((section.match(/role="menuitem"/g) || []).length, 1, mode);
    assert.match(section, /data-action="copy"[\s\S]*?<strong>Copy diagram<\/strong>/, mode);
    assert.match(section, /PNG to clipboard/, mode);
  }
});

test('Copy diagram uses the complete high-resolution PNG raster path', () => {
  const html = render('architecture');
  assert.match(html, /function runCopy\(\)[\s\S]*?var blobPromise = rasterize\('png'\);/);
  assert.match(html, /runCopy\(\)[\s\S]*?writePngToClipboard\(blobPromise\)/);
  assert.match(html, /new ClipboardItem\(\{ 'image\/png': blobPromise \}\)/);
  assert.match(html, /copyDiagram: runCopy/);
  assert.match(html, /var scale = pickSafeScale\(vb\.width, vb\.height\);/);
  assert.match(html, /var data = serializeSvg\(scale\);/);
  assert.match(html, /ctx\.drawImage\(img, 0, 0\);/);
  assert.match(html, /var SUPPORTED_EXPORT_FORMATS = \{ svg: true, png: true, jpeg: true, webp: true, webm: true \};/);
  assert.match(html, /function runExport\(format\) \{\s*clearExportReceipt\(\);\s*if \(!Object\.prototype\.hasOwnProperty\.call\(SUPPORTED_EXPORT_FORMATS, format\)\)[\s\S]*?Promise\.reject/);
});

test('retired Share Card UI, implementation, API, and receipt state are absent', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    for (const retired of [
      /share-card/i,
      /Share Card/,
      /rasterizeShareCard/,
      /renderShareCard/,
      /copyShareCard/,
      /downloadRouteShareCard/,
      /downloadReachShareCard/,
      /syncReachShare/,
      /syncRouteShare/,
      /reachabilitySnapshot/,
      /exportSnapshot/,
      /data-last-export-variant/,
      /data-last-export-route-state-clean/,
      /data-last-export-reach-state-clean/,
    ]) assert.doesNotMatch(html, retired, `${mode}: ${retired}`);
  }
});

test('current product documentation describes Copy diagram without Share Card promises', () => {
  for (const file of [
    'README.md',
    'README_EN.md',
    'README_ZH.md',
    'PRODUCT.md',
    'DESIGN.md',
    'archify/SKILL.md',
    'archify/references/viewer-runtime.md',
    'archify/references/delivery-contract.md',
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(text, /Share Card|分享卡片/, file);
  }
  assert.match(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'), /Copy diagram/);
  assert.match(fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8'), /复制图表/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
