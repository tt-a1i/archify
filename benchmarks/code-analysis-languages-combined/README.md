# History-preserving six-language candidate

Local integration candidate based on TS #1261 `cbc557b7b616dfc1dde2a6b2a7e04af32c9b5d54`, itself above JS #1260 in native stack #1262. It composes preserved Rust #1258 (including Go #1256 and frozen #1255), independent Java #1259 and the existing Labs CI baseline repair #1242. Python #1252 and all original contributed ancestors remain. Exact ancestry assertions and source head are in `evidence/parity.json`.

These are local Git history-composition merges, not GitHub PR merges. Original commits/authors and separately owned PRs are retained; do not later merge both a combined candidate and its original slices without reconciling overlap. No approval, formal merge, release or live installation. The integration layer is prepared as a dependent Draft; its PR and team Wiki record actual publication and final-head remote checks separately.

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

All six normal source CLI recipes and their extracted-ZIP counterparts passed their original graders. **17 raw-facts captures are byte-identical;20 saved/paired questions agree after only output/install paths are normalized.** After the fixture correction, all six source/ZIP recipes were rerun at b2693a221; see final-parity.json and *-final-source/zip.json. Earlier receipts remain historical evidence. The recorded exits, configuration and profile limitations are preserved in each language's source/ZIP report. `--fail-on never` check exits do not mean no findings. JS/Rust partial paired outputs remain partial/nonzero.

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

- Final source module **373/373pass,0fail,0skip** on both Node26.12 and officialNode22.23.3. Earlier372pass/1failure logs are preserved, not relabeled. A controlled probe proves the macOS test mutation never fired when /var and /private/var spellings differed. Canonicalizing that test fixture root makes the mutation run and preserves the expected extract/source-changed assertion. No analyzer/runtime change or assertion relaxation.
- Final extracted ZIP call/question/paired/native/Java/Python/configuration selection **91/91pass,0skip**. Attempting all373tests in the Git-free ZIP yields372pass/1failure: extract-self.test.mjs43 explicitly requires the self-bootstrap repository's Git baseRevision. The archive intentionally lacks Git metadata; normal Git/non-Git analysis semantics remain unchanged. This full-package test limitation is separate from CLI parity and is not hidden by the focused pass.
- Reused unchanged local core19/19, generated/identity/golden checks, README14pass/1Windows-onlyskip and DSHdocs7/7 at15c9cf5e3; the only later archify source edit is the test-fixture path correction. Remote final-head CI supplies broader validation separately.
- Two final canonicalNode22.23.3/zlib1.3.1-e00f703builds identical.168trackedmodulefilesmatch. ZIPsha256 `aa74920538583e62d8494ba9244efd031b192b45899f685009547e5a69018f89`. All six final source/ZIP graders replayed,17captures/20questions parity; partial paired outputs keep nonzero exits. Earlier e1eda9... package receipt belongs to its earlier head.
- Remote CI is recorded in the owning PR and team Wiki. OriginalTS#1261 passed353/353analysis but failed overall on the inherited README baseline; this candidate includes the separately preserved#1242repair. A candidate pass cannot retroactively change that run.
- Labs/approval/merge/release/installation: none. Maintain original PR ownership and reconciliation of combined/original scopes. Continue real misses, wrong targets and interrupted investigations after composition validation.


Scoped review traces shared schema → semantic validators → saved questions → paired references. Existing model/freshness/exclusion tests and six real replays cover composition; no duplicate resolver or test-only implementation was introduced. The five original Rust authored cfg controls contain inherited blank lines at EOF; this composition does not rewrite their source or attribution as incidental cleanup.
