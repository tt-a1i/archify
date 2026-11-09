# Two unrelated clap changes: v8 baseline and v9 result

The answers in `../../answers/real-changes.md` were frozen from source before any
candidate query ran. Both changes were selected only because the changed
definition has a caller inside `ok!(...)`; neither was used to design the macro
rule. The v8 baseline is `021a3898a` (adapter revision 8); the candidate is this
branch (adapter revision 9).

| Case | Changed definition | v8 references | v9 references | Wrong targets |
| --- | --- | --- | --- | --- |
| A | `Parser::parse_long_arg` (763) | 0 | 1 at `149:44`, `valid` | 0 |
| A | `Parser::parse_short_arg` (882) | 0 | 1 at `219:44`, `valid` | 0 |
| B | `Parser::parse_short_arg` (831) | 0 | 1 at `185:44`, `valid` | 0 |
| B | `Parser::is_new_arg` (635) | 1 at `331:29`, `valid` | 1 at `331:29`, `valid` | 0 |

All three added references carry
`macroEvidence: [{name:"ok", definition:{file:"clap_builder/src/macros.rs",
line:583 or 554, column:14}, argumentUse:"once", expansion:"preserved"}]` and
resolve to the named changed declaration. `is_new_arg` is a direct call and
correctly carries no macro evidence.

Net effect: **3 new navigable positions and 3 newly resolved targets, with no
lost baseline reference and no wrong target.**

Case A's query status is `partial` with reason `resolution-settings-differ`;
the head commit edits the root `Cargo.toml`, so the paired capture records a
settings change. Every reference is still `valid`; the status describes the
capture, not a finding. Case B is `ready`.

Raw receipts: `case-a.json`, `case-b.json` (v9) and `baseline-v8/` (v8).

## v10 accuracy revision (same branch, 2026-11-09)

The two changes were re-run under `rust-source-direct-v10`. All three
`ok!`-wrapped positions (`149:44`, `219:44`, `185:44`) still resolve to the
named declarations with `macroEvidence`; `is_new_arg` at `331:29` remains a
direct reference with no macro evidence. Receipts:
`../revision-v10/real-changes/`.
