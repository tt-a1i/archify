import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'archify/bin/archify.mjs');
const footer = '<footer class="page-feedback';
const colophon = '<p class="colophon-feedback';
const links = ['mailto:2801884530@qq.com?subject=Archify%20feedback', 'https://github.com/tt-a1i/archify/issues/new/choose', 'href="https://github.com/tt-a1i/archify"'];

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

test('diagram pages carry the feedback footer unless meta.feedback_links is false', (t) => {
  const shown = render(t, 'architecture', 'web-app.architecture.json');
  assert.equal(shown.split(footer).length - 1, 1);
  for (const link of links) assert.ok(shown.includes(link), link);
  const hidden = render(t, 'architecture', 'web-app.architecture.json', (spec) => { spec.meta.feedback_links = false; });
  assert.ok(!hidden.includes(footer));
  assert.ok(!hidden.includes('mailto:'));
});

test('explainer pages carry the feedback row unless meta.feedback_links is false', (t) => {
  const shown = render(t, 'explainer', 'delivery.explainer.json');
  assert.equal(shown.split(colophon).length - 1, 1);
  for (const link of links) assert.ok(shown.includes(link), link);
  const hidden = render(t, 'explainer', 'delivery.explainer.json', (spec) => { spec.meta.feedback_links = false; });
  assert.ok(!hidden.includes(colophon));
  assert.ok(!hidden.includes('mailto:'));
});
