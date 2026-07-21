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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-moment-link-'));

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

test('all five renderers inherit one viewer-only Story Moment Link control', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const { result, html } = render(mode, example);
    assert.equal(result.status, 0, result.stderr);
    assert.match(html, /id="guided-view-beat-link"[^>]+aria-label="Select a Story Beat to copy its exact link"[^>]+disabled/);
    assert.match(html, /id="guided-view-beat-link-label">Copy moment<\/span>/);
    assert.doesNotMatch(canonicalSvg(html), /data-story-moment|guided-view-beat-link|#view=/);
  }
});

test('moment links use exact stable view and node ids without mutating manual selection URLs', () => {
  assert.match(template, /function storyMomentLink\(\)/);
  assert.match(template, /url\.searchParams\.delete\('play'\)/);
  assert.match(template, /url\.hash = 'view=' \+ encodeURIComponent\(view\.id\) \+ '&beat=' \+ encodeURIComponent\(step\.nodeId\)/);
  assert.match(template, /function selectStoryBeatById\(id, options\)/);
  assert.match(template, /storySteps\.findIndex\(function \(step\) \{ return step\.nodeId === id; \}\)/);
  assert.match(template, /var requestedBeat = params\.get\('beat'\)/);
  assert.match(template, /var restoreGeneration = \+\+momentRestoreGeneration/);
  assert.match(template, /afterHandoff\(function \(\) \{[\s\S]*restoreGeneration !== momentRestoreGeneration[\s\S]*selectStoryBeatById\(requestedBeat, \{ linked: true, follow: true, followInstant: true \}\)/);
  const manualSelection = template.match(/function selectStoryBeat\(index\) \{([\s\S]*?)\n      function updateUrl/)?.[1] || '';
  assert.doesNotMatch(manualSelection, /history\.|location\.|updateUrl\(/);
});

test('invalid or cross-chapter beat ids fail closed while the public receipt stays read-only', () => {
  assert.match(template, /if \(index < 0\) return false/);
  assert.doesNotMatch(template, /Number\(params\.get\('beat'\)\)/);
  assert.match(template, /setStoryBeat\(index, \{[\s\S]*?manual: false,[\s\S]*?center: true,[\s\S]*?pulse: false,[\s\S]*?follow: options\.follow === true,[\s\S]*?linked: options\.linked === true,[\s\S]*?followInstant: options\.followInstant === true/);
  assert.match(template, /beatLink: storyMomentLink/);
  assert.match(template, /copyBeatLink: copyStoryMomentLink/);
  assert.match(template, /beat: function \(\)[\s\S]*nodeId: step\.nodeId/);
});

test('copy feedback, one-shot playback, and reduced motion preserve the requested moment', () => {
  assert.match(template, /navigator\.clipboard && typeof navigator\.clipboard\.writeText === 'function'/);
  assert.match(template, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(template, /document\.execCommand\('copy'\)/);
  assert.match(template, /beatLinkLabel\.textContent = copied \? 'Copied' : 'Copy failed'/);
  assert.match(template, /Moment link copied/);
  assert.match(template, /function hashBeatMatchesCurrent\(\)/);
  assert.match(template, /if \(!storyAutomaticPlaybackAllowed\(\)\)[\s\S]*hashBeatMatchesCurrent\(\)[\s\S]*setAutoplayState\('reduced-motion'\)/);
  assert.match(template, /storyPlaybackScope = 'chapter'/);
  assert.match(template, /if \(storyBeatIndex < 0\)[\s\S]*setStoryBeat\(0, \{ pulse: true, follow: true \}\)/);
});

test('the control keeps stable desktop/mobile geometry and existing viewer boundaries', () => {
  assert.match(template, /\.guided-view-beat-link \{[\s\S]*min-height: 1\.5rem/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-view-actions \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-view-beat-link \{[\s\S]*min-height: 2\.75rem/);
  assert.match(template, /html\[data-embed="true"\][\s\S]*\.guided-views \{ display: none !important; \}/);
  assert.match(template, /html\[data-embed="true"\]\[data-share-moment="true"\] \.share-chapter-cue:not\(\[hidden\]\)/);
  assert.match(template, /pinnedMode = !shareMode && embedMode && hashBeatMatchesCurrent\(\)/);
  assert.match(template, /pinned: 'Pinned'/);
  assert.match(template, /@media print[\s\S]*\.guided-views/);
  assert.match(template, /syncStoryControlsDisabled\(\)[\s\S]*beatLink\.disabled =/);
  assert.match(template, /clone\.querySelectorAll\('\[data-story-overlay\], \[data-story-carrier-overlay\]'\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
