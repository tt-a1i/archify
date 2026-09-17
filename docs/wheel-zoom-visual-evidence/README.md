# Pointer-anchored wheel zoom visual evidence

Captures produced from revision `b9410d4` with Node 22.23.2 and headless
Chromium 131, using the commands below. Automated browser evidence, perceptual
visual review and device acceptance are reported separately. Nothing below
claims a check that was not performed.

## Automated browser evidence

- Commands: `cd archify && ARCHIFY_CHROME=<chrome> node --test
  test/wheel-zoom.test.mjs`, `npm test`, and `ARCHIFY_CHROME=<chrome>
  npm run test:browser` at code revision `4e25478`; the captures below come from
  `node bin/archify.mjs render workflow examples/agent-tool-call.workflow.json
  <out> --quality showcase` driven by the same headless Chromium.
- Results at `4e25478`: wheel-zoom suite 3/3 pass; `npm test` 1653 tests with
  0 fail (1588 pass, 65 skipped browser suites); the shared browser gate
  226/226 pass, 0 skipped.
- Input: trusted Chrome `Input.dispatchMouseEvent` mouse-wheel events
  (`isTrusted`), never synthetic `dispatchEvent` calls.
- Matrix: eight combinations of preset (signal-flow, classic) x theme (dark,
  light) x viewport (1440x900, 1440x700). Every combination moves 1x to 1.5x
  toward the pointer, the percent control reads 150%, and the gesture is
  consumed (`defaultPrevented` true). With `?embed=1` the same wheel leaves the
  camera at 1x with `defaultPrevented` false.
- Pointer-anchor pixel check: the pre-zoom crop around the pointer is re-rendered
  at 1.5x by the browser (`Page.captureScreenshot` with `clip.scale`) and compared
  with the post-zoom capture of the same screen region. Mean channel delta is
  1.0-2.5 of 255, with at most 2.5% of pixels above 24. The same comparison
  against a deliberately center-anchored reference gives 21.6-22.9 mean and
  15.6-20.6% above 24, so the check separates the anchored result from a wrong
  anchor rather than passing everything.
- Conditions: 1440x900 or 1440x700 desktop viewport, `showcase` quality, dark or
  light theme, `data-motion="still"`, page at scrollY 0, pointer at 34% width and
  31% height of the diagram stage, one `-120` wheel event.

## Perceptual visual review

Status: **passed** by the author at revision `b9410d4` (2026-09-17). The author
inspected the two captures below and reported no visible defect, with the diagram
correctly magnified about the pointer. Recorded alongside that review: the
magnified diagram is clipped at the stage boundary, the cards below the diagram
and the navigation overlays stay in place, and the percent control reads 150%.

## Device acceptance

Status: **partially exercised** by the author on 2026-09-17, on artifacts rendered
from revision `78cb8a8`, whose Viewer sources are identical to the code revision
`4e25478`; the captures and the automated results above keep their own revisions.
The author's reported observations:

- Windows laptop, Chrome 151.0.7922.138, trackpad: two-finger swipe zoomed in and
  out as expected; after zooming back out to 100%, continuing the same gesture
  moved the page again, i.e. reaching a bound hands the gesture back to native
  scrolling; `Ctrl`+wheel kept browser zoom; after zooming in, `Shift`+wheel
  scrolled horizontally; the classic wide diagram still scrolled horizontally.
- Windows laptop, same Chrome, recorded wheel notches: each notch reports
  `deltaY 100` with `deltaMode 0` and no modifiers, and consecutive notches added
  1, 2, 2, 1, 2 steps of 0.25 instead of a fixed step; notches taken at the 1x
  bound added 0 steps.
- Windows laptop, same Chrome, pre-fix comparison build (revision `e03c341`): with
  the pointer over the diagram at 1x, a downward wheel left the page at scrollY 0
  — the blocking defect reproduced on real hardware, in contrast to the fixed
  build above where the same gesture moves the page.
- Android phone, Chrome 151.0.7922.173: two-finger pinch zoomed the page, which is
  the browser-controlled touch behavior, so the touch path is unaffected by the
  wheel listener.

Not exercised in this session: trackpad momentum at a bound, Firefox/Safari and
other engines, macOS, display scaling, touch-specific viewer behavior on narrow
screens, and installed-package hosts.

## Captures

![Before wheel zoom](before-wheel.png)

![After one wheel event at the pointer](after-wheel-zoomed.png)

- Before: `1x`, full signal-flow workflow diagram
  (`agent-tool-call.workflow.json`).
- After: one `-120` mouse-wheel event at the pointer, `1.5x`.
- The content under the pointer is preserved in the viewport; the surrounding
  diagram expands around that anchor instead of zooming from the SVG center.

## Not tested

- Trackpad momentum at a bound was not observed, and only the two hosts above were
  used; the per-notch step counts above are what this one wheel reported, not a
  claim about other devices.
- Firefox, Safari and other engines, macOS, display scaling, touch-specific
  viewer behavior on narrow screens, and installed-package hosts were not
  exercised. Device and trial-use acceptance remain separate claims from these
  browser checks; see [Contributing](../../CONTRIBUTING.md#choose-evidence-by-impact).

The generated HTML is not checked in because the public renderer tests already
cover it and the full viewer runtime would be duplicated here.
