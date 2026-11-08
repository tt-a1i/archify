> Evidence correction: the original complete 47-test log was overwritten during follow-up. Only its original event-stream exit/tail survives. Do not read the current local focused.log as 996 evidence; the fresh 48-test re-review log is separate.

> Archived independent review narrative. Source anchors are pinned below; selected machine receipts are in [evidence](../evidence). Other original relative artifact links name retained local work records and may not be published. For current disposition read [the review summary](../README.md).

# Six-language shared runtime and compatibility review

**Disposition: two blocking reproduced defects (P2), plus required human acceptance and evidence decisions. No wrong-source target was reproduced in the examined controls.** The navigation capability is useful and the explicit model gates preserve valuable distinctions; the shared decoding and line-boundary assumptions need correction or an explicit maintainer deferral before acceptance. These are constructed counterexamples found during review, not naturally observed user incidents.

## Revision and authority

- Repository: `tt-a1i/archify`. Comparison: Labs `bf0a29e7664f52973d06a8e6a608df2db1ecbd39` → candidate `996e073ded7b99cbe885fbc4afab5d125412f6c1`: 632 changed files, 176 commits. The review considers the cumulative language/shared implementation, rather than only the final PR layer.
- All executed product code came from a `git archive` extraction of that exact candidate under `shared/candidate/`. Python `43561155e` code and its ZIP were not used. Product source and tracked tests were not edited. No analyzed upstream project was executed. Only owned Go/Rust fixtures were compiled/executed as semantic controls.
- Read `AGENTS.md`, `REVIEWING.md`, CONTRIBUTING evidence/compatibility/integration sections, archify-review and test-value skills. The explicit technical commission permits this inspection despite missing personal confirmations; it does not supply those confirmations or authorize integration.
- Evidence route: justified narrow source-contract review, independent literal-source fixtures and scoped existing reader tests. This is not a fresh real-repository generation comparison, compiler attribution benchmark, or production accuracy estimate.

## Blocking reproduced defect S1 — shared CR line splitting rejects compiler-accepted Go and Rust source

**Trigger:** A literal U+000D carriage return outside a CRLF pair inside a Go raw string or a Go/Rust block comment, before or inside a captured definition. The fixture uses actual CR bytes, not a backslash escape.

Minimal Go source, shown with `\r` standing for the actual CR byte:

```text
package main
func f() string { return `a\rb` }
func main() { println(f()) }
```

Minimal Rust source:

```text
/* a\rb */ pub fn f()->i32 {1} pub fn run()->i32 {f()}
```

**Expected and independent basis:** Extraction should accept these valid source inputs and retain exact UTF-16 coordinates/digests. The owned Go fixture compiles/runs with Go 1.27.2, exit 0, printing `ab` (stderr). The owned Rust block-comment fixture compiles with rustc 1.89.0, exit 0. Producer coordinate code also explicitly uses LF boundaries: [Go extract.go:242](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/extract/go/extract.go#L242) uses physical token positions and scans back to `\n`; [Rust main.rs:256](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/extract/rust/src/main.rs#L256) counts/splits `\n`. Python's universal newline rules cannot be transferred to these consumers.

**Observed:** Both adapters' output is rejected by `extractFacts` with `extract/schema-invalid`. Go reports exact-definition hash/range errors plus calls outside captured source; the Rust block-comment fixture also reports definition range and call point failures. The Go block-comment variant reproduces the same defect. Normal CRLF/astral controls pass.

**Location/root cause:** [source-range.mjs:8](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/extract/shared/source-range.mjs#L8) treats a bare CR as a newline for every language. [semantics.mjs:72](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/extract/shared/semantics.mjs#L72) repeats that assumption in call/target point validation for Go and Rust. Thus fixing only the range hash check would leave point validation inconsistent. [analysis.mjs:95](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/lib/analysis.mjs#L95) turns the validation mismatch into failure of the whole extraction.

**Reproduce from this report directory:**

```sh
export PATH=/Users/tsk/.local/share/archify-tuning/rounds/pr671-20261025/tools/node-v22.23.3-darwin-arm64/bin:$PATH
node probe.mjs go-cr
node probe.mjs rust-cr-comment
go run fixtures/go-cr/entry.go
rustc --crate-type lib fixtures/rust-cr-comment/src/lib.rs -o rust-cr-comment.rlib
```

The probe catches the extractor exception and exits 0; `extractOutcome: "threw"` and diagnostics describe the actual failure. The two compiler commands exit 0 independently. See [probes.json](probes.json), [reproduction-commands.json](reproduction-commands.json) (exact argv, cwd, output and exit), [commands.json](commands.json), and literal byte fixtures under `fixtures/`.

**Impact:** One valid source file can abort the selected-language analysis, including graph generation and question capture. No wrong navigation escapes validation. Frequency in production was not measured. Preserve language-appropriate newline interpretation without changing the captured source bytes or offsets.

## Blocking reproduced defect S2 — unchanged UTF-8-BOM Python files are always stale to question readers

**Trigger:** A `.py` file beginning with UTF-8 BOM bytes `EF BB BF`, freshly extracted with Python2 (`python-lexical-v2`), then investigated with no disk edits. Owned source after the BOM is `def f(): return 1\ndef run(): return f()\n`.

**Expected and source-backed basis:** Fresh extraction followed by a read of the identical file should retain valid source identity and available coverage. [extract.py:379](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/extract/py/extract.py#L379) uses `tokenize.detect_encoding` and decoding, which removes the Python UTF-8 signature. [evidence.mjs:90](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/lib/evidence.mjs#L90) already documents this producer difference and handles BOM variants for the older evidence-location path. The question workflow requires source freshness, not equality between inconsistent decoding policies.

**Observed:** Extraction succeeds and captures the `run`→`f` target, but the saved question immediately reports `entry.factsStatus: "changed"`, calls coverage `"unavailable"`, reason `"entry-changed"`, and no navigable records. Freshly capturing both sides from that same unchanged root yields `status: "partial"`, both source identities `"incomplete"`, and both definition coverages `"changed"`. Re-extraction cannot repair this false-stale state.

**Location/root cause:** [evidence.mjs:75](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/lib/evidence.mjs#L75) returns `buffer.toString('utf8')` when the BOM is present, retaining U+FEFF. [explain.mjs:104](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/lib/explain.mjs#L104) compares that directly with the producer's stripped text. [change-question.mjs:58](https://github.com/tt-a1i/archify/blob/996e073ded7b99cbe885fbc4afab5d125412f6c1/archify/modules/code-analysis/lib/change-question.mjs#L58) does the same. The older `variants()` helper is not used by either question path.

**Reproduce from this directory:**

```sh
node probe.mjs py-bom
node bom-pair.mjs
```

Both wrappers exit 0 and write observed/expected records. See [probes.json](probes.json) (`py-bom`) and [bom-pair.json](bom-pair.json). The fixture is created by the first command; the second captures both sides anew without changing it.

**Impact:** Valid BOM-encoded Python sources lose saved function/call navigation and fresh paired definition analysis. This fails closed and does not produce wrong target locations. Align the question reader's decoded identity with the extractor; simply tolerating a BOM in comparison without aligning coordinate text would require care for first-line columns.

## Local evidence and inspected scope

Runtime: official Node 22.23.3 / bundled zlib `1.3.1-e00f703`, Go 1.27.2, rustc/cargo 1.89.0, Python 3.15.0, macOS arm64. Canonical Node was prepended to inherited PATH; Cargo remained available. Locked module dependencies were installed using `npm ci --ignore-scripts` only under the owned candidate extraction. No toolchain or live Skill was installed.

| Scope | Independent observation |
| --- | --- |
| JS + TS, `js-ts-lexical-v5` | Read callsite/checker identity, forwarding/export traversal, observed writes/eval guards and shared consumers. Literal one-hop forwarding preserves changed-definition references; parameter shadow stays unresolved; astral/same-line/CRLF navigation valid. |
| Python, `python-lexical-v2` | Read lexical scope events, direct imports/one-reexport target selection, exact ranges and decoding. One-reexport reference retained; parameter shadow unresolved; BOM defect reproduced. No module-qualified Python3 behavior used. |
| Java, `java-static-lexical-v5` | Read invocation inventory, fixed-arity/public/static selection, type/value blockers, project/ancestry evidence passed into shared readers. Direct class-qualified reference retained; value qualifier shadow unresolved; astral/same-line/CRLF identity valid. No independent Maven effective-model or inherited-chain oracle run. |
| Go, `go-source-direct-v3` | Read physical UTF-16 positions, go/types target object lookup, concrete-selection/uniqueness guards and metadata capture. Direct reference retained; function parameter shadow unresolved. Probes use `stdlib:false`; SDK typing not independently benchmarked. |
| Rust, `rust-source-direct-v4` | Read byte→UTF-16 conversion, value/type scope checks, model-specific target emission, crate-context disagreement suppression and physical-fact deduplication; shared readers/schema. Cross-module free reference retained; generic type-name shadow unresolved; CR defect reproduced. No independent lifetime/specialization compiler-attribution cohort. |
| Shared changed definitions / freshness | Six literal base/head pairs: one changed definition and one known reference each side; saved navigation valid, later caller drift suppresses navigation. Unknown call model in each language gives unavailable coverage and null total. See [contracts.json](contracts.json). |
| Conservative unknowns | Six independently authored shadow cases each produce one unresolved record and no target. See [guards.json](guards.json). |
| Existing affected regression tests | `question-calls`, `change-question`, `comparability`, `definition-metadata`: 47 passed, 0 failed, 0 skipped, exit 0. See [focused.log](focused.log). Reused assertions supplement independent controls; they are not called an independent semantic oracle. |

Historical model allowlists and optional definition metadata were traced through schema/semantic checks and both question readers. Existing focused tests cover historical/unknown models, same-line identity, duplicate slots, corrupt hashes, source/config drift and forwarding freshness. This review did not independently replay authentic earlier captures; older Go/Rust/Java revisions and all historical artifact shapes remain less strongly verified than the current six tiny controls. No base/candidate production accuracy metric is claimed.

## ZIP validation — separate from runtime and CI

The tracked candidate `archify.zip` hashes to `bb2f38587109acd1b73e97d58ce987b8db56af0c9ad58988665340e668286e4b`, matching the supplied pin. All **170** archived code-analysis files are byte-identical to the pinned source extraction, including the defective helpers. See [zip-validation.json](zip-validation.json). This was a content/digest check: no local canonical ZIP rebuild, extracted-package runtime run, live install, or cross-platform package acceptance was performed. Source runtime conclusions transfer to the compared module bytes; that is not a new packaged CLI acceptance run.

## Inherited CI evidence — not locally rerun or independently verified here

The commission and PR body attribute successful run [42442200073](https://github.com/tt-a1i/archify/actions/runs/42442200073) to `996e073ded7b99cbe885fbc4afab5d125412f6c1`. PR body claims include 410 module tests, full/browser/ZIP/WebM/website/three-platform package/Windows gates. Those remain **inherited author/CI evidence at that head**, not results of this reviewer. Job logs and complete generation/accuracy reports were not independently audited. The two counterexamples are not contradicted by a green run that omits them.

## Actual merge state and required decisions

A read-only GitHub connector query during this review returned PR #1279 **open, Draft, merged=false, merged_at=null**, head `996e073ded7b99cbe885fbc4afab5d125412f6c1`, base `codex/java-declared-project-deps-20261108` at `196dd3569efba785d456a6dd0825ea6ebdf489bf`. See [pr-state.json](pr-state.json). The API's non-null `merge_commit_sha` is not evidence of a completed merge. Native stack membership/complete merge set was not independently queried, and no approval or merge was attempted.

**Required human decision/evidence:** The PR body still has an unchecked personal review confirmation. The technical commission is not that confirmation. The maintainer must resolve contributor accountability, exact cumulative adoption/merge scope, and adequacy of real-repository accuracy/generation evidence before final acceptance; the bounded review does not establish those requirements. The coordinator owns fixes, deferral decisions and any final-head validation/publication.

**Nonblocking limitations:** No wrong-source target was found in the inspected samples, but this is not exhaustive language attribution. Dynamic value flow, full Java classpaths/overload typing, external Go typing, Rust expansion/inference and runtime dispatch remain declared unknowns. Current navigation intentionally checks captured evidence rather than whole-project live re-resolution (`docs/FUNCTION-ANALYSIS.md:76–83`); changed unrelated inputs must not be represented as a newly reproduced wrong-target defect without a contract violation. Production frequency and broader historical compatibility require evidence beyond these controls.
