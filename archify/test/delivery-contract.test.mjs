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

test('strict provenance check must succeed before visual-check', () => {
  const workflows = [
    {
      name: 'SKILL.md',
      section: skill.match(/After `deliver` exits zero, require current delivery evidence before handoff:[\s\S]*?node bin\/archify\.mjs visual-check <output\.html> --json --require-provenance/)?.[0] ?? '',
      check: 'node bin/archify.mjs check <output.html> --require-provenance',
      visualCheck: 'node bin/archify.mjs visual-check <output.html> --json --require-provenance',
    },
    {
      name: 'delivery contract',
      section: delivery.match(/Run strict `check` after `deliver` exits zero\.[\s\S]*?before collecting new\s+visual evidence\./)?.[0] ?? '',
      check: 'strict `check`',
      visualCheck: '`visual-check`',
    },
  ];

  for (const { name, section, check, visualCheck } of workflows) {
    const checkIndex = section.indexOf(check);
    const visualCheckIndex = section.indexOf(visualCheck);

    assert.notEqual(checkIndex, -1, `${name}: strict check command is documented`);
    assert.ok(checkIndex < visualCheckIndex, `${name}: strict check command precedes visual-check`);
    assert.match(
      section,
      /(?:after the strict `check` above exits zero[\s\S]{0,300}visual-check|visual-check`? only after that\s+strict check exits zero)/i,
      `${name}: visual-check requires a successful strict check`,
    );
  }
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

test('skill uses recoverable verified delivery for the final artifact', () => {
  assert.match(delivery, /archify\.mjs deliver <type>/);
  assert.match(delivery, /same-directory candidate/i);
  assert.match(delivery, /only replaces the target after.*artifact checks pass/i);
  assert.match(delivery, /journal[\s\S]*checkers then fail closed/i);
  assert.match(delivery, /never claim that the deterministic receipt includes visual review/i);
});

test('skill keeps optional opening behind the verified commit and outside automation', () => {
  assert.match(delivery, /Add `--open` only when the user wants an immediate local preview/);
  assert.match(delivery, /runs after[\s\S]*verified pair commit[\s\S]*journal has been\s+removed/);
  assert.match(delivery, /journal has been removed[\s\S]*delivery lock has been released successfully/);
  assert.match(delivery, /Keep it off for CI, unattended agents, and non-interactive\s+environments/);
  assert.match(delivery, /never invokes an opener/);
  assert.match(delivery, /status proves only whether the local opener invocation succeeded/);
});
