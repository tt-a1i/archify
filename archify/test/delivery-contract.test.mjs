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

test('skill uses atomic verified delivery for the final artifact', () => {
  assert.match(skill, /archify\.mjs deliver <type>/);
  assert.match(skill, /same-directory candidate/i);
  assert.match(skill, /only replaces the target after.*artifact checks pass/i);
  assert.match(skill, /never claim that the deterministic receipt includes visual review/i);
});

test('skill keeps optional opening behind the verified commit and outside automation', () => {
  assert.match(skill, /Add `--open` only when the user wants an immediate local preview/);
  assert.match(skill, /runs after that atomic commit/);
  assert.match(skill, /Keep it off for CI, unattended agents, and non-interactive environments/);
  assert.match(skill, /never invokes an opener/);
  assert.match(skill, /status proves only whether the local opener invocation succeeded/);
});
