# Travel map visual contract

The approved overall style is `illustrated-diorama-v1` in `visual-style.js`.
Keep pastel materials, model silhouettes, lighting and typography consistent
across destinations and generated itineraries. The user-facing presentation is
now flowchart first, then 3D with height; do not restore 2D/flat-3D controls.
Generation supplies known places and visit order, not new rendering code or
arbitrary visual parameters. The build pins renderer/CSS/arrow/preset content
hashes; downloaded data is integrity-checked. Any intentional style change needs
an explicit user request, a style version update and Paris/Shanghai visual checks.
Cache misses and quota failures must never switch to a different visual renderer.

The user approved and explicitly locked the `air-arc-v1` direction style.
Apply it to future generated 3D travel maps and itinerary changes in this module.

- Import `air-route-style.js`; do not duplicate or override style values in
  prompts, generated itinerary data, scene renderers or export renderers.
- Each consecutive stop pair has ONE elevated quadratic arc, starting above
  the source landmark and ending above the destination, with ONE simple open
  arrowhead at the destination. No cones, solid arrow models, repeated arrows,
  tubular road-following routes or decorative effects in the 3D itinerary layer.
- Keep stroke and arrowhead sizes constant in screen pixels while rotating or
  zooming. Export uses the same style scaled only by output pixel ratio.
- Generated content may change endpoints, stop order and day colors. Reuse the
  existing bounded height calculation; do not let generation invent a style.
- The arc communicates visit order, not an actual road or flight route. Keep
  road distance calculations and the 2D road view separate and clearly labeled.
- Preserve this style unless the user explicitly requests a visual change.
  For new rendering targets, implement this same contract instead of inventing
  an alternative arrow. Check both the live view and exported image.
