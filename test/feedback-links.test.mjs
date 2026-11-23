import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStory } from '../archify/story/tool.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'archify/bin/archify.mjs');
const footer = '<footer class="page-feedback';
const colophon = '<div class="colophon-feedback';
const storyFooter = '<footer class="story-feedback';
const links = [
  'mailto:2801884530@qq.com?subject=Archify%20feedback',
  'https://github.com/tt-a1i/archify/issues/new/choose',
  'href="https://github.com/tt-a1i/archify"',
  'data-copy-email="2801884530@qq.com"',
];

function render(t, type, example, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-feedback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'archify/examples', example), 'utf8'));
  mutate?.(spec);
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  const result = spawnSync(process.execPath, [cli, 'render', type, input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(output, 'utf8');
}

test('diagram pages carry the feedback colophon and star card unless meta.feedback_links is false', (t) => {
  const shown = render(t, 'architecture', 'web-app.architecture.json');
  assert.equal(shown.split(footer).length - 1, 1);
  assert.ok(shown.includes('id="page-feedback-star-tip"'));
  for (const link of links) assert.ok(shown.includes(link), link);
  const hidden = render(t, 'architecture', 'web-app.architecture.json', (spec) => { spec.meta.feedback_links = false; });
  assert.ok(!hidden.includes(footer));
  assert.ok(!hidden.includes('mailto:'));
});

test('explainer pages carry the feedback colophon and star card unless meta.feedback_links is false', (t) => {
  const shown = render(t, 'explainer', 'delivery.explainer.json');
  assert.equal(shown.split(colophon).length - 1, 1);
  assert.ok(shown.includes('id="colophon-star-tip"'));
  for (const link of links) assert.ok(shown.includes(link), link);
  const hidden = render(t, 'explainer', 'delivery.explainer.json', (spec) => { spec.meta.feedback_links = false; });
  assert.ok(!hidden.includes(colophon));
  assert.ok(!hidden.includes('mailto:'));
});

test('story studio follows the source diagram feedback setting', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-feedback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const renderHtml = (feedbackLinks, name) => {
    const spec = JSON.parse(fs.readFileSync(path.join(repoRoot, 'archify/examples/web-app.architecture.json'), 'utf8'));
    if (feedbackLinks === false) spec.meta.feedback_links = false;
    const input = path.join(dir, `${name}.json`);
    const output = path.join(dir, `${name}.html`);
    fs.writeFileSync(input, JSON.stringify(spec));
    const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return output;
  };
  const briefPath = path.join(dir, 'brief.json');
  fs.writeFileSync(briefPath, JSON.stringify({
    version: 2,
    title: 'Feedback test',
    intro: 'Intro.',
    outro: 'Outro.',
    scenes: [{ title: 'Scene 1', points: [{ anchor: 'api', title: 'API', text: 'Handles requests.' }] }],
  }));

  const shownOut = path.join(dir, 'story-shown.html');
  buildStory(renderHtml(true, 'shown'), briefPath, shownOut, { standalone: true, repoRoot });
  const shown = fs.readFileSync(shownOut, 'utf8');
  assert.equal(shown.split(storyFooter).length - 1, 1);
  assert.ok(shown.includes('id="story-star-tip"'));
  for (const link of links) assert.ok(shown.includes(link), link);

  const hiddenOut = path.join(dir, 'story-hidden.html');
  buildStory(renderHtml(false, 'hidden'), briefPath, hiddenOut, { standalone: true, repoRoot });
  const hidden = fs.readFileSync(hiddenOut, 'utf8');
  assert.ok(!hidden.includes(storyFooter));
  assert.ok(!hidden.includes('mailto:'));
});
