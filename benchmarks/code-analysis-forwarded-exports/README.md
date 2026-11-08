# Explicit ESM forwarding to implementation bodies

Dependent follow-up above Rust Draft #1270, retaining #1252 and every team/language commit. This is JS/TS v5 / adapter22 validation in a Draft candidate, not Labs integration, approval, merge, release or installation.

In pinned Redux c9e06506f88926e252daf5275495eba0c04bf8e3, investigation previously stopped at the public API module: test/combineReducers.spec.ts:17:23 imported combineReducers from redux, which resolves to src/index.ts. The candidate follows index.ts:3 to the implementation body src/combineReducers.ts:123:1. It does not select the overload signature at114. createStore at test/createStore.spec.ts:26:19 similarly reaches src/createStore.ts:86:1, rather than signatures41/75. Factory-returned reducer calls remain a separate missing function-value-flow capability.

## Frozen questions and evidence

Source answers09745753a and v4 baseline2ae4a65a8 preceded product changes. Initial implementation1dc65d74a preceded both reserved-call candidate comparisons. Two design calls and two calls reserved from initial tuning are all correct (4correct/0wrong/0missed); the external vi.fn call remains unknown. Baseline was0correct/0wrong/4missed/1unknown. This previously exposed Redux corpus is not a blind repository. Exact paths, definitions, overload counterexamples, hashes, cohorts and limits remain in source-first.json. The initial prose note's export line offset is explicitly corrected there; frozen AST spans, import points and body answers are unchanged.

All201files,30,241call ranges,7,549functions,imports and3,594old targets are unchanged. There are205new targets,0removed/changed old targets,0parse errors. A separate full-resolution TypeScript5.9.3 Program (not the extractor's noResolve Program) agrees on all205 unique implementation bodies,0different/0unavailable; resolved overload signature points are recorded separately. Its488diagnostics mean this is definition agreement, not successful compilation or general accuracy/recall. The selected4calls are included in205, not additional observations. A deliberately substituted target is rejected (204agree/1different, exit1). All captured source bytes are checked before/after audit.

## Bounded semantics

Reuse captured import/export selections, checker binding identity and measured functions. Explicit local/imported function exports and explicit reexports can traverse module-acyclic value paths; calls[].via records every forwarding statement. Only one implementation body qualifies. Direct const initializers retain their prior eligibility. Observed callable binding writes and direct eval, including parentheses/erased TypeScript wrappers, block imported implementation attribution. Current navigation requires forwarding-file freshness as well as caller/target freshness. Authored export-reassignment and parenthesized-eval controls were executed before the guard: they return replacement functions while the old rule pointed to the original body. They are controls, not field-discovered usage or extra accuracy samples.

Star/type-only/dynamic/CommonJS forwarding, cyclic routes, arbitrary value aliases, factory returns and runtime module initialization remain unproved. Same-file lexical declarations keep their existing contract; this is not a new global runtime mutation analysis. Historical v1–v4 captures are not rebound under v5. Configured source aliases and captured test scope are source evidence, not proof of a working runtime loader. No external resolver, project execution or new toolchain is added. Missing npm parser dependencies follow the existing automatic install/error-with-guidance path; no new dependency is introduced.

## Supplemental real source change

real-change-source-first.json records Redux cbde7c9b7ea3c9fe16d4587858093e3364104e37 ->456cc345d8ffdde5d798f8509909eb58357ae23c: the nested combination parameter changes AnyAction ->Action. Both outer combineReducers and nested combination source texts change; no runtime effect is claimed. This pair was selected after implementation and is not a holdout. Initial17/32caller coordinates described only the after version; source AST confirmation after the first paired observation corrected the before coordinates to18/33, explicitly retained in the manifest. No rule retuning followed.

Baseline finds0known references for either changed definition. Candidate captures51direct references to combineReducers per side, displaying40and disclosing11omitted. Only the first two test callers per side are source-verified here;51is not an independently graded correct-target count. These references navigate at the correct version's coordinates. combination still has0known references because returned-function flow is unsupported; zero does not mean no callers. Both paired CLI commands report ready/exit0, meaning usable orientation rather than complete impact.

## Reproduce

```sh
python3 benchmarks/code-analysis-forwarded-exports/run.py \
  --cli archify/bin/archify.mjs --sample /fixed/redux \
  --out /runs/forwarded-exports-accepted-source
python3 benchmarks/code-analysis-forwarded-exports/real-change.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples \
  --out /runs/forwarded-exports-pair-accepted-source
```

Pin redux to the manifest SHA; create clean redux-forward-before/after worktrees at the real pair's revisions. Both runners verify fixed hashes and clean revisions before/after normal CLI commands. Use #1270's CLI and --expect baseline for v4. Repeat with the unpacked ZIP CLI and matching -zip output directories.

```sh
node benchmarks/code-analysis-forwarded-exports/audit.mjs \
  /fixed/redux /runs/baseline/raw-facts.json /runs/candidate/raw-facts.json /runs/audit.json
python3 benchmarks/code-analysis-forwarded-exports/verify.py \
  --work /runs --source-tree . --package /unpacked/archify --out /runs/parity.json
```

verify.py expects output names in evidence/parity.json. It compares source/ZIP captures, questions, historical v4 and authored controls; only installation/output paths normalize. The fixed sample source roots, target locations, coverage, reasons and snapshot identities must agree. Baseline raw-facts used by audit.mjs must be from the same fixed source snapshot; this audit is not a general cross-version comparator.

## Separate verification states

- Local module397/397, zero skips; focused31/31 after adapting the three obsolete reexport/model assertions. These counts overlap.
- Extracted calls/imported/question/paired tests62/62, zero skips.
- Normal source and ZIP recipes each4correct/0wrong/0missed/1unknown. Three raw capture instances (two distinct payloads) byte-equal; five orientation payloads agree after only installation/output paths, including real pair and actual saved v4. Eight CLI commands per distribution all exit0. Historical v4 retains its unresolved forwarded call evidence.
- Two canonical Node22.23.3/zlib1.3.1-e00f703 ZIP builds agree;168module files byte-match source. ZIP SHA256bb68b249ea7a64ac2dcf7238ae1664db44de12f6833155888ec060f6b20914bd. Dependencies installed into the extracted package; no live Skill installation. Node26.12.0 runs the CLI/audit/tests; existing TypeScript5.9.3 reused, no additional SDK installed.
- Remote final-head CI remains tracked separately in the Draft/Wiki. Other five languages' real project evidence remains attributed to their prior commits, not relabeled as new-head runs. No approval, merge, release or installation.

Scoped test-value review protects correct body navigation, malformed route rejection, stale intermediate source, mutable exports and changed-definition callers. Focused simplification reuses the existing reference-effects traversal and capture graph rather than adding a second resolver; internal forwarding state is emitted only as verifiable via points. Diagram generation is unchanged, so renderer generation comparisons are not applicable.

The older configured-alias recipe was replayed under v5 through source and ZIP:7correct/0wrong/0missed/1reasonable-unknown. Its original barrel question overlaps this new cohort; do not add denominators. The grader preserves the original v4 miss. Root CLI routing1/1, website distribution1/1 and release identity pass after installing the existing root development dependencies (initial identity invocation lacked parse5). First remote run42427586703 at28d5fe467 was cancelled after ZIP freshness and website distribution failed because the verified ZIP had not been committed. Artifact-only2eb69c7b5 committed the identical verified ZIP; the initial failure remains historical. Final-head CI is tracked in the Draft/Wiki.
