# Layered reading

Use Focus, Views and Story when the same diagram topology can explain the detail.
Use an atlas only when a module needs a separate authored diagram. An atlas is a
portable reading artifact, not a diagram editor or a repository browser.

Deliver each child HTML first, then author a manifest:

```json
{
  "schema_version": 1,
  "title": "Request processing",
  "locale": "en",
  "overview": "overview",
  "diagrams": [
    { "id": "overview", "title": "Request overview", "file": "overview.html" },
    { "id": "worker", "title": "Worker execution", "file": "worker.html" }
  ],
  "links": [{ "node": "worker", "details": ["worker"] }]
}
```

```sh
node bin/archify.mjs atlas atlas.json atlas.html --json
```

A [runnable sample](request-reading.atlas.json) links the packaged web application to its cache-miss sequence.

Paths resolve relative to the manifest. IDs start with a letter and contain only
letters, digits, `_` or `-`. Supply 2–20 diagrams. Every detail must be explicitly
reachable from a unique overview node. Multiple detail IDs open a choice dialog;
one opens directly. Unlinked nodes retain their ordinary Focus behavior. Linked
nodes use click or Enter/Space to open details. Return restores the overview's
existing camera and keyboard focus. The compact theme control and child theme
controls stay synchronized. Locale is `en` (default) or `zh-CN` for atlas chrome;
child content is not translated. The atlas preserves the child HTML bytes and
never adjusts their typography or geometry. A viewer-chrome adapter paints existing CSS mask icons as inline SVG in local `srcdoc` frames; diagram SVG is unchanged.

The command checks private snapshots of all child artifacts before atomically
replacing the atlas. Invalid manifests, links or children preserve the previous
output. The JSON receipt binds the manifest, all embedded children and output by
SHA-256 and byte count. Keep that receipt with the output. This is artifact
validation, not a browser or perceptual verdict: both remain `pending`.

Open the final atlas offline and check keyboard entry, multi-detail choice,
return position, both themes, child export behavior and desktop containment.
`visual-check` is a single-diagram tool; do not present its child receipts as
atlas acceptance. Record atlas browser evidence against its final hash, then
inspect screenshots independently. Atlas exports remain the active child's
canonical exports; the navigation shell is not part of them.

Only package trusted, locally authored Archify HTML. Child scripts execute in the
same local reading context; the atlas is not an isolation boundary for untrusted
HTML. It introduces no hosted dependency or automatic relationship discovery.
