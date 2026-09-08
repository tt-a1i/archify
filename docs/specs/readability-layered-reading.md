# Readability and layered reading

Agreed scope: improve default reading quality and let readers move from an overview to explicitly authored detail diagrams. The requesting contributor approved implementation and PR creation. Upstream maintainer acceptance remains pending; submit as Draft for scope review.

## Acceptance

- Sequence message names are primary reading content. Use a readable default size, measure matching label plates, preserve authored messages and geometry, and include message text in real browser readability evidence.
- Preserve standard schema-v1 input compatibility. New geometry acceptance restrictions must not be introduced merely for taste.
- An opt-in `atlas` CLI packages existing checked Archify HTML files with explicit overview-node-to-detail associations in one offline HTML. Existing Focus/Views/Story remain the right choice for detail within the same topology.
- Readers can choose among multiple explicitly linked details, return to the exact overview reading state, and keep a common theme. Keyboard navigation is supported. No inferred relationships, automatic diagram splitting, hosted runtime, editing interface, or permanent directory panel.
- Reject invalid manifests, duplicate identities, missing nodes/files and output/input aliases before replacing output. Bind the receipt to manifest, child bytes and final HTML. Child checks do not claim final browser or perceptual acceptance.
- Verify through CLI artifacts/diagnostics and real browser behavior. Include a small synthetic, redistributable sequence example; do not publish private task content.
