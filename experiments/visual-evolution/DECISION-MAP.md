# Archify visual evolution decision map

Goal: make Archify visibly richer, stable, and more shareable while preserving
typed IR, deterministic validation, zero-install use, and self-contained output.

## #1: Which visual direction should become the first production preset?

Blocked by: none
Type: Prototype

### Question

Which of three real-diagram treatments creates the clearest improvement without
turning Archify into a skin collection?

### Answer

Resolved: **Signal Flow** is the first production preset. On the same workflow
artifact it kept the strongest hierarchy and most reusable technical palette,
while Blueprint Review compressed the diagram too aggressively and Ember Ops
felt too incident-specific. Production use is explicit through
`meta.visual_preset: "signal-flow"`; omitted values remain `classic`.

## #2: What is the smallest reliable shareable motion format?

Blocked by: none
Type: Prototype

### Question

Can the existing self-contained trace animation be recorded in-browser as WebM
without external dependencies, while failing closed on unsupported browsers?

### Answer

Resolved: use a six-second WebM recorded by `canvas.captureStream()` and
`MediaRecorder` from the self-contained animated SVG. The browser test produced
a non-empty 1,168,954-byte artifact. No Puppeteer, ffmpeg, new package, or
network service is required. Unsupported browsers and static diagrams disable
the menu item instead of attempting a broken export.

## #3: Which scene recipe should follow the visual preset?

Blocked by: #1
Type: Research

### Question

Which single recipe—agent run, event stream, cloud deployment, or reliability
trace—adds the most expressive power to existing renderer modes?

### Answer

Deferred deliberately. The agent tool-call workflow is now the proof scene for
the first preset. A new recipe should wait for user feedback rather than mixing
scene expansion into the visual/export slice.

## #4: What proves the experiment is production-worthy?

Blocked by: #1, #2
Type: Grilling

### Question

Which golden artifacts, browser interactions, accessibility checks, motion
fallbacks, and package checks must pass before merging?

### Answer

Resolved for this slice: all five golden renderers are regenerated from the
shared template; dedicated tests cover classic defaults, Signal Flow
propagation, schema rejection, and the WebM proof surface; reduced-motion keeps
animations disabled; dark and light browser screenshots were inspected; a real
WebM download was produced; static output disabled WebM; and the packaged CLI
must pass its zero-install smoke checks before handoff.
