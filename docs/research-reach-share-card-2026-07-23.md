# Reach Share Card — competitor learning and bounded export contract

Date: 2026-07-23

## Evidence

- [GitNexus architecture at current `main`](https://github.com/abhigyanpatwari/GitNexus/blob/main/ARCHITECTURE.md#L265-L285) treats upstream/downstream impact and shortest directed traces as first-class graph questions, and now extends them across repository contract boundaries.
- [SocratiCode README](https://github.com/giancarloerra/SocratiCode#readme) presents blast-radius and call-flow overlays as core code-intelligence outputs, but those claims are backed by its AST/dependency index rather than by presentation geometry.
- [SwarmVault README lines 670–676](https://github.com/swarmclawai/swarmvault/blob/main/README.md#L670-L676) pairs deterministic graph health/traversal outputs with a post-ready 1200×630 card and share bundle. The useful growth lesson is that a graph answer becomes more valuable when it is easy to carry into a post, issue, or review.

Archify should combine the interaction and sharing patterns without copying their causal claims. Its graph is the relationship set authored into one diagram, not a complete code index.

## Product decision

Add **Reach Share Card** as an explicit, contextual export variant:

- It appears only after a non-empty `Upstream` or `Downstream` authored reach query.
- It copies the already resolved origin, direction, stable node IDs, stable edge keys, minimum depths, and maximum hops. It never invokes BFS during export.
- The complete diagram remains as dimmed context; the resolved closure remains fully readable.
- The card header says `Authored upstream/downstream`, origin label, reachable nodes, links, and maximum hops.
- Upstream uses Repository Violet; downstream uses Proof Green; Blueprint has no filter or glow.
- The download is named `<diagram-base>-<direction>-reach-share-card.png`.
- The receipt is `format=share-card`, `variant=reach`, `canonical=false`, `reach-state-clean=true`, width 1200, and height 630.

## Fail-closed rules

Reject the variant when any of these is true:

- no active reach result, an empty closure, or invalid direction;
- active origin, URL/viewer direction, or reach state disagree;
- duplicate or missing node IDs / edge keys;
- a node or relationship no longer maps to exactly one valid authored identity;
- relationship fragments disagree on source, target, or author ID;
- drawable geometry is missing or duplicated;
- stored depth or maximum-hop evidence is invalid;
- canonical cleanup fails before the scoped decoration is applied.

## Explicit boundaries

- Do not call the card impact, blast radius, breakage, confidence, or runtime causality.
- Do not add code parsing, repository traversal, schema fields, a new format, a new panel, a permanent toolbar control, motion, copy-to-clipboard, storage, hosted sharing, or a mobile product surface.
- Ordinary Share Card, SVG, raster, WebM, and print remain canonical and strip both live reach state and share-variant attributes.
- The Reach Card owns only static `data-share-reach-*` decoration on an isolated clone.

## Acceptance

- All five renderers expose the same contextual menu contract.
- Browser smoke proves real 1200×630 PNG pixels, exact identity, live-SVG immutability, stale-state rejection, canonical follow-up exports, and Classic / Flow / Blueprint × dark / light parity.
- The MCO public proof exports Command Router downstream reach and is shown below the unchanged README Hero.
- Full Node regression, WebM/share-card smoke, Proof Lab, ZIP freshness, dependency-free package smoke, composition check, and in-app browser inspection pass.
