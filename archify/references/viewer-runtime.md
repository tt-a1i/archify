# Viewer Runtime reference

Read this only when the user asks for a reader-facing capability. Ordinary generation does not require implementing or re-documenting these features; they are already in the generated HTML.

## Exploration

- Diagram Guide lists current actions and shortcuts. Open it with the guide button or `?`; it never opens automatically.
- Reading Depth starts at READ at the default 100% scale, reveals FULL detail at 175%, and falls back to MAP only below 100%. Focus, route, and semantic interactions reveal their exact facts at any scale.
- Semantic Lens summarizes selected node/relationship kinds without changing authored geometry.
- Intent Trace previews a fine-pointer or keyboard target before committed focus.
- Node Finder searches labels and stable IDs.
- Semantic Passport opens on focus, shows authored upstream/downstream facts, supports a copyable deep link, has an explicit close action, closes on true outside activation and Escape, and never enters canonical export.
- Semantic Radar mirrors the visible viewport and authored graph without becoming a second source of truth.
- Direct Relationship Pin makes a unique compiled relationship operable while preserving the authored line and stable relationship identity. It must fail closed on conflicting source/target/label/ID metadata.
- Route Probe resolves exactly two endpoints over authored directed relationships. It never infers a route from geometry.

## Embedded reading addresses

A host displaying the native reader in an opaque `srcdoc` frame may set
`data-reading-link-template` on that reader's `html` element. Supply an absolute
HTTP, HTTPS or file URL containing exactly one `{state}` marker, for example
`https://example.test/architecture#page=mechanism&reader={state}`. Native Focus,
Relationship, Reach, Route and Lens copy actions replace the marker with their
percent-encoded opaque query state. The host keeps its page identity and restores
that value as the native frame's hash; it never parses or reconstructs queries.

Absent configuration preserves standalone links. Invalid, credential-bearing or
unsupported URL templates make copying fail without accessing the clipboard.
This seam changes copied addresses only, not query parsing, history, permissions,
embedding isolation or authored geometry. It adds no network or storage surface.

## Motion and presentation

For a narrated walkthrough with camera framing, explanations, captions and
synchronized audio, use [Story authoring](story-authoring.md). The `story attach`
command adds Story to the native motion control and Story video to Export.
The player loads on first use and follows the existing preset and theme controls.
Playback schedules two short audio buffers ahead instead of synthesizing the whole timeline.
Very large video exports are rejected before rendering. Use
`Archify.story.exportVideo({start, seconds})` for a shorter range when needed.

Every rendered diagram enables reader-controlled Live/Still motion by default. In Live, every edge runs a small light show on one shared cycle: a comet (glow, halo, tail, head, plus a dimmer echo on every edge) cascades downstream, leaves a soft wake, and lands as a ripple on the target node, while nodes enter once and then glow on the same cycle with authored-step staggering. Phases follow the authored step order (source-node rank, chronological in sequence diagrams); the flow rides a separate Viewer overlay and the original line styles and arrowheads remain intact. Compact edges receive a larger, brighter comet; echoes stay dimmer. With no saved preference, new pages start Still. Choosing Live starts continuous flow and saves that preference; choosing Still stops it and clears the saved Live preference. Existing saved Still preferences remain Still. Semantic exploration temporarily owns the motion budget, and continuous flow resumes when that action releases it. Diagrams without connections retain their bounded node entrance rather than inventing a flow. Omit `meta.animation`; historical `"trace"` and `"none"` values remain accepted for input compatibility and do not change this default. Reduced motion, page hiding, print, and canonical export preserve complete static meaning. Presentation Stage changes viewer chrome and framing, never authored geometry. This is not a mobile product feature; narrow layouts get containment only.

## Canonical exports

The export menu can copy/download full-diagram PNG, download JPEG/WebP, download a dual-theme SVG, and record a trace-enabled WebM. Viewer state—Guide, Lens, finder, focus, route, camera, radar, presentation, motion ownership, and temporary overlays—must be removed from canonical export.

Opening, closing, or completing an export preserves the live Focus/Reach selection for continued exploration. Export-owned download activation is not outside dismissal; genuine outside activation and Escape retain their existing behavior. Full-diagram PNG/SVG exports still contain the complete canonical diagram, while the Reach Share Card communicates the active authored closure.

### Route Share Card

After a real directed Route Probe resolves, the reader may use **Export → Route Share Card**. It reuses the exact ordered route snapshot and the shared Share Card seam: `format=share-card`, `variant=route`. The isolated clone may use only static `data-share-route-*` decoration. It is download-only, fails closed for stale/unreachable/conflicting routes, and never becomes the canonical artifact.

### Reach Share Card

After a non-empty authored reachability query, the reader may use **Export → Reach Share Card**. It consumes the already resolved upstream/downstream node and edge set without rerunning traversal: `format=share-card`, `variant=reach`. The isolated clone may use only static `data-share-reach-*` decoration. It is download-only. Call it authored reachability—not impact, blast radius, breakage, or runtime causality.

## Truth boundary

Viewer exports are communication assets. They do not replace the checked HTML, the deterministic delivery receipt, or a real visual review. Do not add a hosted service, storage surface, dependency, schema branch, or mobile product surface for these viewer-only capabilities.
