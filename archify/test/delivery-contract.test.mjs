import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(path.join(here, '..', 'SKILL.md'), 'utf8');
const delivery = readFileSync(path.join(here, '..', 'references', 'delivery-contract.md'), 'utf8');

const finalizeSection = delivery.match(/For the ordinary agent handoff path[\s\S]*?The individual commands remain authoritative/)?.[0] ?? '';
const browserSection = delivery.match(/## Automated browser evidence[\s\S]*?## Optional capture evidence/)?.[0] ?? '';
const optionalReviewSection = delivery.match(/## Optional perceptual review[\s\S]*?## Handoff receipt/)?.[0] ?? '';

test('ordinary handoff uses one deterministic finalizer without image capability', () => {
  assert.ok(skill.indexOf('## Existing candidate handoff') < skill.indexOf('## Fast authoring path'));
  assert.match(skill, /run `finalize` first as one CLI invocation/);
  assert.match(skill, /passing receipt completes the handoff; screenshots and an image-capable model are optional/i);
  assert.match(skill, /archify\.mjs finalize <type> <candidate\.json> <output\.html> --quality showcase --json/);
  assert.match(skill, /When the user supplies a frozen candidate[\s\S]*?run `finalize` first as one CLI invocation/);
  assert.match(skill, /Once the complete first candidate is written, run `finalize` directly\. Its first gate is showcase validation/);
  assert.doesNotMatch(skill, /node bin\/archify\.mjs deliver <type> <candidate\.json> <output\.html>/);

  assert.match(finalizeSection, /`browser-check --require-provenance`/);
  assert.match(finalizeSection, /stops at the first failed or skipped stage/i);
  assert.match(finalizeSection, /Complete stage\s+receipts and timings[\s\S]*<output-stem>\.finalize\.json/i);
  assert.match(finalizeSection, /visualReview: "not-requested"/);
  assert.match(finalizeSection, /does not create images or require a perceptual reviewer/i);
  assert.match(finalizeSection, /Merely\s+naming the gates or requiring each one to pass does not require replaying their\s+standalone commands/);
});

test('required browser evidence stays deterministic and capture-free', () => {
  assert.match(browserSection, /browser-check <output\.html> --json --require-provenance/);
  assert.match(browserSection, /1440×900, 1600×1000, 1920×1080, and\s+2048×1320/);
  assert.match(browserSection, /creates one\s+`<output-stem>\.browser-check\.json` receipt and no screenshots or contact sheet/i);
  assert.match(browserSection, /visualReview: "not-requested"/);
  assert.match(browserSection, /Reader reaches its projected text floor/i);
});

test('delivery, browser evidence, capture evidence, and perceptual review remain distinct', () => {
  for (const [name, source] of [['SKILL.md', skill], ['delivery contract', delivery]]) {
    assert.match(source, /deliver[\s\S]*deterministic/i, name);
    assert.match(source, /browser-check[\s\S]*browser evidence/i, name);
    assert.match(source, /visual-check[\s\S]*capture|screenshots/i, name);
    assert.match(source, /human|perceptual review/i, name);
  }
  assert.match(delivery, /Passing one claim never implies the others/i);
  assert.match(delivery, /Never claim that the deterministic receipt includes browser or perceptual review evidence/i);
});

test('strict provenance succeeds before either browser command', () => {
  const ordering = delivery.match(/Run strict `check` after `deliver` exits zero\.[\s\S]*?collecting new browser evidence\./)?.[0] ?? '';
  assert.match(ordering, /Run `browser-check` or optional\s+`visual-check` only after that strict check exits zero/i);
  assert.match(skill, /required order stays `deliver` → strict provenance `check` → `browser-check`/);
  assert.match(skill, /Run optional `visual-check` only against a strict-provenance artifact/);
});

test('perceptual review is an explicit risk escalation with a bounded correction loop', () => {
  assert.match(optionalReviewSection, /visual_review: not_requested/);
  assert.match(optionalReviewSection, /user explicitly requests an aesthetic or visual review/i);
  assert.match(optionalReviewSection, /template, renderer, or Viewer change/i);
  assert.match(optionalReviewSection, /novel layout or browser diagnostic leaves low confidence/i);
  assert.match(optionalReviewSection, /sampled audit or dogfood/i);
  assert.match(optionalReviewSection, /run `visual-check`[\s\S]*contact sheet/i);
  assert.match(optionalReviewSection, /never exceed two focused correction rounds/i);
  assert.match(optionalReviewSection, /Never report\s+`visual_review: passed` without inspecting/i);
  assert.match(skill, /Model image capability is optional/i);
  assert.match(delivery, /single `\.visual-check\.contact\.png` is the image-reader entry point/i);
});

test('handoff browser evidence mirrors only browser-check outcomes', () => {
  assert.match(browserSection, /`browser_evidence`[\s\S]*records only the outcome of this automated\s+command/i);
  assert.match(browserSection, /`passed`[\s\S]*exit 0[\s\S]*receipt `status: "pass"`/i);
  assert.match(browserSection, /`failed`[\s\S]*exit 1[\s\S]*receipt `status: "fail"`/i);
  assert.match(browserSection, /`skipped`[\s\S]*exit 2[\s\S]*receipt `status: "skipped"`/i);
  assert.match(browserSection, /Runtime failures[\s\S]*must not be normalized to\s+`skipped`/i);
  assert.match(delivery, /Derive `browser_evidence` only from the latest artifact-bound `browser-check`\s+receipt/i);
  assert.match(delivery, /visual_review: not_requested\|passed\|skipped \(image reader unavailable\)\|failed/);
});

test('verified delivery remains recoverable and optional opening stays after commit', () => {
  assert.match(delivery, /archify\.mjs deliver <type>/);
  assert.match(delivery, /same-directory candidate/i);
  assert.match(delivery, /only replaces the target after.*artifact checks pass/i);
  assert.match(delivery, /journal[\s\S]*checkers then fail closed/i);
  assert.match(delivery, /Add `--open` only when the user wants an immediate local preview/);
  assert.match(delivery, /runs after[\s\S]*verified pair commit[\s\S]*journal has been removed/i);
  assert.match(delivery, /journal has been removed[\s\S]*delivery lock has been released successfully/i);
  assert.match(delivery, /Keep it off for CI, unattended agents, and non-interactive\s+environments/i);
  assert.match(delivery, /never invokes an opener/);
});
