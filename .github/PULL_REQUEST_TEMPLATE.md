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

For CI-oriented validation and receipt handling, see the [CI and pull request integration guide](https://github.com/tt-a1i/archify/blob/main/docs/ci-integration.md).

## Visual evidence

For visible changes, attach before/after final-artifact screenshots and state whether visual review passed, failed, or was skipped. Write “Not applicable” for non-visual changes.

## Generated artifacts

List regenerated files such as Gallery pages, guides, README proofs, or `archify.zip`. If none changed, explain why they remain fresh.

## Checklist

- [ ] I used a minimal focused change and preserved existing typed JSON behavior unless the issue requires a contract change.
- [ ] I ran the relevant targeted tests and `npm test` in `archify/`.
- [ ] I added or updated a regression test for behavioral changes.
- [ ] I checked generated artifacts and package freshness when their sources changed.
- [ ] I removed secrets, private repository content, and customer data from fixtures and screenshots.
