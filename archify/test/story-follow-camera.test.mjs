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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-follow-camera-'));

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

test('all five renderers inherit one viewer-only Story Follow Camera', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /function followStoryStep\(step, options\)/, mode);
    assert.match(html, /panel\.setAttribute\('data-story-follow', 'moving'\)/, mode);
    assert.match(html, /panel\.setAttribute\('data-story-follow-node', step\.nodeId\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /data-story-follow/, mode);
  }
});

test('Story Follow frames the exact previous, current, and next authored stops through the shared camera', () => {
  assert.match(template, /function storyFrameIds\(step\)/);
  assert.match(template, /step\.index > 0 && storySteps\[step\.index - 1\]/);
  assert.match(template, /ids\.push\(step\.nodeId\)/);
  assert.match(template, /step\.index \+ 1 < storySteps\.length/);
  assert.match(template, /var ids = storyFrameIds\(step\)/);
  assert.match(template, /Archify\.view\.reveal\(ids, \{/);
  assert.match(template, /reason: options\.manual === true \? 'story-beat' : 'story-follow'/);
  assert.match(template, /padding: 64/);
  assert.match(template, /maxScale: 1\.65/);
  assert.match(template, /duration: STORY_FOLLOW_DURATION_MS/);
  assert.match(template, /storyFollowGeneration/);
  assert.match(template, /generation !== storyFollowGeneration \|\| storyBeatIndex !== step\.index/);
});

test('playback and deliberate beat activation follow while stable moment restoration stays calm', () => {
  assert.match(template, /setStoryBeat\(0, \{ pulse: true, follow: true \}\)/);
  assert.match(template, /setStoryBeat\(storyBeatIndex \+ 1, \{ pulse: true, follow: true \}\)/);
  assert.match(template, /if \(storyBeatIndex >= 0\) followStoryStep\(storySteps\[storyBeatIndex\]\)/);
  assert.match(template, /setStoryBeat\(index, \{ manual: true, center: true, pulse: true, follow: true \}\)/);
  assert.match(template, /follow: options\.follow === true/);
  assert.match(template, /selectStoryBeatById\(requestedBeat, \{ linked: true, follow: true, followInstant: true \}\)/);
  assert.match(template, /if \(embed && !explicitEmbedPlayback && options\.linked !== true\) return false/);
  assert.match(template, /var deferredGeneration = \+\+storyFollowGeneration/);
  assert.match(template, /requestAnimationFrame\(function \(\) \{[\s\S]*?storyBeatIndex !== deferredIndex[\s\S]*?followStoryStep\(step, options\)/);
});

test('adaptive dwell, Still, reduced motion, hidden pages, and print keep camera motion bounded', () => {
  assert.match(template, /var STORY_FOLLOW_MIN_DWELL_MS = 1100/);
  assert.match(template, /var STORY_FOLLOW_DURATION_MS = 320/);
  assert.match(template, /Math\.max\(STORY_FOLLOW_MIN_DWELL_MS, VIEW_INTERVAL_MS \/ Math\.max\(1, total\)\)/);
  assert.match(template, /storyBeatDwellMs = storyBeatDwell\(total\)/);
  assert.match(template, /if \(!step \|\| document\.hidden/);
  assert.match(template, /window\.matchMedia\('print'\)\.matches/);
  assert.match(template, /instant: options\.instant === true \|\| reducedMotion\(\) \|\| document\.documentElement\.getAttribute\('data-motion'\) !== 'live'/);
  assert.match(template, /function storyAutomaticPlaybackAllowed\(\)/);
  assert.match(template, /Archify\.motionGovernor && Archify\.motionGovernor\.capable\) return !Archify\.motionGovernor\.isPaused\(\)/);
  assert.match(template, /play\.disabled = !playing && !automaticPlaybackAllowed/);
  assert.match(template, /Story playback unavailable while motion is Still/);
  assert.match(template, /function startPlayback\(\) \{[\s\S]*?if \(!storyAutomaticPlaybackAllowed\(\)\)/);
  assert.match(template, /if \(shouldPlay && svg\.getAttribute\('data-story-playing'\) !== 'true'\)/);
  assert.match(template, /else if \(!shouldPlay && svg\.hasAttribute\('data-story-playing'\)\)/);
  assert.doesNotMatch(template, /storyFollowTimer = setInterval/);
});

test('pause, settle, overview, and manual camera takeover cancel Story Follow state', () => {
  assert.match(template, /function clearStoryFollow\(\)/);
  assert.match(template, /svg\.removeAttribute\('data-story-follow'\)/);
  assert.match(template, /panel\.removeAttribute\('data-story-follow'\)/);
  assert.match(template, /function pausePlayback\(options\)[\s\S]*?clearStoryFollow\(\)/);
  assert.match(template, /function settleStoryBeats\(\)[\s\S]*?clearStoryFollow\(\)/);
  assert.match(template, /function clearStoryTrail\(\)[\s\S]*?clearStoryFollow\(\)/);
  assert.match(template, /function interruptCamera\(reason\)[\s\S]*?Archify\.guidedViews\.pause\(\)/);
  assert.match(template, /clone\.removeAttribute\('data-story-follow'\)/);
  assert.match(template, /!clone\.hasAttribute\('data-story-follow'\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
