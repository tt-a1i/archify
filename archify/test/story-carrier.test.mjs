import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-carrier-'));

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

test('all five renderers inherit one viewer-only Semantic Story Carrier', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /Archify\.flowTokens = \{/, mode);
    assert.match(html, /className: 'story-flow-token'/, mode);
    assert.match(html, /data-story-carrier-token/, mode);
    assert.match(html, /animation: archify-relationship-token-life 0\.78s linear 1 both/, mode);
    assert.doesNotMatch(canonicalSvg(html), /story-flow-token|story-carrier-token|semantic-flow-token/, mode);
  }
});

test('Story deduplicates SVG path and label fragments by stable authored edge key', () => {
  assert.match(template, /function uniqueStoryEdges\(edgeList\)/);
  assert.match(template, /var key = storyEdgeKey\(edge\)/);
  assert.match(template, /Object\.prototype\.hasOwnProperty\.call\(positions, key\)/);
  assert.match(template, /!storyGeometry\(unique\[index\]\)\.length && storyGeometry\(edge\)\.length/);
  assert.match(template, /forward = uniqueStoryEdges\(forward\)/);
  assert.match(template, /reverse = uniqueStoryEdges\(reverse\)/);
  assert.match(template, /edges\.length === 1 && forward\.length === 1 \? 'forward'/);
});

test('Story reuses the exact semantic token vocabulary on its existing finite edge pulse', () => {
  assert.match(template, /function createSemanticFlowToken\(edge, shape, options\)/);
  assert.match(template, /relationshipTokenGeometry\(shape, relationshipTokenKind\(edge\), key, options\)/);
  assert.match(template, /Archify\.flowTokens\.create\(edge, shapes\[0\], \{/);
  assert.match(template, /className: 'story-flow-token'/);
  assert.match(template, /duration: '0\.78s'/);
  assert.match(template, /carrier\.setAttribute\('data-story-beat-step', String\(step\.index\)\)/);
  assert.match(template, /carrierOverlay\.setAttribute\('data-story-carrier-overlay', ''\)/);
  assert.match(template, /carrierWrapper\.appendChild\(carrier\)/);
  assert.match(template, /svg\.insertBefore\(carrierOverlay, firstNode\)/);
  assert.match(template, /semantic-flow-token-halo/);
  assert.doesNotMatch(template, /story-flow-token[^}]+infinite/);
});

test('only explicit play=1 embeds may show the finite carrier', () => {
  assert.match(template, /data-embed'\) === 'true' &&\s*document\.documentElement\.getAttribute\('data-share-playback'\) !== 'true'/);
  assert.match(template, /autoplayPending = sharePlaybackRequested\(\)/);
  assert.match(template, /document\.documentElement\.setAttribute\('data-share-playback', 'true'\)/);
  assert.match(template, /html\[data-motion="still"\] \.story-carrier-overlay/);
  assert.match(template, /html\[data-document-hidden="true"\] \.story-carrier-overlay/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\)[\s\S]+\.story-carrier-overlay \{ display: none !important; \}/);
});

test('Story Carrier cleanup and export remain owned by Story Trail', () => {
  assert.match(template, /svg\.querySelectorAll\('\[data-story-carrier-overlay\]'\)/);
  assert.match(template, /overlay\.remove\(\)/);
  assert.match(template, /var pulseGeneration = storyPulseGeneration/);
  assert.match(template, /if \(pulseGeneration === storyPulseGeneration\) clearStoryPulse\(\)/);
  assert.equal((template.match(/storyPulseOwnerToken = Archify\.motionGovernor\.claim\('story'/g) || []).length, 1);
  assert.match(template, /clone\.querySelectorAll\('\[data-story-overlay\], \[data-story-carrier-overlay\]'\)/);
  assert.match(template, /@media print \{[\s\S]+\.story-trail-overlay,[\s\S]+\.story-carrier-overlay \{ display: none !important; \}/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
