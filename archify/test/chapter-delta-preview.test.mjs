import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-chapter-delta-preview-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

const PROOF_CASES = [
  'agent-tool-call.workflow.json',
  'production-deployment.architecture.json',
  'cache-miss-request.sequence.json',
  'release-delivery.workflow.json',
  'incident-response.workflow.json',
  'product-analytics.dataflow.json',
  'async-job-roundtrip.sequence.json',
  'event-stream.dataflow.json',
  'agent-run.lifecycle.json',
  'deployment-release.lifecycle.json',
  'web-app.architecture.json',
];

function render(mode) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', CASES[mode]),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function delta(previous, destination) {
  const previousIds = new Set(previous);
  const destinationIds = new Set(destination);
  return {
    stay: previous.filter((id) => destinationIds.has(id)),
    enter: destination.filter((id) => !previousIds.has(id)),
    leave: previous.filter((id) => !destinationIds.has(id)),
  };
}

test('all five renderers inherit one viewer-only static Chapter Delta Preview', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /function chapterDelta\(previous, destination\)/, mode);
    assert.match(html, /className = 'guided-view-chapter-delta'/, mode);
    assert.match(html, /svg\.setAttribute\('data-chapter-preview', views\[index\]\.id\)/, mode);
    assert.match(html, /data-chapter-preview-role/, mode);
    assert.match(html, /transition: none !important/, mode);
    assert.doesNotMatch(canonicalSvg(html), /data-chapter-preview|data-chapter-preview-role/, mode);
  }
});

test('exact stable-ID set math powers truthful counts and the existing handoff', () => {
  const html = render('workflow');
  assert.match(html, /stay: previousFocus\.filter\(function \(id\) \{ return destinationIds\[id\]; \}\)/);
  assert.match(html, /enter: destinationFocus\.filter\(function \(id\) \{ return !previousIds\[id\]; \}\)/);
  assert.match(html, /leave: previousFocus\.filter\(function \(id\) \{ return !destinationIds\[id\]; \}\)/);
  assert.match(html, /var delta = chapterDelta\(previous, destination\);[\s\S]*?chapterAnchor\(previous, destination, outgoingBeatIndex, delta\)/);
  assert.match(html, /var compact = '=' \+ delta\.stay\.length \+ ' \+' \+ delta\.enter\.length \+ ' \\u2212' \+ delta\.leave\.length/);
  assert.match(html, /Chapter focus delta: ' \+ expanded/);
  assert.doesNotMatch(html, /inferChapterDelta|matchChapterLabel|nearestKind/);

  let adjacent = 0;
  let shared = 0;
  for (const file of PROOF_CASES) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', file), 'utf8'));
    const views = doc.meta.views;
    for (let index = 1; index < views.length; index += 1) {
      adjacent += 1;
      if (delta(views[index - 1].focus, views[index].focus).stay.length) shared += 1;
    }
  }
  assert.equal(adjacent, 22);
  assert.equal(shared, 19);

  const workflow = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', CASES.workflow), 'utf8'));
  const [first, second, third] = workflow.meta.views;
  assert.deepEqual(delta(first.focus, second.focus), {
    stay: ['router', 'approval'],
    enter: ['blocked', 'retry'],
    leave: ['user', 'chat', 'planner', 'tool', 'external', 'final'],
  });
  assert.deepEqual(delta(second.focus, third.focus), {
    stay: [],
    enter: ['external', 'store', 'trace'],
    leave: ['router', 'approval', 'blocked', 'retry'],
  });
});

test('pointer and keyboard inspect while touch and native activation still commit directly', () => {
  const html = render('architecture');
  assert.match(html, /chapterList\.addEventListener\('pointerover'/);
  assert.match(html, /!hoverCapable\(\) \|\| event\.pointerType === 'touch'/);
  assert.match(html, /setChapterPreviewIntent\('pointer', chapterButtons\.indexOf\(button\)\)/);
  assert.match(html, /chapterIndex\.addEventListener\('focusin',[\s\S]*?setChapterPreviewIntent\('focus'/);
  assert.match(html, /event\.key === 'Escape' && activePreviewIndex >= 0[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?clearChapterPreview\(\{ clearIntents: true \}\)/);
  assert.match(html, /chapterList\.addEventListener\('click',[\s\S]*?activateById/);
  assert.match(html, /button\.type = 'button'/);
  assert.doesNotMatch(html, /firstTap|secondTap|longpress|long-press/);

  const previewRuntime = html.slice(
    html.indexOf('function chapterPreviewBlocked()'),
    html.indexOf('function sharePlaybackRequested()'),
  );
  assert.doesNotMatch(previewRuntime, /Archify\.view\.|updateUrl\(|Archify\.focus\.|renderStoryTrail\(/);
});

test('latest intent, stronger owners, playback, and lifecycle cleanup remain bounded', () => {
  const html = render('lifecycle');
  assert.match(html, /var previewGeneration = 0/);
  assert.match(html, /right\.generation - left\.generation/);
  assert.match(html, /\[pointerPreviewIntent, focusPreviewIntent\]/);
  assert.match(html, /document\.hidden \|\| playing \|\| currentHandoff/);
  assert.match(html, /data-route-picking'[\s\S]*?data-route-active/);
  assert.match(html, /data-lens-active'[\s\S]*?data-legend-preview-active/);
  assert.match(html, /data-relationship-preview-active'[\s\S]*?data-intent-trace-active/);
  assert.match(html, /if \(playing\) pausePlayback\(\)/);
  assert.match(html, /Archify\.motionGovernor\.claim\('chapter-preview'/);
  assert.match(html, /Archify\.motionGovernor\.release\(token\)/);
  assert.match(html, /handoff\.resolve[\s\S]*?syncChapterPreview\(\)/);
  assert.match(html, /visibilitychange'[\s\S]*?clearChapterPreview/);
  assert.match(html, /beforeprint'[\s\S]*?clearChapterPreview[\s\S]*?settleHandoff/);
});

test('mobile, Still, embed, print, and canonical exports keep the preview viewer-only', () => {
  const html = render('sequence');
  assert.match(html, /\.guided-view-chapter \{ min-height: 2\.75rem; \}/);
  assert.match(html, /flex: 0 0 min\(14rem, 78vw\)/);
  assert.match(html, /\.guided-view-chapter-delta\[hidden\] \{ display: none; \}/);
  assert.match(html, /document\.documentElement\.getAttribute\('data-embed'\) === 'true'/);
  assert.match(html, /prefers-reduced-motion: reduce[\s\S]*?svg\[data-chapter-preview\]/);
  assert.match(html, /svg\[data-chapter-preview\] \[data-node-id\],[\s\S]*?opacity: 1 !important; filter: none !important/);
  assert.match(html, /clone\.removeAttribute\('data-chapter-preview'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-chapter-preview-role\]'\)/);
  assert.match(html, /!clone\.hasAttribute\('data-chapter-preview'\)/);
  assert.match(html, /canonicalStateClean/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
