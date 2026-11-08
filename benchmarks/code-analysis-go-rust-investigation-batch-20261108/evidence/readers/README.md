# Independent reader checks

Two readers who had not seen the answer keys ran the normal candidate CLI. They
were told not to read `cases/`, `evidence/` or the benchmark README, and to verify
positions against the sample source before reporting.

## Go: `echo-remove-custom-method` (reserved)

Question: "routeMethods.set now accepts a nil routeMethod so Router.Remove can
delete a custom method without panicking. Which source call reaches this
method?"

Reader result:

- Definition: `router.go:226` (range to 268), `*routeMethods.set`, paired as the
  single changed definition; the effective edit is the nil guard at line 261.
- Direct call: `router.go:860:2`–`26`, `n.methods.set(method, r)`; direct caller
  `(*node).setHandler`, method, declared line 859.
- Resolution: determined (`go-direct-method`), target `set` line 226; no
  interface candidates.
- What helped: `changedDefinitions.items[0].head.knownReferences.items[0].fact`,
  which gave the call range, direct caller and target in one record.
- Remaining gap the reader found: there is no reverse lookup from `setHandler`, so
  the nil-producing call `nodeToRemove.setHandler(method, nil)` at `router.go:446`
  inside `(*DefaultRouter).Remove` has to be found by reading source. The tool
  labels its reference list as direct callsites, not transitive callers.

This matches the frozen key exactly (definition 226, call 860 column 2, caller
`setHandler` 859 method).

## Rust: `bytes-truncate-zero` (reserved)

Question: "Bytes::truncate now releases a shared reference when called with zero.
Which source calls reach this method?"

Reader result:

- Definition: `src/bytes.rs:569` (range to 584), `bytes::Bytes::truncate`; the new
  zero branch is at 570–571.
- Production call: `src/bytes.rs:599:9`–`25`, `self.truncate(0)` inside
  `Bytes::clear` (line 598, method). Shown as `rust-inherent-source-candidate`
  with target line 569.
- What helped: `changedDefinitions.items[0].head.knownReferences` plus
  `sides.head.languageScope.excludedFiles`, which explained why test calls were
  absent (`tests/test_bytes.rs` is outside the selected crate module tree;
  `build.tests` is false).
- Remaining gaps the reader found: `knownReferences.total: 1` reads as exhaustive
  although test calls exist outside the capture profile; the query does not
  analyse arguments, so the "with zero" qualifier must be checked manually; no
  transitive callers.

This matches the frozen key exactly (definition 569, call 599 column 9, caller
`clear` 598 method).

## Why the answer keys stay valid

Neither reader had access to `cases/*.json`. Both reproduced the frozen
coordinates from the CLI output and source alone, and the direct caller kinds
matched. Their reported gaps are display/navigation limits already recorded in
the batch README, not coordinate errors.
