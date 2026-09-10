# Repository Evidence Passport — focused research note

Date: 2026-07-23
Decision: build one bounded Architecture-only slice; do not widen Archify into a code indexer.

## Signal from adjacent projects

- GitNexus treats a code map as useful when it carries real execution flows, impact, staleness, and local/private operation—not merely more node styles ([README at `cdbdf21`, execution model](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L32-L32), [privacy and local operation](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L83-L93), [staleness and process resources](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L168-L172)).
- CodeBoarding leads with architecture and component diagrams that remain navigable across local workflows, IDEs, CI, and docs ([README at `96c6015`](https://github.com/CodeBoarding/CodeBoarding/blob/96c60153f5169102d49dc3cf4150293df0db1eb0/README.md#L5-L32)).
- Understand Anything says the graph should teach, then makes nodes clickable/searchable and pairs them with source, relationships, and dependency-ordered tours ([README at `6ae7187`](https://github.com/Egonex-AI/Understand-Anything/blob/6ae71878beb50226a1e4b7e2f52ac6468c86f74b/README.md#L51-L80)). Archify already has search, relationships, guided views, and stories; the missing part is source evidence.
- CodeVisualizer likewise makes click-to-code, auto-refresh, and local parsing prominent ([README at `5b100b8`](https://github.com/DucPhamNgoc08/CodeVisualizer/blob/5b100b847ec9a86ac07129f7f6ed1a9deafc9ecc/README.md#L96-L119), [privacy](https://github.com/DucPhamNgoc08/CodeVisualizer/blob/5b100b847ec9a86ac07129f7f6ed1a9deafc9ecc/README.md#L264-L269)).
- Fireworks Tech Graph wins attention through visual breadth and motion, but its current public surface already overlaps Archify's offline HTML/export strengths ([README at `50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L136-L153)). Copying more styles is lower-value than making Archify's existing semantic exploration more trustworthy.

## Borrow / skip

Borrow:

1. A selected architecture node can open the exact source file and optional line range.
2. File paths participate in the existing Node Finder.
3. Evidence is pinned to a full commit SHA so links cannot silently drift.
4. Local verification happens before an artifact is written.

Skip:

1. No AST parser, repository crawler, knowledge graph, LLM indexing pipeline, IDE extension, or server.
2. No additional toolbar control or permanent panel.
3. No generic “source” label that merely repeats an unverified path.
4. No private filesystem paths in the artifact, receipt, SVG, raster, Share Card, or WebM.

## Product contract

The feature is opt-in and Architecture-only in its first version:

- `meta.repository.url` is a public GitHub repository URL.
- `meta.repository.revision` is a full 40-character commit SHA.
- a component may carry one to three `sources` with repo-relative POSIX paths, optional line ranges, and an optional reader label;
- `archify render|validate|deliver|preview ... --repo-root <path>` is required when evidence exists;
- the local repository origin must match the authored public repository;
- Git must prove the revision, every blob, and every requested line before rendering;
- a successful delivery receipt reports the verified repository, revision, and reference count;
- verified references appear inside the existing Semantic Passport and participate in the existing Node Finder;
- the evidence payload stays outside the canonical SVG, so visual exports remain repository-path-free.

## Why this slice

It closes a concrete trust gap without disturbing the stable renderer, geometry, export, motion, or interaction contracts. It also gives Archify a better growth sentence than “more diagram styles”: **turn a high-level architecture map into a revision-pinned doorway to the code that proves it.**
