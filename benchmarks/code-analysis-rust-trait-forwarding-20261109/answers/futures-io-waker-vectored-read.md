# Frozen source answer: futures I/O whole-impl forwarding (2026-11-09)

Source-only research for #1297, against Archify baseline
`70750e6ba7831634e4388f13114c952ffd1690bc`. No Archify CLI, candidate query,
product build, or product test was run for this answer. The expected answer is
not derived from candidate output. No upstream Rust source was edited.

## Real repository change and prepared sources

- Repository: [rust-lang/futures-rs](https://github.com/rust-lang/futures-rs),
  independent of `tokio-rs/bytes` (not a vendored bytes copy).
- Base: `446134c14f1b49217597e1b796cd0b4eb090daff`.
- Head: `c01229935e4029e7b51f7cc60ca05c178ec10175`.
- [Public commit](https://github.com/rust-lang/futures-rs/commit/c01229935e4029e7b51f7cc60ca05c178ec10175):
  “Implements the waker changes for task API stabilization. This removes
  LocalWaker, and adds ArcWake to the library.” Its sole parent is the base.
  Git records author date 2018-11-18 and committer date 2019-02-19.
- Entry: `futures-io/src/lib.rs`.
- Changed definition: `if_std::AsyncRead::poll_vectored_read`, identifier at
  `136:12`; signature/default body at `136:9-145:10` on both sides.
- The actual diff changes `lw: &LocalWaker` to `waker: &Waker`, and the default
  body's `self.poll_read(lw, first_iovec)` to
  `self.poll_read(waker, first_iovec)` at line 140. This is a real API migration,
  not an invented historical algorithm fix. The commit changes other methods
  and files too; this case freezes only `poll_vectored_read`.
- Base checkout:
  `/private/tmp/archify-batch-20261108/samples/futures-io-waker-vectored-read-base`.
- Head checkout:
  `/private/tmp/archify-batch-20261108/samples/futures-io-waker-vectored-read-head`.
- History clone: `/private/tmp/archify-futures-source-20261109`.
- Case: `../cases/futures-io-waker-vectored-read.json`. The checkout names match
  the existing `run-case.py --samples /private/tmp/archify-batch-20261108/samples`
  convention; no harness change is needed.

Both checkouts are detached at their pins with clean tracked source. Neither
revision has a committed Cargo.lock. Cargo 1.89.0
`metadata --offline --locked --no-deps --format-version 1 --manifest-path
<checkout>/Cargo.toml` succeeded on both (nine local packages) without creating
a lockfile. No dependencies were built. This historical source contains
`#![feature(futures_api)]`; a successful modern Rust build is not claimed.

Use the default workspace source profile, tests/benchmarks/examples excluded.
`futures-io/Cargo.toml:18-19` enables `std` by default, selecting `mod if_std`
at `futures-io/src/lib.rs:15-16`. `futures-util/Cargo.toml:18-19` likewise
selects its `std` I/O module (`src/lib.rs:89-90`).

## A. The whole-impl macro call: the same bounded expansion rule

All following locations are in
[head `futures-io/src/lib.rs`](https://github.com/rust-lang/futures-rs/blob/c01229935e4029e7b51f7cc60ca05c178ec10175/futures-io/src/lib.rs#L244-L270).

- Definition: `macro_rules! deref_async_read`, `244:5-262:6`.
- Exactly one rule: empty matcher `()` at line 245, with a method-list expansion.
  There are no metavariables, alternative rules, nested method-producing macros,
  or conditional methods in that expansion.
- Exactly two invocations in the entire pinned repository, both in the same
  file, crate, and inline module `if_std`, after the definition:

| Impl source range | Implementing type and bound | Entire impl body | Invocation range (excluding semicolon) |
| --- | --- | --- | --- |
| `264:5-266:6` | `impl<T: ?Sized + AsyncRead> AsyncRead for Box<T>` | `deref_async_read!();` | `265:9-265:28` |
| `268:5-270:6` | `impl<'a, T: ?Sized + AsyncRead> AsyncRead for &'a mut T` | `deref_async_read!();` | `269:9-269:28` |

Each parsed `syn::ItemImpl.items` has length **one**, and its sole item is
`ImplItem::Macro`. Each invocation has an unqualified one-segment path and zero
argument tokens. There is one visible matching macro definition. Module imports
at lines 17-30 are explicit; there is no same-module glob or imported macro
competitor. The outer re-export at line 383 does not change this same-module
textual lookup.

These satisfy the actual baseline guards in
`archify/modules/code-analysis/extract/rust/src/main.rs:1621-1659`
(`expanded_impl_items`), including whole-impl-only, same-file/same-module,
visibility, one empty matcher rule, and expansion parseability. This is not the
previous tracing `Layer::event_enabled` case with mixed impl items.

### All generated methods and call positions

The same three-method template is instantiated at **both** invocation positions.
Coordinates are one-based, end-exclusive, and point into the macro definition,
not imaginary generated files. Base and head have the same line numbers.

| Generated method range | Forwarded call | Base call range | Head call range |
| --- | --- | --- | --- |
| `246:13-248:14` | `(**self).initializer()` | `247:17-247:39` | `247:17-247:39` |
| `250:13-254:14` | `(**self).poll_read(...)` | `253:17-253:44` | `253:17-253:47` |
| `256:13-260:14` | `(**self).poll_vectored_read(...)` | `259:17-259:53` | `259:17-259:56` |

Only the last row calls the declaration frozen by this case:
`(**self).poll_vectored_read(waker, vec)` at **259:17-259:56**.
Its direct caller is the generated `poll_vectored_read` method at line 256,
kind `macro-generated-method`.

For `Self = Box<T>`, `self: &mut Box<T>` and `**self: T` through Box's dereference.
For `Self = &'a mut T`, `self: &mut &'a mut T` and `**self: T`. The method call
borrows that place mutably; it does not move the possibly unsized T. Both impls
supply `T: AsyncRead + ?Sized`. The lifetime on the reference impl adds no
alternative method target. `AsyncRead` has no competing supertrait method.

Thus the source identifies the **trait declaration** at `136:12`, not a unique
concrete implementation. T may inherit the default or override it. Unlike later
futures I/O source, this revision uses `&mut self` and `(**self)` directly: it
needs no `Pin::new(...)` return-type inference or general macro expansion.

The frozen case records one source position for these two semantic expansion
contexts, matching the existing bytes case's source-position counting. The two
invocation sites are not two distinct call expressions at new source locations.
The other whole-impl read template, `unsafe_delegate_async_read_to_stdio`
(lines 274-298), supplies `initializer` and `poll_read` only; it does not emit
another `poll_vectored_read` call.

## B. Other workspace call: retain the separate closure-inference gap

The only other call to this method in the pinned repository is in
[head `futures-util/src/io/split.rs`](https://github.com/rust-lang/futures-rs/blob/c01229935e4029e7b51f7cc60ca05c178ec10175/futures-util/src/io/split.rs#L19-L50):

- Head expression: `l.poll_vectored_read(waker, vec)`, **49:55-49:87**.
- Base expression: `l.poll_vectored_read(lw, vec)`, **49:49-49:78**.
- Enclosing method: `ReadHalf<R>::poll_vectored_read`, line 46, ordinary `method`;
  the expression is inside its callback `|l, waker| ...`.
- The impl at line 39 binds `R: AsyncRead`; `self.handle: BiLock<R>` follows from
  `ReadHalf<T>` at lines 9-10. `lock_and_then` takes `&BiLock<T>` and requires
  `F: FnOnce(&mut T, &Waker)` (lines 19-24). Its invocation therefore supplies
  `l: &mut R` to this callback. This establishes the same trait declaration at
  `futures-io/src/lib.rs:136:12`, with concrete R and runtime override unknown.
- This is **not** a macro-expansion win. Inferring that callback parameter type
  requires the generic helper's argument/closure contract. The baseline closure
  visitor records parameter names without these inferred types. The case keeps
  this second source-proven call in the denominator and sets `expectedGap: true`;
  it must not disappear from the answer to make a one-call result look complete.

A repository-wide source search for `poll_vectored_read` finds the trait
signature, macro method signature/call, and this split method signature/call;
no additional calls were found. The default body's line 140 calls `poll_read`,
not `poll_vectored_read`, so it is not an incoming reference to this case.

## Verification and limits

- Public commit/parent verified through `gh api` and local git; source diff read
  from those immutable revisions, not reconstructed from a recent snapshot.
- Independent standalone syn 2.0.119/proc-macro2 parser, built with rustc 1.89.0,
  checked both full source files: exactly one macro rule with an empty matcher,
  three parsable generated methods, two whole-impl empty-argument invocations,
  and the source spans above. It did not link or execute Archify product code.
  Temporary verifier: `/private/tmp/archify-futures-syn-check-20261109`.
- Source positions and clean checkout state checked independently; Cargo metadata
  readiness checked as described above. No project compilation is asserted.
- Expected answer: **two unique source calls**, both trait-declaration targets,
  runtime implementation not determined; only A exercises the bounded macro rule.
- **Measured improvement: not measured.** Neither baseline nor candidate CLI was
  run on this case. Source inspection predicts that A is eligible for the existing
  whole-impl expansion; B is a separate gap. Do not report a 0-to-1 or 0-to-2 result
  until an authorized replay produces evidence.
- The previous tracing 4/7 case remains regression evidence only; this answer does
  not relabel it or modify any existing answers, cases, scorer, or product source.
