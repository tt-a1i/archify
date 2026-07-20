import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-chapter-handoff-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

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

test('all five renderers inherit one viewer-only Shared Anchor Chapter Handoff', () => {
  for (const mode of Object.keys(CASES)) {
    const html = render(mode);
    assert.match(html, /id="guided-view-handoff" hidden aria-hidden="true"/, mode);
    assert.match(html, /function beginHandoff\(previousIndex, nextIndex, previous, destination, outgoingBeatIndex, reason\)/, mode);
    assert.match(html, /data-chapter-handoff-overlay/, mode);
    assert.match(html, /ring\.setAttribute\('class', 'chapter-handoff-anchor'\)/, mode);
    assert.doesNotMatch(canonicalSvg(html), /data-chapter-handoff|data-chapter-role|chapter-handoff-anchor/, mode);
  }
});

test('anchor selection uses exact stable-id intersection with deterministic outgoing priority', () => {
  const html = render('workflow');
  assert.match(html, /function chapterDelta\(previous, destination\)/);
  assert.match(html, /function chapterAnchor\(previous, destination, outgoingBeatIndex, delta\)/);
  assert.match(html, /delta\.stay\.forEach\(function \(id\) \{ stayIds\[id\] = true; \}\)/);
  assert.match(html, /var activeBeat = outgoingBeatIndex >= 0 \? previous\.focus\[outgoingBeatIndex\] : ''/);
  assert.match(html, /activeBeat && stayIds\[activeBeat\]/);
  assert.match(html, /for \(var index = previous\.focus\.length - 1; index >= 0; index -= 1\)/);
  assert.match(html, /if \(stayIds\[previous\.focus\[index\]\]\) return previous\.focus\[index\]/);
  assert.doesNotMatch(html, /inferChapterAnchor|matchChapterLabel|nearestKind/);
});

test('handoff holds one truthful anchor then settles through one finite camera transaction', () => {
  const html = render('architecture');
  assert.match(html, /handoff\.mode = 'settling'/);
  assert.match(html, /setTimeout\(startCamera, 110\)/);
  assert.match(html, /duration: 420/);
  assert.match(html, /requestAnimationFrame\(step\)/);
  assert.match(html, /var eased = 1 - Math\.pow\(1 - fraction, 3\)/);
  assert.match(html, /Archify\.motionGovernor\.claim\('handoff'/);
  assert.match(html, /Archify\.motionGovernor\.release\(handoff\.ownerToken\)/);
  assert.match(html, /' \\u2192 '.*' \\u00b7 via '/s);
  assert.doesNotMatch(html, /chapter-handoff[^\n]+infinite/);
});

test('latest intent, manual takeover, Still, reduced motion, and hidden pages cleanly settle', () => {
  const html = render('lifecycle');
  assert.match(html, /cancelHandoff\('replaced'\)/);
  assert.match(html, /cameraTransaction\.cancel\(reason \|\| 'cancelled', commitTarget === true\)/);
  assert.match(html, /transaction\.settled/);
  assert.match(html, /currentHandoff !== handoff/);
  assert.match(html, /Archify\.guidedViews\.cancelHandoff\(reason \|\| 'manual'\)/);
  assert.match(html, /settleHandoff\(systemPaused \? 'reduced-motion' : \(hasSuspension\(\) \? 'hidden' : 'still'\)\)/);
  assert.match(html, /settleHandoff\('hidden'\)/);
  assert.match(html, /settleHandoff\('reduced-motion'\)/);
  assert.match(html, /window\.addEventListener\('beforeprint',[\s\S]*?clearChapterPreview[\s\S]*?settleHandoff\('print'\)/);
});

test('mobile, embed, print, and canonical exports keep strict static boundaries', () => {
  const html = render('sequence');
  assert.match(html, /document\.documentElement\.getAttribute\('data-embed'\) === 'true'/);
  assert.match(html, /cameraReceipt\(\{ scrollLeft: target \}/);
  assert.match(html, /behavior: instant \? 'auto' : 'smooth'/);
  assert.match(html, /\.chapter-handoff-overlay \{ display: none !important; \}/);
  assert.match(html, /clone\.removeAttribute\('data-chapter-handoff'\)/);
  assert.match(html, /clone\.removeAttribute\('data-chapter-anchor'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-chapter-handoff-overlay\]'\)/);
  assert.match(html, /clone\.querySelectorAll\('\[data-chapter-role\]'\)/);
  assert.match(html, /!clone\.hasAttribute\('data-chapter-handoff'\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
