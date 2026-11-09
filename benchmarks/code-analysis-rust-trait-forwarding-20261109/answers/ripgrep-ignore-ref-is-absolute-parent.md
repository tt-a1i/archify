# Frozen source answer: ripgrep IgnoreRef::is_absolute_parent through a closure (2026-11-09)

Source-only research for the v14 closure-provenance revision. No Archify CLI,
candidate query, product build, or product test was run before this answer was
written. The expected answer is derived from the pinned upstream source and
diff only. No upstream Rust source was edited.

## Real repository change and prepared sources

- Repository: [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep),
  unrelated to the synthetic `closure-provenance` fixture.
- Base: `79a23e0` (`43e2f08^`).
- Head: `43e2f08edef8c00e5d7719212c3e6a869bca1151`
  ("ignore: fix parent gitignore matching across multiple roots").
- Entry: `crates/ignore/src/dir.rs`.
- Changed definition: `IgnoreRef::is_absolute_parent`; declaration starts at
  `crates/ignore/src/dir.rs:610:5` (the `pub` token, the model's item position)
  and the identifier is at `610:19`; body `self.inner.is_absolute_parent`.
- The commit moves the accessor off `Ignore` and onto a new borrowed view:
  - Base: `Ignore::is_absolute_parent` at `crates/ignore/src/dir.rs:167`,
    body `self.inner.is_absolute_parent`.
  - Head: `IgnoreRef<'_>` at `dir.rs:600-613`; `Ignore::parents` at `dir.rs:589`
    returns `Parents<'_>`; `Parents::next` at `dir.rs:617` yields
    `Item = IgnoreRef<'a>` (`dir.rs:619`).
- Local helper signature: `fn parents(&self) -> Parents<'_>`; the local
  `Iterator for Parents` declaration supplies the closure input type
  `IgnoreRef`.
- Worktrees: base `/private/tmp/archify-v14-samples/ripgrep-ref-base`,
  head `/private/tmp/archify-v14-samples/ripgrep-ref-head`.
- Case: `../cases/ripgrep-ignore-ref-is-absolute-parent.json`.

Both checkouts are clean detached worktrees with a committed `Cargo.lock`.
Cargo 1.89.0 `metadata --offline --no-deps --format-version 1` succeeded on
both; no dependencies were built.

## Expected call

Coordinates are one-based; spans are end-exclusive, so the end column is one
past the method call's closing `)`.

| Call | Direct caller | Why it is a reference |
| --- | --- | --- |
| `crates/ignore/src/walk.rs:1900:52-1900:75` | `check_symlink_loop` at `1892:1` | `for ig in ig_parent.parents().take_while(|ig| !ig.is_absolute_parent())` |

`ig_parent.parents()` is the local `Ignore::parents` helper. On head its
signature returns `Parents<'_>`, whose `Iterator::Item` is `IgnoreRef<'a>`, so
the `take_while` closure input `ig` is `&IgnoreRef<'_>` and
`ig.is_absolute_parent()` resolves to the head definition at `dir.rs:610`.
On base the same source position resolves to `Ignore::is_absolute_parent` at
`dir.rs:167`, because `Parents::Item` was then `&'a Ignore`. The commit changes
the receiver identity of the same physical call.

## Excluded sites

- `crates/ignore/src/dir.rs:563`, `606` and `630` read the
  `is_absolute_parent` field through `ig.inner`, not the accessor method.
- `crates/ignore/src/dir.rs:240` and `846` assign the field.
- No other `.is_absolute_parent()` method call exists in the pinned head tree;
  the walk test at `walk.rs:2629` is unit-test code outside the default source
  profile and does not call this method.

## Unknowns and measured-interest

- The receiver type comes from the local `Parents` iterator declaration, not
  from an `Fn(...)` parameter of a helper function. The closure is handed to
  the standard `Iterator::take_while` adapter, so this case intentionally tests
  the boundary of the v14 closure model. A zero-result candidate answer here is
  a retained coverage gap, not evidence that the source has no reference.
- This is a receiver-identity change: name-based matching must not silently
  keep the base `Ignore` accessor as the head target.

## Freeze provenance

Frozen from the pinned upstream base/head diff and source before the candidate
query. The head definition, both `Parents` versions and the single call site
were read directly from the two worktrees. Candidate output was not consulted
for the call set or target. After the first candidate run, the answer text was
corrected only for span convention: the call end is end-exclusive and the
inherent item's position is its declaration start (`pub` token). The call
position and target line did not change.

## Candidate comparison (after freeze)

Normal CLI, default Rust source profile, same frozen case and roots:

| Model | Score | Detail |
| --- | --- | --- |
| v13 (`3ab78d5be`) | 0/1 | zero known references, no extras |
| v14 (working tree) | 0/1 | zero known references, no extras |

Evidence: `evidence/revision-v14/queries/ripgrep-ignore-ref-is-absolute-parent.{v13,v14}.json`.
Both models classify the head accessor as an unpaired head-only definition and
return an available but empty reference list. The source call at
`walk.rs:1900` is not resolved because the closure input comes from the local
`Parents` iterator through the standard `take_while` adapter. This case is
retained as a measured coverage gap; it is not reported as a v14 gain.
