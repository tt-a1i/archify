import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-guided-views-'));

const CASES = {
  architecture: { example: 'web-app.architecture.json', collection: 'components' },
  workflow: { example: 'agent-tool-call.workflow.json', collection: 'nodes' },
  sequence: { example: 'cache-miss-request.sequence.json', collection: 'participants' },
  dataflow: { example: 'product-analytics.dataflow.json', collection: 'nodes' },
  lifecycle: { example: 'agent-run.lifecycle.json', collection: 'states' },
};

function run(mode, doc, suffix) {
  const input = path.join(tmp, `${mode}-${suffix}.json`);
  const output = path.join(tmp, `${mode}-${suffix}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, output,
  ], { encoding: 'utf8' });
  return { result, output, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function fixture(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES[mode].example), 'utf8'));
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

for (const [mode, config] of Object.entries(CASES)) {
  test(`${mode}: guided views preserve base SVG geometry`, () => {
    const withViews = fixture(mode);
    const ids = withViews[config.collection].slice(0, 2).map((item) => item.id);
    withViews.meta.views = [{
      id: 'reader-path',
      label: 'Reader path',
      focus: ids,
      note: 'A safe note with </script><script> text.',
    }];
    const withoutViews = structuredClone(withViews);
    delete withoutViews.meta.views;

    const guided = run(mode, withViews, 'guided');
    const plain = run(mode, withoutViews, 'plain');
    assert.equal(guided.result.status, 0, guided.result.stderr);
    assert.equal(plain.result.status, 0, plain.result.stderr);
    assert.equal(svg(guided.html), svg(plain.html));
    assert.match(guided.html, /id="guided-views" hidden/);
    assert.match(guided.html, /Archify\.guidedViews = \(function \(\)/);
    assert.match(guided.html, /#view=/);
    assert.match(guided.html, /addEventListener\('hashchange', syncViewFromHash\)/);
    assert.match(guided.html, /id="guided-view-play"/);
    assert.match(guided.html, /VIEW_INTERVAL_MS = 3200/);
    assert.match(guided.html, /visibilitychange/);
    assert.match(guided.html, /play: startPlayback/);
    assert.match(guided.html, /playCurrent: startCurrentViewPlayback/);
    assert.match(guided.html, /URLSearchParams\(location\.search\)\.get\('play'\) === '1'/);
    assert.match(guided.html, /data-autoplay/);
    assert.match(guided.html, /prefers-reduced-motion: reduce/);
    assert.match(guided.html, /pausePlayback\(\{ complete: true \}\)/);
    assert.match(guided.html, /html\[data-embed="true"\] svg\[data-animation="trace"\] \[data-animate\],[\s\S]*?html\[data-share-playback="true"\][\s\S]*?animation: none !important;[\s\S]*?stroke-dashoffset: 0/);
    assert.match(guided.html, /document\.documentElement\.setAttribute\('data-share-playback', 'true'\)/);
    assert.match(guided.html, /document\.documentElement\.removeAttribute\('data-share-playback'\)/);
    const oneShot = guided.html.match(/function startCurrentViewPlayback\(\) \{([\s\S]*?)\n      function maybeStartSharePlayback/);
    assert.ok(oneShot, 'one-shot share playback implementation missing');
    assert.match(oneShot[1], /storyPlaybackScope = 'chapter'/);
    assert.match(oneShot[1], /scheduleStoryPlayback\(\)/);
    assert.doesNotMatch(oneShot[1], /scheduleNextView/);
    assert.match(guided.html, /id="share-chapter-cue" hidden role="status" aria-live="polite"/);
    assert.match(guided.html, /data-share-playback="true"\] \.share-chapter-cue:not\(\[hidden\]\)/);
    assert.match(guided.html, /data-share-playback="true"\] \.diagram-container \{\s*padding-top: 4\.25rem/);
    assert.match(guided.html, /function renderShareCue\(\)/);
    assert.match(guided.html, /function shareCueBeatCopy\(state, view, stops\)/);
    assert.match(guided.html, /Step ' \+ \(storyBeatIndex \+ 1 < 10/);
    assert.match(guided.html, /shareCue\.setAttribute\('aria-live', state === 'playing' \? 'off' : 'polite'\)/);
    assert.match(guided.html, /function scheduleStoryPlayback\(\)/);
    assert.match(guided.html, /storyBeatTimer = setTimeout/);
    assert.match(guided.html, /generation !== storyPlaybackGeneration/);
    assert.match(guided.html, /settleStoryBeats\(\);/);
    assert.match(guided.html, /kind === 'multiple' \? '\\u21c4' : '\\u00b7'/);
    assert.match(guided.html, /currentStoryProgress\(\)/);
    assert.match(guided.html, /setShareCueProgress\(progress\)/);
    assert.match(guided.html, /startShareCueProgress\(progress, remainingChapter\)/);
    assert.match(guided.html, /data-wide-diagram/);
    assert.match(guided.html, /min-width: 720px/);
    assert.match(guided.html, /reveal: reveal/);
    assert.match(guided.html, /container\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/);
    assert.match(guided.html, /--archify-scroll-x/);
    assert.match(guided.html, /focus: function \(\) \{ return activeIndex < 0 \? \[\] : views\[activeIndex\]\.focus\.slice\(\); \}/);
    assert.match(guided.html, /<kbd>P<\/kbd> play story/);
    assert.doesNotMatch(plain.html, /<kbd>P<\/kbd> play story/);
    assert.match(guided.html, /\\u003c\/script\\u003e\\u003cscript\\u003e/);
    assert.doesNotMatch(guided.html, /A safe note with <\/script><script>/);
  });
}

test('guided views reject duplicate view ids', () => {
  const doc = fixture('workflow');
  doc.meta.views = [
    { id: 'same', label: 'First', focus: ['user'] },
    { id: 'same', label: 'Second', focus: ['chat'] },
  ];
  const { result } = run('workflow', doc, 'duplicate-view-id');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicates view id "same"/);
});

test('guided views reject dangling semantic ids', () => {
  const doc = fixture('sequence');
  doc.meta.views = [{ id: 'broken', label: 'Broken', focus: ['ghost'] }];
  const { result } = run('sequence', doc, 'dangling-id');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references unknown semantic id "ghost"/);
});

test('guided views schema enforces collection and focus bounds', () => {
  const tooMany = fixture('architecture');
  tooMany.meta.views = Array.from({ length: 6 }, (_, index) => ({
    id: `view-${index}`,
    label: `View ${index}`,
    focus: [tooMany.components[0].id],
  }));
  const overLimit = run('architecture', tooMany, 'too-many');
  assert.notEqual(overLimit.result.status, 0);
  assert.match(overLimit.result.stderr, /must NOT have more than 5 items/);

  const duplicateFocus = fixture('dataflow');
  duplicateFocus.meta.views = [{ id: 'duplicate', label: 'Duplicate', focus: ['web', 'web'] }];
  const duplicate = run('dataflow', duplicateFocus, 'duplicate-focus');
  assert.notEqual(duplicate.result.status, 0);
  assert.match(duplicate.result.stderr, /duplicates semantic id "web"/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
