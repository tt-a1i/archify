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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-horizon-'));

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

test('all five renderers inherit one viewer-only Story Horizon', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const { result, html } = render(mode, example);
    assert.equal(result.status, 0, result.stderr);
    assert.match(html, /data-story-beat-state="next"/, mode);
    assert.match(html, /step === storyBeatIndex \+ 1/, mode);
    assert.match(html, /svg\.setAttribute\('data-story-next', nextStep\.nodeId\)/, mode);
    assert.match(html, /panel\.setAttribute\('data-story-next', nextStep\.nodeId\)/, mode);
    assert.match(html, /id="guided-story-caption-next" hidden aria-hidden="true"/, mode);
    const generatedSvg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
    assert.doesNotMatch(generatedSvg, /data-story-next|data-story-beat-state="next"/, mode);
  }
});

test('the temporal hierarchy has one bounded next state and a clean final beat', () => {
  assert.match(template, /if \(step < storyBeatIndex\) return 'past'/);
  assert.match(template, /if \(step === storyBeatIndex\) return 'active'/);
  assert.match(template, /if \(step === storyBeatIndex \+ 1\) return 'next'/);
  assert.match(template, /return 'pending'/);
  assert.match(template, /storyBeatIndex \+ 1 < storySteps\.length \? storySteps\[storyBeatIndex \+ 1\] : null/);
  assert.match(template, /else \{\s*svg\.removeAttribute\('data-story-next'\);\s*panel\.removeAttribute\('data-story-next'\)/);
  assert.match(template, /storyCaptionNext\.hidden = !nextStep/);
});

test('next edges reuse exact authored step membership without synthesizing topology', () => {
  assert.match(template, /storySteps\.forEach\(function \(step\) \{\s*step\.edges\.forEach/);
  assert.match(template, /edge\.setAttribute\('data-story-beat-step', String\(edgeBeat\)\)/);
  assert.match(template, /edge\.setAttribute\('data-story-beat-state', storyBeatState\(step\)\)/);
  assert.match(template, /index === 0 \? 'start' : \(!edges\.length \? 'group'/);
  assert.match(template, /edges\.length === 1 && forward\.length === 1 \? 'forward'/);
  assert.match(template, /edges\.length === 1 && reverse\.length === 1 \? 'reverse' : 'multiple'/);
  assert.doesNotMatch(template, /createElementNS\([^\n]+story-horizon|data-story-horizon-edge/);
});

test('next remains static, subordinate, preset-safe, and mobile-height neutral', () => {
  assert.match(template, /data-story-step\]\[data-story-beat-state="next"\] \{\s*opacity: 0\.5;\s*filter: saturate\(0\.66\)/);
  assert.match(template, /data-story-beat-state="past"\] \{\s*opacity: 0\.72/);
  assert.match(template, /data-edge-from\]\[data-story-beat-step\]\[data-story-beat-state="next"\] \{ opacity: 0\.34; \}/);
  assert.match(template, /guided-view-stop\[data-story-beat-state="next"\][\s\S]*border-style: dashed/);
  assert.match(template, /@media \(max-width: 720px\)[\s\S]*\.guided-story-caption-next \{ display: none; \}/);
  const nextRules = template.match(/[^\n{]*data-story-beat-state="next"[^\n{]*\{[^}]*\}/g)?.join('\n') || '';
  assert.doesNotMatch(nextRules, /animation:|drop-shadow|stroke-dasharray/);
});

test('Still, accessibility, teardown, and export preserve the product boundary', () => {
  assert.match(template, /id="guided-story-caption-next" hidden aria-hidden="true"/);
  assert.match(template, /storyCaption\.setAttribute\('aria-live', playing \? 'off' : 'polite'\)/);
  assert.doesNotMatch(template, /storyCaptionNext\.setAttribute\('aria-live'/);
  assert.match(template, /html\[data-motion="still"\] \[data-story-step\]/);
  assert.match(template, /html\[data-motion="still"\] svg \[data-node-id\][\s\S]*transition: none !important/);
  assert.match(template, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.story-trail-flow/);
  assert.ok((template.match(/svg\.removeAttribute\('data-story-next'\)/g) || []).length >= 3);
  assert.ok((template.match(/panel\.removeAttribute\('data-story-next'\)/g) || []).length >= 2);
  assert.match(template, /clone\.removeAttribute\('data-story-next'\)/);
  assert.match(template, /canonicalStateClean[\s\S]*!clone\.hasAttribute\('data-story-next'\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
