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
  assert.match(delivery, /never claim that the deterministic receipt includes visual review/i);
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
  assert.match(delivery, /runs after[\s\S]*verified pair commit[\s\S]*journal has been\s+removed/);
  assert.match(delivery, /journal has been removed[\s\S]*delivery lock has been released successfully/);
  assert.match(delivery, /Keep it off for CI, unattended agents, and non-interactive\s+environments/);
  assert.match(delivery, /never invokes an opener/);
  assert.match(delivery, /status proves only whether the local opener invocation succeeded/);
});
