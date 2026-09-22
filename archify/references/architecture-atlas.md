# Architecture Atlas

Use an Atlas when a reader needs to enter a module's internal architecture and return to the overview, or inspect a shared object's canonical definition. Each view is an independent architecture schema v1 document. Ordinary focus, zoom, graph tools and exports operate on the current view.

## Author and deliver

1. Author the member architecture JSON files. Use stable local node IDs and their actual communication relationships. Validate members with the existing architecture command while repairing their layouts.
2. Write an atlas manifest, using `schemas/atlas.schema.json`. The root is `entry`; every other diagram has exactly one parent `detail`. Add `references` only for explicit occurrences of an object defined elsewhere.
3. Deliver and inspect the complete bundle:

   ```sh
   node bin/archify.mjs deliver atlas examples/atlas/project.atlas.json output.html --quality showcase --json
   node bin/archify.mjs visual-check output.html --json
   ```

Only a zero delivery exit makes the output current. On failure, repair the diagnosed manifest location or member and retry. An existing output remains the previous artifact. Browser evidence checks every actual member and the outer navigation shell; its receipt identifies the final bundle digest and member IDs. Inspect the generated contact sheet separately for perceptual quality.

`deliver atlas` supports optional output, `--quality`, `--json`, `--repo-root` and `--open`. Omitted output becomes `<manifest filename without its final extension>.html` beside the manifest: `project.atlas.json` becomes `project.atlas.html`. Member `meta.output` is ignored. Use `--open` only when opening the completed artifact is wanted. Atlas has no `render`, `validate`, `preview`, `compare` or `migrate` command; use the member architecture commands during authoring.

## Manifest

```json
{
  "atlas_version": 1,
  "entry": "system",
  "meta": { "title": "Order platform", "locale": "en", "visual_preset": "classic" },
  "diagrams": {
    "system": { "source": "system.architecture.json" },
    "payment": { "source": "payment.architecture.json" }
  },
  "details": [
    { "from": { "diagram": "system", "node": "payment" }, "to": "payment" }
  ],
  "references": [
    {
      "occurrence": { "diagram": "payment", "node": "redis" },
      "target": { "diagram": "system", "node": "redis" }
    }
  ]
}
```

`meta.title` is required. Locale defaults to `en`, preset to `classic`; omitted member values inherit, and explicit conflicts fail. Member titles, chapters, viewBoxes, animation and engineering profiles remain local. `details` and `references` default to empty arrays, so a single root member is valid.

Sources are local filesystem JSON paths, absolute or relative to the manifest directory. Parent-directory segments and symlinks are supported. URL/URI sources are rejected. Output must not alias the manifest or any member, including through symbolic links or hard links; aliases are checked again before commit.

Diagram and node IDs use the existing restricted ID style. The pair `(diagram, node)` identifies an occurrence; different diagrams can use the same local ID.

## Detail tree and shared references

- The entry has no parent. Every non-entry diagram has one incoming detail and is reachable from entry. A node has at most one default internal diagram. Containment cycles, self-detail links, duplicate parents and orphan views fail validation. The same rule applies at any depth.
- A reference occurrence and target both exist and have the same component type. Targets are canonical definitions, not other references. Occurrences are unique, cannot reference themselves and cannot own a detail. Two diagrams may refer to each other's distinct canonical objects.
- References retain their database/backend/etc. identity and carry a visible context mark in canonical SVG and image exports. A definition link moves to the qualified target; it adds no communication edge.
- Parent relationship disclosure lists only the host node's authored incoming/outgoing edges. An authored relationship ID enables navigation to that parent relationship. Edges without IDs remain text summaries.
- Detail membership and shared-object identity are author declarations. Validation checks consistency, not whether the declaration describes the real system. Inspect source evidence when factual ownership matters. Route and reachability searches use only the current member's authored communication graph.

### Canonical internal structure

Internal structure belongs to the canonical component that authors it. A
reference occurrence must not repeat `internal_structure`; validation rejects
the occurrence at its member component path. Any number of occurrences may
resolve to one canonical structure. If the canonical target has no structure,
its occurrences expose no structure action. The authoring shape and evidence
boundary are in the
[authoring contract](authoring-contract.md#architecture-node-internal-structure).

Each owning member contains one inert node-indexed payload. Atlas metadata keeps
only a compact node/domain/item inventory and the member receipt. It never copies
the structure body. The bundle reader and delivery checker reconstruct the member
and compare the actual payload, inventory, counts, bytes, and digest before use.

## Reading and sharing

Click a node to focus it. A node that owns an internal diagram carries a small stacked-layer mark; a shared occurrence carries an outward reference mark. Its node inspector offers one action naming the destination diagram, such as “Open Payment →” or “View definition in System ↗”. Responsibilities stay visible; source evidence, metadata, reachability, relationship tools and a copyable node link live under “Sources and relationships”. Ordinary nodes and multiple selections have no diagram action. These marks remain part of canonical SVG and image exports.

A component with internal structure adds an “Internal structure” section inside
the existing Details tab. It shows a Code structure card, a State fields card,
or both, with exact item counts. It does not add a fourth inspector tab. A node
without structure keeps its prior inspector with no empty block. A node may show
both its independent “open internal diagram” action and structure cards.

Opening a structure card replaces the member's graph reading area with a tree
and item detail surface. The Atlas shell, Directory, toolbar, current diagram,
and breadcrumb remain. The hidden graph retains its reading snapshot, becomes
inert, and leaves the accessibility tree. Returning restores the graph without
creating an Atlas layer.

Structure addresses extend the node address:

```text
#diagram=payment&focus=controller
#diagram=payment&focus=controller&inspect=structure&section=code
#diagram=payment&focus=controller&inspect=structure&section=state&item=status
```

`inspect=structure` requires a valid `focus`. `section` is `code` or `state` and
must exist on that node; `item` must belong to the selected section. Omission
uses the first authored domain and root. Standalone Architecture uses the same
fields without `diagram`. Invalid or stale addresses show a recoverable error
and are not silently redirected to another item.

Selecting a graph node and changing inspector tabs retain the existing in-view
replacement behavior and add no visit. A user-opened graph-to-structure transition
prepares the requested surface before commit, then adds exactly one native
history entry. Domain, item, and expansion changes replace that entry, so tree
navigation does not grow history. Reopening the committed structure is a no-op.
Back restores the originating graph visit and Forward restores the last domain,
item, expansion, focus, and scroll snapshot. “Return to graph” uses the source visit
when it exists; from a cold structure link it removes `inspect`, `section`, and `item` from
the current entry rather than leaving the artifact.

Opening structure from a reference occurrence resolves to the canonical
`(diagram, node)` before preparation. A copied structure link therefore names the
canonical definition and current domain/item, while a copied node link keeps the
local occurrence. The source visit remains in history, so Back returns to that
occurrence with its own relationships, camera, inspector, and scroll state. A
clipboard failure is reported beside the structure action and does not change the
address or navigation state.

The transition commits only after the requested graph or structure surface reports
ready. A failed explicit open keeps the last committed surface, URL, and history
entry; late results from a superseded candidate cannot commit. Native history or
an externally edited hash already owns its target address, so a failed restore
keeps that address visible with recovery actions. Structure navigation uses the same
one-active/one-candidate limit, export gating, delayed status, and cancellation
rules as a diagram transition.

The brand, Directory and global toolbar persist across diagram changes. Theme, preset and other existing appearance preferences belong to this workbench. The Directory starts closed and lists the single-parent detail tree; references and guided chapters do not become children. Its open state, search query, list scroll, input selection and keyboard focus are shared across the current Atlas session, including Back/Forward. Visit restoration must not replace them with an earlier visit's values or steal focus from a workbench control. The highlighted current diagram changes only when a target is committed. Clicking that current item leaves the Directory and reading state unchanged; during an explicit pending switch it cancels the switch. Different focus or relationship targets within the current diagram use the existing in-view address update.

Ancestor breadcrumbs sit above the existing title; Back follows actual visits and is hidden on a cold link. A cold deep link can return through its ancestors. Each visit keeps its own semantic state, camera, inspector tab, overview/panel scroll and parent disclosure. Restoring a visit waits for member layout and restores its reading state and available in-view trigger focus. Responsibilities, details, relationships and sources continue to come from the current member and selection. Addresses qualify local state, for example `#diagram=payment&focus=redis`; theme, preset and Presentation Stage remain query preferences. Historical appearance values do not override the workbench's current preferences.

For wide desktop members, reserve a fixed 280px left rail, a 16px left inset, a 20px graph gap and the page's right padding before sizing the reader. The rail appears when the remaining workspace can hold the 960px minimum reader, independent of the member's chapters or overview cards. Fit the reading width to that workspace and the available height, then center it within the workspace. Overview cards stay in the rail and do not consume the graph's height budget. Selecting nodes, opening evidence and collapsing the desktop directory do not move or shrink the graph. When the rail cannot fit, or in Presentation Stage, navigation flows near the title and a selected-node inspector follows the graph and explanatory cards. Compact layouts allow vertical scrolling; they never overlay the graph. Escape first closes an open parent-relationship or source disclosure, then an open directory, returning keyboard focus to its trigger before changing the reading state. Responsive moves preserve the focused control.

The outer shell owns history and the transition. An explicit switch keeps the old diagram visible and readable while one hidden, non-interactive candidate initializes at the final workspace dimensions. The candidate must settle the latest theme/preset, fonts, layout, semantic state, camera and scroll before commit; iframe load or bridge readiness alone is insufficient. Initialization grants no playback, export or address/snapshot-writing rights. At most one active Viewer and one candidate are mounted; abandoned candidates and replaced Viewers are released. A local loading status appears only if preparation lasts beyond 300ms; this is a feedback threshold, not a completion deadline. Repeated requests for the pending target merge, and a later valid target supersedes the earlier candidate.

On successful explicit commit, capture the old visit's final reading state, revoke its rights, and update the target content, title, breadcrumbs, current Directory item and address together. Only this success adds a history entry. An explicit failure or cancellation leaves the old diagram and address usable and adds no visit; failure offers a local retry. A browser Back/Forward or external hash change has already changed the address, so it immediately revokes the old visit's writing and recording rights. The old picture may remain inert during preparation. A failure keeps the target address and displays an explicit target error with retry/navigation actions; it must not rewrite the entry to the old diagram. Any retained old preview is identified as such and cannot be shared or exported as the target. Clicking that revoked old diagram in the Directory requests a new explicit visit; it does not reactivate the old session.

Explicit diagram navigation waits for an ongoing export and retains only the latest requested target, without starting a candidate. Preparation blocks new exports until commit or explicit failure/cancellation. Native history departure cancels recording, releases its tracks and prevents late downloads. All existing toolbar export capabilities operate through the committed current member's Viewer, whose visit identity must match the address. Export files retain the current member's full canonical graph, including reference marks.

The delivered HTML contains all bytes needed to restore its complete, checked member documents. Bundle format v2 stores identical script/style/font blocks once, document fragments as literals or resource indices, and navigation metadata separately. JSON strings are chunked so each serialized payload line is at most 8192 UTF-8 bytes, including escaping and indentation. Long metadata uses the same bounded-string representation; no metadata or member content is truncated.

New deliveries wrap that unchanged v2 payload in a deterministic `gzip-base64`
transport envelope. The envelope records the exact uncompressed UTF-8 byte count
and SHA-256 digest, and splits Base64 into bounded lines. Browsers use native
gzip decompression when available and an inline, MIT-licensed offline fallback
otherwise; both paths validate the restored bytes before member startup. No
runtime asset is fetched. The CLI still reads legacy raw v1 and raw v2 payloads,
so the transport change does not alter manifests, member schemas, navigation
addresses, exports, or the logical result returned by `unpackAtlas`.

The browser reconstructs only the requested member, within the existing current/candidate lifecycle. It does not cache all reconstructed pages or preload their execution environments. The CLI uses the same reader to restore members before their original digest, source, relation and rendering checks. `unpackAtlas` returns the existing complete logical member representation for its callers; member receipts still describe those restored HTML bytes, while the bundle receipt describes the final compact file. The CLI continues to check v1 bundles. Manifest `atlas_version: 1`, architecture schemas and public navigation addresses are unchanged.

It runs from `file://` or local HTTP without reading source JSON or fetching runtime assets. User-clicked source links may open their external destinations. For delivery, return the HTML link and a final-artifact PNG preview; avoid automatically opening the HTML in the host file panel, while honoring explicit requests to open it. Existing current-view exports, share cards and clipboard actions retain their complete Viewer implementations.

## Evidence and boundaries

Each member uses the existing `repository`/`sources` and engineering-profile checks. One `--repo-root` is forwarded under the existing repository semantics. Members can pin different verified revisions; the bundle does not claim a shared repository transaction snapshot.

Delivery freezes the bytes it reads, computes separate original-source/effective-input/member-HTML receipts, rechecks the actual embedded documents and atomically replaces the output. The CLI receipt also identifies the manifest and final bundle bytes. Digests establish byte consistency, not signatures or provenance authentication.

Atlas v1 includes architecture members, a single-parent detail tree, canonical references and current-view exports. Multi-parent views, other diagram types as members, inline expansion, cross-diagram route calculations, automatic connections and synchronized object properties are outside this format.
