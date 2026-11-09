# Frozen macro-site answers (2026-11-09)

Frozen from upstream source and diff at the head commits below, before any
candidate run in this stage. Coordinates are 1-based head-tree positions. The
questions were the four remaining misses of the previous batch.

## 1. clap `ok!(...)` — preserved argument

- Repository: `clap-rs/clap`, head tree `6720240` (`clap_builder/src`).
- Macro definition: `clap_builder/src/macros.rs:554`, one rule
  `($expr:expr) => { match $expr { Ok(val) => val, Err(err) => { return Err(err); } } }`.
  The argument is used **once** as the match scrutinee; it is neither discarded
  nor duplicated. `macros.rs` is imported with `#[macro_use] mod macros;`.
- Invocation and call expression: `clap_builder/src/builder/value_parser.rs:658`,
  inner call `TypedValueParser::parse_ref_(self, cmd, arg, value, source)` at
  columns 25–84, inside
  `impl<T, P> AnyValueParser for P where P: TypedValueParser<Value = T>`.
- Direct caller: `P::parse_ref_` declared at line 651.
- Target: trait declaration `TypedValueParser::parse_ref_` at line 766, column 8
  (source candidate; runtime implementation is not determined).
- Build: `clap_builder` default features include `std`; the impl and macro have
  no cfg gate.
- Verdict: the expression is visible in source, the default build includes it,
  expansion preserves the call exactly once, and both caller and target can be
  bound. This is the target of the first implementation.

## 2. tracing `layer_impl_body!` — preserved macro body, duplicated invocation

- Repository: `tokio-rs/tracing`, head tree `f42e7e6`.
- Macro definition: `tracing-subscriber/src/layer/mod.rs:1568`; the
  `event_enabled` item inside it calls `self.deref().event_enabled(event, ctx)` at
  line 1609, columns 17–55.
- Invocations: the macro is invoked with no arguments by
  `impl<L, S> Layer<S> for Box<L>` (line 1649) and
  `impl<S> Layer<S> for Box<dyn Layer<S> + Send + Sync>` (line 1656). One source
  call expands into two generated impl methods, so a single caller name would be
  wrong.
- Target: `Layer::event_enabled` at `layer/mod.rs:879`, column 8; `self.deref()`
  is `Box<L>` deref to `L`, where `L: Layer<S>`.
- Build: the definition and both impls sit inside
  `feature! { #![any(feature = "std", feature = "alloc")] ... }`; default features
  include `std`/`alloc`.
- Verdict: visible expression, active config, preserved once per invocation but
  duplicated across two invocations. The source position is navigable; the
  caller is a macro-generated impl method, not one named source function. This
  needs a macro-item expansion mechanism, not argument preservation.

## 3. tracing `try_lock!` — receiver wrapper, call outside the macro

- `try_lock!` definition: `tracing-subscriber/src/macros.rs:2`, gated
  `#[cfg(feature = "std")]`; default features include `std`.
- The changed call is **outside** the macro:
  `tracing-subscriber/src/reload.rs:139`, columns 9–82,
  `try_lock!(self.inner.read(), else return false).event_enabled(event, ctx)`
  in `impl<L, S> crate::Layer<S> for Layer<L, S>`.
- `try_lock!` uses `$lock` once in `if let Ok(l) = $lock`; the argument is
  evaluated once. But the macro unwraps `LockResult<RwLockReadGuard<L>>` and the
  method is called on the guard, which derefs to `L: Layer<S>`.
- Direct caller: `reload::Layer::event_enabled` at line 138.
- Target: `Layer::event_enabled` at `layer/mod.rs:879`.
- Build visibility: `reload` is declared inside `feature! { #![feature = "std"]
  pub mod reload; }` in `lib.rs`, so the current extractor does not capture the
  file at all.
- Verdict: source call and target are provable, but binding the receiver needs
  `std::sync` guard/deref semantics, not just argument preservation. This is a
  separate mechanism.

## 4. tracing `feature!` — cfg-transparent item wrapper

- Macro definition: `tracing-subscriber/src/macros.rs:17`; each item is emitted
  with `#[cfg($meta)] #[cfg_attr(docsrs, doc(cfg($meta)))]`.
- Invocation: `tracing-subscriber/src/lib.rs:226` gates
  `pub mod fmt;` and the re-export with
  `#![all(feature = "fmt", feature = "std")]`. Default features include `fmt`
  and `std`, so the module is active by default.
- Call: `tracing-subscriber/src/fmt/mod.rs:402`, columns 9–40,
  `self.inner.event_enabled(event)` inside
  `impl<N, E, F, W> tracing_core::Subscriber for Subscriber<N, E, F, W>`.
- Direct caller: `fmt::Subscriber::event_enabled` at line 401.
- Target: `Subscriber::event_enabled` at
  `tracing-core/src/subscriber.rs:305`, column 8 (trait declaration).
- Verdict: the item and call are preserved when the cfg is true and the default
  build enables it. The current extractor skips the entire `ItemMacro`, so the
  file is absent from capture. This needs cfg-wrapper traversal, a separate
  mechanism from argument preservation.

## Implementation decision

Deliver the class with the strongest reproducible evidence: single-expression
local macro arguments whose captured definition uses the metavariable exactly
once. `ok!` is the real case; clap's `debug!` (discarded arguments) and a
duplicate-use fixture are negative controls. The other three sites are recorded
above with the mechanism each requires; they are not claimed as fixed.
