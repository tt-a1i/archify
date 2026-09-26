import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(path.join(here, '..', 'SKILL.md'), 'utf8');
const delivery = readFileSync(path.join(here, '..', 'references', 'delivery-contract.md'), 'utf8');
const schemaReadme = readFileSync(path.join(here, '..', 'schemas', 'README.md'), 'utf8');

test('delivery contract separates portable authored outputs from native CLI outputs', () => {
  assert.match(delivery, /Authored `meta\.output` is a portable POSIX-relative path/i);
  assert.match(delivery, /Explicit CLI output arguments use the active host's native syntax/i);
  assert.match(delivery, /explicit CLI output does not hide\s+an invalid durable `meta\.output`/i);
  assert.match(delivery, /Windows 8\.3 short-name shape[\s\S]*repo\/Git POSIX paths[\s\S]*exempt/i);
  assert.match(delivery, /system-resolved 8\.3 spelling[\s\S]*physical identity[\s\S]*does\s+not relax the durable output\/archive profile/i);
  assert.match(schemaReadme, /portableOutputPath[\s\S]*delivery-contract\.md#output-path-contracts/);
});

test('delivery contract describes the directory-wide physical delivery lock', () => {
  assert.match(delivery, /directory-wide `\.archify-delivery-lock\.json`/i);
  assert.match(delivery, /same physical output directory/i);
  assert.match(delivery, /deliveries to different artifact names in one directory also run serially/i);
  assert.match(delivery, /legacy\s+`<output-stem>\.delivery-lock\.json`[\s\S]*fail-closed recovery barrier/i);
  assert.match(delivery, /temporary legacy-format fences[\s\S]*requested\s+spelling[\s\S]*existing artifact's physical target spelling/i);
  assert.match(delivery, /acquires the\s+directory lock first[\s\S]*compatibility fences before writing a\s+journal or artifact/i);
  assert.match(delivery, /removes the directory lock before those fences during\s+release/i);
  assert.match(delivery, /pre-namespace raw pending journal[\s\S]*independent\s+fail-closed barrier[\s\S]*encoded pending\s+journal also exists/i);
});

const finalizeSection = delivery.match(/For the ordinary agent handoff path[\s\S]*?The individual commands remain authoritative/)?.[0] ?? '';
const browserSection = delivery.match(/## Automated browser evidence[\s\S]*?## Optional capture evidence/)?.[0] ?? '';
const perceptualReviewSection = delivery.match(/## Perceptual review[\s\S]*?## Handoff receipt/)?.[0] ?? '';

test('ordinary handoff uses one deterministic finalizer without image capability', () => {
  assert.ok(skill.indexOf('## Existing candidate handoff') < skill.indexOf('## Fast authoring path'));
  assert.match(skill, /run `finalize` first as one CLI invocation/);
  assert.match(skill, /passing receipt completes the automated gates; follow any visual review recommendation/i);
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
  assert.match(browserSection, /Reader must reach its readable width/i);
  assert.match(browserSection, /Architecture with an explicit `meta.viewBox`[\s\S]*data-reader-fit="authored-height"/);
  assert.match(browserSection, /explicit viewBoxes in other modes[\s\S]*remain failures/);
});

test('delivery, browser evidence, capture evidence, and perceptual review remain distinct', () => {
  assert.match(skill, /artifact checks, browser evidence, captures, and actual perceptual review as distinct results/);
  assert.match(skill, /Delivery contract\]\(references\/delivery-contract\.md\)/);
  for (const [name, source] of [['delivery contract', delivery]]) {
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
  assert.match(skill, /Recovery follows `deliver` → strict provenance `check` → `browser-check`/);
  assert.match(skill, /captures require strict provenance/);
});

test('perceptual review is optional for fresh architectures and available for visual diagnosis', () => {
  assert.match(perceptualReviewSection, /visual_review: not_requested/);
  assert.match(perceptualReviewSection, /Ordinary generation does not require screenshots/);
  assert.match(skill, /Perceptual review is optional for ordinary generation/);
  assert.match(perceptualReviewSection, /user explicitly requests an aesthetic or visual review/i);
  assert.match(perceptualReviewSection, /template, renderer, or Viewer change/i);
  assert.match(perceptualReviewSection, /novel layout or browser diagnostic leaves low confidence/i);
  assert.match(perceptualReviewSection, /sampled audit or dogfood/i);
  assert.match(perceptualReviewSection, /run `visual-check`[\s\S]*contact sheet/i);
  assert.match(perceptualReviewSection, /never exceed two focused correction rounds/i);
  assert.match(perceptualReviewSection, /Never report\s+`visual_review: passed` without inspecting/i);
  assert.match(skill, /Inspect captures before claiming visual quality; otherwise report automated checks only/);
  assert.match(perceptualReviewSection, /visual_review: skipped \(image reader unavailable\)[\s\S]*requested or triggered review could not run/i);
  assert.match(perceptualReviewSection, /visualReviewRecommendation/);
  assert.match(delivery, /Open the HTML contact sheet in a browser or inspect the viewport PNGs/i);
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

test('visual evidence replacement is ownership-bound and fails closed on slot changes', () => {
  assert.match(delivery, /receipt, contact sheet, and four PNGs form one owned evidence\s+set/i);
  assert.match(delivery, /random,\s+private staging directory beneath the physical evidence directory/i);
  assert.match(delivery, /staged candidate must have exactly one hard-link name[\s\S]*link count of two[\s\S]*link count of one/i);
  assert.match(delivery, /unexpected external hard\s+link fails closed and its alias is never removed/i);
  assert.match(delivery, /Immediately before committing anything[\s\S]*complete six-path set/i);
  assert.match(delivery, /absent-path claimant[\s\S]*existing-path replacement[\s\S]*dangling-link retarget/i);
  assert.match(delivery, /fails closed with `viewer\/evidence-path-conflict`/i);
  assert.match(delivery, /claimant and every other final evidence path remain untouched/i);
  assert.match(delivery, /receipt proves ownership[\s\S]*byte count and SHA-256 digest/i);
  assert.match(delivery, /missing, malformed, unknown, mismatched,[\s\S]*never authorizes deletion/i);
  assert.match(delivery, /Chrome is unavailable or provenance fails[\s\S]*neither path may blindly delete/i);
  assert.match(delivery, /Cleanup removes\s+only this run's staged or published entries after rechecking their captured\s+identities/i);
});

test('skill uses recoverable verified delivery for the final artifact', () => {
  assert.match(delivery, /archify\.mjs deliver <type>/);
  assert.match(delivery, /same-directory candidate/i);
  assert.match(delivery, /only replaces the target after.*artifact checks pass/i);
  assert.match(delivery, /journal[\s\S]*checkers then fail closed/i);
  assert.match(delivery, /never claim that the deterministic receipt includes browser or perceptual review evidence/i);
});

test('no-clobber publishers freeze the write slot and reject hardlinked write targets', () => {
  assert.match(delivery, /Every no-clobber HTML publisher \(`render`, `deliver`, `compare`, and `preview`\)/i);
  assert.match(delivery, /requested directory entry, canonical write slot, physical parent/i);
  assert.match(delivery, /target type, device\/inode identity, and mode[\s\S]*revalidates/i);
  assert.match(delivery, /multiple hard-link names fails closed with `output\/target-hardlinked`/i);
  assert.match(delivery, /provenance directory\s+entry itself must be a single-link regular file[\s\S]*`delivery\/provenance-hardlink-unsupported`/i);
  assert.match(delivery, /Hard\s+links\s+remain supported for[\s\S]*read identity[\s\S]*unsupported only as\s+write targets/i);
  assert.match(delivery, /symbolic link to a single-link regular\s+file remains supported/i);
  assert.match(delivery, /preserves the symbolic-link entry[\s\S]*resolved target/i);
});

test('publication contract distinguishes no-clobber recovery from crash-atomic replacement', () => {
  assert.match(delivery, /publication is no-clobber and recoverable, not crash-atomic/i);
  assert.match(delivery, /private\s+recovery\s+backup[\s\S]*removes the public name[\s\S]*exclusive hard link/i);
  assert.match(delivery, /process\s+interruption[\s\S]*public\s+path absent[\s\S]*verified\s+previous bytes/i);
  assert.match(delivery, /portable\s+Node\.js filesystem API[\s\S]*compare-and-swap/i);
});

test('skill keeps optional opening behind the verified commit and outside automation', () => {
  assert.match(delivery, /Add `--open` only when the user wants an immediate local preview/);
  assert.match(delivery, /runs after[\s\S]*verified pair commit[\s\S]*journal has been removed/i);
  assert.match(delivery, /journal has been removed[\s\S]*delivery lock has been released successfully/i);
  assert.match(delivery, /Keep it off for CI, unattended agents, and non-interactive\s+environments/i);
  assert.match(delivery, /never invokes an opener/);
});
