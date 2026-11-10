# Validation record

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
