# Delivery contract

## Validate and deliver

Use `validate` after every candidate edit. Use final atomic delivery only after the candidate is frozen:

```bash
node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json
```

Deliver reads the specification once, writes those exact bytes to a private same-directory candidate snapshot, renders that snapshot, runs the complete artifact checker, and only replaces the target after all artifact checks pass. The JSON receipt includes SHA-256 and byte counts for both `specification` and `artifact`. Renderer, checker, receipt, or commit failure exits non-zero, removes private state, preserves the previous trusted artifact, and never invokes an opener.

The deterministic receipt proves byte identity and automated checks. Never claim that the deterministic receipt includes visual review.

## Automated visual evidence

After delivery, inspect the exact trusted HTML without rerendering or modifying
it:

```bash
node bin/archify.mjs visual-check <output.html> --json
```

The zero-dependency command uses Chrome/Chromium through the DevTools pipe. It
measures light-theme containment at 1440×900, 1600×1000, 1920×1080, and
2048×1320, then captures light/dark screenshots at 1440×900 and 2048×1320. It
writes four PNG sidecars, one relative-path HTML contact sheet, and one JSON
receipt beside the artifact. The receipt binds the source artifact SHA-256 and
byte count, records READ plus Still runtime state, and always reports
`visualReview: "pending"`; automated evidence cannot claim perceptual review.

Exit 0 means every containment measurement and capture passed. Exit 1 means an
overflow or capture failure. Exit 2 means Chrome/Chromium was unavailable and
the receipt status is `skipped`. Failed or skipped capture runs remove stale
image/contact-sheet sidecars rather than presenting prior evidence as current.

## Optional opening

Add `--open` only when the user wants an immediate local preview. It runs after that atomic commit, uses one argument-array OS opener with a five-second bound, and records `open.status`. Keep it off for CI, unattended agents, and non-interactive environments. Failure or unsupported opening does not invalidate delivery; its status proves only whether the local opener invocation succeeded.

## Last-Good Live Preview

For an active desktop authoring loop only:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Preview watches one explicit input on loopback, binds each stable digest to a private snapshot, and advances only after the existing verified delivery pipeline passes. Invalid, half-written, deleted, or superseded input leaves the previous verified revision on screen and on disk. Identical bytes do not rebuild or reload.

The preview runtime ships inside the zero-dependency Skill ZIP and must work without `node_modules`.

Never start it by default. Do not use it for CI, unattended agents, remote sharing, or mobile use. `--no-open` is only for a user who will open the printed local URL or for loop testing. Stop it with Ctrl-C before handoff. Server state, port, source path, diagnostics, error text, and reload tokens must never enter the generated artifact or any export.

## Perceptual delivery gate

Automated validation cannot prove visual polish. After deterministic delivery, inspect the actual HTML in a capable browser or render a screenshot with an image reader. Check both themes when changed, the default READ view, line crossings/corridors, label masks, node/card fit, focus/search/passport closure, and export cleanliness.

For the default standalone desktop viewer, measure 1440×900, 1600×1000, and 1920×1080. When the artifact is intended for a large desktop display, also measure 2048×1320. A first-screen pass requires `document.documentElement.scrollWidth <= window.innerWidth` and `scrollHeight <= window.innerHeight` at every checked size. At the largest checked viewport, inspect the rendered composition for a conspicuous empty lower band: the main panel and necessary conclusion cards should use the available height as a balanced whole, not collapse into a shallow strip. If a desktop viewport overflows, repair the authored composition by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. Do not hide overflow, clip content, introduce an internal diagram scroller, or reduce node/label typography to make the measurement pass. Narrow/mobile containment may retain vertical page scrolling.

Report exactly one truthful status:

- `visual_review: passed` — only after inspecting the rendered artifact.
- `visual_review: skipped (image reader unavailable)` — when no capable visual surface exists.
- `visual_review: failed` — with the concrete visible defect.

Use `correction_rounds: 0`, `correction_rounds: 1`, or `correction_rounds: 2`; never exceed a maximum of two focused correction rounds. Never report `visual_review: passed` without inspecting the artifact.

If visual review changes the candidate, validation and delivery must run again because the prior frozen specification receipt is no longer current.

## Handoff receipt

Return:

```text
diagram_type: architecture|workflow|sequence|dataflow|lifecycle
output: /absolute/path/to/file.html
specification_sha256: <receipt value>
artifact_sha256: <receipt value>
validation: 9/9 showcase, 0 errors, 0 warnings
visual_review: passed|skipped (image reader unavailable)|failed
correction_rounds: 0|1|2
```

Opening, preview status, Share Cards, and other viewer exports are not validation claims.
