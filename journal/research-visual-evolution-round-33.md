# Visual Evolution Round 33 — Shareable Story Moment

Date: 2026-07-20
Status: implementation-ready research recommendation

## Executive decision

Build **Shareable Story Moment** as the next bounded viewer slice.

Archify can already restore a named chapter, one focused node, one authored route,
or one semantic-kind Lens from a URL. Round 32 also made every Story Trail beat a
direct native control, but deliberately left the selected beat out of the URL.
The missing product moment is now narrow and visible: a reader can stop a story on
exactly “Tool Router, beat 4 of 8” but cannot send another person a link that opens
on that same semantic node, exact adjacent relationship, receipt, and chapter
camera. These are current viewer contracts, not inferred capabilities
([current README](../README.md),
[current shared viewer source](../archify/assets/template.html)).

Round 33 should extend the existing guided-view fragment grammar from:

```text
#view=<view-id>
```

to:

```text
#view=<view-id>&beat=<stable-node-id>
```

and add one **Copy moment** action to the existing Guided Story chrome. The
chapter ID names the authored projection; the stable node ID names one unique
resolved stop inside that projection. On load, Archify rebuilds the current node,
past/pending beat states, and exact adjacent relationship from canonical compiled
data. It does not serialize visual output, authored graph data, a pixel camera,
timer progress, or runtime overlays.

This is the useful intersection of the primary-source patterns:

- LikeC4 and Structurizr give compiled views stable names/keys in URLs and embeds.
- reveal.js can include the current incremental fragment in its URL, making one
  precise presentation moment recoverable.
- React Flow proves that raw nodes, edges, and viewport can be serialized when the
  product is an editor, but that is intentionally the wrong ownership boundary for
  Archify.
- D2 proves that named boards/steps can be linked or exported, but a new board per
  beat would move narrative state into the authored diagram language.
- Fireworks' current offline viewer keeps pan/zoom only in memory and its GIF is a
  media loop, so it supplies visual inspiration but no exact-moment share contract.

The implementation remains one self-contained deterministic compiler artifact:
no schema field, layout change, dependency, server, storage service, short-link
backend, or editable viewer snapshot.

## Focused research question

> How do comparable interactive diagram and story tools make one exact visual
> moment shareable and recoverable, and which part of those approaches fits a
> deterministic technical diagram compiler rather than a canvas editor?

This note uses current first-party documentation and source as of 2026-07-20.
Where a conclusion depends on the absence of a documented or implemented state
channel, it is marked as an inference rather than presented as a vendor claim.

## Current Archify baseline

### What already has stable URL identity

The shared viewer currently supports these semantic entry points
([viewer README contract](../README.md),
[viewer URL writers and readers](../archify/assets/template.html)):

| State | Current address | Restored meaning |
|---|---|---|
| Focus | `#focus=<node-id>` | One stable semantic node plus its exact one-hop neighborhood |
| Route | `#route=<source-id>~<target-id>` | Deterministic fewest-hop authored directed route |
| Lens | `#lens=<kind>~<kind>` | One or two compiled semantic kinds and their exact authored traffic |
| Guided chapter | `#view=<view-id>` | One named authored `meta.views` projection and its chapter camera |
| Presentation | `?present=1` | Same semantic state in viewport-filling presentation chrome |
| One-shot chapter | `?play=1#view=<view-id>` | The named chapter plays once, then settles |
| Embed | `?embed=1` | Supporting viewer chrome is removed; one-shot playback can show the existing Share Chapter Cue |

Each semantic subsystem parses the fragment with `URLSearchParams`, but its
current writer replaces the fragment with its own top-level mode rather than
combining unrelated modes. That makes the fragment a single semantic ownership
channel, not a bag of simultaneous selections
([focus writer](../archify/assets/template.html),
[guided-view writer](../archify/assets/template.html),
[route writer](../archify/assets/template.html),
[Lens writer](../archify/assets/template.html)).

### What is intentionally not recoverable yet

Round 32's Story Beat Navigator holds one `storyBeatIndex`, resolves it to a
stable node ID, classifies only the exact authored relationship(s) between
adjacent stops, and exposes a read-only receipt. Direct beat activation currently
keeps `#view=` unchanged
([Round 32 contract](research-visual-evolution-round-32.md),
[current Story Beat implementation](../archify/assets/template.html)).

The camera runtime stores transform state separately and derives automatic framing
from semantic node bounds. Manual pan/zoom is not written to the URL, and canonical
export resets/removes viewer-only state
([Semantic Camera and export implementation](../archify/assets/template.html)).

The useful gap is therefore not “save everything.” It is “give the one selected
Story beat a stable semantic address.”

## Primary-source findings

### 1. fireworks-tech-graph: attractive output, but no recoverable viewer moment

At fixed commit
[`fireworks-tech-graph@50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/50c819d68fd4fee330b3010988cd13e98b678d44),
the project advertises two separate output surfaces: focused SVG-to-GIF semantic
motion and a self-contained offline HTML viewer with pan, zoom, reset, theme,
copy, and static export
([official README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md)).

The offline viewer initializes an in-memory object
`{x: 0, y: 0, scale: 1}`, mutates it on wheel/pointer input, and resets it to the
same defaults; the generated source does not read from or write to a URL for this
state
([official interactive viewer source](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/scripts/interactive_html.py#L276-L326)).
Its HTML exporter is explicitly a sanitized single-SVG offline viewer independent
of motion
([official capability contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/docs/CAPABILITIES.md#L31-L34)).

The motion output is a validated GIF timeline, not a navigable story state. The
current official contract uses a 5.75-second, 115-frame default with an infinite
loop and a settled-flow interval
([official motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/references/motion-effects.md)).

**Borrow:** the link must continue to open one self-contained artifact with no
service dependency; selected meaning should be visible on stable geometry.

**Skip:** serializing Fireworks-style pixel pan/zoom, treating a GIF frame as a
semantic checkpoint, adding an animated media format, or introducing a server to
make offline state shareable.

**Inference:** Fireworks currently offers no exact-moment deep link. That follows
from its documented output split and the complete viewer source above; it is not
a claim that the project will never add one.

### 2. LikeC4: stable authored view identity is the share boundary

LikeC4 defines a view as a model projection. Named views must be unique, and the
view name is used both for export filenames and as part of the sharing URL
([official Views documentation](https://likec4.dev/dsl/views/)). Its CLI builds a
deployable or embeddable site, and the official build contract says the Share
action yields a link to a specific diagram; hash-based history is available as
`/#/view`
([official CLI documentation](https://likec4.dev/tooling/cli/#build-static-website)).

The current SPA routes a rendered diagram through `/view/$viewId` and its embed
through `/embed/$viewId`
([official view route source](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/likec4-spa/src/routes/_single/view.%24viewId.tsx),
[official embed route source](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/likec4-spa/src/routes/_single/embed.%24viewId.tsx)).
Its current embed builder derives the URL from the compiled `diagram.id` and adds
only padding and optional theme; it labels this surface a static diagram in an
iframe
([official embed builder source](https://github.com/likec4/likec4/blob/f0ce898be4868a4fc57f80630d6e8b09c0439eb2/packages/likec4-spa/src/components/view-page/share-modal/EmbedPanel.tsx)).

LikeC4's React integration likewise makes `viewId` an explicit component input
and exposes navigation as `onNavigateTo`; pan/zoom capability is configured
separately
([official React integration](https://likec4.dev/tooling/react/)).

**Borrow:** the URL should name an authored, compiler-stable projection rather
than a rendered camera rectangle. Keep `viewId` as the first half of identity.

**Adapt:** Archify's exact Story moment needs one narrower coordinate inside that
view. The already validated stable node ID supplies it without a new authored
beat ID.

**Skip:** a SPA route tree, React state, server-hosted share records, web-component
surface, editable model snapshot, or per-viewport URL state.

### 3. reveal.js: one incremental fragment can be part of the deep link

reveal.js supports stable slide links by unique slide ID (`#/<id>`) and indexed
links for horizontal and vertical slides (`#/h/v`)
([official link documentation](https://revealjs.com/links/)). It exposes direct
navigation with `Reveal.slide(indexh, indexv, indexf)` and
`Reveal.navigateFragment(indexf)`
([official API documentation](https://revealjs.com/api/)).

Its configuration separates three URL/history choices: `hash` writes the current
slide so reload/copy returns to it, `respondToHashChanges` controls restoration,
and `fragmentInURL` includes the current incremental fragment so reload returns to
the same fragment position
([official configuration](https://revealjs.com/config/)). Fragment order is
deterministic and can be overridden with `data-fragment-index`
([official fragment documentation](https://revealjs.com/fragments/)).

Autoplay is separately explicit: `autoSlide` supplies an interval, per-slide or
per-fragment `data-autoslide` can override it, and user interaction pauses the
automatic sequence by default
([official Auto-Slide documentation](https://revealjs.com/auto-slide/)). Embedded
media receives `slide:start` and `slide:stop` messages when its containing slide
becomes visible or hidden
([official media/iframe documentation](https://revealjs.com/media/#iframe-post-message)).

**Borrow:** a deep link can be “named container + one incremental position,” and
playback is an orthogonal, explicit choice rather than implicit in the position.

**Adapt:** use a stable node ID instead of a numeric fragment index. Archify node
IDs already survive label changes and give the exact adjacent-edge classifier all
the information it needs; a numeric `beat=4` would silently retarget after a view
reorder.

**Skip:** slide replacement, two-dimensional slide coordinates, a global deck
router, fragment DOM hiding, full browser-history entries on every automatic
beat, and postMessage control APIs.

### 4. React Flow: full snapshot serialization belongs to an editor

React Flow's `toObject()` returns nodes, edges, and viewport as one JSON object
([official `ReactFlowInstance` API](https://reactflow.dev/api-reference/types/react-flow-instance)).
Its official Save and Restore example writes that object to `localStorage`, then
restores nodes, edges, and `{x, y, zoom}` with `setViewport`
([official Save and Restore example](https://reactflow.dev/examples/interaction/save-and-restore)).

React Flow also models viewport as `x`, `y`, and `zoom`; selection is separate
interactive state surfaced through `onSelectionChange`, and node objects include
an optional `selected` property
([official viewport and selection contract](https://reactflow.dev/api-reference/react-flow),
[official Node type](https://reactflow.dev/api-reference/types/node)).

**Borrow:** make restoration an explicit, testable state transition and fail
closed when IDs no longer resolve.

**Skip:** serializing nodes, edges, positions, selected flags, or raw viewport
coordinates into an Archify link. In React Flow those values are the editable
flow; in Archify the JSON IR and compiled SVG are canonical, and runtime state
must not become a second graph source.

**Reason to skip pixel viewport:** the same `x/y/zoom` describes different visible
content when the artifact is opened at a different container width, mobile
breakpoint, embed size, browser zoom, or Presentation chrome. Archify can instead
derive an appropriate camera from the same semantic chapter nodes on the current
device. This is an Archify design inference based on React Flow's explicitly
pixel/zoom viewport model and Archify's current semantic camera implementation
([React Flow viewport definition](https://reactflow.dev/learn/concepts/terms-and-definitions#viewport),
[Archify camera source](../archify/assets/template.html)).

### 5. D2: named boards are linkable, but board-per-beat is too much authoring

D2 composition distinguishes independent `layers`, base-inheriting `scenarios`,
and prior-step-inheriting `steps`
([official Composition documentation](https://d2lang.com/tour/composition/)).
Objects can link to a named internal board such as `layers.cat`, with breadcrumb
backlinks to ancestors
([official internal-link documentation](https://d2lang.com/tour/linking/)).

For composed diagrams, D2 can emit multiple linked SVGs, one animated SVG, one
GIF, PDF pages, or PowerPoint; the animated SVG interval determines how long each
board stays visible, while the documentation warns that many boards can confuse a
viewer waiting for the loop
([official composition export formats](https://d2lang.com/tour/composition-formats/)).
The CLI also accepts a named `--target` board for deterministic export
([official CLI manual](https://d2lang.com/tour/man/)).

**Borrow:** a semantic sub-position should have an authored/stable identity and
be independently targetable.

**Adapt:** Archify's view is already the board and its existing stable node ID is
already the step identity. Restore viewer emphasis over one graph rather than
compile another board.

**Skip:** a new board/layer/step schema, inherited graph mutations, one SVG per
beat, animated board loops, breadcrumb navigation, and relayout between moments.

### 6. Structurizr: diagram key and perspective belong in embed URLs; animation step does not

Structurizr's static site embeds a diagram by its window hash, for example
`index.html?...#SystemContext`
([official static embed documentation](https://docs.structurizr.com/static/embed)).
The cloud/server embed contract names a diagram through the `diagram` key and can
add selector, iframe, access, perspective, or tag parameters depending on the
deployment
([official cloud embed documentation](https://docs.structurizr.com/cloud/embed),
[official server embed documentation](https://docs.structurizr.com/server/diagrams/iframe-embed)).

Structurizr separately supports authored diagram animation steps and explicit
step-forward/back controls
([official animation documentation](https://docs.structurizr.com/ui/diagrams/animation),
[official viewer documentation](https://docs.structurizr.com/server/diagrams/viewer)).
Its documented embed parameter list does not include an animation-step parameter.
That is a statement about the current public embed contract, not proof that no
internal implementation could represent one.

**Borrow:** stable diagram/view key first; optional semantic filter second; embed
state should be declared in the URL rather than recovered from parent-page
pixels.

**Adapt:** Archify can go one useful step further and document the story beat as a
stable subordinate ID because that state already exists in every generated HTML
artifact.

**Skip:** workspace APIs, tokens, diagram selectors, parent resize scripts,
server-only sharing, manual persisted layout, and a second perspective/filter
model.

## Pattern comparison

| Tool | Stable semantic address | Exact incremental position | Raw viewport snapshot | Embed/autoplay meaning | Archify judgment |
|---|---|---|---|---|---|
| Fireworks | File/slug only | No current viewer contract | In-memory only | Offline viewer is static; GIF loops as media | Borrow self-contained delivery; skip state model |
| LikeC4 | Named `viewId` in view/embed route | No documented walkthrough step in share URL | Not part of current share/embed builder | Embed is a view with padding/theme | Borrow stable view identity |
| reveal.js | Slide ID or h/v index | Fragment index can be in URL | No canvas snapshot | Auto-slide is explicit and interruptible | Borrow container + incremental checkpoint |
| React Flow | Application-defined | Application-defined | Nodes/edges/viewport can be serialized | Application-defined | Borrow restore discipline; skip editable snapshot |
| D2 | Named target board/internal link | Step is another composed board | No viewer snapshot contract | Animated SVG/GIF advances boards | Borrow targetability; skip board-per-beat |
| Structurizr | Diagram key; optional perspective/tags | Animation controls, no documented embed step | Layout belongs to workspace/editor | Live iframe is keyed by diagram | Borrow diagram key + semantic modifier |
| Archify now | `focus`, `route`, `lens`, `view` | Beat is in memory only | Derived camera, no URL snapshot | `play=1` is bounded chapter scope | Add `view + beat`, preserve everything else |

## Candidate comparison

| Candidate | Benefit | Failure mode | Decision |
|---|---|---|---|
| Base64/JSON viewer snapshot in URL | Can encode almost anything | Long opaque links, duplicates graph state, device-dependent viewport, migration/security burden | Skip |
| `#beat=4` alone | Tiny | Ambiguous across chapters and silently retargets after reorder | Skip |
| New authored `meta.views[].beats[].id` | Explicit beat identity | Adds schema/authoring burden when node IDs are already unique within normalized views | Skip |
| `#focus=<beat-node>` | Reuses an existing link | Loses chapter, past/pending story, and exact adjacent relationship meaning | Skip |
| `#view=<id>&beat=<stable-node-id>` | Human-readable, deterministic, composable inside one current mode | Needs careful restore ordering with camera/Handoff and autoplay | **Build** |
| Update URL on every automatic beat | Address bar always mirrors playhead | Timer-driven URL churn; a settled replay link can accidentally become “start from final beat” | Skip |
| Copy-only link with no restore-on-load | Easy UI demo | Link is decorative rather than recoverable state | Skip |

## Borrow / adapt / skip decision

### Borrow

1. **Named view identity** from LikeC4 and Structurizr.
2. **Container plus exact incremental checkpoint** from reveal.js.
3. **Explicit restore transaction and fail-closed validation** from React Flow's
   save/restore pattern.
4. **Self-contained delivery and stable geometry** from Fireworks.
5. **Semantic targetability rather than visual screenshotting** from D2 boards.

### Adapt

1. Use `view=<view-id>` as the container and `beat=<stable-node-id>` as its one
   subordinate coordinate.
2. Resolve the node ID against the normalized active view, then reuse the existing
   `storyStep` classifier; do not encode edge direction/count in the link.
3. Let Semantic Camera derive the same chapter framing for the current viewport;
   do not replay an old pixel transform.
4. Keep autoplay as the existing explicit query command `play=1`, orthogonal to
   the static moment address.
5. Reuse the existing Share Chapter Cue in embed mode to identify a pinned or
   playing moment; do not create a new overlay system.

### Skip

- raw `x/y/zoom`, viewport width, scroll offsets, browser zoom, or screen size;
- serialized node/edge arrays, labels, relationship IDs, SVG paths, or style;
- timer elapsed fraction, motion-owner token, playing/paused flag, Handoff phase,
  pulse clone, or progress animation state;
- a numeric-only beat, new beat schema, new route type, server token, database,
  short-link service, localStorage dependency, postMessage API, or SPA router;
- auto-updating history/address state on every timer-driven beat;
- making the link mutate JSON IR, SVG geometry, canonical export, or layout.

## Bounded implementation recommendation

### Product surface: one Copy moment action

Add one compact **Copy moment** button to the existing Guided Story action group.
It is disabled when no chapter beat is selected. Activating it:

1. pauses playback at the current beat if necessary;
2. reads the current normalized view ID and `storySteps[storyBeatIndex].nodeId`;
3. constructs the current document URL with the existing query string plus
   `#view=<encoded-view-id>&beat=<encoded-node-id>`;
4. copies it through the same clipboard/fallback pattern used by Focus, Route,
   and Lens;
5. reports one bounded “Moment link copied” status; and
6. does not move focus, camera, diagram/page scroll, or Story Trail scroll.

Do not add a share modal, social destination list, QR code, URL shortener, or a
second toolbar. The action belongs beside Play because it shares the current
playhead, but it must remain visually secondary to playback.

### URL grammar

The accepted grammar is:

```text
#view=<view-id>[&beat=<node-id>]
```

Rules:

1. `beat` is valid only when `view` is present and resolves to one current
   normalized view.
2. The decoded beat must exactly equal one member of that view's de-duplicated
   `focus` list.
3. IDs are compared as exact strings; no label, index, prefix, fuzzy, or DOM-ID
   fallback is allowed.
4. Because normalized views already reject duplicate semantic IDs, the stable
   node ID identifies exactly one beat in a valid view.
5. Unknown view: preserve today's fail-closed Show all behavior.
6. Known view plus missing/unknown beat: restore the chapter only and create no
   current beat, pulse, or error modal.
7. `beat` without `view`: ignore it. Do not guess which chapter contains the
   node.
8. Extra unrelated fragment keys do not create combined viewer ownership. Focus,
   Route, and Lens remain mutually exclusive with Guided Story.
9. Copy produces canonical key order `view` then `beat`.
10. Automatic beat advancement never rewrites the URL. The beat parameter is an
    entry checkpoint, not timer telemetry.

### Restore transaction

Restoration must be one latest-wins transaction:

1. Parse `view` and `beat` together in `syncViewFromHash()`.
2. Increment a dedicated restore generation before activation.
3. Activate the view with `updateUrl: false`, reusing canonical focus selection,
   Story Trail construction, and Semantic Camera framing.
4. Resolve `beat` only against the just-normalized active view.
5. Wait for the current chapter Handoff/camera promise to settle.
6. Recheck generation, current hash, active view, and resolved node identity.
7. Apply the existing beat writer once with `manual: false`, `center: true`, and
   `pulse: false`.
8. Leave playback paused unless `play=1` explicitly requests chapter playback.
9. Do not move DOM focus or announce restoration through a polite live region.

The no-pulse rule matters: opening a static link must present the exact final
semantic state immediately. Motion is an explicit play or reader activation, not
a side effect of parsing a URL.

### Manual selection and address-bar behavior

Keep Round 32's low-noise invariant: merely clicking a beat does not need to
create a browser history entry. Two acceptable writers share one canonical URL
builder:

- **Copy moment** always serializes the current beat without changing the page
  address.
- If the product chooses to mirror a manual pinned beat in the address bar, use
  `history.replaceState`, never `pushState`, and never update from automatic
  playback.

For the bounded Round 33 slice, prefer copy-without-address-mutation first. It
preserves existing selection tests and prevents a pasted link from becoming stale
during automatic playback. A later round can add address mirroring only if user
evidence shows the hidden link state is confusing.

### Static, play, embed, and presentation semantics

| URL | Required result |
|---|---|
| `#view=v&beat=n` | Restore chapter `v`, pin semantic beat `n`, no pulse, no autoplay |
| `?present=1#view=v&beat=n` | Same pinned moment in existing Presentation Stage |
| `?play=1#view=v` | Preserve current one-shot whole-chapter behavior |
| `?play=1#view=v&beat=n` | Start the existing chapter-scoped scheduler at `n`, play only the remaining beats, never advance chapter |
| `?embed=1#view=v&beat=n` | Hide controls; show the pinned canonical beat and reuse Share Chapter Cue as `Pinned · Beat NN / NN` |
| `?embed=1&play=1#view=v&beat=n` | Show `n` as the starting cue, play remaining chapter beats once, then settle |

Playback uses the current single generation-owned scheduler. Starting from a
linked beat sets its elapsed dwell to zero and retains the existing per-chapter
dwell calculation; it does not invent a second “moment player.” User interaction,
page hiding, Still, and reduced motion keep their existing pause/cancel ownership.

When reduced motion is active:

- a static moment link remains pinned at the requested beat;
- `play=1` with a beat shows that same requested beat as `Still`, without advancing;
- `play=1` without a beat preserves today's static whole-chapter fallback.

This keeps the semantic checkpoint truthful instead of replacing it with a
different final frame solely because motion is unavailable.

### Semantic reconstruction

For resolved view `V` and linked node ID `B`:

```text
i             = exactIndexOf(V.focus, B)
activeNode    = V.focus[i]
previousNode  = i > 0 ? V.focus[i - 1] : null
pastNodes     = V.focus[0 .. i-1]
pendingNodes  = V.focus[i+1 .. end]
stepRelation  = storyStep(V, i).relation
stepEdges     = storyStep(V, i).edges
```

The URL never stores `i`, relationship direction, edge keys, labels, or counts.
Those are reconstructed from the current compiled artifact. If the artifact
changes so that the node leaves the view, the link safely degrades to the named
chapter. If its exact adjacent relationship changes, the current artifact's
authored truth wins; the URL does not preserve stale topology.

### Visual contract

1. Restored state must be visually indistinguishable from manually pinning the
   same beat, except it creates no finite pulse.
2. The existing `aria-current="step"`, past/current/pending contrast, receipt,
   exact edge classification, Blueprint square treatment, and Signal Flow glow
   remain the only beat presentation.
3. Copy moment adds no card, modal, thumbnail, miniature camera, or screenshot.
4. The copy button must not increase the desktop Guided Story panel height or
   create document-level overflow at 320px/390px.
5. In narrow layouts, use the existing action-row wrapping/compaction rather than
   abbreviating the accessible name.
6. A restored link may center only its Story Trail button locally. It may not use
   `scrollIntoView` to move the page or diagram.

### Accessibility contract

- Use a native `button type="button"` named “Copy link to current story moment.”
- Disable it when `beat()` returns no selected beat; do not expose a link to an
  ambiguous chapter-only state under the word “moment.”
- Copy activation may pause playback because it is direct reader exploration;
  keyboard focus alone retains the existing pause-without-selection contract.
- Restoration does not move DOM focus and does not announce every automatic beat.
- One bounded status message is allowed after an explicit copy action.
- The copied URL text does not need to be printed in the UI, but the current
  chapter, beat position, node label, and relationship receipt stay visible.
- Still/reduced-motion recipients receive identical semantic emphasis without a
  pulse or camera animation.

### Export and compiler boundary

Shareable Story Moment is HTML viewer state only:

- JSON schemas and renderer IR do not change.
- `meta.views` authoring does not change.
- SVG nodes, edges, IDs, geometry, markers, labels, and viewBox do not change.
- Canonical SVG/PNG/JPEG/WebP export strips/ignores the restored beat exactly as
  it does a manually selected beat.
- Browser-native WebM continues to record its existing canonical trace contract;
  it does not bake in a share URL checkpoint.
- Print restores the full undimmed graph and omits Story controls/cues.
- No URL text, copied value, query state, or `data-share-moment` marker enters the
  canonical SVG clone.
- The generated HTML remains self-contained and opens from a local file; fragment
  parsing requires no origin, network, cookie, or storage.

## Suggested implementation shape

Keep all code in the existing shared template so all five renderers inherit it:

1. Add pure `storyMomentUrl(view, step)` that clones `location.href`, removes the
   old fragment, and writes canonical `view` + `beat` fragment parameters.
2. Add one `Copy moment` button in existing Guided Story actions and reuse the
   current clipboard fallback/status pattern.
3. Extend the read-only beat receipt to include `viewId` and `href`, or add a
   read-only `moment()` receipt. Do not expose a setter.
4. Extend `syncViewFromHash()` to parse both keys and maintain a latest-wins
   restore generation.
5. Add `restoreStoryMoment(viewId, nodeId, generation)` that waits for Handoff and
   delegates to the existing beat writer with no pulse/live announcement.
6. Let `startCurrentViewPlayback()` honor an already restored beat as its starting
   checkpoint rather than resetting to beat 1.
7. Reuse Share Chapter Cue for pinned embed copy/state; add no new overlay.
8. Extend central Show all/hash replacement/hidden/Still/reduced-motion/print and
   canonical-export cleanup tests for the new URL marker only where needed.
9. Keep focus/route/lens writers singleton. They may clear `beat` because changing
   semantic owner exits Guided Story.
10. Update README, README_ZH, SKILL, Roadmap, Changelog, guide task copy, generated
    examples, Proof Lab, README reel, and package ZIP only after the shared
    contract is green.

## Acceptance checklist

- [ ] All five renderer outputs inherit the same `view + beat` parser and copy
      action from one template.
- [ ] `#view=<valid>&beat=<valid-stable-node>` restores exactly one current beat,
      one current chapter, the correct past/pending states, exact relationship
      classification, and the existing chapter camera.
- [ ] A restored forward, reverse, grouped, and multiple transition matches the
      same manual Story Beat receipt and edge set.
- [ ] Restoration creates zero pulse overlays, zero live-region chatter, and zero
      DOM-focus movement.
- [ ] Copy moment produces canonical key order and percent-encoding, then copying
      that URL into a fresh page recreates the same read-only `beat()` receipt.
- [ ] Unknown view, unknown beat, beat from another chapter, encoded junk, duplicate
      keys, and `beat` without `view` fail closed without an exception or inferred
      selection.
- [ ] Ten rapid hash changes across chapters leave only the final requested view
      and beat; older Handoff completions cannot overwrite it.
- [ ] Copying during playback pauses once and captures the visible current beat,
      not the previous scheduled beat.
- [ ] Automatic playback never rewrites the fragment or creates history entries.
- [ ] `?play=1#view=v&beat=n` starts at `n`, advances only remaining beats through
      the existing scheduler, and stops at the final beat without changing chapter.
- [ ] Static, one-shot, interrupted, completed, hidden, Still, and reduced-motion
      states retain one coherent semantic checkpoint.
- [ ] `?embed=1#view=v&beat=n` exposes no controls and shows one truthful pinned
      Share Chapter Cue outside the SVG.
- [ ] `?present=1#view=v&beat=n` uses the shared implementation, not a presentation
      fork.
- [ ] Manual pan/zoom before copy does not enter the URL; opening on desktop,
      390px, and 320px derives an appropriate camera from semantic chapter bounds.
- [ ] Copy moment does not change active chapter, focus IDs, edge classification,
      SVG transform, camera, page scroll, diagram scroll, or canonical SVG bytes.
- [ ] Focus, Route, Lens, another chapter, Show all, and direct node exploration
      clear or supersede moment ownership exactly once.
- [ ] Print and SVG/PNG/JPEG/WebP/WebM outputs contain no beat URL, runtime marker,
      Share Cue, control, or pulse residue.
- [ ] The action is a native keyboard-operable button with a stable accessible
      name, visible focus, disabled empty state, and one bounded copy receipt.
- [ ] Guided Story desktop height remains within the current baseline; 320px/390px
      layouts have no document-level horizontal overflow.
- [ ] Existing Focus, Route, Lens, Guided View, Chapter Delta, Handoff, Story Beat,
      Motion Governor, Presentation, embed, print, and export tests remain green.
- [ ] Built-in-browser verification covers fresh-load restoration, copied-link
      round trip, dark/light, Signal Flow/Blueprint, keyboard, 320px/390px, rapid
      hash replacement, reverse/group/multiple, Presentation, embed, Still,
      reduced motion, print, and export during a restored moment.

## Risks and containment

### Risk: a stale asynchronous Handoff applies the wrong beat

Contain it with one restore generation and a final identity check after Handoff.
URL parsing, chapter activation, and beat restoration cannot be independent
callbacks with no shared ownership token.

### Risk: node IDs change between artifact versions

Fail closed to the named chapter. Do not fall back to numeric position or label,
because that can produce a convincing but incorrect moment.

### Risk: autoplay erases the shared moment

Treat `beat` as a starting checkpoint and `play=1` as the explicit command. Do not
let timer-driven beats rewrite it. A static link never starts playback.

### Risk: “exact moment” is interpreted as a pixel-perfect screenshot

Document that the contract is semantic: same chapter, current node, adjacent
authored relationship, narrative states, and deterministic device-appropriate
camera. Browser width and manual pan/zoom are intentionally not part of identity.

### Risk: share affordance expands into a platform

Keep one copy button and one transparent URL. No accounts, collaboration records,
analytics, social targets, short links, snapshots, comments, or permissions.

## Non-goals

Round 33 does not add collaborative sessions, comments, cursors, saved workspaces,
editable snapshots, server-side hosting, short links, QR codes, social share
menus, speaker notes, per-beat authored IDs, per-beat durations, raw viewport
serialization, scroll restoration, screenshot thumbnails, new animation formats,
new router dependencies, browser storage, graph version pinning, URL signatures,
encryption, or a second playback scheduler.

The bounded outcome is simple: when a reader sees one meaningful Story Beat,
they can copy one human-readable link, and another browser reconstructs that same
semantic moment from the compiled artifact's existing truth.
