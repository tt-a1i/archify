# Graphty SCC kernel

Adapted from `@graphty/algorithms@3.4.14`, `algorithms/src/indexed/scc.ts`,
commit [909fda2c702c9d802d24ce9dcc21fb8dbf6d2530](https://github.com/graphty-org/graphty-monorepo/blob/909fda2c702c9d802d24ce9dcc21fb8dbf6d2530/algorithms/src/indexed/scc.ts).
The npm release provenance records that commit, and its TypeScript source was
compared byte for byte with the published package.

Copyright (c) 2025 Adam Powers. Distributed under the [MIT License](LICENSE).
Only the SCC traversal is vendored; no Graphty npm runtime is required.

## Local changes

- Use the published JavaScript traversal with a direct `nodeCount/rowPtr/colIdx` input.
- Keep the normal adjacency order; remove the unused `arcOrder` option and its validation.
- Remove the directed-graph wrapper, grouping/condensation APIs and their imports.
- Inline the `0xffffffff` unvisited sentinel.
- Remove the unused `popped` buffer, counter and writes; return only `labels/count`.

The string-ID adapter and canonical cyclic-group output belong to
`../../evaluate/rules/coupling/scc.mjs`. Retain the license and this source pin
when updating. Review upstream traversal changes against this small delta and
run the SCC correctness, deep-graph and cycle evidence tests before syncing.

## Source identity

- Published TypeScript SHA-256: `c7e43bc51b58418fab3049ffecd7e37306ab6875285232bc20d5d16305a4cd01`
- Published JavaScript SHA-256: `a65399b366e95e1e3569a4ac0e17b3dfc3cd8ae7044c64ea97a53ac5b5fad2c5`
- npm tarball SHA-1: `aa0c4333c0225fb41546282c1a9c1c23a6b2c12b`
- npm tarball integrity: `sha512-s4Yj7QIviJYJmnGdmDgLflsDMWH/zGbuzy/zxriWdCUd0vA06QyQfDD309M2HB4keP5fjq8hGakpbCLrkzFQgw==`
