# Rust trait-default and forwarding callers (2026-11-09)

Original product start: `a840c2d07` (Draft #1296). The branch subsequently
includes #1296's statistics-only commit `aa080c89b`. The current attribution
revision uses **`70750e6ba` as its fixed v11 baseline**, on the original #1297
branch; #1296's counterexample-statistics correction is not product benefit.

The round asks a maintainer changing a Rust trait method to find the callers
that are worth checking through a default body and `&mut B` forwarding. The two
real misses are in `tokio-rs/bytes`, change
`d5c8ad32..7930d93d`, changed definition `Buf::try_get_int` at
`src/buf/buf_impl.rs:2086`.

## v12: cfg and template ownership revision

This revision compares against `70750e6ba`, not v10. It does not claim additional
real caller positions: the improvement is rejecting excluded/unknown cfg as
known calls, identifying the physical template rather than the first impl, and
retaining all provable expansion origins after source-position deduplication.

```diff
 physical template call
- first impl's directCaller; invocation cfg ignored
+ combined impl / invocation / method / body cfg (nested cfg_attr included)
+ template-qualified directCaller + macro definition and expansion anchors
+ target disagreement => unknown; caller disagreement => omit only caller
```

Unknown accessor implementations remain ambiguity blockers; their return types
cannot make an outer call known. Unknown generated trait implementations also
block method and qualified-call uniqueness. Excluded implementations do not
block active ones. Loading one source file under two module identities does not remove an
agreed target or choose a disputed caller. These additional review findings are
protected by focused Rust regressions, not counted as new real-repository callers.

Two source-frozen controls are in `fixtures/{cfg-template,divergent-template}`;
`run-template-controls.py` uses only the normal CLI, checks both base/head and
feature profiles, and compiles all eight combinations. The cfg control checks
absence, not just absence from resolved targets. The divergent-target control
already had an unknown target in v11: the defect was the first-impl caller and
missing origins, not a demonstrated wrong target.

The genuinely independent same-rule case is
[the futures-rs source answer](answers/futures-io-waker-vectored-read.md), frozen
before either query. Its `deref_async_read!` template is the entire body of both
`AsyncRead for Box<T>` and `AsyncRead for &'a mut T`. The source-proven closure
caller in `futures-util/src/io/split.rs:49` remains in the denominator even when
missed. The historical source is not claimed to build on modern Rust; the CLI's
separate `arc_wake.rs` parse failure makes this capture partial, not complete.
Tracing's 4/7 case is retained as a regression, not advertised as validation of
the whole-impl macro rule.

### Final v11 → v12 comparison

[Computed comparison](evidence/revision-v12/comparison-final.json), including
per-case deltas, counts counterexamples directly from `available` / `passed`.

| Measure | v11 baseline `70750e6ba` | Final v12 | Fresh ZIP v12 |
| --- | --- | --- | --- |
| Bytes positions | 2/2 | 2/2 | 2/2 |
| Bytes template identity / both origins | missing / first impl | retained / both | retained / both |
| Futures positions | 1/2, partial | 1/2, partial | 1/2, partial |
| Futures template identity / both origins | missing / first impl | retained / both | retained / both |
| Tracing regression | 4/7 | 4/7 | 4/7 |
| Cfg control known references, off / on | 3 / 6 | 0 / 5 | 0 / 5 |
| Divergent template target | unknown, first-impl caller | unknown, both origins | unknown, both origins |

Final original-20 replay: **81/86 correct, 5 missed, 0 wrong, 2 known extras,
20/20 definitions**. Every case's position metrics match v11: **0 newly found
positions, 0 real-case wrong-target removals, 0 regressions**. Counterexamples:
**152 checks, 121 applicable and passing, 31 N/A, all 8 classes covered**.
Both normal-CLI controls pass **364/364 assertions**, independently in source
and ZIP runs; each run also compiles all **8/8** fixture/profile/side combinations.

Rescoring the identical baseline and candidate queries against the original,
stale bytes answer yields the same **79 correct, 6 missed, 1 wrong, 3 extras** on
both. Each rescore exits 1 with two stale-oracle mutation failures (119/121
applicable checks passing). Correcting caller kind, source column and target
class changes the evaluation, not the product. The genuine v10 → v11 gain of
two bytes positions is historical and must not be counted again in v12.

Final acceptance artifacts are under `evidence/revision-v12/final/`: `batch/`,
`controls/`, `bytes/`, `futures/`, `tracing/`, and corresponding `zip-*` entries.
`baseline-controls-final-contract/` rescored the original baseline queries and
reused its eight build receipts; it did not rerun the baseline. Futures retains
its missing closure call and separate parse failure in source and ZIP results.
Final-head remote CI is recorded in the PR and Wiki after publication of the
branch, separately from these local checks.

### Verification identity

- Final module suite: **461 passed, 0 failed, 0 skipped**, including 54 Rust
  tests (`evidence/revision-v12/module-tests-final.log`).
- `product-sha256-final.json` binds the tested source and tests. The ZIP is built
  from tracked content with official Node 22.23.2 / bundled zlib
  `1.3.1-e00f703`, contains 405 files, and has SHA-256
  `a61b2328c6b88127a324384e9ef536f42282ca41d4cd2d93290d1e774da5e6d9`.
  `zip-identity-final.json` verifies matching source hashes after a fresh unpack;
  this is not a live installation or release publication. A second canonical
  build is byte-identical. The isolated module install succeeded but reported
  eight npm audit warnings (one moderate, seven high) against unchanged
  dependencies; no dependency upgrade or security clearance is claimed.
- `review-receipt.txt` records the scoped review and which earlier runs became
  stale. The initial candidate batch hit a Rust tooling failure; a later batch
  was cancelled when follow-up review found the trait-edge blocker. Neither
  interrupted run nor the earlier ZIP is final acceptance.
- The independent reader predates those final conservative cfg/ambiguity fixes;
  its source locations and interpretation are reused under that original run,
  not relabeled as a final-head reader session.

### Reader navigation

The [independent reader report](evidence/revision-v12/reader/reader-report.txt)
was produced without benchmark answers or product diffs. Start with a normal
`code-analysis task` query using the case's roots and entry, asking
`Who calls the changed method?`:

1. Bytes: find `Buf::try_get_int` at 2086, then ordinary caller 2158 and template
   call 2836; follow `macroTemplate.definition` to `deref_forward_buf` at 2461
   and `expansions` to 2887 / 2891 (`&mut T` / `Box<T>`).
2. Futures: find `AsyncRead::poll_vectored_read` at 136, template call 259 and
   `deref_async_read` at 244; follow expansions 265 / 269. The query does not
   include `split.rs:49`; source navigation supplies that missing relationship.
3. Both identify trait declaration candidates, not concrete runtime
   implementations. Bytes' ordinary `cfg!` branch is a lexical reference, not
   evidence of execution on the captured little-endian host.

## Historical v11 source answer (frozen before that candidate)

Full trace: [answers/bytes-forwarding.md](answers/bytes-forwarding.md).

| Call | Source | Enclosing method | Receiver | Proven | Not proven |
| --- | --- | --- | --- | --- | --- |
| A | `2158:13` | `Buf::try_get_int_ne` default body (2156) | `self: &mut Self`, `Self: Buf` | calls `Buf::try_get_int` | concrete `Self`/override |
| B | `2836:13` | `try_get_int` in zero-argument `deref_forward_buf!` (2461), instanced by `impl Buf for &mut T` / `Box<T>` (2886/2890) | `**self: T`, `T: Buf + ?Sized` | calls `Buf::try_get_int` | concrete `T`; call is macro-generated forwarding |

The earlier batch had frozen A with caller kind `method`, B at `2836:26`, and
both as determined concrete targets. Source reading shows A's caller is the
trait default method, B's expression starts at the receiver (`13`), and neither
call determines a concrete implementation. These are **answer-key corrections,
not product wrong-target removals**: v10 did not return either position. The
corrected answer is in `cases/bytes-try-get-int.json` and
`cases20/bytes-try-get-int.json`. The v12 answer additionally requires B's macro
name anchor and both expansion origins, scored separately from position totals.

## Where the baseline evidence disappears

The pinned CLI is `rust-source-direct-v10` / adapter 10. Receipts:
`evidence/baseline/` and `evidence/baseline-score/`.

- A is present in raw facts as `unresolved / rust-trait-or-method-dispatch`.
  The enclosing `defaultMethod` and `directCaller` are already recorded; the
  extractor lacks the implicit `Self: Buf` binding in a default body.
- B is absent entirely. The macro definition and its impl-body invocation are
  opaque, and `(**self)` has no deref receiver typing.
- Baseline score: 0 of 2 positions, 2 missed.

## v11 changes

Model: `rust-source-direct-v11` / adapter revision 11. Documentation:
`archify/modules/code-analysis/docs/RUST.md`.

1. A bare `self.method()` in a trait default body binds to the enclosing
   trait's method declaration when that method exists. A missing method stays
   unresolved.
2. A zero-argument local `macro_rules!` used as the **entire** body of an impl
   is expanded for inventory. Generated methods inherit the impl self type,
   generic bounds and where clause. This is a bounded textual template, not
   general macro expansion.
3. `*self` / `**self` receivers keep the captured trait bound. Generic
   `&mut T` and `Box<T>` forwarding target the trait declaration; a deref of a
   non-`self` generic receiver stays unknown.
4. Generated callers use `directCaller.kind = "macro-generated-method"`.
   This v11 label alone did **not** establish accurate ownership: deduplication
   retained the first impl's qualname and lost the other expansion. v12 corrects
   the identity and preserves both origins.
5. A concrete local type whose captured plain `impl Trait for Type` does not
   override the method inherits the default. An override resolves to the impl
   body and is excluded from the default's references.

## Historical v10 → v11 result

| Case | Baseline v10 | Candidate v11 |
| --- | ---: | ---: |
| bytes `Buf::try_get_int` | 0/2, 2 missed | **2/2, 0 wrong, 0 missed, 0 extras** |
| tracing `Layer::event_enabled` (cross-project) | 4/7, 3 missed | 4/7, 3 missed (kept) |

Bytes evidence: `evidence/candidate/`; tracing:
`evidence/tracing-{baseline,candidate}/`. The tracing case is an independent
answer frozen in `answers/tracing-layer-forwarding.md`: four
trait-declaration candidates (`layered.rs 143`, `293`, `295`; `layer/mod.rs
1514`) and three named unknown mechanisms (macro defined inside a `feature!`
item expansion; closure element; `try_lock!` guard; `reload.rs` outside the
captured feature profile). The candidate does not regress it.

## Compilable controls

`fixtures/rust-trait-forwarding/{base,head}` compiles with `cargo build`
(cargo 1.89.0) and differs only in the default body (`1` to `3`). The change
query returns four candidates:

| Call | Why accepted | Why not a concrete target |
| --- | --- | --- |
| `via_default` 7:9 | `self.check()` in the default body | `Self` may override |
| macro forwarding 24:13 | zero-arg impl-body template, one position for both impls | `T` unknown; caller kind `macro-generated-method` |
| `generic` 38:5 | `G: Gate` bound | `G` unknown |
| `concrete_plain` 42:5 | `impl Gate for Plain {}` has no override | default declaration, not an impl body |

`concrete_override` at 46:5 resolves to the `Override::check` body and is not a
reference to the default. `local_deref` at 50:5 stays unknown; its receiver is
a local `&mut &mut G`, not `self`. Unit tests additionally reject a non-empty
macro matcher, an imported/ambiguous macro, a macro mixed with other impl
items, and a deref of a non-`self` generic.

## Original 20 cases

The original frozen answers keep their previous bytes expectation here on
purpose, so the run measures the candidate against the old record. It reports
79 correct, 1 wrong, 6 missed, 3 extras, 20/20 definitions
(`evidence/final-v11/`). The wrong/missed/extra are the two corrected bytes
records: caller kind, receiver column and target class.

Replaying the same 20 cases with the corrected bytes answer
(`evidence/final-v11-corrected/`, inputs in `cases20/` and
`run20-corrected.py`) reports **81/86 correct, 5 missed, 0 wrong, 2 extras,
20/20 definitions** — two more correct positions and two fewer misses than v10
(79/7), with the same two known extras. Counterexamples: 152 checks, 121
applicable and all passing, 31 not applicable, all 8 kinds covered. The
remaining five misses are `clap-any-value-parser` (1), `tracing-layer` (3) and
`tracing-subscriber` (1), all with the previously documented mechanisms; no
case regressed.

## Reproduce v12

Run from the repository root. Keep the source checkouts at the pins in the case
files, the clean baseline worktree at `70750e6ba`, and the fresh ZIP unpack at the
paths recorded by `replay-v12.sh`. Install the unpacked module's dependencies
with `npm ci --prefix /private/tmp/archify-v12-final-zip/archify/modules/code-analysis --ignore-scripts`.
No upstream sample build is performed except the explicitly compiled synthetic
controls.

```sh
bash benchmarks/code-analysis-rust-trait-forwarding-20261109/replay-v12.sh /tmp/archify-v12-replay-new
```

The output directory must be new. The script runs the corrected original 20
cases, both normal-CLI controls, bytes, futures and tracing, then repeats both
controls and all three cases using the extracted ZIP. Each run retains raw
queries and exact commands. Baseline controls may be reproduced with
`run-template-controls.py --mode baseline --cli <clean-baseline-cli> --out <new-directory>`;
`--mode baseline --replay <original-evidence>` rescoring is separately identified as reused evidence.

## Historical v11 reproduction

```sh
(cd fixtures/rust-trait-forwarding/base && cargo build)
(cd fixtures/rust-trait-forwarding/head && cargo build)

node archify/bin/archify.mjs code-analysis task --question "Buf::try_get_int now sign-extends the unsigned result instead of using the byte-copy macro. Which source calls use this default method?" \
  --base-root /private/tmp/archify-batch-20261108/samples/bytes-try-get-int-base \
  --root /private/tmp/archify-batch-20261108/samples/bytes-try-get-int-head \
  --entry src/buf/buf_impl.rs --format json --out /tmp/bytes.json

python3 run-case.py --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples --out evidence/candidate

python3 run20-corrected.py --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out evidence/final-v11-corrected --include-reserved
```

The sample roots are the fixed `git worktree` checkouts used by the earlier
batch. `src/buf/buf_impl.rs` is read only; no project build is executed by the
extractor.

## Known limits

- Only a zero-argument local macro defined earlier in the same file/module and
  used as the whole impl body is expanded. Imported macros, non-empty matchers,
  macros mixed with other items, and macros inside item-expansion macros (for
  example tracing's `layer_impl_body!` inside `feature!`) stay opaque.
- Deref typing is limited to chains rooted at `self`; a local generic deref
  stays unknown.
- Concrete inheritance is claimed only for a plain local `impl Trait for Type`
  with no generics/where clause and no selected override. Conditional,
  generic, external or uncaptured impls stay unknown.
- Every accepted call is anchored at the trait declaration (candidate), not a
  concrete runtime implementation; overrides may still change the behavior.
