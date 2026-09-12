# Drilldown bundles reference

Read this reference only when the user asks for a diagram whose components expand into their own
diagrams, or asks about `archify bundle`. A single diagram never needs it.

A drilldown bundle is one directory holding one entry diagram, up to twelve same-directory
children, and a `manifest.json` that binds them by diagram id and content digest. Reading is
descend-in-place: the parent shrinks to a breadcrumb and a silhouette, the child opens on the same
canvas, and returning restores the parent's exact geometry and scroll position.

## When to use it

Use a bundle when one component of a map has enough internal structure to deserve its own diagram
and the twelve-node cap makes inlining it dishonest. Keep a single diagram when the detail fits.
Depth is fixed at two levels; a child cannot itself be a parent.

## Commands

```
archify bundle <dir> [--json]
archify bundle <dir> --check [--json]
```

Without `--check`, the command re-renders each diagram with its bundle attributes, writes
`manifest.json` atomically, refreshes the entry's embedded manifest copy, and then validates.
With `--check` it validates only and writes nothing. Human output is one line
(`bundle ok <dir> (10/10 checks)`); `--json` prints a receipt with `schemaVersion`, `ok`,
`command`, `action`, `dir`, `checksPassed`, `checkCount`, and `diagnostics`. `checksPassed` and
`checkCount` are derived from the checks that ran (`archify/bundle/diagram-bundle.mjs:360-365`,
`:584`). The `--bundle-*` flags are parsed once at each renderer CLI entry and passed into
`svgRootAttrs`; the library function does not read `process.argv`. Re-render also sets
`ARCHIFY_REPO_ROOT` from the Git top-level of the current working directory so architecture
maps that declare source evidence can verify (`archify/bundle/diagram-bundle.mjs:211-217`,
`:249`).

## Directory layout

One directory is one bundle. Every diagram is a same-directory `<id>.html` paired with the
`<id>.json` it was rendered from. Subdirectories, `../`, absolute paths, and URL schemes are not
representable — filenames must match `^[A-Za-z0-9][A-Za-z0-9._-]*\.html$`, in the schema and again
in the viewer before an iframe is pointed at one.

```
docs/cases/archify-self/
  archify-self.html                  entry   (architecture, level 0)
  archify-self.json
  archify-self.ownership.json        optional sidecar
  archify-renderers.html             child   (architecture, level 1)
  archify-renderers.json
  archify-renderers.ownership.json
  render-pipeline.html               child   (workflow, level 1)
  render-pipeline.json
  render-pipeline.ownership.json
  manifest.json
```

A child may be any of the five diagram types. The self-map uses a workflow child under an
architecture entry.

## Adding a drilldown child

1. Author the child diagram JSON as an ordinary diagram, with its own coordinates and at most
   twelve primary nodes. Give it a filename stem that is a valid diagram id
   (`^[a-zA-Z][a-zA-Z0-9_-]*$`); that stem *is* the id.
2. Deliver both parent and child into the same directory, so each `<id>.html` sits beside its
   `<id>.json`.
3. On the parent architecture component, add `"drilldown": "<child stem>"`. The target is a
   diagram id, never a path. One component may declare at most one child.
4. Optionally add an ownership sidecar pair: `parent: { map, component }` on the child,
   `child_map` on the parent component. If any `*.ownership.json` files are present, the
   entry sidecar must be named `<entryId>.ownership.json`; otherwise the bundle fails with
   `bundle/ownership-missing` (`archify/bundle/diagram-bundle.mjs:219-228`). Every child
   glob — `components[].globs` **and** `excluded` — must be a syntactic subset of the parent
   component's globs (`validateChildOwnershipSubset`, `archify/locate/ownership.mjs:222-248`).
   Parent `excluded` is inherited at projection time and does not have to be repeated — see
   `locate.md`. A child `parent` pointer that names a missing map or sidecar is
   `locate/ownership-parent-missing`.
5. Run `archify bundle <dir>`.

The entry is inferred: it is the unique diagram that declares drilldowns and is not itself a
target. A directory with no unique root fails with `bundle/entry-ambiguous`.

The renderer draws the drilldown mark into the SVG from the diagram's own JSON, so it survives
canonical export and no tool rewrites delivered bytes to add it. The node group also gains
`data-drilldown-child`.

## Manifest

`manifest.json` is validated by `schemas/bundle.schema.json` and rejects unknown fields.

```json
{
  "schema_version": 1,
  "bundle_type": "drilldown",
  "entry": "archify-self",
  "max_depth": 2,
  "diagrams": [
    {
      "id": "render-pipeline",
      "file": "render-pipeline.html",
      "diagram_type": "workflow",
      "title": "Render Pipeline",
      "level": 1,
      "node_count": 7,
      "spec_sha256": "3d951943eab2…",
      "artifact_sha256": "ae93996cb6c3…"
    }
  ],
  "drilldowns": [
    { "parent": "archify-self", "component": "renderers-shared", "child": "render-pipeline", "label": "Shared Renderer Runtime" }
  ],
  "ownership": { "file": "archify-self.ownership.json", "sha256": "f4d57bce1a2d…" }
}
```

`max_depth` is always `2`. `diagrams` holds at most 13 entries — one entry at `level: 0` plus up
to twelve children at `level: 1`. `drilldowns[]` is the id-to-file resolution table used by both
the validator and the viewer; the diagram JSON only ever names an id.

The entry HTML embeds a byte-identical copy of the manifest as
`<script id="archify-bundle-manifest" type="application/json">`, because a `file://` document
cannot fetch a sibling JSON file. The disk `manifest.json` stays the normative source, and the
validator forces the two to remain byte-equal.

## The two digests

| Digest | Over | Used by |
|---|---|---|
| `spec_sha256` | the sibling `<id>.json` bytes | the runtime handshake; the renderer writes it onto the SVG root as `data-bundle-spec-sha256` and the child reports it back |
| `artifact_sha256` | the `<id>.html` bytes on disk | offline validation only; a self-contained HTML file cannot carry its own digest, and a `file://` parent cannot read child bytes |

They are not interchangeable. Re-delivering any diagram requires re-running `archify bundle`.

One exception: for a file that already carries an embedded manifest, the artifact digest is
computed after stripping the `archify-bundle-manifest` script. Otherwise injecting the manifest
would change the bytes the manifest describes and the entry could never validate. The consequence
is that `artifact_sha256` pins the entry's pre-injection bytes.

## Validation

`archify bundle --check` first checks the manifest. If it is missing, cannot be parsed, or fails
the schema, validation stops there. With a valid manifest it runs the remaining checks and
collects their failures. The ten checks are:

1. `manifest.json` exists, parses, and passes the schema.
2. the entry exists in `diagrams[]` at `level: 0`, every other diagram is `level: 1`, and
   `max_depth` is 2.
3. `id` and `file` are unique, and each `file` is an existing same-directory HTML name.
4. each HTML's `data-bundle-id`, `data-bundle-role`, and `data-bundle-spec-sha256` match the
   manifest.
5. recomputed artifact and spec digests match the manifest.
6. the entry embeds exactly one manifest copy, byte-identical to disk.
7. every drilldown row: the parent is the entry, the component exists in the entry's semantic
   collection, the child exists in `diagrams[]`, at most one child per component, no cycle, no
   nesting.
8. every diagram has between 1 and 12 primary nodes.
9. no child carries a drilldown mark — the second layer does not descend.
10. when a sidecar is listed: the file exists, its digest matches, it parses, and every child
    sidecar glob (component globs and `excluded`) is a subset of the parent component that
    declares the drilldown (`validateChildOwnershipSubset` via
    `archify/bundle/diagram-bundle.mjs:126-133` and `:569-577`). Parent `excluded` is inherited
    at locate projection time, not re-checked as a cover relation. The sidecar file, when
    present, must be `<entryId>.ownership.json`.

Failure codes are `bundle/entry-level`, `bundle/child-level`, `bundle/max-depth`,
`bundle/duplicate-id`, `bundle/duplicate-file`, `bundle/file-path`, `bundle/file-missing`,
`bundle/child-stale`, `bundle/embed-count`, `bundle/embed-mismatch`, `bundle/drilldown-parent`,
`bundle/drilldown-component`, `bundle/drilldown-child`, `bundle/drilldown-duplicate`,
`bundle/drilldown-cycle`, `bundle/drilldown-nested`, `bundle/node-cap`, `bundle/child-mark`,
`bundle/ownership-missing`, `bundle/ownership-stale`, `bundle/ownership-parse`,
`bundle/ownership-not-subset`. Manifest construction can also fail with `bundle/dir-missing`,
`bundle/id-invalid`, `bundle/spec-missing`, `bundle/spec-parse`, `bundle/empty`,
`bundle/entry-ambiguous`, `bundle/entry-missing`, `bundle/type-unknown`, `bundle/render-failed`,
or `bundle/embed-missing`.

Manifest validation can fail with `bundle/manifest-missing`, `bundle/manifest-parse`, or
`bundle/schema: <path> <message>`. These are entries in
`diagnostics[0].evidence.failures[]`; the diagnostic's top-level `code` is `bundle/invalid`.
For these early failures, the evidence reports `checksPassed: 0` and `checkCount: 1`, because
the remaining checks did not run.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the bundle was written and validated, or `--check` passed |
| 2 | any validation or construction failure, and any usage error |

There is no exit-1 tier. Failures surface as one diagnostic with `code`, `message`, `subject`,
`evidence.failures[]`, and `supportedFixes`. When any failure concerns a digest or attribute
mismatch, the top-level code is promoted to `bundle/child-stale`.

## Reader behavior

**Descending.** Single click keeps its existing one-hop focus meaning. Descending happens through
the named `Descend` control in the Semantic Passport, or by activating the drilldown mark on the
node. Keyboard activation works because the node is already a focusable button.

For scripts and headless readers, `Archify.drilldown.descend(componentId)` starts a descent from
an entry-diagram node. Pass the node's semantic ID (`data-node-id`), not the child diagram ID.
The Viewer resolves the child through the node's annotation and the bundle manifest.

The call returns a boolean synchronously. `false` means no descent started: the Viewer is
nested, the node has no drilldown child, or no readable embedded manifest is available. `true`
means the request was handled; it may start loading a child or immediately show a stale card
for an invalid bundle reference. It does not confirm that the iframe loaded or its handshake
succeeded. The frame remains hidden until the expected diagram ID and spec digest pass the
handshake. Neither `active()` nor `data-drilldown-state="level1"` is a readiness signal.
Use `Archify.drilldown.back()` to return to the parent.

Bundle click/load listeners are registered only for an entry with an embedded manifest, after
the document has parsed. A nested child still receives handshake messages without its own
manifest or Locate payload. Ordinary Viewers do not register bundle message listeners.
Offline `file:` documents have opaque origins, so their `postMessage` transport uses `"*"`;
receivers validate the actual source window, bundle role and message shape, and the parent
verifies the child's ID and spec digest. The wildcard is not permission for an unrelated
embedding page to turn an ordinary Viewer into a bundle child.

**Level 1.** A breadcrumb reads `<entry title> › <component label> · <child title>`; its first
rung is a button that ascends, and only the current rung carries `aria-current="page"`. Below it,
a 96 px silhouette of the parent — structure only, no text, sigils, beacons or brand marks — marks
the descended component in Verified Cyan. The child fills the canvas as a complete viewer with its
own Passport, focus, lens, route probe, finder, theme, preset, and export.

**Returning.** The parent SVG never leaves the DOM or the layout: it stays in flow with
`visibility: hidden` while the child is overlaid, and the adaptive reader's re-measure is frozen
while descended, so no fit runs and `back()` simply reveals the same geometry. Window and canvas scroll
offsets are captured on descend and restored on ascend. `Esc` ascends, `Backspace` is a synonym,
and the breadcrumb's first rung does the same. The drilldown rung sits at the outer end of the
existing Escape ladder, so transient states inside the child are cleared first. A child that has
exhausted its own ladder forwards the keystroke to the parent, so `Esc` works with focus inside
the child.

**Disabled at level 1.** Presentation Stage is unavailable while nested. A nested child starts in
Still and does not auto-play a trace. Focus, lens, route probe, intent trace, presentation, and
guided views are cleared before descending and are not restored afterwards — what is restored is
geometry, not temporary state.

**Motion.** Descend and ascend run at roughly 170 ms and switch instantly under
`prefers-reduced-motion`.

## Stale children

Nothing is rendered when identity does not line up.

After the iframe loads, the entry posts a hello carrying the expected id and spec digest. The
child answers with its own `data-bundle-id` and `data-bundle-spec-sha256`. The parent accepts a
reply only from the frame's own window, and only when the id and digest match the expected
patterns. A mismatch, a missing attribute, an unsafe filename, or a handshake that does not
complete within 1200 ms removes the iframe and shows an explicit stale card naming:

- the expected and actual diagram id,
- the first twelve hex characters of the expected and actual spec digest,
- the failure reason,
- and the single repair action, `archify bundle <dir>`.

The breadcrumb stays and the return path still works. The same fact is reported offline as
`bundle/child-stale`.

## Change projection

`archify locate … --bundle <dir>` writes a copy of the entry HTML carrying
`<script id="archify-locate-projection" type="application/json">`. The entry applies component
states to its own nodes on load, and forwards the child's node states after a successful
handshake.

The visual rules are deliberately narrow. Untouched nodes dim; `touched` and `stale` stay lit. The
parent chip reads "N FILES TOUCHED INSIDE" and is hidden when the count is zero — a clean
projection is an empty list, not a reassurance. There are no check marks, no green, and no risk
or merge vocabulary; `stale` gets its own non-green treatment. With no projection attached, no
projection attributes are written and every node renders fully lit.

A lit node means one thing: at least one changed path in the range matched that component's
globs. It is not a claim about behavior, correctness, or consequences.

## Worked example: the Archify self-map

`docs/cases/archify-self/` is a working bundle: a ten-component architecture entry with two
children — an architecture child for the typed renderers and a workflow child for the render
pipeline — plus three ownership sidecars and two checked-in locate receipts. Rebuild it from the
repository root:

```bash
node archify/bin/archify.mjs bundle docs/cases/archify-self
node archify/bin/archify.mjs bundle docs/cases/archify-self --check --json
```

The locate commands that produce the two PR receipts, and the rule that only
`locate.receipt.json` is kept under each PR folder, are in
`docs/cases/archify-self/README.md` and in `locate.md`.

## Not supported

No third level. No inline single-file bundles. No bare-path or cross-directory targets, and no
`http(s)` targets. No automatic generation of children — a child is an authored diagram. No
auto-layout. No network access and no model call anywhere in `bundle` or in the viewer runtime.
