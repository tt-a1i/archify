import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-direct-explorer-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ], { encoding: 'utf8' });
  return { result, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all five renderers inherit one viewer-only Direct Relationship Explorer', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const { result, html } = render(mode, example);
    assert.equal(result.status, 0, result.stderr);
    assert.match(html, /function installRelationshipHitTargets\(\)/, mode);
    assert.match(html, /data-relationship-hit-overlay/, mode);
    assert.match(html, /className \|\| 'relationship-hit-rail'/, mode);
    assert.doesNotMatch(canonicalSvg(html), /relationship-hit-(?:overlay|target|rail)|data-relationship-direct-active/, mode);
  }
});

test('one roving target represents each exact stable edge key and authored direction', () => {
  assert.match(template, /function relationshipHitRecords\(\)/);
  assert.match(template, /var recordsByKey = \{\}/);
  assert.match(template, /existing\.invalid = true/);
  assert.match(template, /filter\(function \(record\) \{ return !record\.invalid/);
  assert.match(template, /data-relationship-key/);
  assert.match(template, /data-relationship-from/);
  assert.match(template, /data-relationship-to/);
  assert.match(template, /target\.setAttribute\('role', 'button'\)/);
  assert.match(template, /relationshipHitOverlay\.setAttribute\('role', 'group'\)/);
  assert.match(template, /target\.setAttribute\('aria-describedby', relationshipHelp\.id\)/);
  assert.match(template, /target\.setAttribute\('tabindex', index === 0 \? '0' : '-1'\)/);
  assert.match(template, /Inspect relationship .* of .*: .* to /);
  assert.match(template, /relationshipEdgeShapes\(edge\)/);
  assert.match(template, /shape\.cloneNode\(false\)/);
  assert.match(template, /\.relationship-hit-rail \{[\s\S]*stroke: transparent;[\s\S]*stroke-width: 24/);
});

test('fine-pointer and keyboard intent preview the exact edge before activation', () => {
  assert.match(template, /function directRelationshipBlocked\(\)/);
  assert.match(template, /function scheduleDirectRelationshipPreview\(target\)/);
  assert.match(template, /if \(pinnedRelationshipKey \|\| hoveredRelationship !== target/);
  assert.match(template, /previewRelationship\(target, \{ direct: true \}\)/);
  assert.match(template, /event\.pointerType === 'touch'/);
  assert.match(template, /finePointerQuery && !finePointerQuery\.matches/);
  assert.match(template, /addEventListener\('pointerover'/);
  assert.match(template, /addEventListener\('pointerout'/);
  assert.match(template, /addEventListener\('focusin'/);
  assert.match(template, /addEventListener\('focusout'/);
  assert.match(template, /data-relationship-direct-active/);
  assert.match(template, /\.relationship-hit-target:focus-visible \.relationship-focus-rail/);
});

test('activation opens the existing source passport and pins its exact relationship row', () => {
  assert.match(template, /function inspectRelationship\(key, options\)/);
  assert.match(template, /if \(directPreviewTimer\) window\.clearTimeout\(directPreviewTimer\)/);
  assert.match(template, /if \(pinnedRelationshipKey === key\)/);
  assert.match(template, /set\(record\.from, \{ toggle: false, updateUrl: false \}\)/);
  assert.match(template, /relationshipList\.querySelectorAll\('\[data-relationship-key\]'\)/);
  assert.match(template, /pinnedRelationship = row/);
  assert.match(template, /pinnedRelationshipKey = key/);
  assert.match(template, /data-relationship-pin-active/);
  assert.match(template, /function clearRelationshipPreview\(options\)/);
  assert.match(template, /clearRelationshipPreview\(\{ clearPin: true \}\)/);
  assert.match(template, /copyBtn\.textContent = 'Copy node'/);
  assert.match(template, /previewRelationship\(row\)/);
  assert.match(template, /inspectRelationship: inspectRelationship/);
  assert.match(template, /event\.key !== 'ArrowRight'/);
  assert.match(template, /event\.key !== 'ArrowLeft'/);
  assert.match(template, /event\.key !== 'Home'/);
  assert.match(template, /event\.key !== 'End'/);
  assert.match(template, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('direct relationship targets support one-tap touch, yield to stronger states, and stay export-clean', () => {
  assert.match(template, /html\.getAttribute\('data-embed'\) === 'true'/);
  assert.match(template, /svg\.hasAttribute\('data-story-active'\)/);
  assert.match(template, /svg\.hasAttribute\('data-route-active'\)/);
  assert.match(template, /svg\.hasAttribute\('data-lens-active'\)/);
  assert.match(template, /event\.target\.closest\('\[data-relationship-hit-key\]'\)/);
  assert.match(template, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.relationship-hit-rail \{ stroke-width: 24/);
  assert.match(template, /@media print \{[\s\S]*\.relationship-hit-overlay/);
  assert.match(template, /clone\.removeAttribute\('data-relationship-direct-active'\)/);
  assert.match(template, /clone\.removeAttribute\('data-relationship-pin-active'\)/);
  assert.match(template, /clone\.querySelectorAll\('\[data-relationship-hit-overlay\]'\)/);
  assert.match(template, /\[data-relationship-hit-overlay\][^']*\[data-relationship-pulse-overlay\]/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
