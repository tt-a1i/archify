# Frozen source answer: tracing-core `Subscriber::event_enabled` (2026-11-09)

The three tracing-core calls were frozen from the pinned upstream diff and source
before running any candidate query. The candidate later surfaced the Layered
wrapper call at `layered.rs:145` as an extra; it was verified in source and added
to this answer, not inferred from the candidate target. After the final run, an
independent reader without answer access found the `fmt` forward at
`tracing-subscriber/src/fmt/mod.rs:402`; it was verified in source and added as a
known expected miss. That addition corrects coverage; it does not improve any
measured result. The same change also adds `Layer::event_enabled` in
`tracing-subscriber`; that same-name method belongs to a different trait and is
not a target of these calls.

- Repository: `tokio-rs/tracing`
- Base: `d3eb109e45a5078716345fccc05505f63ecea69f`
- Head: `f42e7e6dd2593ffdddf75f4ae48fa8ebdd649184`
- Entry: `tracing-core/src/subscriber.rs`
- Changed definition: `subscriber::Subscriber::event_enabled` at
  `tracing-core/src/subscriber.rs:305:8`, default body returning `true`.
- Base lacks the method (`definitionScope: unpaired`).

## Calls that reference the trait declaration

| Call | Expression | Enclosing method | Receiver | Proven | Not proven |
| --- | --- | --- | --- | --- | --- |
| A | `514:12-514:48` | `Dispatch::event` (513) | `Box<dyn Subscriber + Send + Sync>` | trait declaration | concrete dyn target / override |
| B | `717:9-717:43` | `Subscriber for Box<S>::event_enabled` (716) | `self.as_ref(): &S`, `S: Subscriber + ?Sized` | trait declaration | concrete `S` / override |
| C | `802:9-802:43` | `Subscriber for Arc<S>::event_enabled` (801) | `self.as_ref(): &S`, `S: Subscriber + ?Sized` | trait declaration | concrete `S` / override |
| D | `layered.rs 145:13-145:44` | `Subscriber for Layered::event_enabled` (142) | `self.inner: S`, `S: Subscriber` | trait declaration | concrete `S` / override |
| E | `fmt/mod.rs 402:9-402:40` | `Subscriber for fmt::Subscriber::event_enabled` (401) | `self.inner: Layered<F, Formatter<N,E,W>>: Subscriber` | trait declaration | concrete `S` / override |

All five call expressions start at the receiver and end at the closing `)`. Calls D and E are the only references outside tracing-core; both pass only `event`, so they select the Subscriber method rather than the same-name Layer method that also takes `ctx`.
Call E is currently missed: `tracing-subscriber/src/fmt/mod.rs` is declared inside the crate's `feature!` macro, so the extractor excludes it as `not-in-selected-crate-module-tree` even when the feature is active. The call is real and belongs in the answer; the miss is a capture-scope gap, not a target-resolution error.
`A` is the only production dispatch path: `Dispatch::event` checks the trait
method before calling `Subscriber::event`. `B` and `C` are pointer/Arc forwarding
overrides that delegate to the inner subscriber, and `D` is the Layered wrapper's
Subscriber implementation; all three call the trait method through a captured
`S: Subscriber` bound, not a concrete implementation.

## Same-name method in another trait

`tracing-subscriber/src/layer/mod.rs:879` adds
`Layer::event_enabled(&self, event, ctx)`, with a different signature and trait.
Calls that pass `ctx` (for example `layered.rs:143`, `reload.rs:139`,
`layer/mod.rs:1514`) belong to `Layer`; calls with only `event` belong to
`Subscriber`. They must not be merged merely because the method spelling matches.

## Runtime limit

Source establishes the declaration, not the concrete subscriber behind
`Box<dyn Subscriber>`, `Box<S>` or `Arc<S>`, nor whether an override runs.
`tracing-subscriber`'s wrappers (`Layered`, `fmt::Subscriber`) override the
method; calls that statically select those overrides are separate refactor
targets and are outside this five-call answer. The expected result is four found
and one missed (`fmt/mod.rs:402`), with no wrong target.
