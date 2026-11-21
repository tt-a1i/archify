# Validation record

The original experiment below is historical evidence for `563508ce4`, not a
fresh test of the Labs port. The later PR body records the `7b75aec67` run.

## Command-shell follow-up (2026-11-12)

This follow-up fixes PR #1338's Command Prompt review finding relative to
`7b75aec670c1bedbc554268b154b56d525389153`, retaining the Labs target at
`91270ea08d53baf676bd2270d7805233a8798351`. The evidence in this section applies
to the source and archive in the commit that adds this section.

- Windows receipts explicitly target `cmd.exe`; other hosts target POSIX sh.
  Both lead commands and the drill-down template use the same formatter.
  Ordinary Windows paths use readable native quoting. `%`/`!` paths use a
  Node argv launcher because cmd expands those characters even inside quotes.
  The quoted `<id>` placeholder is an argument rather than shell redirection.
- This is a local CLI command-formatting change. Analysis findings, task
  contents, diagram generation, and defaults are unchanged. Roll back the
  follow-up commit to restore the prior formatting.
- Linux, official Node 22.23.3 / zlib `1.3.1-e00f703`: source focused tests
  (`check-coverage.test.mjs` and `task-command-shell.test.mjs`) **9/9 passed**,
  zero skips. The shell suite executes the command through `/bin/sh`, compares
  exact argv for CLI/output/root paths containing spaces, apostrophes,
  metacharacters and trailing separators, verifies exit 2 propagation, and
  prepares an actual task whose evidence is `valid`.
- Unpacked ZIP: the same shell suite **3/3 passed**, zero skips, after installing
  the package's locked module dependencies. Two canonical ZIP builds were
  byte-identical: **431 entries**, SHA-256
  `c85655b4a50f38155806e2b0e2d14b968dd748c6839d500e04b0ddb5a4bd0c9e`.
- Core smoke: **19/19 passed**, zero skips, with `NODE_NO_WARNINGS=1`. The first
  run had 17 passes and 2 failures (one child assertion plus its parent) because
  this cloud runtime's injected Node proxy warning polluted a diagnostic
  stream. Suppressing runtime warnings made the unchanged smoke pass.
- Full module run with real jscpd 5.4.3: **441/532 passed, 91 failed, zero
  skipped**. All failures report unavailable language tooling: 25 Go helper
  failures (the `go` executable here is not the Go compiler) and 66 Cargo/rustc
  helper failures. This is not a full local pass; final-head CI must supply
  the complete module result.
- Native Windows is not available locally. CI now explicitly runs the shell
  suite under real `cmd.exe`, with delayed expansion enabled, on Windows Node
  22 and 24. Those final-head job logs, not unrelated green checks, must confirm
  Windows acceptance. Native Windows verification is pending at commit time.
- Scoped test-value review replaced text-only confidence with actual command
  execution. Focused simplification review unified the two command producers;
  no broader refactor was warranted. Independent code inspection found no
  blocker, but is not runtime or human acceptance.

AI-assisted implementation, tests and documentation: OpenAI Codex; model
identity is unavailable. No human review or acceptance is asserted here.

## Original experiment

## Environment

- Source CLI: Node v22.23.3, macOS arm64.
- Canonical ZIP build: official Node v22.23.2 with bundled zlib
  `1.3.1-e00f703` from `/private/tmp/node-v22.23.2-darwin-arm64/bin`.
- Product revision tested: commit `563508ce4` on
  `codex/whole-repo-investigation`, based on
  `2877c1576610fe171c562f37cc53c5d6bb77e91a`.

## Source tests

```sh
cd archify/modules/code-analysis && npm test
# 475 tests, 475 passed, 0 failed

npm run test:core
# 19 tests, 19 passed, 0 failed
```

The module suite includes the new `investigation` assertions, the vendor-role
regression, and the regenerated task fixtures. The root core smoke exercises the
public CLI diagram path; it was run with the repository's installed
`node_modules`.

## Source CLI

```sh
node archify/bin/archify.mjs code-analysis check . --language ts --out /tmp/archify-candidate --json
```

- Exit 1 (default warning gate), 448 findings: 210 warning, 238 info.
- `ruleCounts`: 445 complexity, 2 internal-leak, 1 cycle.
- `investigation.leads`: three self-contained records with `where`, `symbol`,
  `message`, `impact`, and a runnable `task`.
- 0 findings under `/vendor/`; 22 vendor files are excluded as generated.
- The emitted task command was run against `requests` v2.32.3 and returned
  `evidence: "valid"` with `locations: ["src/requests/models.py:137"]`.

## ZIP

```sh
scripts/build-zip.sh /tmp/archify-whole-repo-investigation.zip
```

- 405 files, 7.3 MB.
- SHA-256: `f7b697c157cf4e310efb16f6a66ab8e9e723f91124e7acd5f3702ca207cf5d58`.
- The unpacked archive contains `openRuleCounts`, `investigation`, `ruleCounts`,
  and the vendor role defaults.
- `npm ci` in `archify/modules/code-analysis` from the unpacked archive passed.
- Packaged CLI on `requests`: exit 0, 9 info findings, three leads with
  locations and task commands; the emitted task returned valid evidence.
- Packaged CLI on the unpacked `archify/` package: 343 findings (the archive
  excludes the repository tests), `investigation` present, 0 vendor findings.

## External cases

- `requests` v2.32.3 (`0e322af`): two independent old/new-entry sessions both
  found the empty-string cookie bug. The regression test fails on the original
  and passes on the one-line fix.
- `clap` `ec93e71`: deleting one unused import removes the two-file cycle;
  `cargo check -p clap_builder` and 83 library tests pass; re-analysis drops
  28 → 27 findings and 4 → 3 import cycles.

## Review delivery

Draft PR #1303 adds the two commits after `2877c157` on
`codex/whole-repo-investigation`. The Code Analysis module is absent from
`main`, so the review base is `codex/code-analysis-labs-review-candidate`, the
review head of #1301. The stack does not retarget or edit #1301, and nothing is
merged.

## Not validated

- No maintainer feedback was obtained for any case, so adoption is not claimed.
- The clap and requests patches were validated in temporary copies only; no
  pull request was opened against either sample repository.
- The ZIP was built from the committed revision but not from an isolated clean
  checkout; the staging script selects tracked files and excludes node_modules.
- Agent-session measurements are single runs; they show direction, not a
  statistically controlled effect.
