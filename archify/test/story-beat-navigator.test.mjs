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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-beat-navigator-'));

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

test('all five renderers inherit native inspectable Story Beat controls without changing canonical SVG', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const { result, html } = render(mode, example);
    assert.equal(result.status, 0, result.stderr);
    assert.match(html, /var stop = document\.createElement\('button'\)/);
    assert.match(html, /stop\.type = 'button'/);
    assert.match(html, /stop\.setAttribute\('aria-label', storyBeatAria\(step, storySteps\.length\)\)/);
    assert.match(html, /stop\.setAttribute\('aria-current', 'step'\)/);
    assert.doesNotMatch(html, /stop\.setAttribute\('aria-pressed'/);
    const generatedSvg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
    assert.doesNotMatch(generatedSvg, /data-story-(?:active|playing|beat|step|overlay|pulse)/);
  }
});

test('adjacent stable IDs classify start, forward, reverse, group, and multiple without inferred cross-links', () => {
  assert.match(template, /function storyStep\(view, index, edgeList, byId\)/);
  assert.match(template, /from === previousId && to === id/);
  assert.match(template, /from === id && to === previousId/);
  assert.match(template, /edges\.length === 1 && forward\.length === 1 \? 'forward'/);
  assert.match(template, /edges\.length === 1 && reverse\.length === 1 \? 'reverse' : 'multiple'/);
  assert.match(template, /index === 0 \? 'start' : \(!edges\.length \? 'group'/);
  assert.match(template, /storySteps\.forEach\(function \(step\) \{\s*step\.edges\.forEach/);
  assert.doesNotMatch(template, /var storyOrder = \{\}/);
  assert.doesNotMatch(template, /Math\.max\(storyOrder/);
});

test('focus pauses without selection while native activation pins one beat and preserves chapter and link ownership', () => {
  assert.match(template, /trail\.addEventListener\('focusin'[\s\S]*if \(playing\) pausePlayback\(\)/);
  assert.match(template, /trail\.addEventListener\('click'[\s\S]*selectStoryBeat\(Number\(stop\.getAttribute\('data-story-index'\)\)\)/);
  assert.match(template, /trail\.addEventListener\('keydown'[\s\S]*event\.key !== 'Enter' && event\.key !== ' '[\s\S]*event\.preventDefault\(\)/);
  assert.match(template, /function selectStoryBeat\(index\)/);
  assert.match(template, /setStoryBeat\(index, \{ manual: true, center: true, pulse: true, follow: true \}\)/);
  assert.match(template, /stop\.setAttribute\('aria-current', 'step'\)/);
  assert.match(template, /else stop\.removeAttribute\('aria-current'\)/);
  assert.match(template, /trail\.scrollLeft = target/);
  const selection = template.match(/function selectStoryBeat\(index\) \{([\s\S]*?)\n      function updateUrl/)?.[1] || '';
  assert.match(selection, /updateUrl: false/);
  assert.doesNotMatch(selection, /history\.|location\.|scrollIntoView/);
  assert.match(template, /beat: function \(\)[\s\S]*edgeKeys: step\.edgeKeys\.slice\(\)/);
});

test('one generation-owned scheduler resumes remaining dwell and finite exact-edge signals never loop', () => {
  assert.equal((template.match(/storyBeatTimer = setTimeout/g) || []).length, 1);
  assert.doesNotMatch(template, /storyBeatTimer = setInterval/);
  assert.match(template, /storyPlaybackGeneration \+= 1/);
  assert.match(template, /generation !== storyPlaybackGeneration/);
  assert.match(template, /preserveElapsed: options\.complete !== true/);
  assert.match(template, /storyBeatDwellMs - storyBeatElapsedMs/);
  assert.match(template, /afterHandoff\(function \(\)[\s\S]*scheduleStoryPlayback\(\)/);
  assert.match(template, /animation: archify-story-flow 0\.78s linear 1 both/);
  assert.doesNotMatch(template, /archify-story-flow 0\.78s linear infinite/);
  assert.match(template, /svg\[data-preset="blueprint"\]\[data-story-beat\] \[data-story-step\]\[data-story-beat-state="active"\] \{\s*filter: none;\s*animation: none;/);
  assert.match(template, /step\.relation !== 'forward' && step\.relation !== 'reverse'/);
  assert.match(template, /step\.edges\.length !== 1/);
  assert.match(template, /addEventListener\('animationend'[\s\S]*clearStoryPulse/);
});

test('target size, reduced motion, print, embed, and export keep Story Beats viewer-only', () => {
  assert.match(template, /\.guided-view-trail \.guided-view-stop \{[\s\S]*min-height: 1\.5rem/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-view-trail \.guided-view-stop \{[\s\S]*min-height: 2rem/);
  assert.match(template, /touch-action: pan-x/);
  assert.match(template, /document\.documentElement\.getAttribute\('data-embed'\) !== 'true' && typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && svg instanceof Node && document\.documentElement instanceof Node/);
  assert.match(template, /@media print[\s\S]*\.story-trail-overlay,\s*\.story-carrier-overlay \{ display: none !important; \}/);
  assert.match(template, /html\[data-embed="true"\][\s\S]*\.guided-views/);
  assert.match(template, /html\[data-motion="still"\] \.story-trail-flow/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.story-trail-flow/);
  assert.match(template, /clone\.querySelectorAll\('\[data-story-overlay\], \[data-story-carrier-overlay\]'\)/);
  assert.match(template, /clone\.querySelectorAll\('\[data-story-step\], \[data-story-beat-state\], \[data-story-beat-step\]'\)/);
  assert.match(template, /canonicalStateClean[\s\S]*data-story-beat-step/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
