# Archify Roadmap

As of v2.11.0, the coordinate-stability work has shipped as JSON IR plus typed renderers for architecture, workflow, sequence, data-flow, and lifecycle diagrams. Workflow diagrams now also have phase/group/exception-lane structure, happy-path linting, trace animation, and route-crossing guards. The shared viewer adds deterministic semantic node IDs, optional author-controlled relationship IDs with durable `#relation=` links, a pre-click Intent Trace for exact one-hop traffic, a two-endpoint Route Probe with an inspectable Route Journey over deterministic shortest authored paths, searchable Node Finder navigation, read-only one-hop focus with a renderer-owned Semantic Passport and copyable focus link, a runtime-built Semantic Radar for desktop viewport navigation, bounded typed guided views with a visible Named Chapter Rail, pre-commit Chapter Delta Preview, Shared Anchor Handoff, and path-aware Semantic Story Beats, a reader-controlled Live/Still Motion Governor, share-ready one-shot chapters with a title/route/step/state/progress cue, a viewport-filling Presentation Stage, Semantic Camera framing, pan/zoom, three reader-switchable visual presets, a contain-only 1200×630 Share Card, and browser-native WebM export. A generated Proof Lab publishes 11 live scenario artifacts with their exact sources, three named reader views, 88 artifact checks, and named composition receipts; its preview grid stays static while deliberate proof links play one named chapter once. The landing-page Live Proof Stage promotes three of those generated artifacts into the first bounded motion proof, and the README motion reel carries the same proof-first story onto GitHub without claiming SVG animation support. A question-first scenario guide maps concrete user needs to those 11 bounded recipes across the five modes, with one shared source for CLI and GitHub Pages and direct proof navigation. A unified CLI (`bin/archify.mjs`) wraps guide, render, deliver, validate, check, and examples, with an optional verified post-commit open for interactive local handoff. This file records the design decisions that led there, plus the ideas that were explicitly declined. The original v2.4 / v2.5 backlog (export-scale URL param, color-blind palette, gzip+base64 share links) was considered and dropped — see [Not planned](#not-planned) for the rationale on each.

The latest onboarding slice adds Verified Open. `archify deliver ... --open` invokes only the exact absolute final HTML after every renderer, checker, receipt, and atomic-commit gate has passed. macOS, Linux, and Windows use bounded argument-array openers with no shell interpolation. Unsupported, missing, timed-out, or failed openers leave the verified delivery successful, preserve one-object JSON stdout, record a truthful `open.status`, and print the manual absolute path to stderr. The option is off by default and adds no viewer mutation, server, watch process, dependency, network, storage, schema, renderer, layout, export, or mobile surface.

The previous export slice added a canonical 1200×630 Share Card PNG for README, release, social, and launch previews. It contains the complete diagram without crop, uses the reader's current theme and visual preset, fits title and subtitle into fixed card chrome, and removes all temporary viewer state through the existing canonical serializer. Exact dimensions, bytes, and canonical state are recorded in the export receipt; the image makes no validation claim. Real wide-architecture and tall-sequence pixel gates reject blank or malformed cards without adding a server, dependency, schema, layout, storage, or dedicated mobile surface.

The previous stability slice added Atomic Verified Delivery. `archify deliver` writes the selected renderer into a unique same-directory candidate, applies all existing artifact and composition checks, builds an exact byte/SHA-256 receipt, and uses one rename as the only commit point. Input, prepare, render, check, receipt, and commit failures return named machine-readable stages, remove the candidate, and preserve any previous artifact byte-for-byte. Installed skills without `node_modules` retain the same contract across all five modes. Existing iteration commands remain compatible, while schema, renderer geometry, viewer behavior, dependencies, network, storage, exports, and mobile scope remain unchanged.

The previous visual slice added Live Visual Style Try-on. Every ordinary generated artifact can cycle Classic, Signal Flow, and Blueprint with one compact toolbar control or <kbd>S</kbd>; the document root and canonical SVG change in lockstep, so the reader can export the deliberately selected treatment while node and relationship geometry stays byte-identical. The authored preset remains the reload default, and embed/print remain control-free. No preference storage, URL state, source mutation, schema, layout algorithm, dependency, fourth style, or dedicated mobile surface was added. A same-topology cross-preset regression turns the useful Fireworks style-matrix idea into a stability gate rather than a catalogue-expansion excuse.

The previous renderer slice added an Ambiguous Relationship Corridor Gate across all five modes. It identifies unrelated orthogonal relationships that share at least 8px of the same lane—the geometry that can visually invent a merge or branch—while preserving shared-endpoint fan-out/merge, point touches, and shorter overlaps. `standard` emits exact relationship/segment/coordinate warnings; `showcase` rejects the same evidence before write and in the final artifact check. Two canonical routes moved to clear outer rails, Gallery now reports 88/88 checks with zero corridor debt, and the change adds no heuristic rerouting, schema, layout algorithm, dependency, or mobile surface.

The previous visual slice added Semantic Story Carrier to every unambiguous forward/reverse Story Beat. Story now deduplicates compiled path and label fragments by stable authored edge key, so one labeled relationship remains one relationship instead of falsely becoming `multiple`. The existing finite 780ms Story pulse reuses the same call, data, event, security, and lifecycle-state token vocabulary as exact-edge Relationship Preview, following only the real authored source-to-target geometry in a viewer overlay above edges and below nodes. Generation-owned cleanup rejects stale animation callbacks. Ordinary desktop artifacts and explicit `?play=1` shares may show it; passive embeds, Still, reduced motion, hidden/print state, and canonical/raster export remain static. This adds no new animation owner, schema, IR, renderer layout, dependency, authored geometry, or mobile product surface.

The previous visual slice added Semantic Flow Tokens to exact-edge Relationship Preview. Five compact inline SVG cues distinguish calls, data, events, security boundaries, and lifecycle state changes while following the real authored path/line/polyline in source-to-target direction. Classification is deterministic from compiled edge variants and renderer-owned endpoint kinds, with no label matching or new author field. The cue shares the established 1.2-second finite preview owner and cleanup, inherits Classic / Signal Flow / Blueprint plus light/dark tokens, yields to Still and reduced motion, and never enters canonical export. This borrows Fireworks' useful path-following motion principle without introducing another animation system, product-specific icon catalogue, schema surface, or mobile product work.

The previous visual slice added Semantic Sigils across all five typed renderers. Every primary node now carries one quiet inline SVG role stamp derived only from its existing semantic kind: component roles use window, brackets, cylinder rings, cloud, shield, transit rails, and external-portal cues; lifecycle roles use start, pulse, hourglass, check, cross, and neutral-state cues. Sigils inherit the existing preset/theme tokens, stay static under trace motion, survive canonical export, and add no brand asset, product matcher, schema field, layout box, focus target, dependency, network request, or interaction owner. This adopts the useful semantic-shape lesson from `fireworks-tech-graph` without copying its vendor icon catalogue or multiplying Archify's three visual presets. The product remains desktop-first; mobile is a containment fallback, not a dedicated optimization surface.

The previous renderer slice added Readable Route Rhythm on top of Clear Container Corridor, Clean Flow, and profile-aware crossing receipts. Instead of copying one minimum segment length blindly, it classifies source/target stubs and interior turns after duplicate/collinear waypoint normalization. In `showcase`, any route segment below 8px and any interior segment below 16px fails both before write and in the final artifact check; `standard` preserves the same exact relationship/segment/coordinate evidence as warnings. Endpoint stubs from 8–15px stay legal for fixed swimlane gaps, while bend and Manhattan-stretch budgets remain neutral until route-role calibration is trustworthy. Three real routes lost cramped hooks, Event Stream's dead-letter path fell from five bends to three, and Gallery now reports 77/77 checks with zero micro or short-interior segments.

The previous renderer slice added a Clear Container Corridor invariant on top of Clean Flow and profile-aware crossing receipts. Typed architecture boundaries, workflow lanes/groups, data-flow stages, and sequence segments are checked both before write and against exact final SVG primitives: a relationship may cross a frame perpendicularly but cannot run collinearly on its border in either profile. Lifecycle separators remain non-container reading guides. Two canonical routes moved into open corridors, and the receipt records normalized bend/stretch/short-segment metrics as evidence.

The previous viewer slice adds Story Shelf. A guided artifact's untouched overview now keeps its compact `Guided views` identity, Play, and every named chapter visible in one canvas-first shelf, while inactive Previous/Next, Copy moment, Show all, and generic instructional copy no longer occupy a full Director. The existing `data-active-view="all"` state is written before the panel appears; chapter activation, Play, or valid deep-link restoration expands the complete established Director, and Show all/Escape returns to the shelf. The measured workflow panel falls from about 128px to 55px at 1280×720 and 172px to 107px at 390×844, moving the mobile diagram start from roughly y=389 to y=324 with no page overflow. Play and chapter controls retain 44px targets and logical DOM order. The slice adds no panel, disclosure control, state variable, storage, schema, IR, renderer branch, dependency, motion owner, canonical SVG, or export state.

The previous viewer slice added Settled Flow. A normal trace artifact runs one finite ambient edge/node pass, then permanently settles for that document generation and returns every relationship to its authored solid, security, or async dash style. The reader never has to watch an architecture diagram loop forever, and switching `Still` back to `Live` does not replay decorative motion. Story, Route, Lens, previews, embeds, hidden pages, and reduced-motion remain stronger owners; long graphs cap only visual delay, never semantic order. Canonical SVG and raster exports remain static, while the isolated WebM clone explicitly receives the repeatable finite timeline it records. The slice adds no schema, IR, renderer branch, layout, control, or dependency.

The previous product slice added a First-fold Proof Aperture to the GitHub Pages hero. It preserves the full bilingual promise, both 44px calls to action, three explicit proof identities, validation receipts, stable authored views, and 500–610px / 400px proof canvases, but removes accumulated empty rhythm so real diagram topology is already visible before the first scroll at the measured 1280×720 and 390×844 viewports. The eager iframe begins on the same settled named view; a one-shot Intersection Observer requests the existing finite story only after at least 88 real canvas pixels are visible, then disconnects. Deliberate tab choices may play once, while reduced-motion and no-Observer readers keep a fully usable static proof. Normal document flow, keyboard order, one bounded motion owner, Gallery/Guide/README artifacts, schema, IR, renderer geometry, dependencies, print, and canonical export remain unchanged.

The previous viewer slice added Story Horizon. Every non-final Story Beat now distinguishes the one immediate authored next stop from farther pending story state. The next node receives a restrained static opacity/saturation treatment; exact forward, reverse, and multiple connectors reuse their already-resolved beat membership, while grouped transitions deliberately preview no connector. The Director Strip names the same next stop without adding a row, mobile adds no chrome, final beats clear it, and rapid navigation atomically replaces stale state. Story Follow remains the only camera owner. Still/reduced motion preserve the static hierarchy, and ordinary embeds, print, canonical export, schema, IR, layout, dependencies, storage, authored geometry, labels, markers, and dash semantics retain their existing boundaries.

The previous viewer slice added Story Director Strip. Every active Story Beat receives one stable HTML caption derived only from the exact previous/current node identities, authored edge labels, and current node responsibility/context. Forward, reverse, multiple, and grouped transitions reuse Story Beat's fail-closed semantics; autoplay is not live-announced, while paused/manual/exact-link states are polite. Desktop Presentation playback keeps Previous, Next, and Pause but temporarily removes secondary story chrome, reducing the proof's guided surface from about 155px to 82px and returning roughly 16% more vertical space to the diagram. Pause restores the complete trail, actions, and chapter rail. Still/reduced motion, mobile, ordinary embeds, print, canonical export, schema, IR, renderer layout, dependencies, storage, and authored geometry retain their existing boundaries.

The previous viewer slice added Story Follow Camera. Reader-started Story playback and direct beat activation reuse the existing Semantic Camera to frame the exact previous/current/next authored window with a 320ms finite move, 64px padding, a 1.65× cap, and at least 1100ms dwell per beat. The cold open stays stable; manual navigation wins immediately; exact `#view=&beat=` links restore as paused instant frames; ordinary embeds do not acquire a foreground clone. Still/reduced-motion readers keep instant manual inspection but automatic Play is explicitly unavailable. The feature adds no panel, schema, IR, dependency, renderer layout, authored geometry, storage, or export residue.

The previous viewer slice added Route Journey. A completed Route Probe retains its full route as context while native path buttons and Previous, Next, Journey/Pause/Replay, and Overview controls let readers inspect one ordered position at a time. Each later position owns the exact existing incoming edge from `activeEdges[index - 1]`; explicit finite playback preserves remaining dwell, uses the existing Semantic Camera, and yields immediately to reader navigation, Guide, hidden/print state, Motion Still, and reduced motion. Layered Escape pauses, restores Overview, then clears. The durable URL remains the endpoint question only and restores without autoplay; manual inspection works in Still mode. Mobile, embed, print, export, schema, IR, layout, dependencies, storage, and canonical authored geometry keep their established boundaries.

The previous viewer slice added Stable Relationship Links. Each typed relationship array accepts an optional author-controlled `id`, and the renderers preserve it as canonical `data-edge-id` beside the private source-order runtime key. Pinning a named relationship writes and copies `#relation=<relationship-id>`; restoration resolves that identity back to the exact authored source, path, target, and Lens receipt even after the array is reordered. Duplicate authored IDs fail closed. Existing ID-less documents stay valid, their pins remain local, and Copy falls back to the source node rather than publishing an unstable number. Runtime hit rails and animation clones remove the durable ID, while ordinary embeds, print, raster/WebM export, layout, dependencies, storage, authored geometry, and visible stroke width keep their established boundaries.

The previous viewer slice added Direct Relationship Pin. Every unique authored relationship receives one viewer-only semantic button over a 24px non-scaling transparent clone of its exact path geometry. Fine-pointer hover and roving keyboard focus preview the real edge and endpoints; click, tap, Enter, or Space opens the source Passport and pins the exact existing Relationship Lens row. Only one relationship enters the page Tab order, arrows/Home/End traverse the rest, and `aria-pressed` exposes durable state without changing its accessible name. Re-activation, background, Clear, or Escape removes the pin. Conflicting duplicate metadata fails closed, nodes remain above the hit layer, and stronger Focus/Story/Route/Lens/Chapter states retain ownership. ID-less pins remain intentionally local until an author opts into the stable-ID contract.

The previous viewer slice added Shareable Story Moment. Once a reader pins a Story Beat, one compact `Copy moment` action creates `#view=<view-id>&beat=<stable-node-id>`. Restoration waits for the winning Shared Anchor Handoff, rechecks both identities, and then pins the exact node without pulse, autoplay, focus theft, or URL churn. A missing, stale, or cross-chapter beat fails closed to the valid chapter. Copying during playback pauses at the visible beat and strips `play=1`; only an explicitly authored `?play=1` URL continues from the linked beat through the remaining stops. Static embeds reuse Share Chapter Cue as a `Pinned` receipt. The contract adds no numeric beat index, viewport snapshot, editor state, storage, schema, IR, dependency, server, authored SVG, or export residue.

The previous viewer slice added Story Beat Navigator. All 150 resolved stops across the current 33 Proof Lab chapters are native, directly activatable controls with exact position, node identity, relationship truth, focus treatment, and `aria-current="step"`. Only the exact stable-ID edge(s) between consecutive authored stops count: one forward edge, one reverse edge, no direct edge, or multiple/bidirectional edges become explicit `forward / reverse / group / multiple` states. Manual click, tap, Enter, or Space pins one beat without mutating the chapter, focus set, camera, scroll, URL, layout, or graph; focus alone pauses at the existing playhead. One unambiguous edge may run one finite signal in Live, while grouped/multiple steps and Still/reduced-motion readers retain static truth. Playback now uses one generation-owned scheduler, resumes the remaining dwell after pause, waits for Shared Anchor Handoff before starting the destination chapter, and rejects stale callbacks. Mobile contained scroll, Presentation, ordinary embeds, print, canonical SVG/raster/WebM export, schema, IR, renderer layout, dependencies, and authored geometry retain their established boundaries.

The previous viewer slice added Chapter Delta Preview. One normalized stable-ID set helper now powers both preview and Handoff: `stay = current ∩ candidate`, `enter = candidate − current`, and `leave = current − candidate`, preserving authored order and rejecting duplicate or missing IDs. The current chapter keeps its stop count while every candidate exposes compact `= / + / −` evidence with expanded accessible words. Fine-pointer hover and keyboard focus apply a static comparison to existing nodes only; `activeIndex`, committed focus, Story Trail/Beat, camera, diagram scroll, URL, `aria-current`, and `aria-pressed` remain unchanged. Escape dismisses in place, touch keeps first-tap activation, deliberate preview pauses Story without auto-resuming, latest pointer/focus intent wins, and stronger transient tools defer rather than get cleared. The current 11-proof corpus contains 22 adjacent moves: 19 share at least one real ID and 3 truthfully show `=0`. Still, reduced motion, mobile 44px rail geometry, Presentation, embed, print, export, schema, IR, layout, dependencies, and canonical SVG remain unchanged.

The previous viewer slice added Shared Anchor Chapter Handoff. A real chapter-to-chapter transition intersects the two authored `focus` lists by stable ID, preserves the current shared Story Beat or latest outgoing shared stop through a 110ms orientation hold, names that continuity in one compact receipt, and settles the existing bounded camera through one 420ms generation-owned transaction. A no-match transition declares `no-anchor`, omits the ring, and never infers continuity from labels, geometry, kinds, or nearby edges. Rapid replacement is last-intent-wins, manual navigation samples the rendered position before taking control, and full-story dwell begins only after the winning handoff settles. Still, live reduced-motion changes, hidden pages, ordinary embeds, print, mobile contained scroll, and canonical exports synchronously reach one complete destination with zero residue. The slice adds no schema, IR, layout, graph copy, runtime dependency, or authored SVG change.

The previous viewer slice added a Motion Governor. Trace-enabled artifacts expose one 44px `Live` / `Still` control whose reader choice persists when storage is available. Automatic pulse, scan, edge, and node loops yield before paint to the strongest Story, Chapter, Route, Lens, Relationship Preview, Intent Trace, Focus, or Legend owner; `Still` resets those signals to complete static meaning, pauses an active story at its exact beat, and never auto-resumes it. Dynamic reduced-motion and page-visibility changes share that stop path, tokenized owner leases reject stale release callbacks, and Route Probe now settles after one finite pass. Static artifacts never start decorative viewer motion, normal embeds remain calm, `?play=1` retains one bounded chapter, and print/canonical/raster export, schema, IR, renderer layout, WebM, and dependencies stay unchanged.

The previous viewer slice added a Named Chapter Rail. Artifacts with `meta.views` expose every authored chapter before playback as a runtime-built navigation list with a two-digit position, exact label, and truthful stop count. Its buttons mirror the existing `activeIndex`, delegate activation to the established guided-view controls, and offer roving Left/Right/Home/End focus that pauses playback without changing the diagram. Current/before/after remain distinct without color; phones get 44px horizontal snap targets and immediate active centering without page overflow. Embed, print, canonical exports, schema, IR, renderer layout, and dependencies stay unchanged.

The previous viewer slice added a Selective Semantic Legend Bridge. Architecture, workflow, and lifecycle legend rows become counted Semantic Lens entrances only when each row maps exactly to one compiled node kind. Fine-pointer hover and keyboard focus provide a static soft preview; click, tap, Enter, or Space pins the kind through the existing Lens. Sequence and data-flow legends remain static because their rows encode edge variants or mixed semantics. Runtime-derived counts, roving keyboard navigation, non-color selected cues, stronger-owner arbitration, and strict embed/print/export cleanup add no schema, IR, renderer layout, graph copy, or dependency surface.

The previous viewer slice gave Relationship Preview an exact-edge Directional Flow Pulse. Entering a named relationship row with a fine pointer or keyboard plays one 1.2-second signal from the authored source to target over only that stable-keyed path, then leaves the existing static edge and endpoint emphasis readable. Incoming and bent paths retain authored direction; touch stays direct; live reduced-motion changes, replacement, cancellation, page hiding, embed, print, and export all cleanly suppress or remove the runtime clone. The interaction adds no replay control, schema, IR, renderer layout, dependency, timer loop, or canonical geometry.

The previous viewer slice turned the counted two-kind Semantic Lens into a deliberate Semantic Flow view. It preserves one topology and one geometry, uses soft emphasis rather than hard filtering, reports exact single-kind traffic or direct cross-kind direction counts, and overlays direction only on exact matched authored paths after selection. Preset-specific styling, a 24-edge density guard, reduced-motion fallback, stable `#lens=` state, and strict embed/print/export cleanup keep the feature outside schema, IR, renderer layout, dependencies, and canonical SVG.

This roadmap was rewritten on 2026-04-16 after three independent design reviews, and updated the same day after a visual-quality validation experiment conclusively failed (see `experiments/v3-mermaid-validation/RESULT.md`).

---

## JSON IR for coordinate stability

### What

Archify uses JSON intermediate representations to capture each diagram's semantic graph and stable layout inputs so Claude can make targeted edits without regenerating the entire HTML. **Mermaid is not a first-class parser target** — the validation experiment showed that auto-layout + archify CSS is not meaningfully better than stock Mermaid. Mermaid input is handled via SKILL.md prompt engineering: user pastes Mermaid, Claude reads the structure and lays out from scratch.

### Why this shape (and not the original "diagram.yaml" plan)

Three independent reviews converged on:

1. **Auto-layout (dagre / elk-js) is a dead end for archify.** The aesthetic — Auth Provider floating outside the AWS region, S3 deliberately below CloudFront to imply a serving relationship, security-group boundary at exact 30/50 padding, summary cards, legend nested into dead space — *is* the layout decisions. Stripping the human (or Claude) out of layout strips the product of its differentiator. Dagre output of a typical 8-node graph is a uniform rectangular grid; CSS-skinning it gets you only ~30% of the way from "stock Mermaid" to "archify hand-placed."

2. **"Prettier Mermaid renderer" is already taken.** [lukilabs/beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) ships 15 themes (Tokyo Night, Catppuccin, Nord, Dracula…) with 8.1k stars and is growing fast. Mermaid 11.14 itself added Neo / Redux themes + ELK layout + Hand Drawn look. Competing as "the prettier Mermaid library" is uphill. Archify's real moat is *information architecture* (semantic colors per technology, security boundaries, summary cards, deliberate spatial narrative), not just "prettier CSS on top of Mermaid".

3. **JSON beats YAML as the IR format.** LLM-generated YAML has a high "looks right, parses wrong" failure rate due to whitespace sensitivity, and the inline-flow `pos: [40, 80]` / `sublabel: "Redis :6379"` patterns hit YAML quoting gotchas. JSON has unambiguous parsing, native browser `JSON.parse`, mature JSON Schema validation, and is human-readable enough for `git diff`.

### Architecture

```
                                              ┌→ Mermaid output (P4, v3.1+)
                                              │
   Mermaid input  ─┐                          │
                   ├→ IR (JSON) ─→ Claude ────┼→ archify HTML
   Claude direct ─┘                fills      │
                                   coords     └→ PNG / JPEG / WebP / SVG
                                   + classes
```

The "Claude in the loop" property is the moat, not a limitation. Auto-layout libraries see edges and nodes; Claude sees architectural meaning and lays out accordingly.

### IR shape

```json
{
  "schema_version": 1,
  "meta": {
    "title": "agmon",
    "subtitle": "AI agent observability",
    "theme": "dark",
    "viewBox": [1000, 680]
  },
  "components": {
    "claude_code": {
      "type": "external",
      "label": "Claude Code",
      "sublabel": "AI coding agent",
      "pos": [40, 80],
      "size": [140, 60]
    }
  },
  "connections": [
    {
      "from": "claude_code",
      "to": "agmon_emit",
      "label": "hooks (stdin)",
      "variant": "default"
    }
  ]
}
```

Architecture diagrams use a free-coordinate component graph. The typed modes use mode-specific arrays such as workflow lanes/nodes/edges, sequence participants/messages, data-flow stages/flows, and lifecycle lanes/states/transitions. Shared output chrome, theme switching, and export controls still live in the HTML template.

`schema_version: 1` is mandatory from day 1. Validated via JSON Schema. All fields except `schema_version` and the component `type` are optional with documented defaults.

### Phasing (post-experiment, revised)

| Phase | Deliverable | Target |
|---|---|---|
| ~~**Validate**~~ | ~~5-Mermaid blind-rate experiment~~ | **DONE — FAILED** (see below) |
| **P0** | JSON IR + JSON Schema validator + `schema_version` enforcement | **DONE** — shipped for architecture, workflow, sequence, dataflow, and lifecycle, enforced at runtime via ajv |
| **P0.5** | Pure-JS renderers take IR → HTML using the existing template. Coordinates required (no auto-layout). | **DONE** — architecture, workflow, sequence, data-flow, and lifecycle renderers ship in `archify/renderers/` |
| ~~**P1**~~ | ~~Mermaid flowchart parser → IR~~ | **KILLED** — experiment showed auto-layout + CSS is not enough |
| **P2** | Updated SKILL.md teaching Claude to accept Mermaid as input and lay out from scratch (prompt engineering, no parser) | **DONE — 2026-06-11** — implemented in SKILL.md's "Mermaid as an Input Dialect" section |
| ~~**P3**~~ | ~~End-to-end parser pipeline~~ | **KILLED** |
| ~~**P4**~~ | ~~IR → Mermaid output + C4 input~~ | **KILLED** |

### Validation experiment — FAILED (2026-04-16)

The experiment tested whether auto-layout (dagre) + archify CSS (version B) looked meaningfully better than stock Mermaid (version A). 5 real-world Mermaid flowcharts were rendered in three versions (A/B/C), randomized, and blind-rated by the project owner.

**Result:** Owner rated C (archify hand-placed) as good-looking; A and B as both not good-looking. B was not meaningfully better than A. Both pass criteria failed. Full data in `experiments/v3-mermaid-validation/RESULT.md`.

**Takeaway:** archify's aesthetic moat is in Claude's layout judgment (semantic grouping, deliberate spacing, asymmetric placement), not in its CSS. Any path that removes Claude from the layout loop (auto-layout, parser pipeline) strips the product of its differentiator.

### Current status

- The shared viewer now opens every renderer-backed artifact in `MAP`, reveals context at `READ` (125%), and reveals authored fine detail at `FULL` (175%). Semantic interactions override scale only for their exact matches, while print and canonical exports stay complete.
- Architecture, workflow, sequence, data-flow, and lifecycle renderers ship under `archify/renderers/`.
- `schema_version: 1` is documented in `archify/schemas/README.md`; schemas are precompiled with ajv during development and always enforced at runtime by the dependency-free standalone validators shipped with the skill.
- `SKILL.md` documents Mermaid as an accepted input dialect through prompt engineering, not a parser.
- README describes the current install and usage surfaces; the bundled CLI wraps renderer, validate, check, and example-generation commands.
- Generated artifacts expose a factual Diagram Guide over the current artifact's nodes, relationships, views, actions, and shortcuts; stable node identities; optional authored relationship identities with shareable `#relation=` links; a fine-pointer/keyboard Intent Trace that previews one-hop traffic before commitment; Direct Relationship Pin with one accessible target per exact authored relationship; a deterministic two-endpoint Route Probe with searchable valid sources, reachable destinations with hop previews, shareable shortest directed routes, and a finite inspectable Route Journey; searchable node navigation; keyboard-accessible one-hop focus with Semantic Passport context and a copyable deep link; a runtime-built Semantic Radar with live viewport state and stable-ID node activation; up to five typed guided reader views with path-aware Semantic Story Beats; a reduced-motion-aware one-shot share contract with a viewer-only Chapter Cue; a viewport-filling Presentation Stage; Semantic Camera; bounded pan/zoom; and canonical export isolation. `docs/gallery.html` proves these surfaces from checked-in examples.

### Workflow renderer pilot (2026-04-24)

Workflow diagrams became the first concrete test of typed diagram renderers inside Archify. The pilot uses a dedicated `diagram_type: "workflow"` JSON IR with lanes, semantic nodes, anchored edges, route presets, and validation checks for common visual failures such as overlapping nodes, labels on short links, unreadable arrow lengths, and legends outside the viewBox.

This does not reverse the anti-auto-layout decision above. The workflow renderer is intentionally a constrained layout assistant, not a generic graph layout engine: lanes and columns provide stability, while Claude still chooses the semantic grouping, lane order, route intent, labels, and summary cards.

### Sequence renderer pilot (2026-04-24)

Sequence diagrams became the second typed renderer pilot. They use `diagram_type: "sequence"` JSON with participants, time segments, messages, activations, and summary cards. The goal is to explain API call chains, request lifecycles, auth checks, cache fallback, async trace/logging, and return paths with Archify's theme/export shell.

Like workflow, sequence is not a generic auto-layout target. The renderer enforces readable spacing and semantic styling, while Claude still decides which participants matter, how the story is grouped, which messages deserve labels, and which return/async paths should stay quiet.

### Data-flow renderer pilot (2026-04-24)

Data-flow diagrams became the third typed renderer pilot. They use `diagram_type: "dataflow"` JSON with lifecycle stages, semantic nodes, labeled data flows, optional classifications, and summary cards. The goal is to explain analytics pipelines, ETL/ELT, PII isolation, governance boundaries, warehouse sync, derived features, and downstream consumers.

Like workflow and sequence, data-flow is not a generic graph layout engine. The renderer provides stable stage/row placement and validation checks, while Claude still decides which data assets matter, where sensitive boundaries should appear, which paths are primary, and which batch or restricted joins should stay visually secondary.

### Lifecycle renderer pilot (2026-04-24)

Lifecycle diagrams became the fourth typed renderer pilot. They use `diagram_type: "lifecycle"` JSON with lanes, states, semantic state types, routed transitions, transition labels, and summary cards. The goal is to explain state machines for agent runs, tasks, orders, deployments, subscriptions, incident tickets, retries, wait states, cancellation, timeout, and terminal outcomes.

Like the other typed renderers, lifecycle is deliberately constrained rather than fully automatic. The renderer gives stable lane/column placement and validation checks, while Claude still decides which states are worth showing, which transitions should be labeled, and how to separate happy path, waits, and exception recovery.

---

## Not planned

Each item below was considered and explicitly declined. Listed so issue submitters can find prior decision context.

| Idea | Why not |
|---|---|
| **`?exportScale=N` URL parameter** | v2.3 explicitly removed the scale selector because it encouraged users to pick a soft output. Re-adding it — even as URL-only with no UI — is a back door to the same footgun. Users needing smaller raster files can resize externally. |
| **Color-blind-safe palette (Okabe-Ito)** | Maintenance burden — every new component class needs a CB variant — outweighs adoption. The CSS-variable system means downstream forks can roll their own palette in ~30 lines without an upstream change. |
| **gzip+base64 share links** | Requires a long-running hosted decoder page, opens an XSS-via-share-link vector that's hard to fully close even with a separate hostname, and bumps URL length limits on realistic diagrams. The "send a single HTML file" workflow is already friction-free. |
| **Auto-layout (dagre / elk-js)** | Independently flagged by all three v3.0 design reviews as the primary risk to archify's aesthetic. The hand-placed coordinate system *is* the product; automating it is automating away the differentiator. |
| **YAML as the IR format** | LLM-generated YAML has a high "looks right, parses wrong" failure rate due to whitespace sensitivity. JSON is unambiguous, has native browser support, and is sufficient for `git diff` readability. |
| **Mermaid flowchart parser + dagre auto-layout** | Validation experiment (2026-04-16) conclusively showed that auto-layout + archify CSS is not meaningfully better than stock Mermaid. Layout IS the product; removing Claude from the loop strips the differentiator. Mermaid input is instead handled via SKILL.md prompt engineering. |
| **General-purpose graph IR adoption** (Cytoscape JSON / GraphViz DOT / GraphML / Mermaid AST / D2 / C4 DSL) | Each evaluated against archify's actual requirement: hybrid of graph topology + visual layout + non-graph metadata (cards, footer, region boundaries). None covers all three cleanly; the wrappers needed amount to inventing a custom schema anyway. |
| **Annotation / overlay editor mode** | Pushes archify toward being an editor. Positioning is *generator + viewer*, not editor. |
| **Diagram diff UI** | Better delivered as a companion CLI / CI bot than baked into the template. Blocked on `diagram.json` shipping anyway. |
| **PDF export button** | `Cmd+P → Save as PDF` already produces clean output via the v2.2 print stylesheet. No need for a dedicated button. |
| **Dedicated mobile product surface** | Archify is optimized for desktop technical reading, presentation, documentation embeds, and export. Small screens keep a contained basic fallback, but mobile-specific interaction density and layout work are not product acceptance gates. |
| **Font embedding in raster exports** | `local()` fallback (v2.2) covers the common case (developers with JetBrains Mono installed). Full embed adds ~150 KB to every generated HTML file for marginal benefit. |
