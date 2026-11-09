# Frozen source answer: tracing Dispatch::event through a local dispatcher helper (2026-11-09)

Source-only research for the v14 closure-provenance revision. No Archify CLI,
candidate query, product build, or product test was run before this answer was
written. The expected answer is derived from the pinned upstream source and
diff only. No upstream Rust source was edited.

## Real repository change and prepared sources

- Repository: [tokio-rs/tracing](https://github.com/tokio-rs/tracing), unrelated
  to the synthetic `closure-provenance` fixture.
- Base: `d3eb109e45a5078716345fccc05505f63ecea69f`.
- Head: `f42e7e6dd2593ffdddf75f4ae48fa8ebdd649184`
  ("core, subscriber: add `event_enabled` to filter events on fields (#2008)").
- Entry: `tracing-core/src/dispatcher.rs`.
- Changed definition: `dispatcher::Dispatch::event`; declaration starts at
  `tracing-core/src/dispatcher.rs:513:5` (the `pub` token, the model's item
  position) and the identifier is at `513:12`; signature `513:5-517:6`.
- The diff changes the body from `self.subscriber.event(event)` to a guarded
  forward:
  ```rust
  pub fn event(&self, event: &Event<'_>) {
      if self.subscriber.event_enabled(event) {
          self.subscriber.event(event);
      }
  }
  ```
  The commit also adds `Subscriber::event_enabled` and `Layer::event_enabled`;
  this case freezes `Dispatch::event` only.
- Local closure helper: `dispatcher::get_default` at
  `tracing-core/src/dispatcher.rs:319:1`, whose bound is
  `F: FnMut(&Dispatch) -> T` at `321:5`. `tracing-core` enables `std` by
  default, so the std definition applies. The closure parameter type is the
  local `Dispatch` declared by the helper, resolved in `dispatcher`.
- Worktrees: base `/private/tmp/archify-v14-samples/tracing-event-base`,
  head `/private/tmp/archify-v14-samples/tracing-event-head`.
- Case: `../cases/tracing-dispatch-event.json`.

Both checkouts are clean detached worktrees. Neither revision has a committed
`Cargo.lock`. Cargo 1.89.0
`metadata --offline --no-deps --format-version 1 --manifest-path <root>/Cargo.toml`
succeeded on both without generating a lockfile or building dependencies.
Default features select the `std` `get_default` body.

## Expected calls

Coordinates are one-based; spans are end-exclusive, so the end column is one
past the outer closing `)`.

| # | Call | Direct caller | Why it is a reference |
| --- | --- | --- | --- |
| 1 | `tracing-core/src/event.rs:35:13-35:34` | `Event::dispatch` at `32:1` | `crate::dispatcher::get_default(|current| { current.event(&event); })` |
| 2 | `tracing-core/src/event.rs:78:13-78:34` | `Event::child_of` at `71:1` | `crate::dispatcher::get_default(|current| { current.event(&event); })` |
| 3 | `tracing-log/src/lib.rs:209:9-218:11` | `dispatch_record` at `192:1` | `dispatcher::get_default(|dispatch| { ... dispatch.event(&Event::new(...)) })` |

All three receivers are the closure parameter bound by `get_default`'s
`FnMut(&Dispatch)`. Call 3 lives in another workspace crate and imports the
helper and type from `tracing_core`. The target is the inherent
`Dispatch::event`, not the `Subscriber::event` trait method, at
`tracing-core/src/dispatcher.rs:513` (declaration start `513:5`, identifier
`513:12`).

## Excluded same-name `event` calls

- `tracing-core/src/subscriber.rs:722` and `807`: `self.as_ref().event(event)`
  inside `impl Subscriber for Box/Arc`, receiver is the generic inner
  subscriber, not `Dispatch`.
- `tracing-core/src/dispatcher.rs:515`: `self.subscriber.event(event)`, receiver
  is the `dyn Subscriber` field.
- `tracing-subscriber/src/layer/context.rs:108`: `subscriber.event(event)` where
  `subscriber: &S`, a generic `Subscriber`.
- `tracing-subscriber/src/fmt/mod.rs:407` and
  `tracing-subscriber/src/layer/layered.rs:153`: forwarding to a wrapped
  `Subscriber`/`Layer`, not `Dispatch`.

## Unknowns

- The concrete `Subscriber` selected at runtime is not determined; this case
  freezes the inherent `Dispatch::event` definition only.
- The same upstream commit also changed `Layer::event_enabled` and
  `Subscriber::event_enabled`, which are separate existing questions; those
  definitions and their positions are not part of this answer.

## Freeze provenance

Frozen from the pinned upstream base/head diff and source before the candidate
query. The three call positions were read directly from the head worktree and
checked against the base worktree, where the same three call sites exist and
resolve to the same `Dispatch::event` signature. Candidate output was not
consulted for the call set or targets. After the first candidate run, the
answer text was corrected only for span convention: call ends are end-exclusive
and an inherent item's position is its declaration start (`pub` token). No
expected call, receiver, caller or target line changed.

## Candidate comparison (after freeze)

Normal CLI, default Rust source profile, same frozen case and roots:

| Model | Score | Detail |
| --- | --- | --- |
| v13 (`3ab78d5be`) | 0/3 | three misses, no extras |
| v14 (working tree) | 3/3 | targets `tracing-core/src/dispatcher.rs:513`, callers `dispatch`, `child_of`, `dispatch_record` |

Evidence: `evidence/revision-v14/queries/tracing-dispatch-event.{v13,v14}.json`.
The v13 record has no resolved target for the three closure receivers; v14
resolves the helper-declared `&Dispatch` input in both the same-crate and
cross-crate callers. This is a new real capture, not a re-scored existing
position.
