# Visual Evolution Research — Round 48

Date: 2026-07-20
Scope: desktop-first, finite semantic motion on one exact authored relationship.

## Question

Round 47 made node roles recognizable before the reader reaches their labels.
The remaining motion gap is similar: Archify's exact-edge Directional Flow Pulse
is truthful and stable, but every relationship currently moves as the same
dashed light streak. Can the moving mark explain *what kind of traffic it is*
without adding controls, looping decoration, or schema?

## Evidence

### Upstream lesson

At upstream revision
[`50c819d68fd4fee330b3010988cd13e98b678d44`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44),
`fireworks-tech-graph` assigns scene-fitting moving marks to exact routes: packet
heads, registration beads, memory cards, token trains, policy seals, event cars,
replication capsules, and trace scanners. The important principle is not the
number of signatures. It is that the moving object supports the semantic story
while source routes, nodes, labels, containers, markers, and camera stay fixed.

Primary source:
[Focused SVG-to-GIF Motion](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md)

### Current Archify contract

`archify/assets/template.html` already owns one strong exact-edge surface:

- relationship hover/focus resolves a stable `data-edge-key`;
- only matching authored `path`, `line`, or `polyline` geometry is cloned;
- markers, IDs, semantic attributes, interaction roles, and export state are
  stripped from the runtime clone;
- one 1.2-second CSS pulse preserves source-to-target direction;
- Motion Still, reduced motion, hidden pages, embed, print, replacement, and
  canonical export all remove or suppress the overlay;
- the overlay is inserted below semantic nodes, so labels and components remain
  readable.

That owner should be enriched rather than duplicated.

## Decision: Semantic Flow Tokens

Add one small moving token beside the existing finite relationship streak. Its
kind is inferred from evidence already compiled into the artifact—edge class and
source/target node kind—so no author field or guess from arbitrary label prose is
required.

| Token | Evidence | Visual cue |
|---|---|---|
| `security` | security edge, security/failure endpoint | compact shield/seal |
| `event` | dashed/async edge or message-bus endpoint | three-car event train |
| `data` | database source or target | framed data block with record lines |
| `state` | waiting/success lifecycle endpoint | state ring with center mark |
| `call` | remaining exact relationship | paired forward chevrons |

Precedence is deliberate: security overrides event, event overrides data, data
overrides state, and call is the neutral fallback. A dashed write into a message
bus is therefore an event; a security transition into failure remains security.

## Motion contract

1. The existing authored edge remains immutable and visible beneath the overlay.
2. The existing 1.2-second Directional Flow Pulse remains the timing owner.
3. One token follows the first exact drawable primitive using SVG
   `animateMotion`; it inherits the same wrapper transform as the cloned edge.
4. Token visibility uses one finite CSS animation with no repeat.
5. The token rotates with route direction, including reverse, vertical, and bent
   paths.
6. Replacement, animation end/cancel, Still, reduced motion, hidden pages,
   embedding, printing, and export reuse the existing overlay cleanup.
7. Signal Flow may glow, Blueprint stays crisp and unfiltered, and Classic stays
   restrained.

## Product boundary

- no token chooser;
- no new toolbar control;
- no schema/IR field;
- no inference from product or relationship names;
- no permanent ambient token stream;
- no motion on more than one deliberately inspected relationship;
- no mobile-specific work;
- no canonical SVG or raster/WebM residue;
- no dependency and no network request.

## Acceptance gate

1. All five typed renderers inherit the same classification and token builder.
2. Every classification branch has a deterministic fixture assertion.
3. Runtime output carries exact token kind and edge key evidence.
4. Static canonical SVG contains no token or overlay.
5. Token path data is derived only from exact authored `path`, `line`, or
   `polyline` geometry.
6. The token and pulse end together and the overlay is removed.
7. Still/reduced motion/embed/print/export boundaries remain green.
8. Browser proof covers at least call, data, event, and security tokens on real
   desktop Gallery artifacts in dark/light and more than one visual preset.
