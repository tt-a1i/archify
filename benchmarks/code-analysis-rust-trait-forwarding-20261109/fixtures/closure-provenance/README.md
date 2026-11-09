# Closure provenance control

Compiled source control for the v14 closure-provenance revision.

- `base/` has `provider::Item::mark` returning `1`, a `consumer::Item::mark`
  returning `2`, `with_item` taking `FnOnce(&Item)`, and `with_generic` taking a
  generic `FnOnce(&T)`. `generic::run` imports `Item as ProviderItem` and calls
  `with_generic(&item, |item| item.mark())`; `consumer::run` calls
  `with_item(|item| item.mark())`.
- `provider-head/` changes only the provider body from `1` to `3`.
- `caller-head/` changes only the consumer body from `2` to `4`.

The provider query must report both closure calls at `src/lib.rs:24:36` and
`41:26`, both targeting `src/lib.rs:5:9`. The caller query must report zero
known references. The same source runs through `run-closure-provenance.py`,
which also builds all three roots with `cargo build --offline` before querying.

```sh
cargo build --offline --manifest-path base/Cargo.toml
cargo build --offline --manifest-path provider-head/Cargo.toml
cargo build --offline --manifest-path caller-head/Cargo.toml
```
