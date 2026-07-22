---
name: archify
description: Create polished, validated architecture, workflow, sequence, data-flow, and lifecycle/state diagrams as explorable standalone HTML with inline SVG, dark/light themes, semantic navigation, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export. Accept plain-language requirements or pasted Mermaid flowchart, sequenceDiagram, and stateDiagram input; inspect repository evidence when the diagram must reflect real code. Use when the user asks to visualize system architecture, infrastructure, cloud/security/network topology, technical workflows, approval or CI/CD flows, API call sequences, request lifecycles, data pipelines, ETL/ELT, data lineage, state machines, or to convert/beautify Mermaid. Prefer typed JSON IR renderers and deterministic validation; deliver static output by default and enable motion only when requested.
license: MIT
metadata:
  version: "2.11"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify Skill

Create professional technical diagrams as self-contained HTML files with inline SVG, a theme toggle, and a built-in image/SVG export menu.

Every renderer-backed diagram ships with a factual Diagram Guide for discovering its current actions and shortcuts, deterministic semantic node hooks, a counted two-kind Semantic Lens with selective inline legend entrances, a fine-pointer/keyboard Intent Trace before committed focus, a two-endpoint Route Probe over authored directed relationships, a searchable Node Finder, keyboard-accessible one-hop focus with a renderer-owned Semantic Passport and copyable deep link, a live Semantic Radar overview, an optional Named Chapter Rail with static Chapter Delta Preview, a native Story Beat Navigator with Story Follow Camera, Story Director Strip, and Story Horizon, and stable Shareable Story Moment links, a reader-controlled Live/Still Motion Governor for trace artifacts, a viewer-only Share Chapter Cue for one-shot embeds, Presentation Stage, dependency-free pan/zoom, a **dark/light theme toggle** (persists in `localStorage`, respects `prefers-color-scheme`), an **export menu** (copy PNG to clipboard; download PNG/JPEG/WebP rasterized natively at up to 4× resolution; download a **dual-theme SVG**; record a trace-enabled diagram to WebM), and a **CSS-variable color system** that keeps both themes consistent. Temporary Diagram Guide, Semantic Lens, legend preview, Intent Trace, Route Probe, finder, focus, radar, Chapter Delta Preview, Story Trail overlays, Story Director Strip, Story Horizon, beat state, guided-view, playback, presentation, motion-owner, and viewport state never changes the canonical full-diagram export.

Reading Depth progressively reveals renderer-owned context and fine detail as the reader zooms, while semantic interactions reveal the exact local facts they need at any scale.

Direct Relationship Pin makes every unique compiled relationship directly operable without changing the authored line. Give important `connections`, `edges`, `messages`, `flows`, and `transitions` an optional author-controlled `id` using the normal identifier pattern; IDs must be unique within their relationship collection. The renderer keeps its numeric `data-edge-key` for runtime de-duplication and emits the author identity separately as `data-edge-id`. At runtime, reject conflicting source/target/label/ID metadata and clone only path/line/polyline geometry into one viewer-owned overlay below nodes. Use a transparent 24px non-scaling stroke for hit testing plus a separate dashed focus rail; keep exactly one relationship button at `tabindex="0"` and move roving focus with all Arrow keys, Home, and End. Fine-pointer hover and keyboard focus reuse exact Relationship Preview transiently. Click, tap, Enter, or Space opens the source Semantic Passport and pins the exact existing Lens row. When the relationship has an authored ID, the pin writes `#relation=<id>`, changes the action to `Copy relation`, and restores the same source, target, label, path, and bounded camera after reordering; stale IDs fail closed. An ID-less legacy relationship remains an in-page pin, keeps `Copy node`, and never exposes its numeric key. The same relationship, a true background activation, Clear, or Escape clears it. `aria-pressed` conveys the pin while the source/target/label name stays stable. Touch never waits for hover, nodes win near endpoints, panning never activates a relation, and stronger Focus, Story, Route, Semantic Lens, Chapter, and embed states take priority. Do not add another panel, toolbar action, dependency, storage, or authored geometry. Remove all hit, pin, preview, and pulse state from embed, print, and canonical export; preserve the authored `data-edge-id` as semantic SVG identity.

## Setup

No dependency installation is required. The distributed skill includes standalone validators compiled from all five JSON Schemas, so schema and layout validation work immediately after installation. The generated HTML and the renderer runtime are both dependency-free.

Run `node bin/archify.mjs doctor` to verify an installation. Run `node bin/archify.mjs demo [output-directory]` to generate a ready-to-open example before creating the first custom diagram.

If you have no shell access at all (e.g. the skill was added as project knowledge), fall back to architecture mode for every request: hand-place SVG into `assets/template.html` following the Design System below, and run the self-review checklist before delivering.

## Choosing a Diagram Type

When the request is ambiguous, run `node bin/archify.mjs guide "<the user's scenario>"` before choosing a renderer. The bundled zero-dependency guide selects one of 11 bounded scenario recipes and returns the question answered, when to use or avoid it, required evidence, presentation settings, and a copy-ready prompt. `--json` provides the same contract for automation, and `--lang en|zh` overrides language detection. Use the recommendation as a starting point, then verify it against the user's actual question and repository evidence.

Every bundled scenario recipe is backed by a checked-in, validated example in `examples/` and a generated Proof Lab card. Use those examples as structural references rather than copying their domain facts. When changing a recipe or proof example in the repository, regenerate both `docs/guide.html` and `docs/gallery.html`; tests enforce that all 11 recipe proof IDs resolve and that each proof retains three named reader views.

| Type | Use for | How |
|------|---------|-----|
| `architecture` | System components, cloud resources, services, security boundaries, infrastructure | `renderers/architecture/render-architecture.mjs` + JSON (or hand-place SVG when renderers can't run) |
| `workflow` | Technical flows, approval gates, tool calls, runbooks, CI/CD, incident response | `renderers/workflow/render-workflow.mjs` + JSON |
| `sequence` | API call chains, request lifecycles, cache fallback, async traces, return paths | `renderers/sequence/render-sequence.mjs` + JSON |
| `dataflow` | Pipelines, ETL/ELT, PII isolation, lineage, warehouse sync, consumers | `renderers/dataflow/render-dataflow.mjs` + JSON |
| `lifecycle` | State machines, status transitions, wait states, retries, terminal states | `renderers/lifecycle/render-lifecycle.mjs` + JSON |

Trigger phrases: "architecture/system/cloud diagram" → `architecture` (unless clearly process-oriented). "workflow/flow/process/runbook/approval/CI-CD/incident" → `workflow`. "sequence/interaction/call chain/who calls whom" → `sequence`. "data flow/pipeline/ETL/lineage/PII/governance" → `dataflow`. "state/status/lifecycle/state machine/retry/terminal" → `lifecycle`.

## Mermaid as an Input Dialect

When the user pastes Mermaid code, do NOT try to render or parse it mechanically — read it for structure and **lay out from scratch** in the matching archify mode:

| Mermaid | Archify mode | Mapping |
|---------|--------------|---------|
| `flowchart` / `graph` | `workflow` (or `architecture` if it's a component map) | `subgraph` → lane or region boundary; node shape `{}` (diamond) → decision/security node; `-->` labels → edge labels (use sparingly); `classDef`/`style` → nearest semantic type |
| `sequenceDiagram` | `sequence` | `participant` → participants (pick semantic `type` from the name); `->>` → message, `-->>` → `return` variant; `Note` → message `note`; `rect` blocks → segments |
| `stateDiagram` | `lifecycle` | states → states (pick `start`/`active`/`waiting`/`success`/`failure` from names); `[*]` start/end → `start` type / `terminal` lane; transition labels → event-like labels |

Drop Mermaid styling; keep only the topology and meaning. You choose grouping, lane order, and what deserves emphasis — that judgment is the product.

## Layout principles (read before placing)

Archify's readability comes from **spatial narrative**, not from drawing every dependency as an arrow. Before you write coordinates or edge lists, plan one clear story:

1. **One main path** — left → right (architecture) or lane → column (workflow). The reader should trace the happy path without crossing lines.
2. **Few labeled edges** — label only cross-boundary or non-obvious transitions on the main path. Adjacent steps stay unlabeled.
3. **Short side branches** — permissions, storage, bots, CI: connect **up or down** from the nearest node on the main path. Never route a secondary edge diagonally across unrelated components.
4. **Cards for detail** — policies, tech stack notes, and "also connects to X" belong in summary cards, not as extra arrows.
5. **Mode fit** — process / approval / tool-call stories → `workflow` or `sequence`. Component maps with ≤12 nodes → `architecture`. If the diagram needs 20+ edges, remove edges until the main path is obvious.

Worked examples on this pattern: `examples/archify-repo.architecture.json` (this repo) and `examples/maka-architecture.architecture.json` (third-party desktop app).

When validation fails on label overlap, read the **Suggested fix** lines (coordinates / `labelAt` / `labelDy`) and apply them directly — do not guess offsets blindly.

## Renderer Modes (architecture / workflow / sequence / dataflow / lifecycle)

All five modes follow the same loop:

1. **Read first**: the schema (`schemas/<type>.schema.json`) and the complete worked example (`examples/*.{architecture,workflow,sequence,dataflow,lifecycle}.json`) — copy its patterns instead of guessing field shapes.
2. Write `<name>.<type>.json`.
3. Render: `node bin/archify.mjs render <type> <input>.json <output>.html` (paths relative to this skill's folder).
4. Validate the generated artifact: `node bin/archify.mjs validate <type> <input>.json --json`, explicitly add `--quality standard` for dense engineering diagrams or `--quality showcase` for polished delivery, or check an existing HTML file with `node bin/archify.mjs check <output>.html`. This catches malformed SVG output, non-finite SVG values, two-point diagonal arrows, arrows crossing the legend, and profile-aware relationship crossings.
5. If either step fails, the error names the JSON path or the fix (thresholds, valid ranges, which knob to change). Fix the JSON and re-run; never edit the renderer.

Schema violations exit non-zero with path-prefixed messages like `/nodes/3 (id/label: "router") must NOT have additional properties`. The renderers additionally fail fast on established layout problems: node/state overlap (including cross-lane), labels colliding with nodes or other labels, labels wider than their node, out-of-range columns/rows, too-short edges, and legends outside the viewBox. A relationship passing through an unrelated opaque semantic node is always a hard correctness failure, even when neither `meta.quality_profile` nor CLI `--quality` is present: paint order must never make one authored relationship look like a different topology. The shared Clean Flow Gate reports `clean-flow/edge-through-node`, the exact collection/index and optional relationship ID, obstacle ID, first intersecting segment, 2px clearance, and supported routing/placement knobs before output is written. Stricter composition preferences remain profile-aware. For new or edited work, choose `standard` or `showcase` explicitly; structural container-border rules apply to both explicit profiles, unrelated proper X crossings warn in `standard` and fail in `showcase`, and showcase also fails any sub-8px route segment and sub-16px interior turn while preserving ordinary 8–15px endpoint stubs. Shared semantic endpoints, endpoint touches, and collinear relationship corridors are not proper crossings. Source/target boxes are endpoints; boundaries, lanes, stages, lifecycle bands, sequence segments/lifelines/activations, and other containers remain intentional pass-through geometry. CJK text is measured at double width automatically.

Set `meta.animation: "trace"` only when the user asks for motion or a presentation/demo view. It adds lightweight SVG/CSS trace animation to renderer-marked arrows and nodes plus one explicit 44px `Live` / `Still` Motion Governor. Ambient scan, edge, and node motion must run one finite pass, permanently settle for that document generation, and restore every authored solid/security/async dash style; switching `Still` back to `Live` must not replay it. Story, Chapter, Route, Lens, Relationship Preview, Intent Trace, Focus, and Legend remain stronger semantic owners. `Still` must reset every effect to complete static meaning, pause active Story playback at its exact beat, persist the reader choice when storage is available, and never auto-resume playback. Dynamic `prefers-reduced-motion` and page hiding use the same stop path. Static artifacts must never start decorative motion or show the control; embed remains calm unless `?play=1` explicitly requests one bounded chapter. Route Probe uses one finite signal and then leaves the exact route static. Canonical SVG and raster exports remain still; only the isolated WebM clone may explicitly opt into the repeatable finite trace timeline. Motion ownership is viewer-only, tokenized for stale-safe cleanup, and never enters schema, IR, renderer layout, or authored geometry.

Use `meta.views` when one overview needs a short, curated reading sequence. Each view is a label plus a set of existing semantic node IDs; it never changes layout, geometry, or styling. Keep the collection intentionally small (maximum five):

```json
"views": [
  {
    "id": "request-path",
    "label": "Request to result",
    "focus": ["user", "api", "worker", "result"],
    "note": "Follow the successful request through the system."
  }
]
```

Generated HTML exposes Play/Pause, previous/next/overview controls, <kbd>P</kbd> playback, <kbd>[</kbd>/<kbd>]</kbd> manual chapter navigation, and shareable `#view=<id>` links. Before any chapter is active, use the existing `data-active-view="all"` state as Story Shelf: establish it before the panel is unhidden, keep the compact guided identity, Play, and every authored chapter visible with 44px targets, but hide Previous/Next, Copy moment, Show all, and the generic instructional note. Chapter activation, Play, or valid deep-link restoration must expand the full existing Director in the same task; Show all and the existing Escape unwind must return to the shelf. Do not add a disclosure control, second component, storage preference, query parameter, schema field, or playback owner. It also builds a Named Chapter Rail from the same `meta.views` array: every native button shows a two-digit authored position and the exact label. From overview, candidates show `=0 +focus.length −0`; after activation, the current button shows its stop count and every other candidate shows exact `=stay +enter −leave` focus membership. The rail must never own parallel selection state; it mirrors `activeIndex`, delegates activation to the existing guided-view path, and uses a single roving tab stop. Left/Right/Home/End move focus only and apply one static Chapter Delta Preview over existing stable-ID nodes; they must not change selection, camera, Story Trail/Beat, URL, contained scroll, `aria-current`, or `aria-pressed`. Native Enter/Space activates; Escape dismisses only the preview and preserves focus; touch activates on the first tap without a preview latch. Rail preview pauses playback and must not auto-restart it. Mark current, before, after, stay, enter, and leave with structural/text cues as well as color. On narrow screens use contained horizontal scroll/snap, at least 44px targets, and immediate centering of the active chapter without widening the page. Keep the entire rail out of embed and print output.

The ordered `focus` list becomes Story Beat Navigator. Render every resolved stop as a native button with its two-digit position, node label, at least a 24px desktop target and a 32px mobile target. Click, first tap, Enter, or Space pauses playback and pins exactly that beat; keyboard focus pauses at the existing playhead but must not select a different beat. Exactly one active stop carries `aria-current="step"`, and selecting it must not change `activeIndex`, chapter focus IDs, chapter-rail current state, URL/history, diagram/page scroll, layout, or authored data. Classify only the exact stable-ID relationship between the immediately previous and current stop: one previous→current edge is `forward` and renders `→`; one current→previous edge is `reverse` and renders `←`; no direct edge is `group` and renders `·`; more than one or bidirectional exact edge is `multiple` and renders `⇄`. Never infer a path from nonconsecutive internal edges, labels, geometry, proximity, kinds, or Story order. A manual forward/reverse beat may run one finite marker-free exact-edge signal in Live; group/multiple stay static, and Still/reduced motion keeps the complete static meaning. One generation-owned scheduler uses `max(1100ms, 3200ms / stopCount)` dwell, preserves elapsed dwell on pause, resumes the remaining dwell from the same beat, and starts the next chapter only after Shared Anchor Handoff settles. Replacement, hidden state, print, reduced motion, and teardown invalidate stale callbacks and pulses without corrupting the selected static beat. Choose a meaningful authored order even for thematic subgraphs.

Story Follow Camera reuses the existing Semantic Camera only after reader-started playback or deliberate beat activation. Frame current + next at the first stop, previous + current + next in the middle, and previous + current at the last stop; use exact stable IDs only, 64px padding, a 1.65× maximum scale, and one finite 320ms transaction. The camera must settle before the 1100ms minimum dwell expires. Pause, replacement, overview, manual pan/zoom, hidden/print state, and stale camera receipts clear follow ownership. `Still` and reduced motion disable automatic Story Play but keep manual beat inspection as an instant frame. Exact `#view=&beat=` restoration may defer one animation frame until the shared camera exists, then restores paused with no pulse or autoplay. Do not follow an ordinary embed unless `?play=1` explicitly requests playback. Keep follow attributes and transforms out of canonical export, and add no panel, schema, IR, renderer layout, dependency, storage, cloned foreground graph, or authored geometry.

Semantic Story Carrier reuses Relationship Preview's five compiled token kinds on Story Beat's existing finite 780ms exact-edge pulse. Before classifying a step, deduplicate SVG path and label fragments by stable `data-edge-key`, preferring the fragment that owns drawable path/line/polyline geometry; never let a label duplicate turn one authored relationship into `multiple`. Only one unambiguous forward/reverse edge may create the carrier, and it must follow that edge's real source-to-target geometry in a viewer-only overlay above authored edges and below semantic nodes. Reuse the current Story motion owner and a generation receipt so stale `animationend` callbacks cannot clear a newer beat. Ordinary desktop artifacts and explicit `?play=1` playback may animate; passive embeds, Still, reduced motion, hidden/print state, and canonical/raster export remain static. This is not a mobile product feature: narrow layouts receive containment only. Add no schema, IR, renderer branch, layout change, dependency, replay control, timer, authored geometry, or second animation system.

Story Director Strip narrates that frame outside the canonical SVG. For every active beat, show `NN / NN`, the exact previous/current node route, up to three distinct authored `data-edge-label` values, and the current node's existing responsibility/context. Reuse only Story Beat's `start / forward / reverse / multiple / group` result. A group must say `Grouped transition · no direct authored link`; reverse must name the real authored direction; missing labels may say only `Authored relationship`. Never infer a verb, transitive route, or relationship from geometry, proximity, kinds, or story order. Autoplay uses `aria-live="off"`; paused, manual, and exact-link states use `polite`. Live mode may use one 140ms caption entrance, while Still and reduced motion are immediate. On desktop Presentation playback, hide only the chapter rail, Story Trail, Copy moment, Show all, and redundant title/note; keep Previous, Next, Pause, position, route, and facts visible, then restore the complete controls on pause. Mobile keeps its two-line caption and 44px controls. Ordinary embed, print, and canonical export exclude the strip. Add no schema, IR, renderer layout, dependency, storage, authored geometry, or parallel story state.

Story Horizon completes that story state as `past / active / next / pending`. `next` means exactly `storyBeatIndex + 1`: at most one real next node and the exact already-resolved connector set owned by that next step. Forward and reverse preserve authored direction; multiple preserves every real connector; grouped previews only its real node and never invents a link. Use static opacity/saturation hierarchy (`active > past > next > pending`) without early camera movement, pulsing, cloned topology, or another live announcement. The final beat has no horizon. The Director Strip may name the next node only inside its existing desktop footprint; mobile adds no row. Rapid changes atomically replace state. Still and reduced motion preserve the same static meaning. Clear Horizon on overview, chapter replacement, takeover, teardown, print, and export. Add no schema, IR, renderer layout, dependency, storage, edge rewrite, or authored geometry.

Every active beat also enables one viewer-only **Copy moment** action. It produces `#view=<view-id>&beat=<stable-node-id>` from the current chapter and authored node identity; never use a numeric beat index, label, camera transform, layout coordinate, or serialized viewer state. Copying during playback first pauses at the visible beat and removes `play=1` from the copied URL. Static restoration activates the chapter, waits for the winning Shared Anchor Handoff, rechecks the current hash and generation, then selects the exact matching stop with no pulse, autoplay, focus move, or URL rewrite. A missing, stale, duplicate-context, or cross-chapter beat fails closed to the valid chapter. Manual beat activation and automatic playback do not mutate the URL. Expose only read-only `beatLink()` / `copyBeatLink()` receipts; add no storage, schema, IR, dependency, server, or canonical SVG state.

For a share-ready one-shot chapter, use `?play=1#view=<id>`: it plays only that named view once on the same readable per-beat cadence, never auto-advances, then stays still and readable. Add `&beat=<stable-node-id>` only to start at that exact authored stop and play the remaining beats once. In embed mode, a Share Chapter Cue names the view, derives its exact route from the same Story Trail stops, reports the current `Step NN / NN` plus Ready/Playing/Settled/Paused/Still state, and freezes its node, edge, and progress at the actual interruption point. A static `?embed=1#view=<id>&beat=<node-id>` reuses that same cue as a truthful `Pinned` receipt and never starts motion. It is an HTML viewer layer outside SVG geometry and canonical exports; narrow screens reserve a top band so it cannot cover nodes. With no hash it activates the first authored view. It does not run when `prefers-reduced-motion: reduce` matches. Both playback modes pause when the page is hidden and yield immediately when the reader explores a node, changes the view, zooms, or pans. Embed mode pauses ambient trace loops, so Proof Lab grids remain static unless a named one-shot chapter is requested. View IDs must be unique, focus lists cannot be empty or contain duplicates, and every focus ID must exist in that diagram's semantic collection (`components`, `nodes`, `participants`, or `states`).

For every real chapter-to-chapter change, compute continuity only from exact stable IDs shared by the outgoing and destination `focus` lists. Prefer the active Story Beat when it is shared; otherwise use the latest shared outgoing stop. Shared Anchor Handoff keeps that node's screen position fixed through a short orientation hold, shows one viewer-only `NN → NN · via <node>` receipt and ring, then settles the existing bounded Semantic Camera through one interruptible finite transaction. If no ID is shared, publish `no-anchor`, omit the ring, and retarget without guessing from labels, geometry, kinds, or relationships. New navigation replaces the current generation; manual pan/zoom samples the rendered position and takes over without a snap; Story dwell begins only after the winning transaction settles. Still, dynamic reduced motion, hidden pages, ordinary embeds, print, and canonical exports must synchronously reach a complete clean destination. Add no transition fields, cloned graph, layout motion, dependency, or canonical SVG state.

Compute Chapter Delta Preview and Shared Anchor Handoff from one normalized helper only: `stay` is the current focus in authored order intersected with the candidate, `leave` is the remaining current focus, and `enter` is the candidate focus in authored order absent from current. Only unique IDs present in the canonical SVG may count. Preview is instantaneous presentation state, not partial activation: it may write only the root candidate ID, node membership roles, candidate-button preview state, compact counts, and a tokenized static `chapter-preview` motion owner. Pointer and focus intents arbitrate independently with latest valid intent winning; a stronger Route, Lens, Legend, Relationship, or Intent owner defers preview without being cleared. Hidden/print/activation/Show All/hash/direct-node cleanup is atomic, export clones strip every preview attribute, and returning visibility or Live must never restore a stale preview. Never add an overlay, clone, edge diff, camera call, first-tap mobile preview, schema field, or model-change wording such as “nodes added/removed.”

The viewer also includes a zero-dependency Presentation Stage. Press <kbd>F</kbd> or use the Present toolbar action to make the live diagram fill the viewport while retaining theme, guided-story, focus, and pan/zoom controls. Use `?present=1&play=1#view=<id>` for a shareable live slide that demonstrates itself once and then becomes a stable reading surface. <kbd>Escape</kbd> clears an active guided view or semantic focus first, then exits the stage. This is an HTML viewing mode only: never change the typed input, SVG geometry, or canonical export to implement it.

Reading Depth is the shared viewer's progressive semantic-zoom contract. Renderers—not inferred pixel geometry—mark responsibility sublabels and relationship labels with `data-detail="context"`, mark authored tags, steps, notes, and classifications with `data-detail="fine"`, and leave primary labels always visible. The viewer reports `MAP` below 125%, `READ` from 125% to below 175%, and `FULL` from 175% upward. Committed focus, Semantic Lens, Intent Trace, Route Probe, Story Trail, and Relationship Preview must reveal the exact matched detail regardless of zoom. Print and canonical exports always contain complete detail, reduced-motion removes detail transitions, and this contract must never add schema or JSON IR fields.

Press <kbd>?</kbd> or use the question-mark control to open Diagram Guide. It must derive exact semantic node and relationship counts from stable compiled hooks and take guided-view count from the existing runtime. Its six primary rows—Find, Route, Radar, Lens, Story, and Presentation—delegate to those existing interactions; do not create a second command implementation. Disable Story honestly when no guided views exist. Arrow keys, Home, End, the named direct shortcuts, and Escape must work inside the panel. Opening the guide pauses story playback and closes overlapping Finder, Radar, Lens, and export panels without clearing focus or an in-progress route; narrow screens temporarily recede the Route receipt. Keep the guide out of embed, print, and canonical SVG export, and never add guide fields to JSON IR.

Press <kbd>/</kbd> or use the diagram's finder control to search any rendered node by label, responsibility sublabel, structural context, authored tag, semantic kind, or stable ID. Results report that same context plus relationship count; selecting one exits a guided view, resets the viewport, reveals the node on a contained mobile diagram, and enters the existing `#focus=<id>` one-hop view. While Route Probe is choosing an endpoint, the same control becomes a contextual route picker instead: source results include only nodes with a real authored outgoing route, destination results include only nodes reachable from the current source, and each destination previews its shortest directed hop count. Escape closes Finder while preserving the route question. Single-node focus opens Semantic Passport above Relationship Lens: it must show kind, sublabel, structural context, optional tag, and stable ID from renderer-owned SVG attributes, plus a dependency-free `Copy link` action for the existing focus URL. On narrow screens, keep the relationship list collapsed behind its exact count and place the compact Passport above or below the selected node; following a relationship collapses the next Passport again. Architecture context comes from authored boundary `wraps`; workflow context from lane/group/phase; sequence context from participant role; data-flow context from stage; lifecycle context from lane. Never infer scope from pixel proximity. Finder and Passport require no new input fields and must never be hand-authored as viewer markup in JSON IR.

Relationship Lens rows are the accessible target for exact-edge Relationship Preview. On one true fine-pointer entry or keyboard `focusin`, resolve exactly one stable `data-edge-key`, preserve authored source-to-target direction even for incoming rows, and clone only its path/line/polyline geometry into one marker-free, pointer-free, `aria-hidden` overlay with `pathLength="1"`. Play one 1.2-second pass and carry exactly one compact semantic token along the same geometry: security edge/endpoint evidence wins, then dashed/message-bus event evidence, database data evidence, waiting/success lifecycle state evidence, and otherwise a call cue. Use only compiled variants and renderer-owned stable kinds—never labels, product names, or geometry. Then remove the complete overlay while leaving the exact original edge plus source/target emphasis readable. A parked pointer or focus must not loop or restart from child bubbling; row re-entry or re-focus may replay. Narrow screens reuse the contained fallback and are not a dedicated product surface. Replacement, preview exit, Focus clear, Escape, stronger viewer ownership, page hiding, `animationend`, `animationcancel`, and a live switch to reduced motion must leave zero overlays. Classic, Signal Flow, and Blueprint may style the signal differently without changing timing or geometry; Blueprint has no glow. Never add replay controls, nested row actions, timers, schema/IR fields, renderer layout, dependencies, or motion to embed, print, canonical SVG, or raster export.

Press <kbd>M</kbd> or use the `MAP` control to open Semantic Radar. It must derive a simplified, type-colored overview from each rendered node's stable ID, `data-node-kind`, and runtime `getBBox()`; never clone the canonical SVG or add radar fields to JSON IR. Its viewport rectangle follows desktop transform zoom/pan and contained mobile horizontal scroll. Radar node click/Enter/Space delegates to the same semantic focus and camera, while background drag/click and Arrow keys recenter the current view. The open radar docks only while the diagram intersects the window, chooses the opposite horizontal side from the focused node, and searches for a vertical slot that avoids the node and visible Passport when space permits. On contained mobile diagrams, report the actual visible width rather than claiming a zoom percentage. Escape closes the radar before clearing focus. Keep the radar out of embed, print, static HTML SVG counts, and canonical exports by constructing its small SVG at runtime.

Inline legend interaction is selective, not automatic. Add `data-legend-bridge` and exact `data-legend-kind` rows only when one legend row means precisely one renderer-owned node kind: every dynamically used architecture component type; workflow frontend, backend, security, messagebus, and database rows; lifecycle active, waiting, success, and failure rows. Keep sequence edge-variant legends and data-flow mixed node/edge legends static. The viewer derives counts from the same compiled node facts as Semantic Lens, adds hit targets and badges only at runtime, exposes a roving toolbar/group for positive-count rows, and keeps zero-count rows visibly non-actionable. Fine-pointer hover or keyboard focus may softly preview exact nodes, touching authored relationships, and connected peers without flow animation; touch, click, Enter, and Space activate the existing Lens directly. Selected rows need a non-color cue. Active Lens, focus, route, story, presentation, Relationship Preview, and other stronger owners suppress the preview. Embed skips decoration; print and canonical export remove every runtime role, badge, hit target, selection, and preview marker. Never duplicate kind counts in a renderer or add legend schema, JSON IR, graph-copy, or dependency surface.

Press <kbd>L</kbd> or use the `LENS` control to compare compiled node kinds. Derive chips and exact counts only from stable `data-node-kind`; never hard-code a renderer-specific category list. Permit at most two selected kinds. One selected kind keeps its nodes and all touching relationships strong while connected peer endpoints remain contextual; two selected kinds keep only their direct authored cross-kind relationships strong and report both directions separately. Count nodes by stable ID and relationships once by stable edge key. After an explicit selection, Semantic Flow clones only the exact matched path/line/polyline geometry into a marker-free, pointer-free, `aria-hidden` runtime overlay: one-kind traffic distinguishes outgoing, incoming, and within-kind direction, while two-kind traffic distinguishes authored forward and reverse flow. Run one short pass, then leave the complete static Lens selection readable; passive pointer or keyboard focus must not create an infinite loop. Keep nodes, labels, camera, and original edges fixed; preserve preset identity, make reduced motion static, suppress flow above 24 matched edges, and omit the overlay in embed, print, and canonical export. Unrelated content must recede softly without being hidden, moved, rerouted, or removed from fitting. Closing the panel preserves the pinned state, `#lens=<kind>~<kind>` restores it, and Escape closes the panel before clearing the lens. Focus, Route Probe, and Story Trail clear Lens before taking ownership; active Lens suppresses Intent Trace. Matching renderer-owned Reading Depth detail remains visible. Add no schema, IR, renderer layout, graph-copy, or dependency surface.

Before a node is committed to focus, the shared viewer provides Intent Trace. Fine-pointer hover and keyboard focus must derive exactly the node's one-hop incoming, outgoing, and self-loop relationships from stable `data-edge-from`, `data-edge-to`, and `data-edge-key` hooks. Unrelated topology may recede, but authored edges, markers, dash patterns, labels, and geometry remain unchanged. The directional signal is a runtime-only clone of path/line/polyline geometry with markers and semantic attributes removed and `pathLength="1"` for a consistent rhythm. Touch skips the preview and retains one-tap focus. Active embed/story/focus/relationship-preview/pan state suppresses it, `prefers-reduced-motion` replaces movement with a static highlight, keyboard focus announces exact connection counts, and click/Enter/Space clears the temporary state before Semantic Passport takes ownership. Never add Intent Trace fields to JSON IR or include its overlay in canonical exports.

Press <kbd>R</kbd> or use `PATH` to open Route Probe. If one node is already focused it becomes the source; otherwise choose a source directly on the semantic SVG or through contextual Finder, then choose a highlighted reachable destination on-canvas or from the same search surface. Finder must omit dead-end sources, filter destinations by authored reachability, preview their shortest directed hop count, and keep the in-progress route when Finder closes. Traverse only `data-edge-from` → `data-edge-to`, ignore self-loops for two-endpoint routing, and use deterministic unweighted BFS in authored DOM edge order. The result must be the fewest real directed hops, keep exact ordered node and edge identity, frame only that route with Semantic Camera, and expose a compact node/hop receipt plus `#route=<source>~<target>` copy link. Never invent edge weights, fall back to an undirected path, mutate layout, or add route fields to JSON IR. Endpoint selection must work by pointer, Enter/Space, and Finder handoff. `prefers-reduced-motion` keeps the same static result; embed and print omit the control; canonical exports remove route state, step/candidate attributes, and cloned `pathLength="1"` signal geometry.

After Route Probe resolves, expose Route Journey over the existing ordered `activeNodeIds` and exact `activeEdges`; do not build a second graph. Render every receipt stop as a native button with one roving Tab stop and add Previous, Next, Journey/Pause/Replay, and Overview controls. The full route stays visible. Position zero owns the source and no incoming edge; position `i > 0` owns exactly `activeEdges[i - 1]`, which alone may emit one finite 780ms marker-free signal. Manual activation pauses playback, while arrows/Home/End move focus and Enter/Space selects. Playback must start only from deliberate Play activation, run one finite pass, preserve the remaining dwell when paused, and reject stale timers with a generation token. Manual pan/zoom, path focus, Diagram Guide, Motion Still, dynamic reduced motion, page hiding, and print pause it without auto-resume. Use Semantic Camera to frame previous/current/next; manual inspection remains available without motion. Escape layers as pause → Overview → clear. Keep `#route=<source>~<target>` endpoint-only and restore to Overview without autoplay. Mobile controls need 44px targets; embed, print, canonical export, schema, IR, layout, dependencies, storage, and authored SVG geometry remain unchanged.

Choose `meta.visual_preset` by audience, without changing diagram geometry: use `"signal-flow"` for a striking demo, launch graphic, or motion-forward presentation; use `"blueprint"` for deployment maps, design reviews, infrastructure handoffs, and drafting-style technical documentation; omit it (or use `"classic"`) for the stable default visual language. Every preset supports both themes. WebM export appears only for trace-enabled diagrams and records six seconds directly in a supporting browser.

### Workflow

```json
{
  "schema_version": 1,
  "diagram_type": "workflow",
  "meta": { "title": "Release Workflow", "subtitle": "PR to production", "output": "release.html" },
  "lanes": [ { "id": "dev", "label": "Developer" }, { "id": "ci", "label": "CI" }, { "id": "exceptions", "label": "Exception Handling", "variant": "exception" } ],
  "phases": [ { "id": "intake", "label": "Intake", "fromCol": 0, "toCol": 1 } ],
  "groups": [ { "id": "checks", "label": "Parallel checks", "lane": "ci", "fromCol": 1, "toCol": 3, "variant": "emphasis" } ],
  "mainPath": ["pr", "build"],
  "nodes": [
    { "id": "pr", "lane": "dev", "col": 0, "type": "frontend", "label": "Open PR", "sublabel": "feature branch" },
    { "id": "build", "lane": "ci", "col": 1, "type": "backend", "label": "Build", "sublabel": "lint + test", "tag": "blocking" }
  ],
  "edges": [
    { "id": "pr-to-build", "from": "pr", "to": "build", "label": "webhook", "variant": "emphasis", "fromSide": "bottom", "toSide": "top", "route": "drop" }
  ],
  "cards": []
}
```

**Layout budget**: 6 columns (`col` 0–5) at fixed x positions `[88, 220, 300, 430, 500, 625]` — columns 1↔2 and 3↔4 are only 70–80px apart, so default-width (92px) nodes in those adjacent columns of the same lane overlap; skip a column or shrink `width`. Lane content width is 640px. Omit `meta.viewBox` — the renderer sizes height to the lane count automatically. Use `phases` for top-of-diagram story beats, `groups` to frame parallel work or a branch inside one lane, and `lane.variant: "exception"` for error/retry/fallback lanes. `mainPath` is optional but recommended: list the happy-path node ids in order so the renderer can catch missing edges or accidental backward movement. Edge routes: `straight`, `drop` (bend between lanes; `bias` 0–1 picks where), `outside-right`, `return-left`, `bottom-channel`, `up-channel`, or explicit `via` points. Keep adjacent-step edges unlabeled; reserve labels for cross-lane transitions, approvals, async traces, and returns.

### Sequence

```json
{
  "schema_version": 1,
  "diagram_type": "sequence",
  "meta": { "title": "Cache Miss Request", "subtitle": "auth and cache fallback", "output": "cache-miss.html" },
  "participants": [
    { "id": "web", "type": "frontend", "label": "Web App", "sublabel": "React UI" },
    { "id": "api", "type": "backend", "label": "API", "sublabel": "handler" }
  ],
  "segments": [ { "from": 160, "to": 320, "label": "01 / AUTH" } ],
  "messages": [
    { "id": "request-data", "from": "web", "to": "api", "y": 200, "label": "GET /data", "variant": "emphasis" },
    { "id": "return-data", "from": "api", "to": "web", "y": 290, "label": "200 JSON", "variant": "return" }
  ],
  "activations": [ { "participant": "api", "from": 190, "to": 300, "type": "backend" } ],
  "cards": []
}
```

**Layout budget**: participants sit at x = 62 + index×108, so a 920-wide viewBox fits at most 8. Message `y` must stay within `[160, viewBox_height − 83]`; messages that share horizontal space need ≥28px vertical separation; arrows need ≥60px horizontal span. `segments[].from/to` and `activations[].from/to` are **y pixel coordinates**, not participant ids. A taller `meta.viewBox` (default `[920, 760]`) buys more timeline room. Keep labels short: "GET /path", "verify JWT", "cache miss", "200 JSON".

### Dataflow

```json
{
  "schema_version": 1,
  "diagram_type": "dataflow",
  "meta": { "title": "Product Analytics", "subtitle": "events to consumers", "output": "analytics.html" },
  "stages": [ { "label": "Sources" }, { "label": "Ingest" }, { "label": "Store" } ],
  "nodes": [
    { "id": "web", "type": "frontend", "label": "Web App", "stage": 0, "row": 0, "sublabel": "clickstream" },
    { "id": "kafka", "type": "messagebus", "label": "Kafka", "stage": 1, "row": 0, "tag": "accepted events" }
  ],
  "flows": [
    { "id": "web-events", "from": "web", "to": "kafka", "label": "events", "classification": "PII touch", "variant": "emphasis" }
  ],
  "cards": []
}
```

**Layout budget**: 2–5 stages at x = 100 + stage×215; 5 rows (`row` 0–4) at y `[128, 242, 356, 470, 584]`; default node 112×58. Default viewBox `[940, 720]`. Flow labels are mandatory and asset-like ("clickstream", "identity map", "feature vectors"); put sensitivity in `classification` ("PII touch", "approved only", "non-PII"). Variants: `emphasis` = primary path, `security` = PII/policy/consent, `dashed` = async/batch.

### Lifecycle

```json
{
  "schema_version": 1,
  "diagram_type": "lifecycle",
  "meta": { "title": "Agent Run Lifecycle", "subtitle": "states and terminal outcomes", "output": "agent-run.html" },
  "lanes": [
    { "id": "main", "label": "Lifecycle phases" },
    { "id": "waiting", "label": "Interruptions" },
    { "id": "terminal", "label": "Terminal exits" }
  ],
  "states": [
    { "id": "queued", "type": "start", "label": "Queued", "lane": "main", "col": 0, "step": "01" },
    { "id": "running", "type": "active", "label": "Executing", "lane": "main", "col": 2, "step": "02" },
    { "id": "approval", "type": "waiting", "label": "Needs Approval", "lane": "waiting", "col": 0 },
    { "id": "done", "type": "success", "label": "Completed", "lane": "terminal", "col": 2 }
  ],
  "transitions": [
    { "id": "start-running", "from": "queued", "to": "running", "variant": "emphasis" },
    { "id": "approval-needed", "from": "running", "to": "approval", "label": "needs approval", "variant": "security", "fromSide": "bottom", "toSide": "right" },
    { "id": "run-succeeded", "from": "running", "to": "done", "label": "success", "variant": "emphasis", "fromSide": "bottom", "toSide": "top" }
  ],
  "cards": []
}
```

**Layout budget — lane ids are semantic and reserved**: `main` is required and maps to the top phase band (cols 0–4); `terminal` maps to the bottom outcome band (cols 0–2); **every other lane id shares the single middle event band** (cols 0–2) — separate same-band states with different `col` or `yOffset`. Band headers render from your lane labels. Default viewBox `[980, 660]`. Keep transition labels event-like and sparse ("retry", "timeout", "cancel"); prefer state `tag`s, `step` numbers, and summary cards over label-heavy arrows. Put terminal states in the `terminal` lane so endings are unambiguous.

### Per-mode deep guidance

Each renderer has a README with its full design language (route presets, semantic types, story guidance): `renderers/workflow/README.md`, `renderers/sequence/README.md`, `renderers/dataflow/README.md`, `renderers/lifecycle/README.md`. Read the matching one before your first diagram of that mode in a session.

## Architecture Mode

Architecture has the same read-schema-then-render loop as the other modes — prefer it. Hand-placed SVG is the fallback for when renderers can't run.

```json
{
  "schema_version": 1,
  "diagram_type": "architecture",
  "meta": { "title": "Sample Web App", "subtitle": "3-tier SaaS on AWS", "output": "web-app.html" },
  "components": [
    { "id": "users", "type": "external", "label": "Users", "sublabel": "Browser", "pos": [40, 300] },
    { "id": "api", "type": "backend", "label": "API Server", "sublabel": "FastAPI :8000", "pos": [460, 300] },
    { "id": "db", "type": "database", "label": "PostgreSQL", "sublabel": ":5432", "pos": [680, 300] }
  ],
  "boundaries": [
    { "kind": "region", "label": "AWS us-west-2", "wraps": ["api", "db"] }
  ],
  "connections": [
    { "id": "users-to-api", "from": "users", "to": "api", "label": "HTTPS", "variant": "emphasis" },
    { "id": "api-to-db", "from": "api", "to": "db", "label": "SQL" }
  ],
  "cards": []
}
```

Render: `node bin/archify.mjs render architecture <input>.json <output>.html`.

**Free placement** — `pos: [x, y]` is the component's top-left; `size: [w, h]` defaults to `[120, 60]`. Unlike typed modes there is no lane/stage grid — asymmetric placement is yours to choose. `meta.viewBox` is optional (auto-fitted).

**Grid placement (#8)** — when manual coordinates are painful, set semantic cells instead of doing arithmetic:

```json
{
  "layout": { "mode": "grid", "cols": 7, "origin": [40, 100], "gapX": 24, "gapY": 48, "cellW": 120, "cellH": 60 },
  "components": [
    { "id": "agents", "type": "frontend", "label": "Agent Hosts", "row": 1, "col": 1 },
    { "id": "ir", "type": "messagebus", "label": "JSON IR", "row": 1, "col": 2 }
  ]
}
```

`pos` still wins when present (override one cell). This is **not** auto-layout — spacing is fixed cell math. Example: `examples/archify-repo-grid.architecture.json`.

**Inspect layout (#9)** — after editing JSON, dump computed boxes without opening HTML:

```bash
node bin/archify.mjs inspect architecture my.architecture.json
# or: node bin/archify.mjs validate architecture my.architecture.json --layout-json
```

Output includes component rects, boundaries, connection point paths, and label positions.

**The renderer does the mechanical work that used to be hand-tuned**, so you only choose coordinates and meaning:

- **Free coordinates** — `pos: [x, y]` is the component's top-left; `size: [w, h]` defaults to `[120, 60]`. Unlike the typed modes there is no lane/stage grid — asymmetric placement is yours to choose. `meta.viewBox` is optional (auto-fitted to your components + a legend row).
- **Grid placement** — optional `layout.mode: "grid"` with `row`/`col` per component (see above). Not dagre; fixed cell spacing only.
- **Boundaries from `wraps`** — list the component ids a `region` (dashed amber) or `security-group` (dashed rose) encloses; the renderer computes the box with correct 30/50 padding automatically. Never hand-arithmetic a boundary again.
- **Connections** route like edges (`variant`, `fromSide`/`toSide`, `route: straight|orthogonal-h|orthogonal-v|auto`, `via`, `labelDx/labelDy/labelAt`). Architecture `auto` preserves the original H-V-H dogleg when it is clear and tries the complementary in-bounds V-H-V dogleg only when the first would cross an unrelated component; explicit routing is never rewritten. For a vertical labeled connection, push the label into the gap with `labelDy` (the validator will tell you if it lands on a box).
- The renderer auto-emits the two-rect `c-mask` pattern, draws arrows before boxes (z-order), builds the legend from the component types you used, and **fails fast on component overlap, off-canvas components/boundaries, unknown wraps/connection ids, label-vs-component collisions, and non-finite coordinates** — the same reliability the other four modes already had.

### Hand-placed fallback (no renderer available)

When Node/ajv can't run, copy `assets/template.html` and place SVG by hand. Study the worked diagram inside the template and `examples/web-app.html` for coordinate idioms, follow the Design System below, and run the self-review checklist before delivering.

### The Cardinal Rule: CSS classes, not inline colors

The theme toggle works by switching CSS custom properties. Hardcoded `fill="rgba(...)"` or `stroke="#22d3ee"` will NOT update on theme change. Always use the class system:

```svg
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-mask"/>
<rect x="X" y="Y" width="W" height="H" rx="6" class="c-backend" stroke-width="1.5"/>
<text x="CX" y="CY" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">API Server</text>
<text x="CX" y="CY+16" class="t-muted" font-size="9" text-anchor="middle">FastAPI :8000</text>
```

### Design system

Component fills `c-frontend` (clients/UI), `c-backend` (services/APIs), `c-database` (stores/caches), `c-cloud` (managed infra), `c-security` (auth/secrets), `c-messagebus` (Kafka/queues), `c-external` (3rd parties); text accents `t-<same>` plus neutrals `t-primary` / `t-muted` / `t-dim`. Arrows `a-default`, `a-emphasis` (hot path), `a-security` (dashed), `a-dashed` (async) — always set `stroke-width` and pair `marker-end="url(#arrowhead[-variant])"` with the matching class. Boundaries: `c-security-group` (dashed rose), `c-region` (dashed amber), `c-lane` (swimlane).

Renderer-backed nodes automatically receive one small inline SVG Semantic Sigil derived from the existing role (`frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, `external`, or lifecycle state type). Do not add vendor logos or duplicate the sigil by hand; put product identity in the label/sublabel and let the stable semantic category control color and the role stamp.

Typography inherits JetBrains Mono from the SVG root. Sizes: 11–12px component names, 9px sublabels, 8px annotations, 7px tiny labels.

### Hard layout rules

- **Two-rect pattern everywhere**: opaque `c-mask` rect first, styled `c-<type>` rect on top — semi-transparent fills otherwise let arrows bleed through.
- **Arrows before components** in document order (SVG paints in order; arrows must sit behind boxes).
- **Clean flow before delivery**: with or without a quality profile, a relationship may touch its own source/target boxes but must not pass through any unrelated semantic node. If both bounded architecture auto candidates are blocked, fix `clean-flow/edge-through-node` with `fromSide`/`toSide`, a route/channel, explicit `via`, or node placement; do not hide the defect with paint order. This semantic correctness rule is universal, while older profile-less schema-v1 inputs retain advisory handling for stricter composition preferences.
- **Choose a composition profile deliberately with the user**: `standard` keeps dense engineering topologies renderable and records route-rhythm/proper-X findings as warnings; `showcase` fails unrelated proper X crossings, any segment below 8px, and interior turn segments below 16px. Both explicit profiles enforce structural border-run checks; universal Clean Flow applies before profile selection. Endpoint stubs from 8–15px remain valid because fixed lane gaps can require them. Use `meta.quality_profile` or CLI `--quality`, then repair with route/channel/via/side or placement controls. Do not silently add a profile to an existing v1 file.
- **Vertical stacking**: ≥40px gap between components; inline connectors (message buses, 20px tall) live inside the gap, never overlapping boxes.
- **Boundary padding**: boundary `y` = inner `y` − 30, boundary `height` = inner `height` + 50, label baseline 18px below the boundary top.
- **Legend placement**: outside ALL boundary boxes, ≥20px below the lowest one; grow the viewBox if needed.

### Self-review checklist (run before delivering)

1. `grep -E 'fill="(#|rgb)|stroke="(#|rgb)' out.html` inside the SVG returns nothing except the template's own defs (Cardinal Rule).
2. Every `c-<type>` rect has an identical-geometry `c-mask` rect immediately before it.
3. All `<line>`/`<path>` arrows appear before all component rects in document order.
4. Compute max(y + height) over all SVG elements: viewBox height must exceed it by ≥20px; same for x/width.
5. Legend y is below every boundary's y + height.
6. The `.toolbar`, `.diagram-nav`, `.overview-map`, `.semantic-lens`, `.route-probe`, `.intent-trace-status`, `<script>` blocks, and `:root` / `[data-theme]` CSS are untouched — they ARE the theme, Semantic Lens, Intent Trace, Route Probe, Node Finder, Semantic Radar, Presentation Stage, interaction, and export runtime.

### Perceptual delivery gate

Treat the first render as a candidate, not an automatic final result. After deterministic render, validate, and artifact checks pass, inspect the final browser artifact and a canonical raster export when an image reader is available. Check clipping, text fit, hierarchy, whitespace, misleading routes, label placement, and dark/light readability. Make a maximum of two focused correction rounds; change only the diagnosed coordinates, labels, routes, spacing, or viewBox, then rerun render, validate, and check after every round.

Finish with a truthful receipt:

```text
validation: passed
visual_review: passed
correction_rounds: 0
```

When no browser or image reader is available, report `visual_review: skipped (image reader unavailable)` and still report the real correction count. Never report `visual_review: passed` without inspecting the final rendered pixels. Do not start an unbounded aesthetic loop, and do not use visual judgment to override a deterministic failure.

## Output

A single self-contained `.html`: embedded CSS (Google Fonts loads async and degrades to system monospace offline), one canonical inline SVG, and embedded JS for Intent Trace, Route Probe, Node Finder, Semantic Passport, runtime-built Semantic Radar, Presentation Stage, Story Trail playback, semantic focus, pan/zoom, theme, and export. It renders directly in any modern browser. Every semantic node has a deterministic DOM ID, accessible keyboard control, renderer-owned kind/responsibility/context attributes, and a compact native `<title>` tooltip; the SVG root includes its own `<title>` and `<desc>`. Raster exports render natively at up to 4× the viewBox (large diagrams step down to 3×/2× to stay under canvas limits); the SVG download is dual-theme self-contained and follows the host's `prefers-color-scheme` (manual override via `svg[data-theme="..."]`); trace-enabled diagrams can be recorded to WebM without external tooling.
