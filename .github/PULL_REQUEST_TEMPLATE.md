## Problem and value

What user problem does this solve? Link the issue or showcase evidence when one exists.

## Scope

- What changed:
- What deliberately did not change:
- No unrelated changes: <!-- confirm or explain -->

## Stability impact

- Compatibility and migration risk:
- Renderer, validator, package, or generated-artifact risk:
- Failure behavior and rollback path:

## Tests run

List exact commands and results. Do not write only “tests pass.”

## Visual evidence

Provide enough evidence to evaluate whether the intended user value was achieved. Use screenshots, recordings, or reproducible steps as appropriate to the affected behavior. For non-visual changes, write “Not applicable” and briefly explain why.

- Evidence provided:
- Comparison conditions, when applicable (input, viewport, theme, preset, diagram mode, zoom, and page state):
- Automated or browser checks:
- Perceptual visual review: passed / failed / skipped / Not applicable

When presenting a before/after comparison, keep its conditions genuinely comparable. Report automated or browser evidence separately from perceptual review; an automated check does not establish a perceptual pass.

## Generated artifacts

List regenerated files such as Gallery pages, guides, README proofs, or `archify.zip`. If none changed, explain why they remain fresh.

## Checklist

- [ ] I used a minimal focused change and preserved existing typed JSON behavior unless the issue requires a contract change.
- [ ] I ran the relevant targeted tests and `npm test` in `archify/`.
- [ ] I added or updated a regression test for behavioral changes.
- [ ] I checked generated artifacts and package freshness when their sources changed.
- [ ] I removed secrets, private repository content, and customer data from fixtures and screenshots.
