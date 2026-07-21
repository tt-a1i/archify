# Archify visual evolution research — round 2

Research date: 2026-07-19 (Asia/Shanghai)

## Executive decision

Archify should absorb **viewer intelligence**, **stable semantic identity**, and
**proof-first presentation** from adjacent projects. It should not absorb their
canvas-editor architecture, diagram-language breadth, or dependency stacks.

The useful product boundary remains:

```text
typed technical-diagram IR
  -> deterministic validation and layout
  -> self-contained HTML/SVG artifact
  -> optional, read-only exploration of that artifact
```

The next best move after Signal Flow and WebM is a stable-ID refinement and
focus contract: agents edit the typed IR by semantic ID while preserving
untouched identity, and readers click or keyboard-focus a node, dim unrelated
elements, expose its immediate relationships, and create a shareable deep link.
This adds the “large diagrams are safely refinable and explorable” benefit
associated with graph canvases without turning Archify into one.

## Round 2 implementation status

The `codex/archify-visual-evolution` branch now implements the first candidate
as a dependency-free viewer contract across all five renderers:

- deterministic node DOM IDs and relationship endpoint hooks;
- SVG-native `<title>` / `<desc>` metadata;
- mouse and keyboard one-hop focus with a shareable `#focus=<id>` URL;
- focus announcements, clear/Escape behavior, and reduced-motion-safe styling;
- 100–300% zoom plus bounded pointer panning;
- export receipts proving that focus and viewport state are removed from the
  canonical downloaded artifact.
- a generated Proof Lab with five live diagram types, exact JSON sources,
  structural-validation receipts, byte sizes, and deterministic SHA-256
  digests; the gallery freshness test fails if any checked-in proof drifts.

The bounded `meta.views` experiment is now implemented across all five typed
renderers. A real workflow fixture proves the contract with three reader paths,
while schema, semantic, geometry-invariance, gallery, zero-install, and browser
checks keep it inside Archify's read-only viewer boundary.

The follow-on [round 3 playback study](research-visual-evolution-round-3.md)
adds a user-triggered, fixed-camera Play/Pause presentation over those existing
views. It keeps the five-view cap and immutable base geometry rather than
growing into a general animation timeline.

## Scope and evidence rules

This comparison uses only official repositories, official documentation, and
source-owned API/package metadata. GitHub popularity figures are a dated
snapshot, not a quality score. The comparison asks what each repository proves
in these areas:

- stable identity and incremental refinement;
- semantic zoom, focus, or multi-level views;
- interactive exploration;
- theming and visible polish;
- export and sharing;
- accessibility;
- example/showcase quality;
- deterministic layout or rendering;
- no/low-dependency delivery.

The seven repositories were active near the research date. Current metadata can
be refreshed from their first-party GitHub API endpoints:

| Repository | Snapshot stars | Primary role | Strongest relevant lesson |
|---|---:|---|---|
| [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) | 8,871 | Agent Skill + SVG toolchain | Proof-first showcase and scenario contracts |
| [`xyflow/xyflow`](https://github.com/xyflow/xyflow) | 37,696 | React/Svelte node-canvas library | Accessible focus and contextual zoom |
| [`cytoscape.js`](https://github.com/cytoscape/cytoscape.js) | 11,101 | Interactive graph analysis/viewer | Selector-driven focus and graph neighbourhoods |
| [`AntV G6`](https://github.com/antvis/G6) | 12,191 | Graph visualization engine | Focus behaviours and zoom-dependent information density |
| [`D2`](https://github.com/terrastruct/d2) | 24,714 | Text-to-diagram compiler | Layers, scenarios, steps, and export composition |
| [`Mermaid`](https://github.com/mermaid-js/mermaid) | 89,307 | Embeddable text-to-diagram library | Accessibility metadata and deterministic seeds |
| [`elkjs`](https://github.com/kieler/elkjs) | 2,660 | Layout engine | Port-aware hierarchical layout as a separate concern |

Sources: [fireworks API](https://api.github.com/repos/yizhiyanhua-ai/fireworks-tech-graph),
[xyflow API](https://api.github.com/repos/xyflow/xyflow),
[Cytoscape.js API](https://api.github.com/repos/cytoscape/cytoscape.js),
[G6 API](https://api.github.com/repos/antvis/G6),
[D2 API](https://api.github.com/repos/terrastruct/d2),
[Mermaid API](https://api.github.com/repos/mermaid-js/mermaid), and
[elkjs API](https://api.github.com/repos/kieler/elkjs).

## Repository findings

### 1. fireworks-tech-graph

What it proves:

- A versioned JSON IR and semantic validation can coexist with a spectacular,
  image-led presentation. The repository exposes diagram schemas, duplicate-ID
  and reference checks, routing/geometry checks, and domain-specific semantic
  contracts rather than relying on visual output alone
  ([schemas](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/main/schemas),
  [semantic contracts](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/semantic_contracts.py),
  [composition contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md)).
- Its README leads with a twelve-style animated proof grid, while exact JSON
  fixtures and example artifacts make the promise inspectable
  ([README](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/README.md),
  [sample assets](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/main/assets/samples),
  [fixtures](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/main/fixtures)).
- Its generated SVG can be wrapped in an offline interactive HTML artifact,
  and the export code sanitizes the SVG before embedding it
  ([interactive exporter](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/export-interactive-html.py),
  [viewer implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/interactive_html.py)).
- Motion is deliberately constrained by semantic roles and scene contracts,
  but its optional GIF path is a substantially heavier stack than Archify's
  browser-native WebM path
  ([motion contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/motion-effects.md),
  [motion implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/motion.py)).

Borrow now:

- proof-first example presentation with exact source-to-output pairs;
- visible structural/visual validation receipts;
- a small number of domain recipes expressed as executable semantic rules.

Borrow later:

- a scenario suitability guide that tells users which Archify renderer and
  visual treatment fits a request.

Skip:

- style-count competition, broad UML claims, mirrored distribution trees, and
  a hard-coded GIF scene engine.

### 2. xyflow / React Flow

What it proves:

- Stable string IDs are foundational model data, not incidental DOM IDs. Nodes
  also carry hidden, selected, focusable, ARIA-role, and DOM-attribute state
  ([Node type](https://reactflow.dev/api-reference/types/node)).
- The viewport API can focus a specified subset of nodes with animated
  `fitView`, `fitBounds`, `setCenter`, and controlled viewport state
  ([ReactFlowInstance](https://reactflow.dev/api-reference/types/react-flow-instance),
  [FitViewOptions](https://reactflow.dev/api-reference/types/fit-view-options)).
- Its example catalogue explicitly includes contextual zoom, save/restore,
  validation, dark mode, stress tests, and download-image recipes. That is a
  strong discoverability pattern even when individual examples are small
  ([official examples](https://reactflow.dev/examples)).
- Accessibility is a product-level surface: nodes and edges are keyboard
  focusable, focused nodes can auto-pan into view, roles are configurable, and
  live instructions/control labels can be localized
  ([accessibility guide](https://reactflow.dev/learn/advanced-use/accessibility)).
- Image download is an example layered on `html-to-image`, not a zero-dependency
  core guarantee; the React package itself requires the system package,
  `classcat`, `zustand`, React, and React DOM
  ([download example index](https://reactflow.dev/examples),
  [package manifest](https://github.com/xyflow/xyflow/blob/main/packages/react/package.json)).

Borrow now:

- focus a node by stable ID and fit the view to its neighbourhood;
- keyboard equivalence, localized accessible names, and visible focus state;
- contextual detail: labels/details may become richer when focused without
  changing the underlying diagram.

Borrow later:

- save/restore of read-only viewer state if deep links prove useful.

Skip:

- drag, resize, connect, lasso, whiteboard, collaborative editing, and a React
  runtime. Those solve canvas-authoring problems outside Archify's boundary.

### 3. Cytoscape.js

What it proves:

- A graph can be fully serialized/deserialized as JSON, queried by stable IDs
  and selectors, styled from data, and operated headlessly or interactively
  ([official API](https://js.cytoscape.org/)).
- `cy.center(collection)`, `cy.fit(collection)`, graph traversals, selectors,
  classes, and graph events form a compact “focus this neighbourhood” model.
  Pinch zoom, box selection, pan, tap selection, and animated viewport changes
  are all first-class but independently switchable
  ([viewport, events, traversal, and style API](https://js.cytoscape.org/)).
- The library supports PNG/JPEG output and JSON state, while a `preset` layout
  preserves supplied positions. Layout algorithms are selected explicitly
  rather than being entangled with graph identity
  ([core/export/layout API](https://js.cytoscape.org/)).
- The published package currently declares no runtime dependencies and ships
  direct UMD, ESM, and CommonJS builds
  ([package manifest](https://github.com/cytoscape/cytoscape.js/blob/unstable/package.json),
  [distribution documentation](https://js.cytoscape.org/)).
- Its default visual renderer uses the browser Canvas API. That enables large,
  rich graphs, but Canvas does not itself give Archify the semantic DOM and
  screen-reader surface that its SVG output can preserve
  ([official renderer note](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)).

Borrow now:

- graph-neighbour focus semantics: selected node + incoming/outgoing edges +
  adjacent nodes, with unrelated content visually muted;
- separate immutable model coordinates from viewport position;
- keep interaction capabilities independently switchable.

Borrow later:

- a minimap or graph search only after real examples exceed comfortable
  single-screen navigation.

Skip:

- replacing SVG with Canvas, graph-analysis breadth, extension ecosystems, and
  general-purpose selection/editing.

### 4. AntV G6

What it proves:

- Exploration is composable behaviour, not an editor monolith. G6 exposes
  focus-element, hover-activate-neighbours, collapse/expand, drag canvas, zoom,
  and fixed-element-size behaviours as individually configured capabilities
  ([behaviour catalogue](https://g6.antv.antgroup.com/en/manual/behavior/overview),
  [focus-element](https://g6.antv.antgroup.com/en/manual/behavior/focus-element),
  [fix-element-size](https://g6.antv.antgroup.com/en/manual/behavior/fix-element-size)).
- Viewport operations include pan, zoom, fit, focus, and coordinate conversion,
  while export can target the current viewport or full graph
  ([viewport API](https://g6.antv.antgroup.com/en/api/viewport),
  [image export](https://g6.antv.antgroup.com/api/export-image)).
- Its extension surface includes minimaps, fisheye, tooltips, history, timebars,
  and edge bundling. That is useful evidence about mature graph-viewer needs,
  but also evidence that the full engine is much broader than Archify needs
  ([plugin overview](https://g6.antv.antgroup.com/en/manual/plugin/overview),
  [official examples](https://g6.antv.antgroup.com/en/examples)).

Borrow now:

- keep focus, hover, zoom, and fit as separately switchable viewer behaviours;
- semantic zoom should preserve the main label and line weight while delaying
  secondary labels and decoration until the user is close enough.

Borrow later:

- minimap, fisheye, and collapse/expand only after large real-world fixtures
  prove that focus and progressive detail are insufficient.

Skip:

- embedding G6 or its plugin ecosystem. Archify can implement the small,
  read-only subset with its existing semantic SVG and vanilla browser runtime.

### 5. D2

What it proves:

- A compiler can treat multi-view storytelling as a semantic model. `layers`
  start new abstraction boards, `scenarios` inherit from the base board, and
  `steps` inherit from the previous step
  ([composition model](https://d2lang.com/tour/composition/)).
- Layers can be linked to objects to create drill-down navigation, scenarios
  can modify the emphasis of a stable base diagram, and nested imports keep
  multi-level diagrams maintainable
  ([layers](https://d2lang.com/tour/layers/),
  [scenarios](https://d2lang.com/tour/scenarios/),
  [nested composition](https://d2lang.com/tour/nested-composition/)).
- Compositions export as organized SVG sets, animated SVG/GIF, PDF, or PPTX;
  the documentation explicitly warns that too many animated boards confuse
  viewers. This is a valuable restraint, not just a format list
  ([composition export formats](https://d2lang.com/tour/composition-formats/)).
- Interactive tooltips and links remain meaningful in static exports because
  D2 can add a numbered appendix when the target medium cannot preserve the
  interaction. That is a useful graceful-degradation pattern
  ([interactive diagrams](https://d2lang.com/tour/interactive/)).
- D2 separates compiler, renderer, theme, and layout-engine choices. It bundles
  Dagre and ELK and supports a watch loop; SVG remains the default CLI artifact
  ([repository README](https://github.com/terrastruct/d2),
  [exports](https://d2lang.com/tour/exports/),
  [ELK integration](https://d2lang.com/tour/elk/)).
- Its CLI can bundle assets into SVG, target a specific board, validate source,
  and salt generated IDs when identical diagrams share a document
  ([CLI manual](https://d2lang.com/tour/man/)).

Borrow now:

- the conceptual split between an overview, alternate scenario, and ordered
  walkthrough; use it to shape Archify recipes and examples.

Borrow later:

- a small `views`/`steps` contract that references existing typed IDs and only
  changes emphasis, explanation, and viewport—not geometry or node ownership.

Skip:

- a new textual language, multi-layout plugin system, PPTX/PDF breadth, and
  proprietary-layout adjacency.

### 6. Mermaid

What it proves:

- A rendering library can make SVG identity reproducible. Mermaid exposes
  deterministic IDs and an optional deterministic ID seed; current architecture
  diagrams also expose a layout seed specifically to stabilize visual regression
  tests
  ([deterministic ID seed](https://mermaid.js.org/config/schema-docs/config-properties-deterministicidseed.html),
  [configuration schema](https://mermaid.js.org/config/schema-docs/config.html)).
- Themes have a small named set plus a `base` theme whose variables can be
  customized per site or per diagram. Derived colors attempt to preserve
  readability when a primary color changes
  ([theme configuration](https://mermaid.js.org/config/theming)).
- Accessible titles and descriptions are diagram syntax and are inserted into
  the resulting SVG; the rendered artifact does not have to rely on an outer
  page label alone
  ([state diagram accessibility example](https://mermaid.js.org/syntax/stateDiagram),
  [renderer accessibility contract](https://mermaid.js.org/community/new-diagram)).
- Node click/link behaviour is gated by an explicit security level, with
  `strict` disabling click functionality and `sandbox` isolating rendering
  ([usage and security levels](https://github.com/mermaid-js/mermaid/blob/develop/docs/config/usage.md)).
- Mermaid is embeddable through ESM/CDN and offers a smaller “tiny” build, but
  the full package has a broad runtime dependency graph. Archify should copy
  its contracts, not embed it
  ([usage guide](https://github.com/mermaid-js/mermaid/blob/develop/docs/config/usage.md),
  [package manifest](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/package.json)).

Borrow now:

- deterministic DOM/SVG identity as a testable output contract;
- `<title>` and `<desc>` generated from typed metadata;
- an explicit trust boundary for any future external links or click actions.

Borrow later:

- narrowly scoped theme variables if two production presets expose repeated,
  user-meaningful customization needs.

Skip:

- diagram-type breadth, parsing a Markdown-like language, and the full runtime
  dependency graph.

### 7. elkjs / Eclipse Layout Kernel

What it proves:

- `elkjs` is deliberately only a layout engine: it consumes graph JSON with
  stable node/edge IDs and returns coordinates, bends, ports, and dimensions;
  it provides no rendering, styling, or interaction
  ([official repository and API](https://github.com/kieler/elkjs)).
- The layer-based algorithm is designed for directed node-link diagrams with
  ports and hierarchical nodes. Layout options include model-order influence,
  fixed/no-layout regions, interactive layout, hierarchy handling, direction,
  spacing, and a random seed
  ([ELK overview](https://eclipse.dev/elk/),
  [layout option reference](https://eclipse.dev/elk/reference/options.html)).
- The JavaScript distribution supports Web Workers and ships a browser-ready
  bundled build. Its package declares no runtime dependencies, though the
  bundled layout engine is still materially larger and more complex than
  Archify's current renderer-specific geometry
  ([elkjs usage](https://github.com/kieler/elkjs),
  [package manifest](https://github.com/kieler/elkjs/blob/master/package.json)).
- The project's own FAQ points to recurring difficulty preserving previous
  layout results during dynamic or incremental changes. Automatic layout does
  not by itself solve stable editing
  ([elkjs FAQ](https://github.com/kieler/elkjs#faqs-and-recurring-issues)).

Borrow now:

- treat layout options and layout evidence as a separate, typed concern;
- add deterministic regression fixtures before considering a new engine.

Borrow later:

- run a bounded ELK spike only for a renderer and fixture family that current
  routing demonstrably cannot handle, especially nested ports/containers.

Skip:

- adopting ELK as the universal layout engine. It would weaken renderer-specific
  judgment and make a large dependency pay rent before a proven need exists.

## Cross-repository comparison

| Capability | Best evidence | Archify interpretation |
|---|---|---|
| Stable IDs | React Flow node IDs; Cytoscape JSON IDs; Mermaid deterministic seeds | Keep typed IR IDs stable and emit deterministic semantic hooks into SVG/HTML |
| Semantic zoom/focus | React Flow contextual zoom; G6 fixed element size; Cytoscape collection fit; D2 linked layers | Add read-only focus and progressive detail first; multi-board drill-down later |
| Interactive exploration | Cytoscape events/selectors; React Flow viewport/keyboard APIs; G6 behaviours | Neighbour focus, fit, reset, keyboard access; no mutation tools |
| Theming | fireworks style proof; D2 theme catalogue; Mermaid theme variables | Keep a tiny curated preset set; add a preset only when it changes comprehension |
| Export/share | D2 compositions; fireworks offline HTML; Cytoscape images/JSON | Preserve self-contained HTML as primary; keep SVG/raster/WebM derived exports |
| Accessibility | React Flow keyboard/ARIA; Mermaid SVG title/description | Semantic SVG, visible focus, keyboard parity, reduced motion, and useful descriptions |
| Gallery | fireworks sample grid; React Flow example index | Generate a proof gallery from versioned inputs and golden artifacts |
| Determinism | Mermaid seeds; ELK options; Cytoscape preset positions | Deterministic IDs and layout fingerprints before adding an auto-layout engine |
| Low dependency | Cytoscape/elkjs direct bundles; D2 binary | Prefer vanilla HTML/SVG enhancements; do not embed a framework or graph runtime |

## Borrow now / later / skip

### Worth borrowing now

1. **Stable-ID refinement contract.** Every rendered semantic node and
   relationship should have a deterministic hook derived from typed IR, not
   render order. Agent-driven edits must target the current IR by ID, reject
   collisions/dangling references, and preserve untouched IDs.
2. **Accessible focus explorer.** Click, Enter/Space, or a deep link focuses a
   node; unrelated content dims; adjacent nodes and edges remain prominent;
   Escape restores the whole diagram.
3. **Progressive information density.** Keep primary labels and structural
   lines legible at overview scale; reveal secondary labels and decoration when
   focused or zoomed in.
4. **Proof gallery.** Show source request/JSON, dark/light stills, motion where
   meaningful, and validation status for a small set of excellent scenarios.
5. **SVG-native description.** Generate `<title>` and `<desc>` from diagram
   metadata and provide useful, localized controls and focus announcements.
6. **Determinism tests.** Assert stable semantic hooks and a geometry/layout
   fingerprint for unchanged input.

### Worth borrowing later, after usage evidence

1. A typed `views` or `steps` collection that references existing node IDs and
   changes emphasis/explanation without mutating base geometry.
2. Search or a minimap for genuinely large diagrams.
3. A renderer-specific ELK spike for nested/port-heavy graphs that current
   deterministic layout cannot express.
4. A small theme-token surface only if users repeatedly need branded variants.

### Skip

1. A draggable canvas editor or persisted pixel-editing model.
2. React, a graph runtime, or ELK embedded into every self-contained artifact.
3. Broad UML/style-count competition.
4. Arbitrary scriptable click actions without an explicit trust boundary.
5. Random or force layouts in the default rendering path.
6. Heavy animation pipelines when browser-native, semantic motion is enough.

## Ranked implementation candidates

### 1. Stable-ID Refinement + Focus Explorer

**Value: very high. Risk: low to medium. Recommended first.**

Contract:

- refine the current JSON IR by exact semantic ID rather than reconstructing a
  diagram from labels or render order; revalidate all references after a patch;
- preserve untouched semantic IDs across label, style, and routing refinements;
- emit deterministic `data-node-id`, relationship endpoints, and stable DOM IDs
  from the typed IR;
- clicking or pressing Enter/Space on a node selects it;
- selected node, incoming/outgoing edges, and immediate neighbours stay at full
  prominence while unrelated content dims;
- update the URL with `#node=<encoded-id>` and restore focus on reload;
- `Escape` or a “Show all” control resets focus;
- announce the selected label and relationship counts through a polite live
  region; preserve visible keyboard focus and reduced-motion behaviour;
- export continues to serialize the canonical full diagram, not temporary
  viewer state, unless an explicit “export focused view” is added later.

Why this ranks first: it combines React Flow's accessible focus, Cytoscape's
neighbour semantics, and D2's linked navigation while remaining vanilla SVG/JS
inside the current artifact.

Verification path:

1. Unit-test stable hooks across all five renderers and render the same input
   twice to prove identical IDs.
2. Patch one node label and one relationship by semantic ID; prove unrelated
   node/edge IDs and geometry remain unchanged and invalid targets fail closed.
3. Browser-test mouse, Enter, Space, Escape, invalid hash, valid hash, reload,
   and back/forward navigation.
4. Assert only the selected one-hop subgraph remains prominent and that focus
   never becomes trapped.
5. Inspect dark/light, Signal Flow/classic, mobile viewport, reduced motion, and
   static/motion diagrams.
6. Export SVG/PNG/WebM after focusing and prove the canonical artifact remains
   valid and non-empty.

### 2. Generated proof gallery with validation receipts

**Value: high. Risk: low. Recommended immediately after the explorer.**

Contract:

- select six to eight excellent, distinct scenarios rather than adding diagram
  types: agent tool call, cache miss, product analytics dataflow, deployment,
  lifecycle/retry, and one reliability/event-flow case;
- each gallery entry links the exact JSON IR, self-contained HTML, dark/light
  stills, and WebM only where motion conveys sequence;
- generate gallery metadata from versioned examples, including renderer,
  preset, animation availability, structural validation result, artifact check,
  and package version;
- never hand-author claims that can drift from generated artifacts.

Why this ranks second: fireworks demonstrates that users judge visible proof
before architecture. This candidate improves adoption without increasing
runtime complexity.

Verification path:

1. Regenerate gallery artifacts in one command and fail on dirty/untracked
   expected output.
2. Check every source link and artifact path, validate HTML/SVG, and assert that
   advertised capabilities match metadata.
3. Browser-test gallery navigation, image dimensions, dark/light legibility,
   mobile layout, and download links.
4. Add a small visual-regression screenshot set for the hero scenarios.

### 3. Typed guided views (`meta.views`) — implemented

**Value: high. Risk: controlled by a five-view cap and immutable geometry.**

Proposed bounded shape:

```json
{
  "meta": {
    "views": [
      {
        "id": "tool-roundtrip",
        "label": "Tool roundtrip",
        "focus": ["agent", "tool-gateway", "tool"],
        "note": "Request, execution, and result path"
      }
    ]
  }
}
```

Rules:

- views only reference existing semantic IDs;
- views cannot add, move, resize, or restyle nodes and edges;
- each view is a named focus set with explanation and optional order;
- viewer controls can step through views, deep-link to one, and optionally
  record the sequence using the existing browser-native motion path;
- cap the initial contract at five views to avoid D2's documented
  “too many boards confuse viewers” failure mode.

Why this ranks third: it turns animation into explanation and enables D2-like
scenarios without introducing multiple mutable diagrams. The risk is schema and
cross-renderer complexity, so it should remain a spike until real examples prove
that one-hop focus is insufficient.

Verification path:

1. Schema and semantic checks reject duplicate view IDs, dangling focus IDs,
   empty focus sets, and over-limit collections.
2. Golden fixtures prove unchanged base geometry with and without views.
3. Browser-test step controls, keyboard navigation, deep links, history, theme,
   reduced motion, and screen-reader announcements.
4. Record/export one guided view sequence and confirm static exports remain
   useful without JavaScript.

## Final product boundary

The differentiator should become sharper, not broader:

> Archify compiles typed technical intent into a deterministic, validated,
> self-contained diagram that is beautiful at a glance and explorable by
> semantic identity.

That is meaningfully richer than a static compiler output, but still much more
stable, portable, and agent-friendly than a general canvas editor.
