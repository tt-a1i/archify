import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(path.join(here, '..', 'SKILL.md'), 'utf8');

test('skill requires a bounded and truthful perceptual delivery receipt', () => {
  assert.match(skill, /visual_review: passed/);
  assert.match(skill, /visual_review: skipped \(image reader unavailable\)/);
  assert.match(skill, /correction_rounds: [0-2]/);
  assert.match(skill, /maximum of two focused correction rounds/i);
  assert.match(skill, /never report `visual_review: passed` without inspecting/i);
});
