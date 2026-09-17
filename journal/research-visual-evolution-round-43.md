# Visual Evolution Round 43 — Clean Flow Gate

Date: 2026-07-20
Status: implementation-ready research decision

## Executive decision

Build a shared **Clean Flow Gate** that rejects one mechanically unambiguous
defect across all five typed renderers: a rendered relationship passing through
an unrelated semantic node box.

The first slice should not promise that every edge crossing is bad. It should
not treat containers, lanes, stages, lifecycle bands, sequence segments,
lifelines, or activation bars as ordinary node obstacles. It should also not
copy Fireworks' complete showcase budget into Archify. Instead, it should move
the existing workflow-only guard into one shared geometry contract and apply
that contract to architecture, workflow, dataflow, lifecycle, and sequence
before output is written.

```text
resolved relationship + exact authored route points + semantic node boxes
  -> split route into line segments
  -> ignore source and target boxes
  -> test every segment against every unrelated node box with 2px clearance
  -> zero hits: render normally, byte-identical geometry
  -> hit: fail with a stable, actionable geometry receipt
```

This is deliberately a correctness gate, not an auto-router. Archify keeps the
author's topology and route controls; it refuses to silently publish a route
that erases an unrelated node.

## Current-worktree audit

### The five renderers do not yet share the same relationship guarantee

| Renderer | Existing node/layout checks | Relationship-vs-node check | Important legitimate geometry |
| --- | --- | --- | --- |
| Architecture | component bounds, 8px component separation, boundary membership/bounds, short connections, label-vs-component | **Missing** | a connection from a wrapped component to the outside must cross its boundary |
| Workflow | lane/column bounds, per-lane 8px node separation, phases/groups, short edges, label-vs-node and label-vs-label | **Present**, using `segmentIntersectsRect(..., 2)` and excluding endpoints | edges cross lane, phase, and group frames by design |
| Dataflow | stage/row bounds, 10px node separation, short labeled flows, label-vs-node and label-vs-label | **Missing** | flows cross stage containers by design |
| Lifecycle | band/column bounds, cross-lane 10px state separation, short transitions, label-vs-state and label-vs-label | **Missing** | transitions cross lifecycle bands by design |
| Sequence | participant width, timeline bounds, message spacing where x-spans overlap, label-vs-label, segment/activation ranges | **No generic routed-edge check** | a message from A to C crosses B's lifeline; messages attach to lifelines/activation bars intentionally |

The relevant implementation evidence is in:

- `archify/renderers/shared/geometry.mjs`: `segmentIntersectsRect` already
  provides the shared segment/rectangle primitive;
- `archify/renderers/workflow/render-workflow.mjs`: the only renderer that
  currently expands unrelated node boxes by 2px and rejects a crossing;
- `archify/renderers/architecture/render-architecture.mjs`,
  `dataflow/render-dataflow.mjs`, and `lifecycle/render-lifecycle.mjs`: all
  compute exact route points before validation, but only enforce distance and
  label collisions; and
- `archify/scripts/check-render-output.mjs`: performs a separate, post-render
  segment/box calculation only for legend clearance. It does not check
  relationship paths against semantic nodes.

The CLI's validation path already invokes the renderer before running the
post-render checks. Therefore the Clean Flow Gate belongs beside the exact
route construction, before `writeDiagram()`, rather than in a second SVG parser
that must reconstruct author intent from markup.

### The existing test suite proves the asymmetry

`archify/test/layout-rules.test.mjs` has a focused negative fixture for a
workflow edge crossing a non-endpoint node, and
`archify/test/geometry.test.mjs` directly tests the segment/rectangle
primitive. There is no equivalent negative fixture for architecture,
dataflow, or lifecycle, and no sequence-specific exemption fixture.

The repository has 11 canonical examples covering all five renderer types.
They are the right compatibility corpus: the new gate must accept all of them
unchanged and must not alter the generated SVG/HTML bytes for accepted input.

## Primary-source comparison

### Fireworks Tech Graph: strict profiles are useful, but profiles matter

Fireworks' official composition contract separates style from geometry and
sets a strict `showcase` profile: zero edge crossings, zero bridge jumps, at
most two bends per edge, route-stretch and spacing limits, and measurable
clearance around unrelated geometry. It also says container-crossing routes
should use an open corridor rather than run on the container border, and it
keeps stress fixtures separate from showcase baselines.

Source: [Fireworks composition-quality contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md)

**Borrow:** successful rendering is not sufficient evidence of a clean
composition; geometry needs a delivery gate.
**Adapt:** begin with the one invariant Archify can infer exactly from its
current schemas: no relationship through an unrelated semantic node.
**Skip for this slice:** Fireworks' zero edge-crossing, bend, stretch, 40px
spacing, container-gutter, and bridge budgets. Those belong to a future named
quality profile, not an unconditional retrofit over Archify's existing
engineering examples.

### Graphviz: route around nodes, but do not generalize across routing modes

Graphviz documents that spline routing goes around nodes, while line and
polyline modes are distinct choices. Its orthogonal mode is explicitly limited:
it does not handle ports or, in `dot`, edge labels. Graphviz also distinguishes
node avoidance from cluster avoidance; only a specific compound-routing mode
is described as avoiding clusters as well as nodes.

Source: [Graphviz `splines` attribute](https://graphviz.org/docs/attrs/splines/)

**Borrow:** semantic nodes and grouping containers are different obstacle
classes.
**Adapt:** Archify should hard-gate peer node boxes and explicitly exempt
container frames until it has container ports/corridors.
**Skip:** assuming that choosing an orthogonal path automatically makes ports,
labels, and clusters correct.

### ELK: crossings are minimized; edge-node spacing is a first-class invariant

ELK Layered supports straight, orthogonal, and spline routing, honors arbitrary
port constraints for orthogonal routes, supports compound graphs, and reorders
layers to minimize edge crossings. Its official `Edge Node Spacing` option is
specifically the spacing preserved between nodes and edges, with a default of
10. The wording is important: ELK minimizes crossings rather than declaring
that every possible graph can have zero crossings.

Sources:

- [ELK Layered algorithm](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- [ELK Edge Node Spacing](https://eclipse.dev/elk/reference/options/org-eclipse-elk-spacing-edgeNode.html)

**Borrow:** edge-node clearance should be one explicit, reusable contract;
source/target ports and compound containers require their own semantics.
**Adapt:** retain Archify's current 2px workflow clearance in the first shared
gate so the rollout fixes inconsistency without silently tightening every
existing layout.
**Skip:** claiming a global zero-crossing guarantee when Archify is not running
a crossing-minimizing layout algorithm.

### D2: specialized layout semantics and containers limit universal rules

D2 describes its ELK integration as producing clean orthogonal routes,
minimizing crossings, and natively handling container-to-container routing. It
also treats sequence diagrams as a specialized ordered layout: messages are
ordered, participants have lifelines, groups are sequence containers, and
activation spans are explicit semantics.

Sources:

- [D2 ELK layout](https://d2lang.com/tour/elk/)
- [D2 sequence diagrams](https://d2lang.com/tour/sequence-diagrams/)

**Borrow:** renderer-specific semantics must survive a shared quality layer.
**Adapt:** sequence participant header boxes can join the shared semantic-node
obstacle set, but lifelines, activations, and segment frames must remain
exempt. A valid A-to-C message crossing B's lifeline is not an edge-through-node
failure.
**Skip:** treating every visible rectangle or line as the same obstacle type.

### Structurizr: manual correction is a legitimate completion path

Structurizr recommends manual layout for precise, consistent positioning. Its
editor lets a user add/move relationship vertices, move a relationship label,
and switch direct/orthogonal/curved routing. Its automatic-layout documentation
also tells users to return to manual mode when auto-layout does not produce a
good result.

Sources:

- [Structurizr diagram editor](https://docs.structurizr.com/ui/diagrams/editor)
- [Structurizr automatic layout](https://docs.structurizr.com/ui/diagrams/automatic-layout)

**Borrow:** a failed route needs a repair path, not a generic “invalid layout”
message.
**Adapt:** Archify's receipt should point directly to `via`, `route`,
`fromSide`, `toSide`, or the renderer's placement controls.
**Skip:** automatic mutation of authored JSON during validation.

## Why zero edge-edge crossings is not the Round 43 hard gate

Fireworks' showcase profile proves that zero crossings can be a valuable
delivery target. It does not prove that zero is a universal correctness rule.
Graphviz and ELK describe crossing reduction/avoidance in the context of
specific routing algorithms, D2 exposes different engines and special sequence
semantics, and Structurizr offers manual vertices/routing when automatic layout
needs correction.

Archify currently has no schema concept for a junction, shared corridor,
bridge, or intentional crossing. A geometric intersection alone therefore
cannot distinguish:

1. an accidental X crossing;
2. two relationships sharing a source/target port;
3. a T-junction-like branch or merge drawn through common route points;
4. two edges intentionally sharing part of a channel; or
5. a sequence message crossing an unrelated lifeline.

An unconditional edge-edge gate would either reject legitimate authored
geometry or require undocumented heuristics. Round 43 should record edge-edge
crossing analysis as a later `showcase` profile candidate, after explicit
junction/port semantics exist. Automatic bridge jumps should remain rejected
as a substitute: they decorate ambiguity rather than remove it.

## Bounded Clean Flow Gate contract

### Product sentence

**Archify never publishes a relationship through an unrelated semantic node,
and when it refuses a route it tells the author exactly which segment and
which knob to change.**

### Hard invariant

For each resolved relationship in each typed renderer:

1. Use the exact route points already used to render the relationship.
2. Split adjacent points into indexed line segments.
3. Build an obstacle list containing only the renderer's primary semantic
   entity boxes:
   - architecture: components;
   - workflow: nodes;
   - dataflow: nodes;
   - lifecycle: states; and
   - sequence: participant header boxes.
4. Exclude every obstacle whose `id` equals the relationship's `from` or `to`.
   This is the endpoint-port exemption and also makes a future self-loop
   deterministic.
5. Expand every unrelated obstacle by **2px**, matching the current workflow
   behavior, and test every route segment against it.
6. Report at most one issue per relationship/obstacle pair, using the first
   intersecting segment for deterministic output.
7. Any hit fails layout validation before the output file is written.
8. Accepted diagrams render through the existing code path without changing
   route points, SVG markup, styles, animation, viewer state, or export.

### Explicit exemptions

The gate must not treat the following as semantic node obstacles:

- the relationship's source and target entity boxes;
- architecture boundaries, workflow lanes/phases/groups, dataflow stages,
  lifecycle bands/lanes, or sequence segment frames;
- sequence lifelines and activation bars;
- background grid, title, footer, legend, story/viewer chrome, or decorative
  animation layers; and
- edge labels, because existing renderer-specific label collision rules remain
  the owner of label geometry in this slice.

Container boundaries are not “ignored because they do not matter.” They are
exempt because crossing them can be semantically necessary and Archify has no
open-gap/container-port model yet. Existing boundary-bounds and legend
clearance checks remain intact.

### Shared API shape

The implementation should add one pure shared helper rather than copy the
workflow loop into four files. A suitable responsibility boundary is:

```js
findRelationshipObstacleHits({
  relationships,       // [{ index, item, points }]
  obstacles,           // measured semantic entity rects with id
  clearance: 2
})
// -> [{ relationshipIndex, relationship, obstacle,
//       segmentIndex, segment, clearance }]
```

The helper should own segment enumeration, endpoint exclusion, intersection,
deduplication, and deterministic ordering. Renderers should own nouns and repair
advice (`Connection`/`Edge`/`Flow`/`Transition`/`Message`, component/node/state,
and their supported routing/placement knobs).

Do not make the shared helper parse SVG, read schema-specific collections, or
throw renderer-branded errors. This keeps the geometry oracle pure and directly
testable.

## Diagnostic contract

Every failure should carry enough evidence for a human or coding agent to fix
the JSON without opening the generated artifact. Internally, retain these
fields even if the first CLI surface is formatted text:

| Field | Example | Purpose |
| --- | --- | --- |
| `code` | `clean-flow/edge-through-node` | stable machine classification |
| `diagramType` | `dataflow` | renderer context |
| `relationshipPath` | `/flows/3` | exact JSON collection/index |
| `relationshipId` | `ingest-to-warehouse` or `null` | stable authored identity when available |
| `from`, `to`, `label` | `ingest`, `warehouse`, `events` | semantic relationship receipt |
| `obstacleKind`, `obstacleId` | `node`, `transform` | unrelated object being crossed |
| `segmentIndex` | `1` | exact pair in the route points |
| `segment` | `[[260, 180], [500, 180]]` | visible geometry evidence |
| `clearance` | `2` | threshold that caused rejection |
| `routing` | `route`, `fromSide`, `toSide`, `via` values | current authored controls |
| `suggestions` | ordered repair options | actionable next moves |

Representative human text:

```text
[clean-flow/edge-through-node] Data-flow /flows/3 "ingest" -> "warehouse"
crosses unrelated node "transform" at segment 1 [260, 180] -> [500, 180]
(2px clearance). Suggested fix: add/adjust via, choose another route/channel,
change fromSide/toSide, or move "transform" to another stage/row.
```

Renderer-specific final placement hints should be:

- architecture: change `via`, `route`, `fromSide`/`toSide`, or component
  `pos`/grid row/column;
- workflow: change `via`, `route`/channel, `fromSide`/`toSide`, or node
  lane/column/`yOffset`;
- dataflow: change `via`, channel route/coordinates,
  `fromSide`/`toSide`, or node stage/row/`yOffset`;
- lifecycle: change `via`, channel route/coordinates,
  `fromSide`/`toSide`, or state column/`yOffset`; and
- sequence: change participant order or message `y` if a future layout makes a
  message hit an unrelated participant header. Never suggest moving a lifeline.

## Test contract

### Shared geometry unit tests

Add direct tests for:

1. one segment crossing an unrelated rectangle;
2. a route clearly outside the rectangle;
3. a tangent/near route caught by the 2px clearance;
4. source and target boxes excluded even though their anchor segment touches
   their boundary;
5. a multi-segment route reporting the first intersecting segment index;
6. one issue per relationship/obstacle despite multiple intersecting segments;
7. deterministic ordering by relationship index, obstacle order, and segment
   index; and
8. zero-length adjacent points handled deterministically without a crash.

### Renderer fixtures

Add focused fixtures whose only new defect is the crossing:

- architecture: straight A -> C through unrelated component B;
- workflow: retain the existing straight left -> right through middle case but
  assert the new stable receipt fields/message;
- dataflow: stage 0 -> stage 2 through a node in stage 1 on the same row;
- lifecycle: left -> right transition through a middle state in the same band;
- sequence: a positive exemption case where A -> C crosses B's lifeline and
  remains valid, plus a normal participant-header obstacle test at the shared
  helper level.

For every negative renderer fixture, assert non-zero exit, stable code,
collection/index or identity, obstacle id, segment index/coordinates, 2px
clearance, and at least one valid repair knob. Also assert the process does not
fall through to a `TypeError` or write an apparently successful output.

### Compatibility and regression gates

1. All 11 canonical JSON examples validate and render.
2. Existing golden/canonical output remains byte-identical for accepted input.
3. Existing label, legend, overlap, finite-coordinate, schema, degraded-mode,
   route, animation, print, and export tests remain green.
4. `archify validate <type> <input>` and direct renderer invocation reject the
   same bad geometry.
5. No new schema property or dependency is required.

## Browser acceptance

The gate itself is generation-time, so browser QA proves that successful input
was not over-tightened or visually mutated; the failure receipt is verified in
the terminal.

1. Regenerate the 11 canonical examples and open fresh outputs through the
   in-app browser, not stale file tabs.
2. Inspect at least one relationship-dense architecture/workflow artifact at
   desktop size and `390 x 844` mobile size.
3. Confirm routes, arrowheads, labels, container crossings, chapter/story
   controls, trace/focus, zoom, theme, export, and settled animation remain
   visually unchanged.
4. Exercise a valid cross-container route and a sequence A-to-C message that
   crosses an intermediate lifeline; both must remain visible and valid.
5. Confirm zero browser console errors and no page-level horizontal overflow.
6. Run one bad fixture in the terminal and confirm it fails before producing a
   usable artifact with the complete Clean Flow receipt.

## Borrow / Adapt / Skip

| Decision | Round 43 contract |
| --- | --- |
| Borrow | Fireworks' rule that geometry quality is a delivery gate, independent of style. |
| Borrow | Graphviz/ELK's distinction between node avoidance and compound/container routing. |
| Borrow | ELK's explicit edge-node spacing concept. |
| Borrow | Structurizr's actionable manual route controls as the repair path. |
| Adapt | Reuse Archify's exact authored route points and the existing 2px workflow clearance. |
| Adapt | Apply one pure helper across all five renderers while keeping renderer-specific nouns and hints. |
| Adapt | Preserve sequence lifeline/activation semantics and cross-container routes through explicit exemptions. |
| Skip | Automatic rerouting or mutation of authored JSON. |
| Skip | Universal zero edge-edge crossings before junction/shared-corridor semantics exist. |
| Skip | Bridge jumps, decorative duplicate connectors, or copied Fireworks implementation. |
| Skip | New schema fields, quality profiles, dependencies, or post-render SVG reconstruction in this slice. |

## Follow-on, only after this gate has real corpus evidence

The next geometry step should be evidence-driven. If the 11 canonical examples
and real user diagrams show repeated edge-edge ambiguity, design an explicit
`showcase` profile with junction/port/shared-corridor semantics and report
crossing counts, bends, route stretch, and container-border runs. Until then,
the right improvement is the small, strict statement Archify can prove today:
an unrelated node is never used as an edge corridor.
