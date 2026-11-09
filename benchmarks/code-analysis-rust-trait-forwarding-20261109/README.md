# Rust trait-default and forwarding callers (2026-11-09)

Pinned start: `a840c2d07` (head of Draft #1296). This branch starts from that
commit independently; the counterexample-statistics revision stays on #1296.

The round asks a maintainer changing a Rust trait method to find the callers
that are worth checking through a default body and `&mut B` forwarding. The two
real misses are in `tokio-rs/bytes`, change
`d5c8ad32..7930d93d`, changed definition `Buf::try_get_int` at
`src/buf/buf_impl.rs:2086`.

## Source answer (frozen before the candidate)

Full trace: [answers/bytes-forwarding.md](answers/bytes-forwarding.md).

| Call | Source | Enclosing method | Receiver | Proven | Not proven |
| --- | --- | --- | --- | --- | --- |
| A | `2158:13` | `Buf::try_get_int_ne` default body (2156) | `self: &mut Self`, `Self: Buf` | calls `Buf::try_get_int` | concrete `Self`/override |
| B | `2836:13` | `try_get_int` in zero-argument `deref_forward_buf!` (2461), instanced by `impl Buf for &mut T` / `Box<T>` (2886/2890) | `**self: T`, `T: Buf + ?Sized` | calls `Buf::try_get_int` | concrete `T`; call is macro-generated forwarding |

The earlier batch had frozen A with caller kind `method`, B at `2836:26`, and
both as determined concrete targets. Source reading shows A's caller is the
trait default method, B's expression starts at the receiver (`13`), and neither
call determines a concrete implementation. The corrected answer is frozen in
`cases/bytes-try-get-int.json` and `cases20/bytes-try-get-int.json`.

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
4. Generated callers use `directCaller.kind = "macro-generated-method"`, so an
   indirect forwarding template is not shown as a direct call.
5. A concrete local type whose captured plain `impl Trait for Type` does not
   override the method inherits the default. An override resolves to the impl
   body and is excluded from the default's references.

## Candidate result

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

## Reproduction

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
