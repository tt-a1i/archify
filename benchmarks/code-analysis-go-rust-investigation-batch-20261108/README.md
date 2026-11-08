# Go/Rust change-investigation batch (2026-11-08)

Real upstream changes used to check how far the normal `archify code-analysis task`
paired question answers four questions: which definition changed, who directly
calls it, which calls only prove an interface/trait declaration, and where the
reader can verify the call in source.

Frozen answers live in `cases/*.json`. The runner only scores the CLI output; it
does not scan source itself. Every case records the fixed base/head commits, the
changed definition, exact expected call ranges, direct caller name/line/kind,
provable target, unknowns and the expected status (`pass` or a documented
`expectedGap`).

## Baselines and ancestry

| Line | Commit | Source |
| --- | --- | --- |
| Go baseline | `209f4857c` | #1285 accepted Go interface-candidate work |
| Rust baseline | `fef42b806596313b0e02974946a73ef377259c6d` | #1288 fixed commit |
| Batch baseline | `70bdf0227` | merge of the two lines (`origin/codex/go-rust-batch-baseline`) |
| Candidate | `codex/go-rust-investigation-batch` | this branch, based on `70bdf0227` |

Both lines are ancestors of this branch, so the batch reuses the existing merged
baseline instead of duplicating it. Work ran in independent `git worktree`
checkouts; the team commits (`2db340ee7`, `31b207957`, `cca4e8066`) remain in
history.

## Cases

Five repositories were not previously used for this evaluation: `caddyserver/certmagic`,
`gin-gonic/gin`, `clap-rs/clap`, `tokio-rs/tracing`, `hashicorp/raft`.
`marshallpierce/rust-base64` is regression only.

| Case | Lang | Repo | Definition | Status |
| --- | --- | --- | --- | --- |
| `certmagic-store` | Go | certmagic `16c9db1`→`1a2275d` | `*FileStorage.Store` | pass |
| `certmagic-load` | Go | certmagic `16c9db1`→`1a2275d` | `*FileStorage.Load` | pass |
| `certmagic-interface` | Go | certmagic `2d11419`→`9a56fcd` | `Storage.Store` (interface) | pass |
| `certmagic-interface-load` | Go | certmagic `2d11419`→`9a56fcd` | `Storage.Load` (interface) | pass, **reserved** |
| `gin-close` | Go | gin `8d0468f`→`d75fcd4` | `*responseWriter.CloseNotify` | documented gap |
| `gin-hijack` | Go | gin `8d0468f`→`d75fcd4` | `*responseWriter.Hijack` | documented gap |
| `raft-stage-commit-index` | Go | raft `d3c9124`→`a2e8778` | `CommitTrackingLogStore.StageCommitIndex` | pass |
| `clap-any-value-parser` | Rust | clap `b55ebc9`→`6720240` | `AnyValueParser::parse_ref_` | documented gap |
| `clap-typed-value-parser` | Rust | clap `b55ebc9`→`6720240` | `TypedValueParser::parse_ref_` | documented gap, **reserved** |
| `tracing-subscriber-event-enabled` | Rust | tracing `d3eb109`→`f42e7e6` | `Subscriber::event_enabled` | documented gap |
| `tracing-layer-event-enabled` | Rust | tracing `d3eb109`→`f42e7e6` | `Layer::event_enabled` | documented gap |
| `base64-inner-decode` | Rust | rust-base64 `a8a60f4`→`9e9c7ab` | `GeneralPurpose::internal_decode` | pass, regression |

The reserved cases were frozen in `cca4e8066` before any candidate run and were
first executed after the rules were final (`evidence/reserved`). They produced no
rule change, so no replacement reserved case was needed.

Selection notes:

- The interface cases use `Storage.Load` as the reserved Go question and
  `Storage.Store` as an already-fixed regression, so the same upstream commit
  exercises both a fresh and a known path.
- `gin` `CloseNotify`/`Hijack` were kept although they return zero: the
  implementations come from external embedded `http.CloseNotifier`/`http.Hijacker`
  interfaces, which are outside source capture. They are documented gaps, not
  scorer failures.
- `clap` `parse_ref_` calls sit inside `ok!(...)` macro arguments. The extractor
  records the macro invocation as opaque, so these cases stay as expected gaps
  until macro arguments are modeled.
- `tracing` `layer/layered.rs` calls reach `Layer::event_enabled` through a field
  whose generic name differs between the struct and the impl
  (`inner: I` vs `Layered<L, S>`). That needs generic substitution and was left
  as a documented limit rather than a wider receiver-typing change.
- `raft` adds a head-only interface (`CommitTrackingLogStore`) with one
  interface-dispatch call from `tryStageCommitIndex` and one captured
  implementation (`*InmemCommitTrackingStore`). It is the sixth independent
  base/head group.
- Already-used repositories (Echo, client_golang, Afero, bytes, log) were not
  selected for new questions; rust-base64 appears only as regression.

## Product changes in this batch

1. **Trait-default references.** A Rust default body is registered at its `fn`
   keyword, while trait-dispatch calls target the method name, so a changed
   default method showed no direct references. `change-question.mjs` now unions
   the definition key with the name-anchor keys from `facts.traits`, restricted
   to the declaring file because module paths are crate-local and workspace
   members can share a qualname. Trigger:
   `tracing` `dispatcher.rs:514` (`self.subscriber.event_enabled(event)`) now
   resolves to `Subscriber::event_enabled` at `subscriber.rs:305:8` with direct
   caller `event` at line 513. Negative control: a concrete impl call is resolved
   to the impl and must not appear as a trait-default reference; a same-named
   trait in another workspace member is not merged.
2. **Evidence-based receiver typing (Rust v7).** The Rust extractor records
   named struct field type hints and the impl self type. It resolves
   `self.<field>` through the impl instantiation, substituting generic fields by
   declaration position rather than by the parameter name; this also covers
   swapped parameters such as `impl<A: Right, B: Left> Pair<B, A>`. It resolves
   `self.as_ref()/deref()/borrow()` only from captured evidence: an inherent
   method return type, an `AsRef`/`Borrow` generic target, or a `Deref::Target`.
   A unique inherent accessor shadows those wrapping traits. Without that
   evidence the call stays unresolved. Trigger: the `Wrapper<T: Gate>` fixture
   whose inherent `as_ref` returns `&Other` resolves `self.as_ref().enabled()` to
   `Other::enabled`, not `Gate::enabled`. Negative controls: the unproven
   `Borrowed<G>(G)` fixture returns to unresolved, a concrete call must not
   become a trait candidate, and a differently instantiated generic field
   (`Holder<u8>`) stays unresolved. The adapter is now
   `rust-source-direct-v7` / adapter revision 7, so baseline and candidate
   evidence record different extractor versions.

`docs/GO.md` and `docs/RUST.md` describe the supported and unsupported cases.

## Scoring contract and counterexamples

All runs go through one `score_case(case, query)` entry. The counterexample pass
mutates the full query saved under `<out>/queries`, then sends the mutated query
back through the same entry. Each full run checks:

- deleting a required target;
- moving a declaration to a wrong line;
- adding an extra call;
- duplicating an existing call;
- changing a direct caller;
- promoting a candidate to a determined target.

It also preserves two upstream omissions: an absent `target.file` means the
call file, and end coordinates are compared only when both the frozen answer and
the query provide them. Results outside the expected list are split into
`proven-error` (for example a duplicate record or an unresolved record carrying a
target) and `needs-source-review`; only proven errors fail the case. Both the
baseline and candidate runs executed 56 checks, all passed, and every required
kind was covered (`evidence/stage-*/counterexamples.json`).

## Verification

```sh
# module tests (435 tests, 0 skips)
cd archify && node --test modules/code-analysis/test/*.test.mjs

# the Wrapper<T: Gate> counterexample, normal CLI
node archify/bin/archify.mjs code-analysis task \
  --question "Wrapper<T: Gate>::as_ref returns Other, not T. Which calls reach Other::enabled?" \
  --base-root benchmarks/code-analysis-go-rust-investigation-batch-20261108/fixtures/rust-accessor-shadow/base \
  --root     benchmarks/code-analysis-go-rust-investigation-batch-20261108/fixtures/rust-accessor-shadow/head \
  --entry src/lib.rs --format json --out /tmp/asref.json

# one real question, normal CLI
node archify/bin/archify.mjs code-analysis task \
  --question "Which callers reach it?" \
  --base-root /private/tmp/archify-batch-20261108/samples/certmagic-load-base \
  --root     /private/tmp/archify-batch-20261108/samples/certmagic-load-head \
  --entry filestorage.go --format json --out /tmp/certmagic-load.json

# full batch (reserved included) and its counterexample pass
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/run.py \
  --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out benchmarks/code-analysis-go-rust-investigation-batch-20261108/evidence/final \
  --include-reserved

# rescore the saved full queries without re-running the CLI
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/run.py \
  --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out benchmarks/code-analysis-go-rust-investigation-batch-20261108/evidence/final \
  --include-reserved --saved

# baseline vs candidate report
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/compare.py
```

Each sample root is a `git worktree` at the fixed base or head commit. `clap` and
`tracing` roots were read with a generated `Cargo.lock` because the extractor uses
`--locked`; no project build or test was executed. Go roots were read with Go
1.27.2, default `GOOS/GOARCH`, cgo disabled. The code-analysis module suite passed
435/435 with 0 skips at this revision.

## Results (same questions on baseline and candidate)

| Scope | Definitions found | Calls found | Wrong targets | Missed | Extras |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whole batch (12 cases) | 12/12 | 56/73 | 0 | 17 | 0 |
| Go (7 cases) | 7/7 | 51/56 | 0 | 5 | 0 |
| Rust (5 cases) | 5/5 | 5/17 | 0 | 12 | 0 |
| New repositories (9 cases) | 9/9 | 39/55 | 0 | 16 | 0 |
| Existing regression (1 case) | 1/1 | 4/4 | 0 | 0 | 0 |
| Reserved Go (1 case) | 1/1 | 13/13 | 0 | 0 | 0 |
| Reserved Rust (1 case) | 1/1 | 0/1 | 0 | 1 | 0 |

`evidence/comparison/comparison.md` contains the per-question table with found,
wrong, missed, extras and the displayed determined/candidate/unknown mix for both
runs.

Target mix across the batch: 5 determined targets, 63 candidate targets
(interface/trait declarations), 5 explicitly unknown. The candidate run displayed
5 determined and 51 candidate targets; the five unknown questions (`gin`) produced
no call record, so no unknown row was displayed. No interface or trait candidate
is presented as a definite implementation; every candidate carries
`runtimeTarget: "not-determined"`.

Before/after on the same 12 questions:

| Run | Definitions | Calls found | Wrong targets |
| --- | ---: | ---: | ---: |
| Stage baseline `c5616d34d` (Rust v6) | 12/12 | 56/73 | 0 |
| Candidate (Rust v7, scorer, raft group) | 12/12 | 56/73 | 0 |

No real-question hit changed, so existing correct hits were preserved. The fix is
visible on the cargo-check-valid `Wrapper<T: Gate>` counterexample:

| Run | `Other::enabled` references | Raw `self.as_ref().enabled()` |
| --- | ---: | --- |
| Baseline `c5616d34d` | 0 | `unresolved` plus `rust-trait-method-candidate` → `Gate::enabled` line 2 |
| Candidate v7 | 1, from line 23 to `src/lib.rs:8` | `rust-inherent-source-candidate` → `Other::enabled`; no trait candidate |

This is the misleading path: the baseline tells a reader that the generic `T: Gate`
bound is the target, although `Wrapper::as_ref` returns `Other`. The candidate
points at `Other::enabled`, which a reader can verify at `src/lib.rs:8`. The
unproven `Borrowed<G>(G)` fixture, which has no inherent return or
`AsRef`/`Borrow`/`Deref` evidence, returns to `unresolved` instead of keeping the
old one-parameter-wrapper guess.

Six independent new base/head groups (two questions from one pair count once):

| Group | Cases |
| --- | --- |
| certmagic `16c9db14`→`1a2275d5` | `certmagic-load`, `certmagic-store` |
| certmagic `2d114193`→`9a56fcd4` | `certmagic-interface`, `certmagic-interface-load` |
| gin `8d0468f7`→`d75fcd4c` | `gin-close`, `gin-hijack` |
| clap `b55ebc9f`→`67202405` | `clap-any-value-parser`, `clap-typed-value-parser` |
| tracing `d3eb109e`→`f42e7e6d` | `tracing-layer-event-enabled`, `tracing-subscriber-event-enabled` |
| raft `d3c91249`→`a2e87783` | `raft-stage-commit-index` |

Documented gaps that remain (all counted as misses, none as wrong targets):
macro-argument calls (`clap`), external embedded interface implementations
(`gin`), and field receivers whose generic name changes between struct and impl
plus macro-produced receivers (`tracing` `layered.rs`, `fmt/mod.rs`).

The first baseline attempt aborted with `raft-stage-commit-index: missing sample
roots`: the case id expects `raft-stage-commit-index-base/-head`, but the
worktrees had been created as `raft-stage-commit-base/-head`. The raw output and
reason are kept in `evidence/stage-baseline/aborted-run.txt` and
`aborted-run-reason.txt`; after `git worktree move`, both complete runs finished
and agreed.

## ZIP replay

The final ZIP was unpacked into a fresh directory (`unzip archify.zip`), the
Code Analysis module installed its locked dependencies with `npm ci` inside that
copy, and three questions were replayed with its CLI: the Wrapper
counterexample, `raft-stage-commit-index`, and `base64-inner-decode`. The same
three questions were also run with the stage-baseline CLI and the normal candidate
CLI.

| Run | Rust identity | `Other::enabled` refs | raft result | base64 result |
| --- | --- | ---: | --- | --- |
| Stage baseline `c5616d34d` | adapter 6 / `rust-source-direct-v6` | 0 | raft.go:1401 → log.go:211 | 4 trait candidates |
| Normal candidate | adapter 7 / `rust-source-direct-v7` | 1 at `src/lib.rs:8` | raft.go:1401 → log.go:211 | 4 trait candidates |
| Fresh ZIP | adapter 7 / `rust-source-direct-v7` | 1 at `src/lib.rs:8` | raft.go:1401 → log.go:211 | 4 trait candidates |

The normal and ZIP runs produced the same snapshot IDs and call results; the
baseline's version field and raw facts differ. The ZIP raw facts show
`rust-inherent-source-candidate` for `as_ref` (line 18) and `enabled` (line 8),
with no `Gate::enabled` candidate. ZIP SHA256:
`6f6314c95b12a0249dcda61513c821622a53d718caab9cea2f193ae6a4bc3a60`.
Evidence is under `evidence/replay/{baseline,normal,zip}`.

## Uninvolved reader check

A reader that did not see the answer keys ran the normal CLI on two questions.

- Go, `certmagic-store`: found the changed `*FileStorage.Store`, 3 direct
  references, 9 interface candidates with implementation lists and
  `runtimeTarget: not-determined`; verified `filestorage_test.go:21:8` in source.
  It also noted that candidate columns point at the receiver start, not the
  method name.
- Rust, `tracing-subscriber-event-enabled`: found the definition as a head-only
  unpaired definition, 1 direct reference at `dispatcher.rs:514` with caller
  `event`, and 2 trait candidates, all `not-determined`. It reported the same
  misses recorded above (`layered.rs:145`, `fmt/mod.rs:402`).

Attribution: benchmark design, scoring, extractor/query changes and tests were
written in this session on top of the team baselines above. Upstream sample
repositories and commits are the work of their maintainers.

## Evidence layout

`evidence/final` is the authoritative candidate run. `evidence/stage-baseline`
is the same 12 questions at `c5616d34d`, including the aborted first attempt's
stdout/reason files. `evidence/comparison` holds the per-case baseline/candidate
report, `evidence/asref` holds the Wrapper counterexample's question output and
raw extractor facts for both versions, and `evidence/replay` holds the normal
CLI and fresh-ZIP replay. Each run contains the full query JSON,
the exact command and stderr per case, `summary.json` and
`counterexamples.json`; the runner does not truncate the query JSON. The evidence
tree is about 25 MB, mostly paired-query JSON. Rerunning the commands above
regenerates it.
