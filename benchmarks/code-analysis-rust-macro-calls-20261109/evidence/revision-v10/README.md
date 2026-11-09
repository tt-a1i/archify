# v10 accuracy revision and full replay

This directory records the second review round on the same branch, starting
from `77d0aae23` (v9). It fixes two false-positive classes found by review and
replays every earlier acceptance artifact.

## Counterexample (scope + cfg)

Fixture: `../../fixtures/rust-macro-scope-cfg`. Base and head differ only in the
`Parser::parse` body. Three calls on the same base/head:

- line 7: block-local `ok!` discards its argument;
- line 10: `cfg_drop!` keeps the use only under `#[cfg(any())]`;
- line 13: module `ok!` passes the argument through once.

| Receipt | Known references |
| --- | --- |
| `scope-cfg/before-query.json` (v9) | `7:88`, `10:51`, `13:45` |
| `scope-cfg/after-query.json` (v10) | `13:45` only |

The two eliminated positions are the local-shadowing and cfg-deleted false
positives. Lines 7 and 10 remain unresolved macro calls in raw facts, without a
target or `macroEvidence`.

## Same source, cfg on and off

`../../fixtures/rust-macro-args` adds `gated`, whose expansion uses the argument
only under `#[cfg(feature = "extra")]`. With `extra` off the call at line 35 is
`rust-macro-not-expanded`; with `extra` on it resolves with `gated` evidence at
32:14. Both profiles compile with cargo 1.89.0.

## Real clap changes

`real-changes/case-a.json` and `case-b.json` (v10) retain the same three
passthrough positions as v9: `149:44`, `219:44` and `185:44`, each with `ok`
evidence. `is_new_arg` at `331:29` remains a direct call without macro evidence.
Case A is `partial` only because the head commit edits the root `Cargo.toml`.

## Original 20 cases

`../final-v10/summary.json`: 79/86 correct, 7 missed, 0 wrong, 2 known extras,
20/20 definitions found, counterexamples 144/144. `../comparison-v10` compares
v9 with v10 and shows identical per-case outcomes.

## Reader

A fresh uninvolved reader ran case B with the v10 CLI and cross-checked source:
`parse_short_arg` at 831, reference `185:44` with `ok@554:14`, and the direct
`is_new_arg` caller at `331:29` with no macro evidence. Report:
`../readers/case-b-reader-v10.md`.

## Fresh ZIP

`archify.zip` bytes for v10: SHA256
`5876a160729f4e0c16305071976444837c40403b9715e72619690a4b0c612932`,
405 files. Unpacked into a fresh directory and installed with `npm ci`, the
ZIP's own CLI reports `rust-syn@2.0.119` / revision 10 /
`rust-source-direct-v10` and reproduces:

- `zip/scope-cfg.json`: only `13:45`;
- `zip/case-b.json`: `185:44` with `ok@554:14`, `331:29` direct.

Command lines are stored next to the receipts.
