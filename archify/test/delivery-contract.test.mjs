import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(path.join(here, '..', 'SKILL.md'), 'utf8');
const delivery = readFileSync(path.join(here, '..', 'references', 'delivery-contract.md'), 'utf8');

test('skill requires a bounded and truthful perceptual delivery receipt', () => {
  assert.match(delivery, /browser_evidence: passed\|failed\|skipped/);
  assert.match(delivery, /visual_review: passed/);
  assert.match(delivery, /visual_review: skipped \(image reader unavailable\)/);
  assert.match(delivery, /correction_rounds: [0-2]/);
  assert.match(delivery, /maximum of two focused correction rounds/i);
  assert.match(delivery, /never report `visual_review: passed` without inspecting/i);
});

test('skill keeps deterministic delivery, automated browser evidence, and perceptual review distinct', () => {
  for (const [name, source] of [['SKILL.md', skill], ['delivery contract', delivery]]) {
    assert.match(source, /deliver[\s\S]*deterministic/i, name);
    assert.match(source, /visual-check[\s\S]*automated browser evidence/i, name);
    assert.match(source, /human|perceptual visual review/i, name);
  }
  assert.match(delivery, /manual browser record[\s\S]*all four exact viewport measurements, both endpoint themes, and an artifact-bound record/i);
});

test('handoff browser evidence mirrors only the automated visual-check outcome', () => {
  assert.match(delivery, /`browser_evidence`[\s\S]*records only the outcome of this automated command/i);
  assert.match(delivery, /`passed`[\s\S]*exit 0[\s\S]*receipt `status: "pass"`/i);
  assert.match(delivery, /`failed`[\s\S]*exit 1[\s\S]*receipt `status: "fail"`/i);
  assert.match(delivery, /`skipped`[\s\S]*exit 2[\s\S]*receipt `status: "skipped"`/i);
  assert.match(delivery, /runtime or capture failures[\s\S]*must not be normalized to `skipped`/i);
  assert.match(delivery, /remains `skipped` even when[\s\S]*`visual_review: passed`/i);
  assert.match(delivery, /manual browser record[\s\S]*never changes `browser_evidence`/i);
});

test('skill uses atomic verified delivery for the final artifact', () => {
  assert.match(delivery, /archify\.mjs deliver <type>/);
  assert.match(delivery, /same-directory candidate/i);
  assert.match(delivery, /only replaces the target after.*artifact checks pass/i);
  assert.match(delivery, /never claim that the deterministic receipt includes visual review/i);
});

test('skill keeps optional opening behind the verified commit and outside automation', () => {
  assert.match(delivery, /Add `--open` only when the user wants an immediate local preview/);
  assert.match(delivery, /runs after that atomic commit/);
  assert.match(delivery, /Keep it off for CI, unattended agents, and non-interactive environments/);
  assert.match(delivery, /never invokes an opener/);
  assert.match(delivery, /status proves only whether the local opener invocation succeeded/);
});
