# Clean-session baseline transcript

An independent agent received only the repository path and “帮我看看这个项目”.
It was read-only and was not told that Code Analysis existed or which findings to
consider. This is a paraphrase of its returned report; the measured figures are
from the task record.

## Measured effort

- Measured duration: 150.6 s
- Tool uses: 58
- Subagent tokens: 2,344,087
- Shell commands: about 26; files/artifacts read: about 18
- Self-reported backtracking: 3
- Human hints: none

## What it did

1. Read the root manifest, recent commits, README, skill files and the Code
   Analysis module README.
2. Found `archify code-analysis check` and ran it on the repository with
   `--language ts --out /tmp/archify-analysis --json`.
3. Chose TypeScript unguided because 631 of 695 source files are JS/TS and the
   module README said Rust was unsupported.
4. Read `check` JSON (99 KB), `overview.json` (189 KB), `findings.json`
   (850 KB), `review.json`, `module-graph.json` and the top-level keys of
   `raw-facts.json` (44.8 MB).
5. Selected three leads by reading the diagnostics, verified each in source, and
   reported the decisions below.

It did not run a second analysis, build an IR, or use `task`; it read source
directly. It did not mine `raw-facts.json` beyond key inspection.

## Leads it selected (not the built-in priorities)

### 1. Vendored minified bundles produce 56 complexity findings (selected first)

- Example: `COMP-9ad3b80f0df4` plus 55 siblings across 12 files.
- Source verified: `archify/story/vendor/html-parser.mjs` is one minified line;
  `archify/explainer/vendor/pele/chunks/*.js` are 1–9 line bundles. The analyzer
  reports complexity 132 / 109 / 97 on them.
- Root cause: `config/defaults.json` has `test` and `generated` roles only;
  `vendor/` is skipped by the internal-leak rule but not by complexity.
- Recommendation: add `**/vendor/**` to `roles.generated` and test that a
  minified vendor file yields no complexity finding.
- Scope, not accuracy: these 56 findings measure real complexity in third-party
  bundles. The defect is that first-party analysis counts them, not that the
  measurements are wrong.

This claim was independently checked: the baseline has 56 findings under
`/vendor/`, all in 12 files; the default roles do not include vendor; excluded
roles suppress findings (0 findings in `test/` or `generated-*` paths). The
candidate applies this recommendation.

### 2. Real `scripts` ↔ `website` cycle

- `COUP-af9d4e4a189e`, `coupling/cycle`, info, modules `scripts` + `website`.
- Verified: `scripts/build-gallery.mjs:11` imports
  `../website/src/data/gallery-presentation.mjs`, whose line 1 imports
  `../../../scripts/site-copy.mjs`; the latter supplies
  `DIAGRAM_TYPE_LABELS` used at `gallery-presentation.mjs:234`.
- Recommendation: move the frozen label constants to a neutral module and have
  both sides import it; re-run the gallery build into a temp directory and diff.

### 3. `commandDeliver` is large but should stay as one function

- `COMP-fa6e3d1b92b5`, `archify/bin/archify.mjs:4409`, 938 lines,
  complexity 127.
- Source verified: a staged pipeline with many `stage:` receipts and shared
  mutable state (`outputPath`, `deliveryOwnership`, `recoveryRequired`,
  `stagingDirectory`) that every stage must preserve. Splitting would move the
  state, not remove it.
- Recommendation: maintain as is; add one CLI test forcing a prepare-stage
  directory failure and asserting the `stage: 'prepare'` receipt and exit code.
- The agent reported no test matching `delivery/prepare-directory`; this was not
  independently re-run here.

## False-defect checks it reported

- It did not treat the 501 complexity findings as defects; it quoted the
  analyzer's “maintenance signal, not a defect” wording.
- It treated the 367 role exclusions as deliberate (303 test files), and the
  other-language files as an explicit scope limit rather than a defect.
- It recognized exit 1 as the default warning gate, not a tool failure.

## Dead ends it disclosed

- A `grep --include=*.mjs` command failed under zsh and it switched tools.
- It guessed the shape of `findings.json` wrong twice; details live in
  `diagnostics`, not a top-level `findings` array.
- It did not exercise the diagram-overlay path or the 64 non-JS files.

## Baseline conclusion

The current output was sufficient to find a real, source-verified lead with no
human hint. The cost was high: 58 tool uses, 2.34 M tokens and reading an 850 KB
finding list. The built-in `priorities` were not the leads the agent chose; it
found a false-positive cluster that the priority list did not surface. This is
the gap the candidate addresses.
