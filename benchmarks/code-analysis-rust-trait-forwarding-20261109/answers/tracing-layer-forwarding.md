# Frozen source answer: tracing `Layer::event_enabled` forwarding (2026-11-09)

Frozen from source before using any candidate output to shape this answer. This
is the cross-project control for the bytes default-method work: another Rust
repository, the same mechanism (a trait default method reached through
forwarding impls and generic bounds), and the same rule that a call proves the
trait declaration before it can prove a concrete implementation.

- Repository: `tokio-rs/tracing`
- Base: `d3eb109e45a5078716345fccc05505f63ecea69f`
- Head: `f42e7e6dd2593ffdddf75f4ae48fa8ebdd649184`
- Entry: `tracing-subscriber/src/layer/mod.rs`
- Changed definition: `Layer::event_enabled` default body at
  `tracing-subscriber/src/layer/mod.rs:879` (head).
- Profile: default workspace features recorded by the CLI; tests excluded.

## Calls that reach the default declaration

1. `tracing-subscriber/src/layer/layered.rs:143:12`,
   `self.layer.event_enabled(event, self.ctx())` inside
   `Layered::event_enabled` at `142`. The `layer` field is `L: Layer<S>`, so
   the call proves the trait declaration; the concrete layer is not
   determined. Direct caller: `event_enabled`, kind `method`.
2. `tracing-subscriber/src/layer/layered.rs:293:12`,
   `self.layer.event_enabled(event, ctx.clone())` in the other `Layered` impl
   at `292`. Same proof and same unknown concrete layer.
3. `tracing-subscriber/src/layer/layered.rs:295:13`,
   `self.inner.event_enabled(event, ctx)` in the same impl at `292`. The
   `inner` field is `B: Layer<S>`, so this is another trait-declaration
   candidate, not the subscriber path at `145`.
4. `tracing-subscriber/src/layer/mod.rs:1514:32`,
   `inner.event_enabled(event, ctx)` inside
   `impl<S: Layer<S>> Layer<S> for Option<S>` at `1512`. The pattern binds
   `inner: S` where `S: Layer<S>`; the target is the trait declaration, not a
   concrete impl.

## Calls that stay unknown

5. `tracing-subscriber/src/layer/mod.rs:1609:17`, inside
   `macro_rules! layer_impl_body` at `1592`. The macro definition is inside a
   `feature!` item expansion; the generated method is not inventoried before
   expansion, so the call is a macro-template boundary, not a direct call.
6. `tracing-subscriber/src/layer/mod.rs:1694:33`, inside the closure over
   `Vec<L>` in `impl<S, L> Layer<S> for Vec<L>`. The closure parameter is not a
   captured typed receiver, so the target is not determined.
7. `tracing-subscriber/src/reload.rs:139:9`,
   `self.inner.event_enabled(event, cx)` inside the `try_lock!` macro. The
   receiver is hidden behind a macro argument/field access that the current
   source model does not prove.

## Classification

- Every call above that resolves is a **candidate anchored at the trait
  declaration**. None proves a concrete layer implementation, so none may be
  written as a determined concrete target.
- Calls 5–7 are indirect or macro-produced. They stay unknown rather than
  being promoted to direct calls by token matching.
- The expected source count is four known references and three explicit
  unknowns. A candidate that reports these four references with the three
  unknown mechanisms named is acceptable; a candidate that reports one
  concrete layer as the target is wrong. `reload.rs` is outside the captured
  feature profile in this run, so its call is an explicit capture boundary.
