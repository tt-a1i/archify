# Whole-repository first-contact baseline

This directory freezes the first-contact behavior of the existing Code Analysis
commands on Archify itself. It is evidence for a later change, not a claim that
the change is correct or that the product gained accuracy.

- Revision: `2877c1576610fe171c562f37cc53c5d6bb77e91a` (`#1301`)
- Node: `v22.23.3`
- Node package version string: not exposed by `archify --version` on this revision
- Analyzer: `@archify/code-analysis@0.1.0-dev.1`, adapter `typescript@5.9.3`

## Reproduce

From the repository root:

```sh
node archify/bin/archify.mjs code-analysis check . --out /tmp/archify-self-baseline --json
node archify/bin/archify.mjs code-analysis check . --language ts --out /tmp/archify-self-baseline --json
node archify/bin/archify.mjs code-analysis task /tmp/archify-self-baseline --finding COMP-2a6dc21b585e --root . --format json --out /tmp/archify-self-baseline/task-COMP-2a6dc21b585e.json
node archify/bin/archify.mjs code-analysis task /tmp/archify-self-baseline --finding COMP-a130c939bd0a --root . --format json --out /tmp/archify-self-baseline/task-COMP-a130c939bd0a.json
node archify/bin/archify.mjs code-analysis task /tmp/archify-self-baseline --finding COMP-b7239cec9f19 --root . --format json --out /tmp/archify-self-baseline/task-COMP-b7239cec9f19.json
```

The first command exits `2` with `extract/adapter-ambiguous`. The second exits
`1` because the default gate fails on warnings. The three `task` commands exit
`0` and report `evidence.status: "valid"`.

## What the current entry returns

| Artifact | Size | Read by the investigator | Contents used |
| --- | ---: | --- | --- |
| check JSON (`--json`) | 100 KB | yes | counts, verdict, `gate.failing`, `priorities`, `coverage`, `review` |
| `overview.json` | 188 KB | yes | `groups`, 504 finding records, 3 priority IDs |
| `findings.json` | 832 KB | yes | metadata and summary only; no locations or messages |
| `review.json` | 32 KB | no | — |
| `module-graph.json` | 28 KB | no | — |
| `raw-facts.json` | 43 MB | no | — |
| three `task` JSONs | 8–12 KB each | yes | `locations`, `facts`, `suggestions`, `acceptance`, `evidence` |

Check result on this revision:

```json
{"findings":504,"error":0,"warning":234,"info":270,"accepted":0,"offDiagram":504}
```

Rules: `coupling/import-cycle`, `coupling/cycle`, `coupling/hub`,
`coupling/internal-leak`, `complexity/function`. Of the 504 findings, 501 are
`complexity/function`. Coverage: 264 TypeScript files analyzed, 367 files
excluded by role, no parse errors, and other languages detected but not
analyzed: Python 28, Java 8, Go 1, Rust 27.

`priorities` is three bare IDs:

```json
["COMP-2a6dc21b585e","COMP-a130c939bd0a","COMP-b7239cec9f19"]
```

Their messages and `path:line` are only present in the 234-entry
`gate.failing` list (the same records are also in `overview.findings` without
message or location). The `task` command is the only artifact that carries
source excerpts, facts, suggestions, acceptance and evidence digests.

## Three leads verified against source

### 1. `COMP-2a6dc21b585e` — `compileDataflow.<locals>.build`

- Finding says complexity 227, nesting 6, 1517 lines.
- Source: `archify/renderers/dataflow/dataflow-compiler.mjs:63-1579`.
- Verified: `build` is a nested function inside `compileDataflow`; the module is
  1607 lines and the next sibling `attempt` starts at line 1581. The function is
  real, not a parser artifact.
- Judgment: a maintenance signal, not a defect. The function closes over the
  layout, measurement, routing and SVG emission helpers; a wholesale extraction
  would be a large, risky refactor. A bounded first step would extract one
  cohesive block (label-routing candidates around lines 1190–1260) behind tests.
- Tests: `test/dataflow-*.test.mjs` exercise the renderer, but none names
  `compileDataflow` directly.

### 2. `COMP-a130c939bd0a` — `semanticErrors`

- Finding says complexity 223, nesting 6, 207 lines.
- Source: `archify/modules/code-analysis/extract/shared/semantics.mjs:5-211`.
- Verified: the function is real. The complexity comes from enumerating schema
  and call-model invariants, especially the Rust `rust-source-direct-vN`
  compatibility gates.
- Concrete maintainability issue: the full version range is repeated as literal
  arrays in at least three files (`extract/shared/semantics.mjs`,
  `lib/question-calls.mjs`, `lib/change-question.mjs`; 14 distinct versions in
  each) while the current model is defined separately in
  `extract/rust/index.mjs:14`. There is no shared "model at least vN" helper.
- Judgment: a small, source-backed consolidation is defensible; the high
  complexity number itself is not the reason.

### 3. `COMP-b7239cec9f19` — `createReadableLayout`

- Finding says complexity 166, nesting 5, 429 lines.
- Source: `archify/renderers/workflow/workflow-compiler.mjs:236-664`.
- Verified: the function is real and contains column constraints, lane/group
  measurement, iteration and feedback constraints, plus the returned layout.
- Judgment: mostly inherent to layout constraint solving. The module has
  extensive contract tests (`test/workflow-*.test.mjs`). Without a concrete
  failing change, "maintain as is" is the honest recommendation.

## First-contact observations

1. **The first command fails without a scope decision.** `check .` exits `2`
   with `extract/adapter-ambiguous` for `ts|py|go|rust`. A first-contact agent
   must choose a language (or a config exclusion) before any findings exist.
2. **The priority list is not self-contained.** Three IDs must be joined by hand
   against 234 `gate.failing` records, then turned into evidence with a second
   command. The data exists, but no single artifact says "start here, this is
   the location, and this is how to drill".
3. **Complexity dominates the result.** 501 of 504 findings are
   `complexity/function`. The task text correctly calls this "a maintenance
   signal, not a defect", but the volume makes it easy to present a generic
   signal as a defect list.
4. **Coverage is present but easy to misread.** The TypeScript run leaves 27
   Rust, 28 Python, 8 Java and 1 Go file unanalyzed, and excludes 367 files by
   role. The check output names them, but a report that says "the project has
   504 problems" without those limits would overstate coverage.
5. **Documentation drift.** The top-level `code-analysis` usage line lists only
   `ts|py|java`, while `check --help` lists `go|rust`; the module README still
   says Rust is not supported.

## Clean-session baseline

An independent read-only agent received only the repository path and
“帮我看看这个项目”, with no findings, files, language rules or maintenance
targets preselected. Its transcript and measured effort are in
[clean-session-baseline.md](clean-session-baseline.md).

It found the analysis path and delivered a source-verified lead with no human
hint. It selected the vendor-path complexity findings first, then a real
`scripts` ↔ `website` cycle, then `commandDeliver` as “maintain as is with a
test gap”. It did not select the built-in `priorities`, and it did not treat the
501 complexity findings or the role/language exclusions as defects.

Measured cost: 58 tool uses, 2.34 M subagent tokens, 150.6 s, about 18 files and
artifacts read, including the 850 KB `findings.json`. That cost and the missed
vendor cluster are the baseline for the candidate comparison.

## Candidate and external validation

- [Candidate comparison](candidate-comparison.md): old vs new entry on Archify,
  scan counts and two clean sessions.
- [External validation](external/README.md): Python `requests` v2.32.3 and Rust
  `clap` at fixed revisions, with two independent requests sessions, a
  source-verified empty-string cookie bug, and a clap cycle fix. Patches, tests
  and re-analysis evidence are in `external/`.

The candidate is not an adoption claim. No maintainer reviewed it, no upstream
pull request was opened against either sample repository, and the external
requests session showed that a nine-finding repository does not benefit in cost
from the new entry.
