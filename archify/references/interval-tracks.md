# Interval tracks

Use `interval` to compare several segmentations of one numeric range. Every track shares the same X coordinate system; track spacing is independent of that range. This type supports `standard` validation. Graph routing, trace animation, and showcase acceptance are outside this slice.

## Generate a diagram

From the `archify/` package directory, validate and deliver the generic storage example:

```sh
node bin/archify.mjs finalize interval examples/storage.interval.json /tmp/storage-interval.html --quality standard --json
```

The output uses the shared Archify viewer with shared theme colors and bundled typography. Browser measurements and perceptual review remain separate from deterministic delivery checks.

## Coordinate contract

| Field | Meaning |
| --- | --- |
| `schema_version`, `diagram_type` | `1`, `"interval"` |
| `meta.title`, `meta.output` | Required viewer title and portable relative HTML output path |
| `horizontalScale` | Shared X-axis width multiplier (default `1`); fonts, Y spacing, and annotation offsets stay fixed |
| `showAxis` | Show numeric ticks by default; use `false` for illustrative execution-order diagrams |
| `unitWidth` | Explicit global range; wins over automatic range |
| `tracks` | Nonempty array in vertical order, with unique `id` values |
| `lifetime` | Track endpoints; defaults to `[0, "100%"]` |
| `height`, `gapBefore` | Track height and preceding gap in SVG units |
| `spans`, `objects` | Coverage rectangles; objects default to 80% track height |
| `arrows` | Directed endpoints, including cross-track endpoints and explicit `turnY`; `labelPlacement: "start"` attaches a label near the tail |
| `anchors` | Named global positions with optional inclusive guides |
| `events`, `points` | Position annotations on a track |
| `callouts` | Placed markers with captions or text bubbles |
| `labelOffset` | Explicit text displacement, used after automatic placement cannot express the intended ownership |
| `palette`, `style` | Explicit colors, presets, patterns, and layering |

A position is a number, an absolute string such as `"10u"`, a global percentage such as `"50%"`, or an anchor name. Without `unitWidth`, the range is zero to the maximum of 100 and all absolute positions. Percentages do not grow the range. Endpoints may be reversed; arrow direction follows the authored endpoint order. Unresolvable or circular anchors are errors.

Explicit bounds stay authoritative. Overflow remains visible and produces warnings. A label is presentation; it does not redefine an endpoint, lifetime, or shared-axis position.

## Author labels without changing facts

Start with the true `from`, `to`, and `at` values and omit `labelOffset`. Render the candidate and inspect whether each label clearly belongs to its span, object, arrow, point, or event. For span and object labels, the renderer first fits text inside its interval, then tries bounded horizontal placement within the owning track, then a nearby outside position. A label placed outside its mark needs a visible leader to its owner. If no clear placement is available, treat the diagnostic as unresolved; a background mask clearing a line is not evidence that the label is correctly placed.

Keep labels for equivalent point annotations on the same baseline when space permits. Different authored Y offsets within one track produce an ownership warning even when no text intersects. Recheck copied offsets against the current renderer: omit obsolete offsets and try the default placement before adding new ones. If an annotation is an independent callout rather than a peer point caption, use a start-attached labelled arrow. Inspect their alignment and association with the marked positions, including labels that do not intersect any other text. For a start-attached arrow label, set `labelPlacement: "start"`; `startXOffset` and `startYOffset` explicitly move its tail and label together in SVG units while the target remains fixed. The default arrow label position is the midpoint. Start-attached arrow labels are not automatically nudged; if one collides, adjust the explicit tail offsets or route and inspect the result. Use `turnY` and track spacing when the path itself needs room.

Use `labelOffset` only after inspecting the rendered default and identifying the specific label that needs manual text displacement. This override moves text without changing its factual coordinate; verify a clear visual link to its owner. Expanding a span only to fit its caption is acceptable solely when the diagram is explicitly illustrative and its extent is unconstrained. Keep measured, source-backed, or otherwise factual bounds intact and repair label placement instead.

Approximate geometry checks cannot establish ownership or readability. After delivery, inspect the artifact in a browser: every label should have an unambiguous owner, outside labels should retain a visible leader, peer annotations should read as peers, and masks should not conceal a conflicting mark.

The [JSON Schema](../schemas/interval.schema.json) defines the complete accepted field set. The [storage example](../examples/storage.interval.json) uses generic illustrative coordinates and contains no project-specific facts.

## Edit and retain JSON

Open the generated artifact with `?edit=1` appended to its URL, then enable plot editing to move supported labels, intervals, guides, and callouts. Download JSON to retain changes, then use that file as CLI input. Horizontal geometry edits pin an automatic range; label and vertical-only edits preserve it. Arrow paths, turn heights, and track bands are edited in JSON. Viewer interactions and unsaved edits do not change the original input file.

## Style and editor validation

Default paints use the Viewer theme tokens; light/dark and visual presets apply without moving data. Explicit palette and style colors remain authoritative. The editor uses the same generated JSON Schema as the CLI before applying or downloading JSON. Editing UI is localized through `meta.locale`; changing locale in JSON takes effect after regenerating the artifact.

## Horizontal density

Use `horizontalScale: 1.5` to spread the shared timeline from 720 to 1080 SVG units without changing its numeric range or vertical density. This scales factual X positions, not glyphs or authored annotation offsets. CLI and in-browser edits use the same mapping.

Narrow span/object labels may need the renderer's bounded external placement. Zero-width and coincident annotations cannot be separated by scaling. These are approximate checks, not an acceptance guarantee; inspect the rendered ownership and readability.

The viewer fits the SVG into its available width, so a wider diagram can make on-screen fonts smaller. `visual-check` measures interval text against the existing projected-font floor. Do not treat a geometry warning disappearing as readability proof; check the rendered artifact. Use a focused view when a readable whole-timeline view cannot fit.

## Shared presentation

Tracks uses the same HTML viewer, theme tokens, page spacing, controls, exports,
and grid pattern as the graph types. `renderers/shared/svg-grid.mjs` supplies the
grid to both graph definitions and the browser-capable interval layout. The viewer
build embeds that helper with the layout so CLI and browser edits remain aligned.
Interval coordinates, label placement, and editing remain type-specific.
Normal pages do not mount the authoring panel; `?edit=1` opts into editing.

## Reader fit and review

Visible lane labels reserve a shared gutter before X coordinates are mapped. Nearby guide captions may shift horizontally with leaders to their original anchors. Inspect both themes after rendering; automatic geometry checks do not establish visual ownership or contrast. Tall charts may scroll vertically to preserve readable text. The reader targets readable projected text, constrained by available viewport width; it does not guarantee a minimum font size in every viewport.

## Choosing Tracks

Tracks is a canvas on a shared numeric axis. Use it for storage/memory segmentation, several spans or overlays within one lane, and annotations spanning tracks. Use upstream Timeline for dated event cards and Waterfall for elapsed execution spans with parent/child nesting. Tracks shares the upstream Unicode text-width estimate and intrinsic-height reader fit. Its bounded placement stays local because moving or expanding tracks would change authored geometry.
