# Macro scope and cfg counterexamples

Crate pair checked by `rustc 1.89.0` / `cargo 1.89.0`. The base and head differ
only in the body of `Parser::parse` (`Ok(1)` → `Ok(2)`), so a change query must
report the calls in the three functions without any source-shape change.

| Function | Call | Correct extractor outcome |
| --- | --- | --- |
| `local_discard` | line 7, block-local `ok!` discards `$e` | unknown, no `macroEvidence` |
| `cfg_deleted` | line 10, `cfg_drop!` keeps the use only under `#[cfg(any())]` | unknown, no `macroEvidence` |
| `passthrough` | line 13, module `ok!` uses `$e` once | known reference to `Parser::parse` at 4:5 with `ok` evidence at 6:14 |

`#[cfg(any())]` is false in every profile, so line 10 stays unknown after the
fix. The block-local `ok!` is defined before the line-7 call and goes out of
scope afterwards; line 13 resolves to the module binding again.

## Compile checks

```sh
(cd base && cargo build)
(cd head && cargo build)
```

Both compile with warnings only.

## Change-query check

```sh
node archify/bin/archify.mjs code-analysis task --question "What changed?" \
  --base-root benchmarks/code-analysis-rust-macro-calls-20261109/fixtures/rust-macro-scope-cfg/base \
  --root benchmarks/code-analysis-rust-macro-calls-20261109/fixtures/rust-macro-scope-cfg/head \
  --entry src/lib.rs --format json --out /tmp/scope-cfg.json
```

Before the fix this returned known references at 7, 10 and 13. After the fix
only `src/lib.rs:13:45` is a known reference; lines 7 and 10 remain unresolved
macro calls. Frozen answer: `../../answers/macro-scope-cfg.md`.
