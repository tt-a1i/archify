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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-director-strip-'));

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

test('all five renderers inherit one viewer-only Story Director Strip', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="guided-story-caption" hidden aria-live="polite" aria-atomic="true"/, mode);
    assert.match(html, /function renderStoryCaption\(step, total, nextStep\)/, mode);
    assert.match(html, /storyCaptionRoute\.textContent = storyCaptionRouteCopy\(step\)/, mode);
    assert.match(html, /storyCaptionDetail\.textContent = storyCaptionDetailCopy\(step\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /guided-story-caption|data-story-caption/, mode);
  }
});

test('captions derive only authored edge labels and existing node facts', () => {
  assert.match(template, /edgeLabels: edges\.map\(function \(edge\) \{ return edge\.getAttribute\('data-edge-label'\) \|\| ''; \}\)/);
  assert.match(template, /responsibility: node \? \(node\.getAttribute\('data-node-sublabel'\) \|\| ''\) : ''/);
  assert.match(template, /context: node \? \(node\.getAttribute\('data-node-context'\) \|\| ''\) : ''/);
  assert.match(template, /step\.edgeLabels\.slice\(0, 3\)\.join\(' \+ '\)/);
  assert.match(template, /Grouped transition · no direct authored link/);
  assert.match(template, /if \(!facts\.length\) facts\.push\('Authored starting point'\)/);
  assert.match(template, /authored direction: ' \+ step\.nodeLabel \+ ' → ' \+ step\.previousLabel/);
  assert.doesNotMatch(template, /inferred relationship|likely transition|calls service/);
});

test('route copy preserves start, forward, reverse, multiple, and grouped semantics', () => {
  assert.match(template, /step\.relation === 'start'\) return step\.nodeLabel \+ ' · Starting point'/);
  assert.match(template, /step\.relation === 'reverse'\) return step\.previousLabel \+ ' ← ' \+ step\.nodeLabel/);
  assert.match(template, /step\.relation === 'multiple'\) return step\.previousLabel \+ ' ⇄ ' \+ step\.nodeLabel/);
  assert.match(template, /step\.relation === 'group'\) return step\.previousLabel \+ ' · ' \+ step\.nodeLabel/);
  assert.match(template, /return step\.previousLabel \+ ' → ' \+ step\.nodeLabel/);
});

test('playback announcements and motion remain reader-controlled', () => {
  assert.match(template, /storyCaption\.setAttribute\('aria-live', playing \? 'off' : 'polite'\)/);
  assert.match(template, /html\[data-motion="still"\] \.guided-story-caption/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\) \{\s*\.guided-story-caption \{ animation: none !important; \}/);
  assert.match(template, /animation: archify-story-caption-in 140ms/);
});

test('Presentation playback removes secondary chrome without hiding Pause or navigation', () => {
  assert.match(template, /\.guided-views\[data-story-beat\] \.guided-view-copy > #guided-view-label/);
  assert.match(template, /@media \(min-width: 721px\)[\s\S]*\.guided-views\[data-playing="true"\] \.guided-view-index/);
  assert.match(template, /\.guided-views\[data-playing="true"\] \.guided-view-beat-link/);
  assert.match(template, /\.guided-views\[data-playing="true"\] \.guided-view-all/);
  const presentationRule = template.match(/@media \(min-width: 721px\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.doesNotMatch(presentationRule, /guided-view-play/);
  assert.doesNotMatch(presentationRule, /guided-view-prev|guided-view-next/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-views > #guided-view-prev,[\s\S]*height: 2\.75rem/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-view-play,[\s\S]*\.guided-view-beat-link \{ min-height: 2\.75rem; \}/);
});

test('embed, print, and canonical export boundaries stay clean', () => {
  assert.match(template, /html\[data-embed="true"\] \.guided-views \{ display: none !important; \}/);
  assert.match(template, /@media print[\s\S]*\.guided-views/);
  assert.doesNotMatch(canonicalSvg(render('workflow', CASES.workflow)), /Story Director|guided-story-caption|data-story-caption/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
