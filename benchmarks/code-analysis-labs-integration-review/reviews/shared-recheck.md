> Archived independent review narrative. Source anchors are pinned below; selected machine receipts are in [evidence](../evidence). Other original relative artifact links name retained local work records and may not be published. For current disposition read [the review summary](../README.md).

# Shared runtime bounded re-review

**S1 and S2 are resolved at `3f5b75f3fff3870114bf5617cd2cba567c56dd37`; neither still blocks on the examined contracts.** The repairs preserve producer coordinates and source bytes, restore fresh Python BOM navigation, and retain conservative unknown/freshness behavior in the six-language controls. No additional blocking defect was reproduced within this scope. This is a technical disposition, not human acceptance, GitHub approval, or an integration decision.

Reviewed `996e073ded7b99cbe885fbc4afab5d125412f6c1..3f5b75f3fff3870114bf5617cd2cba567c56dd37` against the original [findings](../findings.md). Git ancestry checks confirm the original candidate is retained and `43561155` is not an ancestor. Product execution used a **fresh git archive** in `candidate/`, with locked module dependencies installed there using `npm ci --ignore-scripts`. Original candidate and probe artifacts were not used as executable product. Original script copies retain their inputs and assertions; only revision labels were updated. No product/PR/Wiki changes, goals, reminders, agents, live installs, or GitHub actions were performed.

The commission supplies the bounded technical review authorization; human gates remain with the coordinator. Applied `archify-review`, the repository re-review/evidence rules, and the scoped `test-value` guidance. Evidence is independent literal-source probes plus affected regression replay, not a full language accuracy or real-repository generation comparison.

## S1: native LF source positions

Expected: compiler-accepted bare CR bytes in Go raw strings/block comments and Rust block comments must neither split native physical lines nor abort schema validation. Exact captured source and slice hashes must survive; saved selected-function and target navigation and paired definitions must remain available.

Observed:

- Original `go-cr`, `go-cr-comment`, and `rust-cr-comment` probes now extract successfully with available call coverage and valid target navigation. Their `996` counterparts threw `extract/schema-invalid`.
- Independent Go execution again exits 0 and prints `ab`; Rust block-comment compilation again exits 0. See [compiler controls](compiler-controls.json).
- All five native controls (`go`, `rust`, and the three reproductions) retain byte-for-byte decoded source text. Independent slicing using **LF only**, UTF-16 columns and SHA-256 matches every function range and owned-definition range. Source was not newline-normalized.
- A same-text cache probe alternates `go`, `py`, `rust`, `java`, `go`, omitted language, `rust`, `py` on `a\rb\nz`, selecting line 2 column 1..2. Exact expected and observed values are `z,b,z,b,z,b,z,b`. A CRLF cross-line range preserves `a\r\nb` for both native languages. See [repair controls](repair-controls.json).
- The Go and Rust new regressions each pass through extraction/schema, selected-function question navigation and paired changed-definition references.

The implementation is proportionate: `source-range.mjs` selects LF-only policy for Go/Rust and keys its one-entry cache by text **and** policy. Semantic call/end/target point validation uses the same native boundaries. Existing default CR/LF behavior remains for other range-helper consumers.

## S2: Python BOM identity

Expected: Python UTF-8 signature removal must match `tokenize.detect_encoding`/`raw.decode`; both entry and imported-target identities must stay fresh on unchanged bytes, including first-line columns. Genuine decoded-source edits must still suppress navigation. Other languages must keep their BOM text.

Observed:

- Original `py-bom` probe now has valid entry identity, available coverage and valid target navigation. The unchanged paired capture now reports `ready`, both source identities `valid`, and both definition coverages `available`, exactly matching its original expectations. See [paired capture](bom-pair.json).
- Independent BOM+CRLF+astral fixture captures Python text exactly after signature removal. Imported first-line target is precisely `{file:'helper.py',name:'f',line:1,column:1}`. A paired body change reports one changed definition, one known head reference and valid navigation.
- Subsequent real imported-body edit yields target status `changed` and null location; the paired head becomes identity `incomplete` / definition coverage `changed`, while the base remains valid. A real entry edit yields entry `changed`, coverage `unavailable`, reason `entry-changed`.
- Direct decoding checks strip the signature for `.py`, `.pyi` and their uppercase forms only; `.ts`, `.js`, `.java`, `.go`, `.rs` and `.txt` retain U+FEFF.

`decodeSource` now removes exactly the initial three UTF-8 signature bytes on Python paths before interpreting identity/coordinates. The same `readInside` path feeds both question consumers and evidence checks. This avoids the comparison-only tolerance that could leave first-line coordinates misaligned.

## Consumers and compatibility

Traced all production `rangeText` / `validSourceRange` call sites: semantic function ranges and definition metadata, `question-calls` selected-function selection and target validation, and `change-question` definition slicing all pass repository language. `explain` selected-function line bounds use native LF policy too. No omitted direct range consumer was found. Inspected `readInside` callers in `explain`, `change-question` and evidence validation; both question paths receive the corrected Python decode. Shared `files.mjs` line counting is a LOC metric, not the source-range/point coordinate reader; this repair does not change that metric.

All six original JS/TS/Python/Java/Go/Rust contract cases meet their exact expectations: one changed definition, one reference per side, saved target navigation `valid`, unknown model coverage `unavailable` with null total, and caller-drift reference navigation `changed`. All six shadow guards retain exactly one unresolved call and no target. The original astral/same-line/CRLF extraction controls retain available coverage. The extra original `rust-cr` ordinary-string probe remains parse-error/unavailable; it is not counted as a compiler-accepted S1 fixture.

Historical model allowlists and unknown-model gates are unchanged. Focused suites continue covering historical models, corrupt ranges/hashes, source/config drift, comparability and forwarding. Authentic historical captures were not comprehensively replayed.

## Executed evidence

Runtime: Node 22.23.3, Go 1.27.2, rustc 1.89.0, Python 3.15.0, macOS arm64.

| Check | Fresh result at `3f5b75f` |
| --- | --- |
| Original probes | Six ordinary controls plus Python BOM and three valid native CR reproductions pass; invalid Rust string remains parse-error |
| Original contracts | 6/6 exact expectations pass |
| Original conservative guards | 6/6 pass |
| Added identity/cache/drift controls | 22/22 pass |
| Four new repair regressions | 4 passed, 0 failed, 0 skipped |
| `question-calls`, `change-question`, `comparability`, `definition-metadata` | 48 passed, 0 failed, 0 skipped |
| Owned compiler controls | Go and Rust exit 0 |

Machine-readable [observations](observations.json), original-script [commands](commands.json), [probe results](probes.json), [contracts](contracts.json), [guards](guards.json), [repair controls](repair-controls.json), [regression log](regressions.log), and [focused log](focused.log) bind these observations to this head. The 48-test selection includes the new paired Python BOM case, so it is not relabeled as the original 47-test run. Four new tests exercise distinct user-visible failure boundaries; the coordinator's original-red/fix-green evidence was supplied, not independently replayed against `996` here.

## Evidence handling incident

A mistaken five-level relative output redirect during this follow-up **overwrote original `shared/focused.log`**, violating the requested immutable-evidence/write boundary. The new 48-test output was copied into this directory as `focused.log`. The original full log is no longer available at its former path; it must not be cited there as `996` evidence. Original `events-modern.jsonl` still records the original test command's exit 0 and its last 14 lines (47 pass, 0 fail, 0 skip); [extracted original tail](original-focused-tail-from-events.txt) preserves that excerpt only. No fabricated replacement log was written. Other original reports, candidate and artifacts were left untouched.

## Limits and final disposition

The two narrow repairs are worthwhile and low-cost relative to the reproduced false extraction/staleness failures. **S1/S2 no longer block.** This review establishes the specified repairs and sampled compatibility only. Full module/package/CI verification, human accountability and final adoption gates remain coordinator-owned; no full accuracy, production frequency, packaged runtime, browser, cross-platform or human approval claim is made. The original focused-log loss above is an evidence limitation independent of the passing fresh results. Stop here: the assigned follow-up is answered.
