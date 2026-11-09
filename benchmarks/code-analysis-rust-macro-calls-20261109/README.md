# Rust macro-argument call evidence (2026-11-09)

This experiment asks whether Archify can turn a macro-wrapped call into a
navigable source reference without guessing. It starts from the four remaining
misses of the previous batch: clap's `ok!(...)`, tracing's `layer_impl_body!`,
`try_lock!` and `feature!`. Answers for all four were frozen from source in
`answers/macro-sites.md` before any candidate ran.

A second review round found two false positives in the first implementation: a
block-local macro that discards its argument, and a macro whose expansion
deletes the argument under cfg. The v10 revision resolves the binding actually
visible at the callsite and proves argument preservation under the active cfg.
The frozen counterexample is `answers/macro-scope-cfg.md`; the pre-fix receipt
returns lines 7, 10 and 13, and the fixed answer keeps only line 13.

## Delivered mechanism

The Rust extractor traverses the argument expression of a local `macro_rules!`
invocation in place, keeping the original source positions, only when all of the
following are proven from captured source:

- the binding visible at the callsite is a preceding block-local definition or,
  when the block has none before the call, the unique module-level definition in
  the selected crates; leaving the block restores the outer binding;
- the definition is textually visible: same module and earlier, an ancestor
  module declared earlier, or a sibling `#[macro_use] mod` declared before the
  callsite module;
- neither the callsite nor an intervening module imports or glob-imports the
  same name, and no enclosing block does either;
- every rule matcher is exactly one `$x:expr` (an optional trailing comma is
  allowed);
- every expansion uses `$x` exactly once, outside `$(...)` repetition and
  outside nested macro argument groups;
- the active cfg keeps that use: attribute state is evaluated against the
  selected feature/target profile, an unknown cfg is not accepted, and a use
  removed by `#[cfg(...)]` is not preservation.

Such calls carry
`macroEvidence: [{name, definition:{file,line,column}, argumentUse:"once",
expansion:"preserved"}]`. Every other macro keeps the old opaque record and
still reports `rust-macro-not-expanded`. The model is
`rust-source-direct-v10` (adapter revision 10); the schema, docs and question
layers were updated together.

The rule was narrowed twice after review. First, a bare-name lookup could
attribute an imported external macro to an unrelated local definition of the
same name; scope and import checks were added. Second, a module-level lookup
ignored block-local shadowing and syntactically present but cfg-deleted uses;
v10 resolves the visible local binding and parses the expansion under the
active cfg. Tests cover both shadowing directions, binding restoration, a
cfg-enabled and cfg-disabled use of the same source, and `#[cfg(any())]`.

## What each frozen site became

| Site | Source answer | Candidate result |
| --- | --- | --- |
| clap `ok!(TypedValueParser::parse_ref_(...))` | argument used once as the `match` scrutinee | **fixed**: the call at `value_parser.rs:658:25` now resolves to the trait declaration with `macroEvidence` for `ok` |
| tracing `layer_impl_body!` | one source call expands into two generated impl methods | **still unknown**: macro-item expansion is a different mechanism; the call remains inside the macro body |
| tracing `try_lock!` | receiver wrapper; the method call is outside the macro; the file is not captured | **still unknown**: needs guard/deref receiver semantics and capture of the `feature!`-gated module |
| tracing `feature!` | cfg-transparent item wrapper around whole modules | **still unknown**: needs cfg-wrapper traversal; the gated file is absent |

Only the first class is claimed. The other three are recorded with the mechanism
each needs rather than approximated by token scanning.

## Review counterexample: same target, three bindings

`fixtures/rust-macro-scope-cfg` is a compilable base/head pair whose only diff
is the `Parser::parse` body. Three calls target it:

| Line | Binding at the callsite | v9 (before) | v10 (after) |
| --- | --- | --- | --- |
| 7 | block-local `ok!` discards `$e` | known reference (wrong) | unknown |
| 10 | `cfg_drop!` uses `$e` only under `#[cfg(any())]` | known reference (wrong) | unknown |
| 13 | module `ok!` passes `$e` once | known reference | **known reference, retained** |

The pre-fix normal CLI returned `7:88`, `10:51` and `13:45`; the fixed CLI
returns only `13:45` with `ok` evidence at `6:14`. Raw facts keep lines 7 and 10
as `rust-macro-not-expanded` without a target. `fixtures/rust-macro-args` adds
the same source analyzed with `extra` off and on: `gated!(p.parse())` stays
unknown when the feature is off and resolves when it is on.

## Two unrelated real changes

Both changes were selected after the rule was designed, only because the changed
definition has a caller inside `ok!(...)`. Answers were frozen before running the
candidate (`answers/real-changes.md`). Baseline is `021a3898a` (v8); candidate is
this branch (v9).

| Case | Changed definition | v8 references | v9 references | Wrong targets |
| --- | --- | --- | --- | --- |
| A | `Parser::parse_long_arg` (763) | 0 | 1 at `149:44`, `valid` | 0 |
| A | `Parser::parse_short_arg` (882) | 0 | 1 at `219:44`, `valid` | 0 |
| B | `Parser::parse_short_arg` (831) | 0 | 1 at `185:44`, `valid` | 0 |
| B | `Parser::is_new_arg` (635) | 1 at `331:29`, `valid` | unchanged | 0 |

All three added references carry `macroEvidence` naming `ok` at
`macros.rs:583:14` (case A) or `macros.rs:554:14` (case B) and resolve to the
named changed declaration. The direct `is_new_arg` call carries no macro
evidence. Net: **3 new navigable positions, 3 newly resolved targets, no lost
baseline reference, no wrong target.** Case A reports `partial` because the head
commit edits the root `Cargo.toml` (`resolution-settings-differ`); every
reference is still `valid`.

Receipts: `evidence/real-changes/{case-a,case-b}.json` (v9),
`evidence/real-changes/baseline-v8/`, `evidence/real-changes/results.md`. The v10
rerun is in `evidence/revision-v10/real-changes` and keeps the same three
positions and the direct `is_new_arg` call.

## Counterexamples

`fixtures/rust-macro-args/` is a real crate that compiles with `cargo build` and
`cargo build --features extra` (rustc/cargo 1.89.0). It proves in executable code
that arguments which are discarded, used twice, nested in another macro
argument, or placed in a repetition are **not** treated as preserved, while the
single-use `ok!` argument is. The cfg-off caller stays opaque and the same caller
resolves when the feature is enabled. The `gated` macro additionally proves that
the same source resolves only when its internal `#[cfg(feature = "extra")]`
keeps the use. The scope/cfg fixture proves the block-local shadowing and
`#[cfg(any())]` deletions in compiled code.

The unit tests add non-compiling scope controls: a macro name shadowed by an
import, a `#[macro_use]` sibling declared after the callsite, and a cfg-gated
definition. These are source-scope controls; compilation is irrelevant to the
question they protect.

## Original 20-case regression

The previous batch was replayed unchanged with v9 (20 cases, 86 expected call
positions, reserved included). Of the 144 counterexample checks, 114 are
applicable and all pass; 30 are not applicable because the saved query has no
record for the mutation to act on; all 8 check kinds have at least one applicable
case.

| Metric | Stage-2 baseline (v8) | First candidate (v9) | Accuracy revision (v10) |
| --- | ---: | ---: | ---: |
| Correct positions | 78 | **79** | **79** |
| Missed | 8 | **7** | **7** |
| Wrong targets | 0 | **0** | **0** |
| Extra positions needing review | 2 | 2 | 2 |
| Definitions found | 20/20 | 20/20 | 20/20 |
| Counterexample checks (applicable / passed) | 104: 84 / 82 | **144: 114 / 114** | **144: 114 / 114** |

The stage-2 baseline predates the reserved cases and has 104 checks. Of the 144
final checks, 30 are not applicable: `delete-target` 9, `promote-candidate` 9,
`omit-target-file` 10 and `wrong-declaration` 2 have no concrete, candidate or
same-file target record to mutate. Totals are computed from each check's
`available` and `passed` fields, not from a blanket pass count.

The only changed case against v8 is `clap-typed-value-parser`: 0/1 to 1/1, the
same `ok!` class. `evidence/comparison/comparison.md` is the v8→v9 comparison;
`evidence/comparison-v10/comparison.md` compares v9 with v10 and shows identical
per-case outcomes. The two remaining extras and seven misses are the previously
documented Go/Rust gaps, not new macro regressions.

## Reader check

An uninvolved reader received only the case-B checkouts, the entry file, the
question "What changed?", and the CLI. It was told not to read the frozen
answers. It independently reported `parse_short_arg` at head line 831, one caller
at `parser.rs:185:44` resolving to `831:5` with `macroEvidence` for `ok` at
`macros.rs:554:14`, plus the direct `is_new_arg` caller at `331:29` with no macro
evidence. It cross-checked every coordinate against source and rated trust high
for the caller answer, limited for behavioral impact. A second reader repeated
the check on v10 with the same result. Records:
`evidence/readers/case-b-reader.md` and `case-b-reader-v10.md`.

## Known limits

- Only local `macro_rules!` arguments are traversed. Imported/exported macros,
  multi-segment macro paths, `macro` 2.0, token rewriting, and macros with any
  non-single-expression rule stay opaque.
- Names imported or glob-imported anywhere between the callsite and the defining
  scope block attribution, even when the import actually points to the same
  definition. This is a deliberate miss.
- A name with one definition in another selected crate is not traversed, even if
  it is re-exported into this crate. Also a deliberate miss.
- `macroEvidence` describes the argument-use proof, not runtime evaluation or
  the concrete method selected at runtime. An unknown cfg keeps the call
  unknown; the extractor does not guess the feature profile. Navigation still
  follows the normal v10 binding rules.
- The visible local binding is chosen by source position within the block. A
  block-local definition placed after the call does not shadow it; macros
  defined inside a nested item that cannot be reached textually are not
  considered.
- `layer_impl_body!`, `try_lock!` and `feature!` require different mechanisms and
  remain unknown; they are not silently promoted to references.

## Reproduction

```sh
node --test archify/modules/code-analysis/test/rust-calls.test.mjs

node archify/bin/archify.mjs code-analysis task --question "What changed?" \
  --base-root /tmp/clap-a2-base --root /tmp/clap-a2-head \
  --entry clap_builder/src/parser/parser.rs --format json \
  --out /tmp/case-a.json

node archify/bin/archify.mjs code-analysis task --question "What changed?" \
  --base-root benchmarks/code-analysis-rust-macro-calls-20261109/fixtures/rust-macro-scope-cfg/base \
  --root benchmarks/code-analysis-rust-macro-calls-20261109/fixtures/rust-macro-scope-cfg/head \
  --entry src/lib.rs --format json --out /tmp/scope-cfg.json

python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/run.py \
  --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out benchmarks/code-analysis-rust-macro-calls-20261109/evidence/final-v10 \
  --include-reserved

python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/replay-counterexamples.py \
  --evidence benchmarks/code-analysis-rust-macro-calls-20261109/evidence/final-v9 \
  --evidence benchmarks/code-analysis-rust-macro-calls-20261109/evidence/final-v10 \
  --check
```

The sample roots are fixed `git worktree` checkouts used by the previous batch.
The two clap pairs are `clap-rs/clap` at `ba89563c^..ba89563c` and
`9a9aabc1^..9a9aabc1`.

## ZIP replay

The distributable `archify.zip` (`5876a160…`, 405 files) was built from commit
`bc21d9cc8` with `scripts/build-zip.sh` under official Node 22.23.4 and bundled
zlib `1.3.1-e00f703`, then unpacked into a fresh directory with `npm ci`. The
ZIP's own CLI reported `rust-syn@2.0.119`, revision 10,
`rust-source-direct-v10`:

| Replay | Result |
| --- | --- |
| scope/cfg counterexample | only `13:45` is a known reference; lines 7 and 10 stay unknown |
| case B | `parse_short_arg` at `parser.rs:831`; reference `185:44` with `ok` evidence at `macros.rs:554:14`; `is_new_arg` reference `331:29` direct |

Receipts, stderr and exact commands are in `evidence/revision-v10/zip/`. The v9
AsRef/case-B replay remains in `evidence/zip/`. The current ZIP is committed at
the repository root; the unpacked tree is not.
