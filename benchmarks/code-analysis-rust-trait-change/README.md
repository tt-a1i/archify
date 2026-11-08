# Rust trait-change investigation

Source-first replay of a maintainer question: a method inside `impl Trait for Type` changed. Which calls definitely point to that implementation, which only prove use of the trait method, and which stay unknown?

This is a bounded source-navigation study, not compiler/runtime proof or a whole-repository accuracy claim.

## Fixed inputs

| Project | Base | Head | Change |
| --- | --- | --- | --- |
| tokio-rs/bytes | `d38faf7c9d003d6074405dd480db6bdb813cb80f` | `c08f87663a04eac3b9ab2dfa1976852d9b525a8c` | body refactor of `impl BufMut for BytesMut::put` |
| rust-lang/log | `761461a5d0c8ea3d483d79b1de0205c2897318d2` | `db145979e229549215300f2696fa89b215cb1cab` | both `KVs::into_kvs` impls change their key type; kept out of rule design |

Profile for both: rustc/cargo `1.89.0`, target `aarch64-apple-darwin`, default features, tests excluded, root module only. `source-first.json` records expected call ranges, declarations, owner types and reasons before either CLI ran; call columns are derived from the frozen source text. `run.py` verifies the head commit and file hashes.

## Source answer and measured result

bytes, changed `BytesMut::put` (`src/bytes_mut.rs:1300`), trait `BufMut::put` (`src/buf/buf_mut.rs:202`):

| Class | Positions | Why |
| --- | --- | --- |
| Definite impl | `src/buf/chain.rs:184`, `src/buf/chain.rs:185` | `ret` is a local `crate::BytesMut`; `ret.put(...)` selects the BytesMut impl |
| Trait candidate | none | no interface-mediated call to `put` in this revision |
| Out of inventory | `src/buf/buf_impl.rs:2374` | definite source answer, but it sits in a `Buf` default method body, which the current call inventory does not scan |
| Other unknown | external/generic `BufMut` receivers, macros | not captured |

log, changed `impl KVs for ()` (`src/__private_api.rs:32`), trait `KVs::into_kvs` (`src/__private_api.rs:17`):

| Class | Positions | Why |
| --- | --- | --- |
| Definite impl | none | no concrete call site in this revision |
| Trait candidate | `src/__private_api.rs:101` | `kvs` has type `K` with `K: KVs<'a>`; the call proves the trait method, not the impl |
| Unknown | concrete impls, macro expansion | reference and unit self types have no concrete call sites |

The reference-self impl at `src/__private_api.rs:25` is reported head-only because its qualname embeds the changed `Key` token text; its head trait candidate is still `src/__private_api.rs:101`.

Baseline at `0c81af0e` reports 0 known references and no trait-candidate coverage for both questions. Candidate `rust-source-direct-v5` returns the three real results below. The display limit is 40; all observed records are included.

| Result | Call range | Target declaration | Owning trait | Implementation type | Status |
| --- | --- | --- | --- | --- | --- |
| bytes `ret.put(&mut self.a)` | `src/buf/chain.rs:184:13-184:33` | `src/bytes_mut.rs:1300:5` | `BufMut` | `BytesMut` | correct |
| bytes `ret.put((&mut self.b).take(...))` | `src/buf/chain.rs:185:13-185:53` | `src/bytes_mut.rs:1300:5` | `BufMut` | `BytesMut` | correct |
| log `kvs.into_kvs()` | `src/__private_api.rs:101:9-101:23` | `src/__private_api.rs:17:12` | `KVs` | unverified (runtime target not determined) | correct |

The bytes count depends on scope, so both are reported:

| Scope | Definite calls found | Missed |
| --- | --- | --- |
| Current call inventory | 2/2 | none |
| Frozen source answer | 2/3 | `src/buf/buf_impl.rs:2374` |

The missing source-answer call is inside a `Buf` default-method body, which the current call inventory does not scan. It is a retained product gap, not a wrong target or a trait-resolution miss.

## Complete example

Change: `BytesMut`'s `BufMut::put` body `src/bytes_mut.rs:1300` was refactored for the cold reuse path.

CLI finding: `ret.put(&mut self.a)` at `src/buf/chain.rs:184` is a direct reference to that changed implementation. `ret` is initialized as `crate::BytesMut::with_capacity(len)`, so the call does not depend on an interface choice. Worth checking because it exercises the refactored cold path.

Remaining uncertainty: `src/buf/buf_impl.rs:2374` also calls `ret.put(...)`, but it lives in a `Buf` default method body outside the current inventory; and any external/generic `BufMut` call is not attributed here.

## Scorer and controls

`run.py` scores each returned real result on call range (file, line, column, end line, end column), target declaration (file, line, column), owning trait and, when determined, implementation type. Missing implementation identity is recorded as `unverified` rather than invented; the log candidate must not claim an implementation.

`controls/fixture` has two traits with the same method name, two types implementing one trait, explicit `<A as Left>::act`, generic `T: Left`, `&dyn Left`, and an ambiguous `&A` receiver that implements both traits. Its negative control replaces the correct `<A as Left>::act` target with `Right::act` on the same type and must return `wrong` with `declaration-range`.

Two controls use the real bytes results:

- Same-named wrong target: replace `src/buf/chain.rs:184`'s target with the same-named trait declaration `src/buf/buf_mut.rs:202` (`BufMut::put`). The scorer returns `wrong` with `declaration-range` and `implementation-type`.
- Same-line different call: replace `src/buf/chain.rs:185`'s call range with the nested `.take(...)` call at `185:21-185:52`, keeping the same target. The scorer returns `wrong` with `call-range` only, so it distinguishes position from target identity.

The script exits nonzero if either real-result control is accepted or if an in-scope item is wrong or missing. The documented source-answer gap at `2374` is reported but does not fail the run.

## CI record

CI run [42465518271](https://github.com/tt-a1i/archify/actions/runs/42465518271) at `3a1ac77a` first failed in `full-regression (2)` because the self-bootstrap test's `spawnSync` hit its 20 s limit (`ETIMEDOUT`, assertion `null !== 0`); no byte or schema comparison ran. The same commit passed on rerun (`gh run rerun --failed`), including the downstream `test (22)` gate. The failure excerpt is in `evidence/ci-full-regression-2-attempt1.txt`; `evidence/ci.json` records both attempts.

The specific 36.19 s runtime cause is unknown; the concurrent shard load is suspected but not measured. Complete CI runs the module suite twice: shard 1 runs it directly and shard 2's root shard includes `test/code-analysis.test.mjs`, which spawns the same suite.

## Independent language-server comparison

`audit.py` asks rust-analyzer `1.89.0 (29483883)` for Go to Definition at the method name, with build scripts, proc macros and check-on-save disabled.

- bytes: 2/2 calls resolve to `src/bytes_mut.rs:1300`, matching the candidate impl targets.
- log: the generic call resolves to the trait declaration `src/__private_api.rs:17`, matching the candidate anchor and not choosing an impl.
- This proves declaration navigation under rust-analyzer's analysis; it does not prove runtime dispatch, execution or full applicability.

## Reproduction

```sh
python3 run.py --cli <source-or-unpacked-zip>/archify/bin/archify.mjs \
  --baseline-cli <0c81af0e-checkout>/archify/bin/archify.mjs \
  --samples /path/to/bytes-base,bytes-head,log-base,log-head \
  --out /tmp/rust-trait-run
```

The samples directory must contain `bytes-base`, `bytes-head`, `log-base`, `log-head` at the pinned revisions. `audit.py --root <sample> --positions <json> --out <dir>` reproduces the language-server rows. `evidence/` contains the normalized source run (`summary.json`), the unpacked-ZIP run (`zip.json`), the CI attempts (`ci.json` and the first-failure excerpt), and the audit summaries; `archify.zip` SHA256 is recorded in `evidence/zip.json`, and the unpacked archive produces byte-identical results to the source run.

## Limits

- Only local captured traits and impls are modeled. External, macro-generated, blanket and supertrait impls remain unknown.
- Receiver types are taken from parameters, local `let` initializers and literal/constructor paths; fields, chained calls and reassigned locals remain unknown.
- Trait default-method bodies are outside the call inventory (independent pre-existing gap).
- Same-type, same-method-name impls in different traits share a qualname slot and stay explicitly `duplicate-slot`, not silently merged.
- No compiler, borrow-check, runtime or complete-impact proof is claimed from source navigation.
