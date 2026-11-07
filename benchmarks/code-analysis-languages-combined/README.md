# History-preserving six-language candidate

Local integration candidate based on TS #1261 `cbc557b7b616dfc1dde2a6b2a7e04af32c9b5d54`, itself above JS #1260 in native stack #1262. It composes preserved Rust #1258 (including Go #1256 and frozen #1255), independent Java #1259 and the existing Labs CI baseline repair #1242. Python #1252 and all original contributed ancestors remain. Exact ancestry assertions and source head are in `evidence/parity.json`.

These are local Git history-composition merges, not GitHub PR merges. Original commits/authors and separately owned PRs are retained; do not later merge both a combined candidate and its original slices without reconciling overlap. No approval, formal merge, release or live installation. The new integration layer is not yet published as a Draft or remotely tested at this checkpoint.

## What changed during composition

- Go/Rust and JS/TS already shared compatible consumer additions; the binary ZIP required regeneration.
- Java's v2 model conflicted with the separately added native model guards in semantic validation, question calls, paired coverage and schema. The resolution accepts the union: JS/TS v1–v4, Python v1, Java v1/v2, Go source-direct v1 and Rust source-direct v1. Original model-specific restrictions, freshness checks and native ranges remain. No new language resolver rule.
- Shared schema accepts Java qualified targets and both native direct-function targets, keeping each target shape/model check. Extractor revisions are preserved: TS21, Java7, native per-language contracts unchanged. No historical capture relabeled.
- Existing #1242 README proof/DSH docs repair is included with its original two commits. The previously failing README motion-proof test now passes locally (14passed/1Windows-onlyskip); DSH docs7/7. This is a tested candidate composition, not a repair already in Labs or in the older language Draft heads.
- Each original ZIP was an incompatible generated-artifact overlap. This candidate regenerates one cumulative ZIP; it does not choose one language branch's old archive as the integration result.

## Real CLI replay, kept separate by language

Original source answers and version pins remain in their owning benchmark directories. This round replays them without adding them as new independent accuracy samples or tuning on a new holdout.

| Language | Finite correct / wrong / missed | Preserved unknowns and limits |
| --- | --- | --- |
| Go | 9 /0 /0; zero omitted | 5reasonableunknowns; Cobra changed definition7knownreferences on each side. Ordinary/alias free functions only; not interfaces/method dispatch or complete build semantics. |
| Rust | 9 /0 /0; zero omitted | 2reasonableunknowns; regex/serde_json pairs remain partial, with their actual nonzero exits. Declared cfg/features/workspace source profile; not expanded macros/trait dispatch or successful Cargo compilation. |
| Java | 3 /0 /0 | SLF4J provider/interface call remains unknown. Bounded public class-qualified static paths; overloads/inheritance/value qualifiers remain unsupported. |
| JavaScript | 2 /0 /0 | 2reasonableunknowns; Prettier real loader pair1knownreference per side, stillpartial. Factory/callback identity not guessed. |
| TypeScript | 6 /0 /1 | 1reasonableunknown; known Redux barrel target remains a miss. Configured captured aliases, not runtime module loading. |
| Python | 5 /0 /0; zero omitted | 5unknowns; Click/Jinja source profile, ordinary local imports only. Dynamic/decorated/member targets remain unsupported. |

**Do not sum these as a general precision/recall metric.** Their denominators, source scopes and exposure differ. The earlier Java and JS/TS independent compiler audits remain supplemental at their recorded heads; they are not re-run or relabeled as new-head compilation evidence here.

All six normal source CLI recipes and their extracted-ZIP counterparts passed their original graders. **17 raw-facts captures are byte-identical;20 saved/paired questions agree after only output/install paths are normalized.** The recorded exits, configuration and profile limitations are preserved in each language's source/ZIP report. `--fail-on never` check exits do not mean no findings. JS/Rust partial paired outputs remain partial/nonzero.

Reuse the original replay scripts with the candidate's `archify/bin/archify.mjs`:

```sh
python3 benchmarks/code-analysis-go-rust/run-go.py --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/combined-go-source
python3 benchmarks/code-analysis-go-rust/run-rust.py --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/combined-rust-source
python3 benchmarks/code-analysis-java-cross-file-static-calls/run.py --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/combined-java-source
python3 benchmarks/code-analysis-js-default-reference-calls/run.py --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/combined-js-source
python3 benchmarks/code-analysis-ts-captured-alias-calls/run.py --cli archify/bin/archify.mjs --sample /fixed/samples/redux --out /runs/combined-ts-source
python3 benchmarks/code-analysis-python-import-calls/run.py --cli archify/bin/archify.mjs --sources /fixed/samples --out /runs/combined-python-source --product-sha <candidate-sha>
```

For ZIP use its extracted entrypoint and the matching `combined-<language>-zip` output directory. Install the existing module dependencies in source and package; Go/Rust toolchain requirements remain those of their original language reports. The original projects are never executed. Then:

```sh
python3 benchmarks/code-analysis-languages-combined/verify.py \
  --work /runs --source /candidate --package /extracted \
  --out /receipt.json
```

The verifier expects both canonical builds `/runs/combined-package-one.zip` and `combined-package-two.zip`, and checks all preserved ancestry and tracked module bytes. Reproduction on another OS/toolchain may legitimately differ in captured profile metadata; this receipt records macOSarm64/Node26.12 runtime, Go1.27.2 and Rust1.89.0. No local Windows execution claim.

## Separate validation states

- Local Node26 full module373tests:372pass/1existing installed-config assertion/0skip. Earlier exact #1252 reproduces the same local assertion. Cause not established by that observation.
- Packaged call/shared-question/paired/native/Java/Python selection80/80, no skips. Core smoke19/19. Generated/identity/golden checks passed. README14pass/1Windows-onlyskip; DSH docs7/7.
- Two canonical Node22.23.3/zlib1.3.1-e00f703 builds identical.168trackedmodulefilesmatch. ZIPsha256 `e1eda9b7201f984f9a97eac0d0502f7f19d09eeffa0a3bef8a4279bbd09c77b6`.
- Remote CI: not run for this unpublished integration head. Original TS #1261 CI passed353/353analysis, but failed overall on the README baseline; this candidate's local proof pass cannot retroactively make that run green.
- Labs/approval/merge/release/installation: none. Next publish the concrete cumulative layer as an English Draft, verify actual native stack membership and monitor final-head CI. Continue source-known misses and wrong-target investigations afterward.

Scoped review traces shared schema → semantic validators → saved questions → paired references. Existing model/freshness/exclusion tests and six real replays cover composition; no duplicate resolver or test-only implementation was introduced. The five original Rust authored cfg controls contain inherited blank lines at EOF; this composition does not rewrite their source or attribution as incidental cleanup.
