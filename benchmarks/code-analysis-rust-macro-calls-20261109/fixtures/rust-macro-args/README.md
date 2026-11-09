# Rust macro-argument counterexamples

Crate checked by `rustc 1.89.0` / `cargo 1.89.0`.

One preserving macro and four controls live in `src/lib.rs`:

| Macro | Matcher | Expansion use | Extractor outcome |
| --- | --- | --- | --- |
| `ok` | `$e:expr` | once as the `match` scrutinee | call inside `ok!(...)` resolves, with `macroEvidence` |
| `discard` | `$e:expr` | never | stays `rust-macro-not-expanded` |
| `twice` | `$e:expr` | twice | stays `rust-macro-not-expanded` |
| `wrapped` | `$e:expr` | once, but as a nested macro argument | stays `rust-macro-not-expanded` |
| `listed` | `$($e:expr),*` | repetition | stays `rust-macro-not-expanded` |
| `gated` | `$e:expr` | once, inside `#[cfg(feature = "extra")]` | resolves only when `extra` is selected |

`feature_call` is gated by `#[cfg(feature = "extra")]`; `extra` is not a default
feature.

## Compile checks

```sh
cargo build                     # exit 0, warnings only (unused results)
cargo build --features extra    # exit 0, warnings only
```

Both profiles compile, so the discard/duplicate/nested/repetition and cfg-off
controls are real programs, not pseudo-code.

## Extractor checks

```sh
node -e "import('../../../../archify/modules/code-analysis/lib/analysis.mjs').then(async m => {
  const facts = m.extractFacts('.', {language:'rust', config:m.mergeConfig(m.loadConfig(), {rust:{offline:false}})}).facts;
  for (const c of facts.calls) console.log(c.line, c.resolution, c.macroEvidence?.[0]?.name);
})"
```

Default profile, `src/lib.rs` positions:

- line 23 `ok!(p.parse())`: `rust-inherent-source-candidate`, target
  `Parser::parse` at 4:5, `macroEvidence: [{name: "ok", definition: 6:14,
  argumentUse: "once", expansion: "preserved"}]`.
- lines 24-27: `unresolved` / `rust-macro-not-expanded`, no `macroEvidence`.
- no call at line 30; the gated function is excluded.

With `-c '{"rust":{"features":{"sample":["extra"]}}}'` the call at line 30 also
resolves with the same `macroEvidence`.

The `gated` macro is the same source analyzed under both profiles: with `extra`
off the argument use is removed by cfg and line 35 stays unknown; with `extra`
on line 35 resolves and carries `gated` evidence at 32:14.

The same assertions are automated in
`archify/modules/code-analysis/test/rust-calls.test.mjs` ("Rust preserves only
single-expression local macro arguments proven used once", "Rust traverses a
preserving macro only when cfg selects the callsite", "Rust duplicate macro
definitions stay opaque instead of choosing one").
