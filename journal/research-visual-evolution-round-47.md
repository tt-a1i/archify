# Visual Evolution Research — Round 47

Date: 2026-07-20
Scope: desktop-first visual richness without adding an editor, vendor asset pack,
new schema field, or another interaction owner.

## Question

Archify already has stronger semantic exploration, guided stories, export, and
geometry validation than a conventional static diagram generator. The current
desktop artifacts are nevertheless visually conservative at the node level:
frontend, backend, database, cloud, security, message-bus, and external nodes
all share the same rounded-rectangle silhouette and differ mainly by color.

What can Archify learn from `fireworks-tech-graph` without copying its breadth
or turning the project into a vendor-icon catalogue?

## Primary-source findings

The inspected upstream revision is
[`50c819d68fd4fee330b3010988cd13e98b678d44`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44).

1. The upstream README now presents twelve visual styles and explicitly calls
   out a semantic shape vocabulary, product icons, style-specific motion, and
   geometry checks. Its showcase succeeds partly because each scene has a
   recognizable visual fingerprint instead of one universal card treatment.
   [README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md)
2. Its icon reference says to prefer generic semantic shapes before product
   marks and to build them from inline SVG primitives. Databases use cylinder
   cues, streams use pipe cues, browsers use a window cue, and agents use a
   distinct silhouette. External icon fonts are explicitly rejected because
   they make renderer output unreliable.
   [Icon reference](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/icons.md)
3. The same reference contains a large product/brand catalogue. That breadth is
   visually useful but creates licensing, versioning, brand-color, and name
   matching responsibilities that Archify does not need for its core promise.
4. Cloud Fabric deliberately avoids becoming a vendor-logo poster: it uses
   manifest-backed neutral glyphs, reserves icon space before fitting text, and
   requires provider facts rather than inventing service identity.
   [Cloud Fabric contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/style-10-cloud-fabric.md)
5. Upstream motion is strongest when the moving mark fits the semantic scene:
   a registration bead, token train, event car, replication capsule, or trace
   scanner. It also keeps nodes, labels, containers, markers, and the camera
   fixed while motion runs on exact routes.
   [Motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md)
6. Upstream also documents that not every visual style fits every diagram type.
   Specialized style fingerprints work because they are bounded by domain
   evidence rather than being blindly selectable skins.
   [Style-to-diagram matrix](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/style-diagram-matrix.md)

## Current Archify evidence

All five typed renderers currently emit an opaque mask rectangle followed by a
semantic-color rectangle for their primary node surface. That two-rectangle
contract is important for clean edge occlusion, but it means the node's role is
communicated almost entirely through color and text:

- architecture components: `renderComponent`
- workflow nodes: `renderNode`
- sequence participant headers: `renderParticipant`
- data-flow nodes: `renderNode`
- lifecycle states: `renderState`

The browser proof for Deployment Ownership at 1280×720 is clean and readable,
but API pods, PostgreSQL, Event Bus, Workers, and Observability still share the
same base silhouette. This is the highest-value remaining first-glance visual
gap because it affects every generated diagram without requiring a new user
workflow.

## Decision: Archify Semantic Sigils

Add one small, renderer-owned inline SVG sigil to each node. A sigil is a quiet
semantic stamp, not a logo and not a replacement node shape.

### Component sigils

| Kind | Cue |
|---|---|
| `frontend` | application window |
| `backend` | paired code brackets |
| `database` | stacked cylinder rings |
| `cloud` | compact cloud contour |
| `security` | shield |
| `messagebus` | parallel transit rails |
| `external` | portal with outbound arrow |

### Lifecycle sigils

| Kind | Cue |
|---|---|
| `start` | start dot / launch cue |
| `active` | execution pulse |
| `waiting` | hourglass |
| `success` | check |
| `failure` | cross |
| `neutral` | neutral state square |

## Why this adaptation fits Archify

- It preserves the existing deliberate layout, masks, coordinates, routing,
  labels, schema, JSON IR, and semantic IDs.
- It improves role recognition even when color is muted, themes change, or a
  reader scans the topology before reading labels.
- It stays self-contained and renderer-safe: only inline SVG primitives and the
  existing CSS variables are used.
- It does not add brand assets, a product-name classifier, network requests, a
  dependency, or licensing maintenance.
- It works in classic, signal-flow, and blueprint instead of multiplying
  presets.
- It survives canonical SVG and raster export as authored diagram content.
- It is static. Existing node/edge/story motion remains the only motion owner.

## Deliberately not adopted

- Twelve generic selectable skins: Archify keeps three coherent presets.
- Product logos and brand colors: these are downstream content concerns, not a
  core renderer contract.
- Different node geometry per product: that would change anchors, routing, hit
  geometry, and text budgets.
- Style-specific looping signatures for every scene: Archify already uses
  finite, reader-controlled motion and should not return to decorative loops.
- Mobile-specific sigil work: the product is desktop-first. Mobile remains a
  basic containment fallback, not an acceptance surface for this slice.

## Acceptance gate

1. One shared sigil generator covers every supported semantic kind.
2. All five renderers emit exactly one `data-semantic-sigil` per primary node.
3. Sigils use no inline literal color and inherit existing theme/preset tokens.
4. Sigils add no focus target, title, accessible name, route point, or layout
   box; the existing node remains the only semantic control.
5. Static and trace outputs share identical sigil geometry.
6. Canonical SVG styling includes the new sigil selectors.
7. Existing golden files, Gallery sources, README motion proof, and ZIP are
   regenerated.
8. Full tests and desktop browser checks pass in dark/light and at least two
   visual presets.
