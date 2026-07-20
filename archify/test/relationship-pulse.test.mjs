import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-pulse-'));

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

test('all typed renderers inherit one exact-edge Directional Flow Pulse', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /function renderRelationshipPulse\(key\)/, mode);
    assert.match(html, /function relationshipTokenKind\(edge\)/, mode);
    assert.match(html, /function relationshipTokenGeometry\(shape, kind, key, options\)/, mode);
    assert.match(html, /data-relationship-pulse-overlay/, mode);
    assert.match(html, /setAttribute\('class', 'relationship-flow-pulse'\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /relationship-flow-(?:pulse|token)|data-relationship-(?:pulse|token)/, mode);
  }
});

test('pulse clones only the previewed authored geometry and keeps source-to-target direction', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /edge\.getAttribute\('data-edge-key'\) === key/);
  assert.match(html, /function relationshipEdgeShapes\(edge\)/);
  assert.match(html, /shape\.cloneNode\(false\)/);
  assert.match(html, /clone\.removeAttribute\('marker-end'\)/);
  assert.match(html, /clone\.removeAttribute\('data-edge-key'\)/);
  assert.match(html, /clone\.removeAttribute\('filter'\)/);
  assert.match(html, /clone\.setAttribute\('pathLength', '1'\)/);
  assert.match(html, /overlay\.setAttribute\('data-relationship-pulse-key', key\)/);
  assert.match(html, /function relationshipTokenPath\(shape\)/);
  assert.match(html, /tagName === 'path'.+shape\.getAttribute\('d'\)/s);
  assert.match(html, /tagName === 'line'/);
  assert.match(html, /tagName === 'polyline' && shape\.points/);
  assert.match(html, /motion\.setAttribute\('path', pathData\)/);
  assert.match(html, /motion\.setAttribute\('rotate', 'auto'\)/);
  assert.match(html, /svg\.insertBefore\(overlay, firstNode\)/);
  assert.match(html, /stroke-dashoffset: -1/);
});

test('semantic token classification is evidence-based and fail-closed', () => {
  const html = render('lifecycle', CASES.lifecycle);
  assert.match(html, /a-security.+sourceKind === 'security'.+targetKind === 'failure'.+return 'security'/s);
  assert.match(html, /a-dashed.+sourceKind === 'messagebus'.+targetKind === 'messagebus'.+return 'event'/s);
  assert.match(html, /sourceKind === 'database' \|\| targetKind === 'database'.+return 'data'/s);
  assert.match(html, /targetKind === 'waiting' \|\| targetKind === 'success'.+return 'state'/s);
  assert.match(html, /return 'call';/);
  assert.doesNotMatch(html, /relationshipTokenKind[\s\S]{0,1800}data-edge-label/);
});

test('semantic tokens use five distinct inline SVG cues on one finite timing owner', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /data-token-kind', kind/);
  assert.match(html, /kind === 'data'[\s\S]+kind === 'event'[\s\S]+kind === 'security'[\s\S]+kind === 'state'/);
  assert.match(html, /document\.createElementNS\(svgNamespace, 'animateMotion'\)/);
  assert.match(html, /motion\.setAttribute\('dur', options\.duration \|\| '1\.2s'\)/);
  assert.match(html, /animation: archify-relationship-token-life 1\.2s linear 1 both/);
  assert.match(html, /semantic-flow-token-halo/);
  assert.match(html, /Archify\.flowTokens = \{/);
  assert.match(html, /data-relationship-token-kind', tokenKind/);
  assert.match(html, /var tokenAdded = false/);
  assert.doesNotMatch(html, /relationship-flow-token[^}]+infinite/);
});

test('pulse is finite, event-owned, preset-aware, touch-safe, and motion-safe', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /animation: archify-relationship-pulse 1\.2s linear 1 both/);
  assert.match(html, /@keyframes archify-relationship-token-life/);
  assert.doesNotMatch(html, /relationship-flow-pulse[^}]+infinite/);
  assert.match(html, /var activeRelationshipPreview = null/);
  assert.match(html, /if \(next === activeRelationshipPreview\) return/);
  assert.match(html, /event\.pointerType === 'touch'/);
  assert.match(html, /finePointerQuery && !finePointerQuery\.matches/);
  assert.match(html, /Archify\.motionGovernor && Archify\.motionGovernor\.isPaused\(\)/);
  assert.match(html, /document\.hidden/);
  assert.match(html, /addEventListener\('animationcancel', finishPulse/);
  assert.match(html, /reducedMotionQuery\.addEventListener\('change', syncRelationshipMotionPreference\)/);
  assert.match(html, /if \(event\.matches\) removeRelationshipPulse\(\)/);
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /html\[data-embed="true"\] \.relationship-pulse-overlay/);
  assert.match(html, /svg\[data-preset="signal-flow"\] \.relationship-flow-pulse/);
  assert.match(html, /svg\[data-preset="blueprint"\] \.relationship-flow-pulse/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]+\.relationship-pulse-overlay \{ display: none !important; \}/);
});

test('pulse has one owner and never enters print or canonical exports', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /function removeRelationshipPulse\(\)/);
  assert.match(html, /svg\.querySelectorAll\('\[data-relationship-pulse-overlay\]'\)/);
  assert.match(html, /@media print \{[\s\S]+\.relationship-pulse-overlay \{ display: none !important; \}/);
  assert.match(html, /clone\.querySelectorAll\('\[data-relationship-pulse-overlay\]'\)/);
  assert.match(html, /\[data-relationship-pulse-overlay\],[^']*\[data-relationship-preview\]/);
  assert.doesNotMatch(canonicalSvg(html), /relationship-flow-(?:pulse|token)|data-relationship-(?:pulse|token)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
