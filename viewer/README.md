# Viewer source

Edit `reader-layout.js` for Adaptive Reader Layout and `template.source.html`
for the rest of the Viewer. `archify/assets/template.html` is the committed
generated artifact, consumed unchanged by all five renderers and the installed
Skill. These maintainer sources live outside the packaged `archify/` directory.

From `archify/`, run `npm run generate:viewer` after editing either source.
`npm run check:viewer` verifies freshness without writing; `npm test` includes
that check. Assembly inserts the Reader source verbatim at one fixed marker.
The first extraction preserves delivered HTML bytes, CSS order, classic script
scope and initialization order. Generated output is not a second editing
surface; release identity changes also belong in `template.source.html`.

## Reader contract

- The IIFE initializes once, after the page DOM and shared
  `Archify.waitForStableLayout` exist, before `viewerChromeLayout` and `view`.
  It captures `.container`, `.diagram-container` and its direct child SVG,
  optional header/chapter/card elements, and the initial viewBox ratio.
- The public Interface remains `measure`, `schedule`, `whenStable`, `active`,
  and `receipt`. Viewer Chrome Layout calls `schedule` after changing the
  navigation reserve and `whenStable` while probing layout. The browser
  visual checker also uses `window.Archify.readerLayout.whenStable`.
- Reader owns the outer width (`html`'s `--archify-reader-width`) and temporary
  `data-reader-layout` / `data-reader-overflow` attributes. Ineligible measures
  clear them and reset the recorded width. CSS consumes the width on `.container`.
  Reader never writes canonical SVG geometry, viewBox or semantic IDs.
- Initial wide-diagram classification sets `data-wide-diagram` on the diagram
  container and `data-diagram-shape` on `html`. These survive eligibility changes;
  CSS and camera/radar behavior still depend on the wide-diagram flag on narrow
  screens. This is not live reclassification after replacing the diagram.
- Reader owns its measure/overflow animation-frame handles and the load/resize,
  font-ready, ResizeObserver and MutationObserver subscriptions. They last for
  the page lifetime. `schedule` coalesces requests; deferred overflow settling
  rechecks eligibility. Leaving adaptive layout clears its state without
  unmounting the module or clearing another module's state.
- Width eligibility, overflow fallback and optional-observer behavior are
  unchanged. Shared `waitForStableLayout` waits for fonts, pending work and
  consecutive stable dimensions; its default 240-frame sampling limit starts
  after font readiness. It is not a wall-clock timeout for stalled fonts or
  background pages. Keep this helper shared with Viewer Chrome Layout.

For required browser, output and package evidence, follow
[Contributing](../CONTRIBUTING.md#local-setup-and-verification).
