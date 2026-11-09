# Frozen answers: two unrelated real clap changes (2026-11-09)

Frozen from source before running any v9 candidate query. Neither change was
used to design the macro rule; both were selected because the changed definition
has a caller whose call expression sits inside `ok!(...)`.

## A. clap `parse_long_arg` / `parse_short_arg` string operations

- Repository: `clap-rs/clap`, base `ba89563c^`, head `ba89563c`
  ("style: Prefer explicit string operations", 2026-05-01).
- Entry: `clap_builder/src/parser/parser.rs`.
- Changed definitions at head:
  - `Parser::parse_long_arg` at line 763 (`sc_name.to_owned()` at 865).
  - `Parser::parse_short_arg` at line 882 (`sc_name.to_owned()` at 995).
- `ok!` definition: `clap_builder/src/macros.rs:583`, one rule
  `($expr:expr) => { match $expr { ... } }`, imported by
  `#[macro_use] mod macros;` at `clap_builder/src/lib.rs:55`.
- Expected macro-wrapped references in `Parser::parse` (declared line 77):
  - line 149, column 44: `self.parse_long_arg(...)`;
  - line 219, column 44: `self.parse_short_arg(...)`.
- Expected evidence: `macroEvidence` naming `ok` with definition
  `clap_builder/src/macros.rs:583:14`, `targetNavigation` to the two
  definitions above.
- Build: no cfg gate on either definition or caller; clap_builder default
  features apply.

## B. clap `parse_short_arg` token-number test

- Repository: `clap-rs/clap`, base `9a9aabc1^`, head `9a9aabc1`
  ("refactor: Reduce code size of testing tokens if they're a number",
  2023-10-23).
- Entry: `clap_builder/src/parser/parser.rs`.
- Changed definition at head: `Parser::parse_short_arg` at line 831.
- Expected macro-wrapped reference in `Parser::parse` (declared line 77):
  - line 185, column 44: `self.parse_short_arg(...)`.
- Expected evidence: `macroEvidence` naming `ok` with definition
  `clap_builder/src/macros.rs:583:14`.

## Scoring

A position counts as correct only when the query returns it, resolves it to the
named definition, and carries `macroEvidence`. Missing positions are recorded
as misses; any resolved position at a different definition is a wrong target.
