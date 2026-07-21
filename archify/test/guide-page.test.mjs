import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');

test('guide page: checked-in HTML is reproducible from the shared recipe source', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-guide-page-'));
  const generated = path.join(tmp, 'guide.html');
  try {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-guide.mjs'), generated]);
    assert.equal(
      fs.readFileSync(generated, 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'docs/guide.html'), 'utf8'),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('guide page: ships bilingual recipes and syntactically valid interaction code', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'docs/guide.html'), 'utf8');
  assert.doesNotMatch(html, /\[\[[A-Z0-9_]+\]\]/);
  assert.match(html, /Question-first diagramming/);
  assert.match(html, /先问题，后图表/);
  assert.match(html, /archify guide &quot;your scenario&quot;|archify guide "your scenario"/);

  const dataMatch = html.match(/<script id="guide-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch);
  const data = JSON.parse(dataMatch[1]);
  assert.equal(data.length, 11);
  assert.equal(data.filter((recipe) => recipe.type === 'workflow').length, 3);
  assert.ok(data.every((recipe) => recipe.en.prompt && recipe.zh.prompt && recipe.proof));
  assert.match(html, /gallery\.html#proof-/);
  assert.match(html, /Open verified example/);
  assert.match(html, /打开验证成品/);

  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n  <\/script>\n<\/body>/);
  assert.ok(scriptMatch);
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
});
