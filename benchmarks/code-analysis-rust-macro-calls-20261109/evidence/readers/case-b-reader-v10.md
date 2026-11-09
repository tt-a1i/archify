# Case B reader check (v10, 2026-11-09)

A reader who had not seen any answer key ran the normal v10 CLI on the same
base/head checkouts and cross-checked every coordinate against source.

- Status `ready`; definitions `Parser::is_new_arg` at 635:5 and
  `Parser::parse_short_arg` at 831:5.
- `parse_short_arg`: reference `parser.rs:185:44` → target `831:5`, caller
  `get_matches_with` at 49:5 (method), `macroEvidence` `ok` at
  `clap_builder/src/macros.rs:554:14`, `argumentUse: once`,
  `expansion: preserved`.
- `is_new_arg`: reference `parser.rs:331:29` → target `635:5`, same caller,
  **no `macroEvidence`**.
- Source cross-check: 185–191 is the `ok!(self.parse_short_arg(...))`
  expression; 331 is `self.is_new_arg(&n, arg)`; 554 is the `ok!` definition
  whose rule uses `$expr` once as the `match` scrutinee.

Trust: high for the coordinates. Limits reported by the reader: source callsites
only, no runtime/transitive expansion; `debug!`-wrapped calls stay unresolved and
the unresolved list is display-limited.
