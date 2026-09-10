# Authored Reachability — competitor learning and product boundary

Date: 2026-07-23

## What the adjacent tools teach

- [GitNexus at `cdbdf21`](https://github.com/abhigyanpatwari/GitNexus/blob/cdbdf219dce797e51cdeb8cfa386e77ab2d35628/README.md#L145-L146) makes graph exploration useful by turning a selected symbol into upstream impact groups and a shortest directed path. The interaction is contextual rather than another permanent dashboard.
- [SocratiCode at `d95a52f`](https://github.com/giancarloerra/SocratiCode/blob/d95a52fba46ae2c3e302edd6d5e9a927daa71bf5/README.md#L918-L943) exposes a blast-radius overlay using breadth-first search through reverse-call edges, while explicitly documenting the limitations of static analysis.

The valuable pattern is not the phrase "blast radius." It is the fast answer to a reader's next question after selecting a node: what authored relationships lead here, and where can they lead next?

## Archify's bounded response

Archify adds **Authored Reachability** to the existing Semantic Passport:

- `Upstream` follows authored relationships toward the focused node.
- `Downstream` follows authored relationships away from the focused node.
- A deterministic, unweighted breadth-first traversal reports matched nodes, matched links, and maximum hops.
- Relationship fragments are deduplicated by their stable authored edge key; cycles terminate; DOM authored order breaks ties.
- Repeating the active action clears reachability but preserves node focus.
- `#focus=<id>&reach=upstream|downstream` makes the exact reading state shareable, and Copy link preserves it.
- Classic, Signal Flow, and Blueprint share the same semantic state; Blueprint deliberately has no glow.
- SVG, raster, Share Card, WebM backgrounds, and print remain canonical and free of viewer-only reachability state.

## Truth boundary

This capability describes only the directed relationships already authored into the artifact. It does **not** claim:

- runtime causality;
- breakage or change impact;
- call-graph completeness;
- confidence scoring;
- repository-wide dependency analysis.

Those claims require a separate evidence model and are deliberately outside this slice.

## Rejected scope

- no parser or crawler;
- no schema or JSON IR change;
- no new panel or permanent toolbar action;
- no weighted path algorithm;
- no dependency, hosted service, storage, or mobile product surface;
- no geometry mutation and no reachability state in canonical exports.

## Acceptance

The slice is acceptable only when traversal is stable through branches, cycles, and duplicate SVG fragments; URL history and Copy link round-trip the direction; all five renderers inherit it; Classic, Signal Flow, Blueprint, dark, and light remain legible; exports are clean; and the complete regression, package, and real-browser gates pass.
