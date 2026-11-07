# Next Rust inherent-function investigation (source freeze only)

Baseline: concrete-Go Draft #1264, `3b2bdd1aec833f85c51aaf8c2d8c711fb7083c32`, retaining the cumulative six-language and original team histories. No associated-function implementation or new Rust model yet. The analyzer remains rust-source-direct-v1.

Answers were committed at98cbbc7dc before this question's baseline and before any new Rust rule. These repositories were previously exposed in the free-function study, not blind. Source-first.json records exact pins, hashes, absent Cargo.lock files, owners, profiles and counterexamples.

- regex9870c06e6c772daaad7ab612faab29130753e41c: `src/regex/string.rs:125 Regex::new(s)` should reach the inherent definition at180:5 in that file. The distinct bytes Regex call at `src/regex/bytes.rs:123` should reach178:5 there. Same type/function spelling must not conflate these modules.
- serde_json4d4f53c3b7de3259b6a8a15ef4d5f4edb47af32f: `src/value/from.rs:60 Number::from_f64(f)` has `use crate::number::Number`; expected `src/number.rs:183:5`. This call occurs inside a trait implementation, but explicitly invokes a named inherent function. Default and arbitrary_precision feature profiles both retain this source definition while selecting different body branches.
- `src/value/de.rs:52 Number::deserialize(de)` refers to a Deserialize trait implementation and remains unproved; do not index trait methods as inherent functions merely by nominal owner name.
- `src/value/from.rs:20 from_integer!` is recorded as an opaque item expansion. Do not invent generated From functions or callers from unexpanded tokens.

All three normal baseline CLI checks exit0 under explicit `--fail-on never`, with zero parse failures. Regex captures166files; each serde profile captures16. Four positive observations represent three distinct physical sites (serde repeated under two profiles); all are known-source misses. Two trait-control observations remain unresolved, and both macro observations remain opaque. Complete call ranges distinguish the inner path call from a chained .map_or/.map sharing the same start.

Current functions already inventory the impl definitions: regex::string::Regex::new, regex::bytes::Regex::new, and number::Number::from_f64 have exact captured ranges. The chosen gap is that structs/enums/types are Binding::Other, so Type::function paths cannot traverse the module resolver. Do not duplicate an inventory that already exists.

Next: freeze independent rustc controls and reserve a review slice before implementing type/owner identity. Preserve inherent versus trait distinctions, cfg state, import aliases and cross-crate Cargo boundaries. Review impl/nested generic scopes before new type-path binding: the current root impl registration propagates function generics but not impl generic parameters. A source candidate must not masquerade as proof of trait, generic or visibility applicability. Preserve v1 readers and explicit unknowns; no macro expansion, project build-script execution, runtime receiver inference or formal integration is implied.
