import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const repoRoot = path.resolve(skillRoot, '..');
const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const english = fs.readFileSync(path.join(repoRoot, 'README_EN.md'), 'utf8');
const chinese = fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8');
const roadmap = fs.readFileSync(path.join(repoRoot, 'ROADMAP.md'), 'utf8');

test('preview contract: the skill keeps live preview explicit, desktop-only, and last-good', () => {
  assert.match(skill, /archify\.mjs preview <type> <input>\.json <output>\.html/);
  assert.match(skill, /active desktop authoring loop/i);
  assert.match(skill, /previous verified revision remains on screen and on disk/i);
  assert.match(skill, /never start it by default/i);
  assert.match(skill, /CI, unattended agents, remote sharing, or mobile use/i);
  assert.match(skill, /must never enter the generated artifact or any export/i);
});

test('preview contract: all README languages document the same optional command without changing the hero', () => {
  assert.equal(readme, english);
  for (const text of [readme, chinese]) {
    assert.match(text, /bin\/archify\.mjs preview workflow/);
    assert.match(text, /--no-open/);
    assert.match(text, /127\.0\.0\.1/);
    assert.match(text, /Ctrl-C/);
    assert.match(text, /docs\/assets\/archify-readme-hero\.png/);
  }
});

test('preview contract: roadmap records the no-leak and zero-dependency boundary', () => {
  assert.match(roadmap, /Last-Good Live Preview/);
  assert.match(roadmap, /installed ZIP skills keep the zero-dependency contract/i);
  assert.match(roadmap, /no server state, port, path, error, or reload token enters HTML/i);
});
