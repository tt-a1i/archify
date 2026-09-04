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

For visible changes, attach comparable final-artifact screenshots generated from the same input. For non-visual changes, write “Not applicable” and briefly explain why.

### Before

<!-- Attach the result before this change. -->

### After

<!-- Attach the result after this change. -->

- Reproduction input or fixture:
- Viewport, theme, preset, or diagram mode:
- Visual review: passed / failed / skipped / Not applicable

Visible changes must reach `passed` before final review or merge. Draft pull requests may report `failed` or `skipped` while evidence or fixes are still in progress.

## Generated artifacts

List regenerated files such as Gallery pages, guides, README proofs, or `archify.zip`. If none changed, explain why they remain fresh.

## Checklist

- [ ] I used a minimal focused change and preserved existing typed JSON behavior unless the issue requires a contract change.
- [ ] I ran the relevant targeted tests and `npm test` in `archify/`.
- [ ] I added or updated a regression test for behavioral changes.
- [ ] I checked generated artifacts and package freshness when their sources changed.
- [ ] I removed secrets, private repository content, and customer data from fixtures and screenshots.
