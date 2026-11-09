# Frozen review counterexample: macro scope and cfg (2026-11-09)

This answer was frozen from the fixture source before the v10 fix ran. The base
and head crate differ only in the body of `Parser::parse` (`Ok(1)` → `Ok(2)`), so
the change query should report exactly the calls in the three functions below.

Fixture: `fixtures/rust-macro-scope-cfg/{base,head}`. Both compile with
`cargo build` (cargo 1.89.0, warnings only).

| Head line | Source | Correct outcome |
| --- | --- | --- |
| 7 | block-local `macro_rules! ok` discards its argument; call `ok!(p.parse())` | **unknown** (`rust-macro-not-expanded`, no macro evidence) |
| 10 | module `cfg_drop!` expands to a statement guarded by `#[cfg(any())]`, which deletes every argument use | **unknown** (`rust-macro-not-expanded`, no macro evidence) |
| 13 | module `ok!` passes `$e` through once | **known** reference to `Parser::parse` at 4:5, `macroEvidence` `ok` at 6:14 |

## Pre-fix receipt (v9, `77d0aae23`)

Normal CLI on the same base/head returned three known references:

- `src/lib.rs:7:88` → `Parser::parse:4`, `macroEvidence` `ok` at `6:14`
- `src/lib.rs:10:51` → `Parser::parse:4`, `macroEvidence` `cfg_drop` at `8:14`
- `src/lib.rs:13:45` → `Parser::parse:4`, `macroEvidence` `ok` at `6:14`

The first is wrong because the block-local `ok` discards the argument; the
second is wrong because `#[cfg(any())]` removes the use. The receipt is kept in
`evidence/revision-v10/scope-cfg/before-query.json`.

## Acceptance

After the fix, the same normal CLI must return only `src/lib.rs:13:45` as a
known reference. Lines 7 and 10 may still appear as unresolved macro calls, but
must not carry a target or `macroEvidence`.
