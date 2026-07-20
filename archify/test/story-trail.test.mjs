import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-trail-'));

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

for (const [mode, example] of Object.entries(CASES)) {
  test(`${mode}: guided paths expose a viewer-only Story Trail`, () => {
    const { result, html } = render(mode, example);
    assert.equal(result.status, 0, result.stderr);
    assert.match(html, /id="guided-view-trail" hidden role="group" aria-label="Story trail"/);
    assert.match(html, /function renderStoryTrail\(view\)/);
    assert.match(html, /document\.createElement\('button'\)/);
    assert.match(html, /stop\.type = 'button'/);
    assert.match(html, /data-story-node/);
    assert.match(html, /data-story-link/);
    assert.match(html, /edges\.length === 1 && forward\.length === 1 \? 'forward'/);
    assert.match(html, /data-story-overlay/);
    assert.match(html, /data-story-playing/);
    assert.match(html, /data-story-beat/);
    assert.match(html, /data-story-beat-state/);
    assert.match(html, /data-story-beat-step/);
    assert.match(html, /storySteps\.forEach\(function \(step\)/);
    assert.match(html, /step\.edges\.forEach\(function \(edge\)/);
    assert.match(html, /edge\.setAttribute\('data-story-beat-step', String\(edgeBeat\)\)/);
    assert.match(html, /svg\[data-story-beat\] \[data-edge-from\]\[data-story-beat-step\]/);
    assert.match(html, /story-trail-flow/);
    assert.match(html, /function scheduleStoryPlayback\(\)/);
    assert.match(html, /storyBeatTimer = setTimeout/);
    assert.match(html, /storyBeatDwellMs = storyBeatDwell\(total\)/);
    assert.match(html, /Math\.max\(STORY_FOLLOW_MIN_DWELL_MS, VIEW_INTERVAL_MS \/ Math\.max\(1, total\)\)/);
    assert.match(html, /function storyStep\(view, index, edgeList, byId\)/);
    assert.match(html, /prefers-reduced-motion: reduce/);
    assert.match(html, /from === previousId && to === id/);
    assert.match(html, /from === id && to === previousId/);
    assert.match(html, /firstEdge\.parentNode\.insertBefore\(overlay, firstEdge\)/);
    assert.doesNotMatch(html, /content: '\\2192';\s*font-size: 0\.65rem/);

    const generatedSvg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
    assert.doesNotMatch(generatedSvg, /data-story-(?:active|playing|beat|step|overlay|carrier)/);
  });
}

test('Story Trail state is removed from every export clone', () => {
  const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
  assert.match(template, /clone\.removeAttribute\('data-story-active'\)/);
  assert.match(template, /clone\.removeAttribute\('data-story-playing'\)/);
  assert.match(template, /clone\.removeAttribute\('data-story-beat'\)/);
  assert.match(template, /clone\.querySelectorAll\('\[data-story-overlay\], \[data-story-carrier-overlay\]'\)/);
  assert.match(template, /clone\.querySelectorAll\('\[data-story-step\], \[data-story-beat-state\], \[data-story-beat-step\]'\)/);
  assert.match(template, /el\.removeAttribute\('data-story-beat-state'\)/);
  assert.match(template, /el\.removeAttribute\('data-story-beat-step'\)/);
  assert.match(template, /el\.style\.removeProperty\('--story-step'\)/);
  assert.match(template, /canonicalStateClean[\s\S]*data-story-beat-state/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
