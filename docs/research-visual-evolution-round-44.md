# Visual Evolution Round 44 — Composition Receipt

Date: 2026-07-20
Status: implementation-ready research decision

## Executive decision

Build a deterministic **Composition Receipt**, backed by one shared visible-path
geometry implementation, and introduce a named `showcase` quality profile.

Do **not** promote every geometric edge intersection to an unconditional layout
error. Keep Round 43's edge-through-unrelated-node rule as a universal safety
gate, make route-on-container-border a second universal hard error, and classify
the remaining composition signals as profile-aware errors, warnings, or metrics.

```text
resolved semantic relationships + final visible path primitives + typed frames
  -> normalize routes without losing curves
  -> classify pair interactions (proper X / touch / overlap / shared endpoint)
  -> measure bends, stretch, shortest segment, border runs, stacked arrowheads
  -> standard: safety errors + composition warnings and metrics
  -> showcase: safety errors + unrelated proper X/overlap errors + warnings
  -> embed one structured receipt in the artifact
  -> CLI, check-render-output, Gallery, tests read the same receipt contract
```

The receipt is more valuable than another visual control. It converts “this
looks busy” into a stable author repair loop, makes Gallery proof honest, and
lets Archify tighten polished examples without rejecting legitimate engineering
topologies.

## Current-worktree audit

### What the existing receipts prove — and what they do not

The generated Gallery manifest contains 11 typed sources and 111 semantic
relationships across architecture, workflow, sequence, dataflow, and lifecycle.
At the start of this audit it recorded 44 successful checks: four per artifact,
covering a single SVG, finite output, absence of one-segment diagonal arrows,
and legend clearance.

Those checks do not measure:

- relationship-to-relationship crossings;
- shared channels or stacked arrowheads;
- route bends, stretch, or short segments;
- a route running on a container, stage, group, or lane border; or
- whether a Gallery artifact satisfies a named polished-delivery profile.

`archify/renderers/shared/layout-report.mjs` serializes component and connection
geometry only for architecture. `archify inspect` and `validate --layout-json`
are likewise architecture-only. The other four renderers already compute exact
routes but do not expose a common layout or composition report. The current
Gallery receipt is therefore an artifact-integrity receipt, not a composition
receipt.

### The live crossing experiment proves why a profile is required

During this research, a concurrent worktree change added
`cleanCrossingProblems()` to all five renderers and a
`relationship_crossings` check to `check-render-output.mjs`. Against the current
11 generated artifacts, that checker finds four unrelated proper intersections:

| Artifact | Left relationship | Right relationship | Visible intersection |
| --- | --- | --- | --- |
| Production Deployment Ownership | `api_a -> events` | `postgres -> replica` | `[1000, 276]` |
| Incident Response Runbook | `triage -> contain` | `declare -> update` | `[356, 290]` |
| Order Event-stream Topology | `enrich -> state` | `validate -> dlq` | `[610, 385]` |
| Agent Run Lifecycle | `executing -> failed` | `approval -> cancelled` | approximately `[322.1, 339]` |

The first three exist in the orthogonal route skeleton. The lifecycle crossing
is introduced by two rounded quadratic corners: renderer-side raw-polyline
validation accepts it, while the post-render visible-path check rejects it.
This is direct evidence that two separately implemented crossing calculations
will drift and that visible composition must be evaluated from final path
primitives, including curves.

The generated `docs/gallery/manifest.json` still says all 44 old checks pass,
while the live five-check validator rejects four stored artifacts. A future
receipt must be generated and consumed atomically so Gallery cannot display a
stale green claim after the checker contract changes.

### Corpus composition baseline

I audited the 111 business relationships in the stored SVG/HTML artifacts,
excluding legend arrows, lifecycle rails, lifelines, animation echoes, and
decorative shapes. Rounded paths were flattened deterministically for visible
intersection analysis; bend and segment metrics were recovered from the route
skeleton, with duplicate and collinear waypoints normalized.

| Signal | Current corpus | Interpretation |
| --- | ---: | --- |
| Unrelated proper X crossings | 4 relationship pairs | Real showcase debt; not proof that every engineering topology must be planar |
| Shared-endpoint collinear channel pairs | 13 | Mostly intentional branch/merge routing; an unconditional overlap ban would misfire |
| Relationships with more than 2 bends | 8, all with 3 bends | Useful pressure signal, not a universal correctness failure |
| Maximum bends on one relationship | 3 | Small, bounded debt; no staircase explosion |
| Route stretch above 1.35 | 4 | Includes legitimate bottom/feedback corridors; needs route-class context |
| Maximum Manhattan stretch | 2.34 | `approval -> cancelled`, an authored recovery detour |
| Positive skeleton segments below 16px | 5, minimum 13px | Endpoint stubs; warn before deciding a renderer-specific minimum |
| Routes collinear with a structural frame border | 2 | Mechanically unambiguous visual defects |

The two border runs are concrete:

1. Product Analytics `web -> edge` follows the Sources stage's right border
   (`x=184`) for 114px.
2. Web App `auth -> api` follows the security-group top border (`y=270`) for
   99px.

Both routes remain semantically valid and pass Clean Flow, yet visually merge a
business connector with a structural frame. This is the strongest next
universal hard invariant.

## Primary-source findings

### Fireworks Tech Graph: borrow the profile boundary, not every number

Fireworks' official [Composition Quality Contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md)
separates style from geometry and defines a strict `showcase` profile: zero edge
crossings and bridges, at most two bends per edge, Manhattan stretch at most
1.35, a 16px shortest segment, and explicit spacing/gutter budgets. It also
requires open container-crossing corridors, distinct ports for edges sharing a
side, and no stacked arrowheads.

Its official [composition quality implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/composition_quality.py)
is explicitly profile-based: `standard` is much looser than `showcase`, stretch
is polyline Manhattan length divided by direct endpoint Manhattan distance, and
the total-bend budget belongs to a particular six-node reference topology. Its
[geometry implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/fireworks_geometry.py)
distinguishes proper crossings, touches, and collinear overlaps; a shared
coordinate endpoint is exempted from crossing, while an overlap remains a
violation.

**Borrow:** named delivery profiles, structured metrics, and the rule that a
successful render is not yet polished delivery.
**Adapt:** verify shared *semantic* endpoints and renderer route classes instead
of trusting coordinate equality; use Archify's real corpus to calibrate warning
budgets.
**Skip:** the six-node total-bend budget, a topology-dependent 0–100 score, and
an unconditional copy of every showcase number.

### Graphviz: shared routes and crossings are routing semantics

Graphviz's [`splines` documentation](https://graphviz.org/docs/attrs/splines/)
says spline routing goes around nodes but does not promise zero edge-edge
crossings; orthogonal routing also has documented port and edge-label
limitations. Its [`concentrate` option](https://graphviz.org/docs/attrs/concentrate/)
deliberately merges multiedges and lets partially parallel relationships share
paths. `samehead` and `sametail` in the official [edge attribute reference](https://graphviz.org/docs/edges/)
likewise allow edges to target a common head or tail point.

**Borrow:** treat node avoidance as safety and crossing reduction as composition.
**Adapt:** classify shared semantic source/target channels separately.
**Skip:** assuming every collinear overlap or common endpoint is accidental.

### ELK/Libavoid: crossings, shared paths, and junctions are separate concepts

[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
reorders nodes to *minimize* crossings and then computes bend points; it supports
ports, multi-edges, compound graphs, and junction output. The official
[shared-endpoint nudging option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-alg-libavoid-nudgeSharedPathsWithCommonEndPoint.html)
defaults to separating common-endpoint intermediate paths but explicitly allows
keeping the whole shared path overlapped. [Junction Points](https://eclipse.dev/elk/reference/options/org-eclipse-elk-junctionPoints.html)
are explicit output for orthogonal hyperedges, rather than something inferred
from an arbitrary geometric touch. [Cluster Crossing Penalty](https://eclipse.dev/elk/reference/options/org-eclipse-elk-alg-libavoid-clusterCrossingPenalty.html)
treats boundary crossing as a configurable routing cost, not an unconditional
error.

**Borrow:** explicit issue classes and junction semantics.
**Adapt:** only border-*collinearity* is universally wrong in Archify today;
necessary perpendicular entry/exit through a container remains legal.
**Skip:** guessing a junction from a T touch or coordinate coincidence.

### D2: renderer semantics limit universal thresholds

D2's official [ELK comparison](https://d2lang.com/tour/elk/) credits ELK with
clean orthogonal routes, crossing minimization, and container-to-container
routing, while also acknowledging unnecessary bends. D2's [sequence diagram
rules](https://d2lang.com/tour/sequence-diagrams/) give message ordering,
lifelines, activation spans, groups, and self-messages specialized semantics.

**Borrow:** assess the final path while preserving renderer meaning.
**Adapt:** sequence messages are ordinary receipt relationships, but lifelines,
activation bars, and frames are not business edges. Self-messages have no
ordinary stretch denominator.
**Skip:** one geometry threshold applied blindly to every visible line.

### Structurizr and LikeC4: quality includes an author repair path

Structurizr recommends [manual layout](https://docs.structurizr.com/ui/diagrams/editor)
for precise, consistent placement and lets authors add/move relationship
vertices, move labels, and switch direct/orthogonal/curved routing. Its
[automatic-layout documentation](https://docs.structurizr.com/ui/diagrams/automatic-layout)
explicitly tells users to return to manual mode when auto-layout is not good
enough.

LikeC4's official [Graphviz printer](https://github.com/likec4/likec4/blob/main/packages/layouts/src/graphviz/DotPrinter.ts)
uses compound graphs, splines, node spacing, and rank spacing. Its official
[AI layout prompt](https://github.com/likec4/likec4/blob/main/packages/layouts/src/graphviz/ai/prompt-system.md)
asks to minimize crossings and prefer balanced, straighter edges through
layout constraints; it does not redefine every remaining crossing as invalid
model content.

**Borrow:** every issue must name an author-controlled repair knob.
**Adapt:** point to `via`, `route`, `fromSide`, `toSide`, channel coordinates,
row/column placement, or profile selection.
**Skip:** silently mutating authored JSON or hiding an unsolved route with a
bridge decoration.

## Borrow / Adapt / Skip decision

### Borrow

- A two-layer contract: universal safety and named composition quality.
- A machine-readable per-artifact receipt, not a single green boolean.
- Visible-path classification into proper crossing, touch, and overlap.
- Deterministic bend, stretch, segment, border, and arrowhead metrics.
- Separate polished baselines from engineering/stress artifacts.

### Adapt

- Validate semantic endpoint identity, not just coordinate equality.
- Keep shared-source/target channels measurable and non-blocking until Archify
  has explicit ports or junctions.
- Compute visible crossings from final `M/L/H/V/Q` geometry, while computing
  bends and segment lengths from the normalized route skeleton.
- Give feedback/corridor/self-loop routes their own context instead of forcing
  one global stretch budget.
- Treat a perpendicular container entry/exit as legal and a collinear border
  run as an error.

### Skip

- Zero crossings as the default correctness contract.
- “Every overlap is invalid.”
- A universal total-bends budget or cross-topology 0–100 score.
- Coordinate-inferred junctions, bridges, or shared ports.
- Pixel screenshot diffs as the source of geometry truth.
- A new artifact-side quality panel; Gallery and CLI are the right first
  surfaces, keeping the diagram itself visually quiet.

## Composition Receipt contract

### Product sentence

**Archify tells an author whether a diagram is safe, whether it is polished,
and exactly which route decision keeps it from the next quality profile.**

### Profiles

| Profile | Intended use | Exit behavior |
| --- | --- | --- |
| `standard` (default) | Real engineering diagrams and backwards-compatible rendering | Safety errors fail; composition issues warn and remain machine-readable |
| `showcase` (opt-in) | Official Gallery scenes, README hero artifacts, polished delivery | Safety errors, unrelated proper X crossings, unrelated collinear overlaps, and border runs fail; calibrated route-budget issues warn in v1 |

Do not add `stress` merely as an escape hatch. Existing `standard` already
supports dense engineering scenes. A future stress corpus can be a test-suite
classification without becoming public JSON API.

### Severity matrix

| Code | Classification | `standard` | `showcase` | Reason |
| --- | --- | --- | --- | --- |
| `safety/edge-through-node` | unrelated relationship through semantic node | error | error | Round 43 mechanically unambiguous invariant |
| `safety/non-finite-path` | unusable path coordinate | error | error | invalid artifact |
| `composition/container-border-run` | business route collinear with structural border for more than tolerance | error | error | business and grouping semantics become visually indistinguishable |
| `composition/proper-crossing` | proper interior X, no shared semantic endpoint | warning | error | valid in complex graphs, unacceptable in an explicitly polished profile |
| `composition/unrelated-overlap` | positive-length collinear overlap with no shared semantic endpoint | warning | error | likely accidental, but standard must not guess an undeclared junction |
| `composition/touch` | endpoint/T touch without explicit junction | warning | warning | ambiguous until junction semantics exist |
| `composition/shared-channel` | positive overlap with shared semantic source/target | metric | metric | Graphviz/ELK show it can be intentional |
| `composition/stacked-arrowhead` | multiple business arrowheads at the same endpoint coordinate | warning | warning | Fireworks rejects it, but Archify lacks port-offset controls today |
| `composition/bend-budget` | normalized direction changes above suggested budget | warning | warning | eight real routes currently use three bends legitimately |
| `composition/stretch-budget` | route/direct Manhattan ratio above suggested budget | warning | warning | feedback and bottom corridors need route-class context |
| `composition/short-segment` | positive normalized segment below suggested budget | warning | warning | endpoint stubs need renderer calibration |
| `composition/boundary-crossing-count` | required frame entries/exits | metric | metric | crossing a container is not itself a defect |

After explicit `port`, `junction`, and route-role semantics exist, Archify can
promote undeclared touches and stacked arrowheads to `showcase` errors. Doing so
before authors have a precise repair control would turn the validator into a
dead end.

### Normalization and measurement rules

1. Only semantic relationships with stable `from`, `to`, collection index, and
   optional `id` enter the receipt.
2. Decorations, glow/casing echoes, lifecycle rails, lifelines, activation
   bars, segment frames, legends, and viewer overlays are excluded by semantic
   role rather than CSS class guesses.
3. Preserve final path primitives. Flatten `Q` curves at a deterministic
   tolerance for intersection analysis; do not replace a curve with its chord.
4. Recover a route skeleton for bends/segments. Remove consecutive duplicate
   points and collapse collinear waypoints. A bend is an actual direction
   change; rounded control points do not add extra bends.
5. A proper crossing requires both route interiors to cross. A coordinate that
   is an endpoint of either segment is a touch, not a proper crossing.
6. A shared-endpoint exemption requires the relationships to share the same
   semantic node ID. Coordinate equality alone never creates an exemption.
7. Collinear positive-length intersections are overlaps and retain their total
   overlap length. Classify them as shared or unrelated by semantic endpoints.
8. Stretch is route Manhattan length divided by direct endpoint Manhattan
   length. Return `null`, not infinity, for self-loops or a zero denominator.
9. Count only positive segments after normalization. Report minimum segment
   length and the relationship/segment that owns it.
10. Structural frames are typed: architecture boundary, workflow lane/group,
    dataflow stage, sequence segment, or lifecycle separator/band. Only a
    positive collinear run on a frame border is a hard defect; point entry/exit
    remains a metric.
11. Preserve exact measurements internally and round only serialized display
    values. Sort issues by severity, code, relationship collection/index, other
    relationship index, and segment index for deterministic output.

### Receipt shape

```json
{
  "schemaVersion": 1,
  "profile": "showcase",
  "status": "fail",
  "summary": { "errors": 1, "warnings": 3 },
  "metrics": {
    "relationshipCount": 12,
    "properCrossings": 1,
    "touches": 0,
    "unrelatedOverlapPairs": 0,
    "sharedChannelPairs": 2,
    "stackedArrowheads": 1,
    "maxBends": 3,
    "overBendBudget": 1,
    "maxStretch": 1.45,
    "overStretchBudget": 1,
    "minSegmentPx": 25,
    "shortSegmentCount": 0,
    "containerBorderRuns": 0,
    "boundaryCrossings": 4
  },
  "issues": [
    {
      "severity": "error",
      "code": "composition/proper-crossing",
      "relationship": { "collection": "connections", "index": 6, "from": "api_a", "to": "events" },
      "otherRelationship": { "collection": "connections", "index": 9, "from": "postgres", "to": "replica" },
      "point": [1000, 276],
      "suggestion": "Move one via point or choose a separate boundary corridor."
    }
  ]
}
```

Do not serialize a single score. Counts and ratios should be compared within the
same artifact/profile or across deterministic versions of the same topology,
not ranked across unrelated diagrams.

## One source of geometry truth

The implementation should not leave one crossing algorithm in each renderer
and another in `check-render-output.mjs`. The lifecycle curve case already
proves that arrangement is inconsistent.

A suitable boundary is a pure shared module that accepts semantic route records
and typed frames and returns a receipt. It should own:

- SVG path tokenization/flattening for `M/L/H/V/Q/Z`;
- route-skeleton normalization;
- segment intersection and overlap classification;
- frame-border analysis;
- metric aggregation and deterministic diagnostics; and
- profile severity mapping.

Each renderer should provide the final rendered `d`, the unrounded route points,
semantic endpoint IDs, collection/index/ID, route role, and typed frames. The
same module can run before write. `writeDiagram()` should embed the receipt as
escaped JSON in a non-executable `<script type="application/json">` block.

`check-render-output.mjs` should parse and validate that receipt and independently
confirm only cheap artifact invariants (one SVG, finite markup, semantic path
count, receipt schema/version). It should not reimplement the full geometry
engine. If stronger tamper detection is needed, include a deterministic digest
of the canonical semantic path/frame records in the receipt.

## CLI, Gallery, and layout-report integration

### CLI

- `archify validate <type> <input> --json` returns `checks` plus
  `compositionReceipt` for all five types.
- Human output becomes, for example,
  `ok workflow ... (artifact 5/5; composition standard: 0 errors, 2 warnings)`.
- Add `--quality standard|showcase`; explicit CLI choice overrides
  `meta.quality_profile`, which otherwise defaults to `standard`.
- A `showcase` error exits non-zero and prints stable codes, both relationship
  identities, point/segment/frame geometry, and a renderer-specific repair hint.
- Generalizing architecture-only `inspect` is useful later, but should not block
  this receipt. `validate --json` is the cross-renderer delivery surface.

### Gallery

- Store the full compact receipt or its summary/metrics in
  `docs/gallery/manifest.json` beside hashes and artifact checks.
- Replace the ambiguous `4/4 pass` claim with separate facts, such as
  `Artifact 5/5` and `Composition SHOWCASE · PASS`.
- If warnings remain, show `PASS · 2 notes`, not a false all-green label.
- Keep detailed issues in an accessible disclosure or source/manifest link;
  do not add another permanent panel over the diagram.
- Gallery generation must fail if a configured `showcase` artifact has a
  composition error or if stored receipt counts do not match the current
  checker contract.

### Existing layout report

Do not expand `layout-report.mjs` by copying five renderer-specific object
serializers in this slice. Keep layout inspection and composition receipts
separate:

- layout report answers “where did the renderer place things?”;
- composition receipt answers “what quality signals does the final visible
  composition contain?”

They can share route-record types later. This avoids making architecture's
current inspect schema a de facto contract for sequence and lifecycle.

## Diagnostics

Diagnostics should remain compact and actionable:

```text
[composition/proper-crossing] showcase architecture connections[6]
"api_a" -> "events" crosses connections[9] "postgres" -> "replica"
at [1000, 276] (segments 2/1). Move a via point or use separate boundary corridors.

[composition/container-border-run] standard dataflow flows[0]
id "web-clickstream" "web" -> "edge" overlaps stage "01 / Sources"
right border for 114px at x=184. Move via/channelX into the 47px inter-stage corridor.

[composition/stretch-budget] warning workflow edges[3]
"contain" -> "recover" stretch 1.91 (suggested 1.35 for showcase direct routes).
This bottom-channel route remains valid; move the nodes or select standard if the detour is intentional.
```

Every diagnostic needs:

- stable code and severity;
- profile and diagram type;
- relationship collection/index/ID/from/to;
- other relationship or frame identity where applicable;
- point, segment indices, overlap length, or measured ratio;
- the active budget and route class; and
- a concrete supported repair knob.

## Required false-positive exemptions

1. Relationships sharing a semantic source or target are not proper-crossing
   errors merely because their endpoint coordinates match.
2. Shared channels remain metrics; do not infer a junction or bridge.
3. A T touch is not a proper X. Warn until explicit junction semantics exist.
4. A relationship may cross architecture boundaries, workflow lanes/groups,
   dataflow stages, sequence frames, and lifecycle bands at entry/exit points.
5. Sequence messages crossing lifelines are not relationship crossings.
6. Lifelines, activation bars, lifecycle rails, borders, legend arrows,
   animation echoes, and glow/casing layers are not business relationships.
7. Self-loops have no ordinary direct-distance stretch budget.
8. Feedback, recovery, and explicit corridor routes keep metrics but may use a
   renderer-specific suggested stretch budget.
9. Duplicate or collinear waypoints do not create bends or zero-length short
   segments.
10. Curve intersections must use the visible curve, not only its endpoints or
    original sharp corner.
11. All coordinates must be resolved into the same SVG user space before
    comparison; transforms and viewBox scaling cannot be mixed.
12. Rounded-frame corner arcs should not be modeled as full rectangular border
    lines near the corner radius.

## Implementation sequence

1. **Demote the current unconditional proper-crossing experiment.** Preserve
   its useful proper-intersection primitive, but map it through profile severity
   rather than adding every hit to renderer `problems`.
2. **Extract shared visible-path composition geometry.** Replace duplicated
   renderer/checker crossing math; add curve, touch, overlap, semantic endpoint,
   and typed-frame records.
3. **Generate structured receipts in all five renderers.** Embed them through
   `writeDiagram()` and expose them through `validate --json`.
4. **Fix the known showcase debt rather than grandfathering it.** Clear the four
   unrelated X crossings and the two border runs in the canonical sources;
   preserve source intent and named views.
5. **Add metrics without over-gating.** Record the 13 shared-channel pairs,
   eight over-two-bend routes, four >1.35 stretch routes, and five <16px
   segments as calibrated warnings/metrics.
6. **Upgrade Gallery receipts atomically.** Add composition profile/status and
   fail generation on stale checker/manifest contracts.
7. **Validate visually in the built-in browser.** Inspect every repaired route,
   then check Gallery presentation and responsive receipt behavior.

## Test plan

### Shared geometry unit tests

- proper orthogonal X, diagonal/curve X, and two curved-corner X fixtures;
- endpoint touch, T touch, parallel disjoint, collinear touch, and positive
  collinear overlap;
- same-coordinate/no-shared-ID is not exempt;
- shared source, shared target, and shared source-target channels;
- duplicate and collinear waypoint normalization;
- bend count and Manhattan stretch, including zero-denominator self-loop;
- rectangle-border crossing versus positive border run, including rounded
  corners;
- deterministic issue sorting and serialization.

### Renderer fixtures

- one deliberate proper crossing per architecture/workflow/dataflow/lifecycle;
- sequence messages remain ordered and lifeline crossings stay exempt;
- a rounded lifecycle curve crossing caught identically before and after write;
- legitimate boundary/lane/stage/frame entry and exit;
- a route-on-border failure in architecture and dataflow;
- shared branch/merge channels accepted with a metric;
- decorations and legend arrows never increase relationship counts.

### Corpus and CLI acceptance

- all 11 canonical sources render with identical semantic relationship counts;
- after route repair, `showcase` has zero unrelated proper X crossings and zero
  border runs across the official Gallery;
- the initial receipt baseline retains 13 shared-channel pairs, eight
  >2-bend routes, four >1.35-stretch routes, and five <16px segments unless a
  targeted source repair intentionally changes them;
- default `standard` exits zero for warning-only fixtures;
- `showcase` exits non-zero for proper X/unrelated overlap/border-run fixtures;
- renderer receipt, embedded receipt, CLI JSON, checker result, and Gallery
  manifest agree byte-for-byte on the canonical receipt summary;
- Gallery build refuses a stale check count or receipt schema version.

## Built-in browser acceptance

At desktop 1280×720 and mobile 390×844:

1. Open the Gallery and confirm every card distinguishes artifact checks from
   composition profile/status without truncating the primary action.
2. Open the four formerly crossing artifacts and the two formerly border-running
   artifacts at normal view and in their named story view; visually confirm
   separate corridors and preserved arrow direction/labels.
3. Toggle dark/light, focus, route trace, presentation, and guided playback on
   at least one artifact from each renderer; geometry and receipt status must
   not change with viewer state.
4. Confirm warning detail disclosure is keyboard reachable and does not overlay
   the SVG or enlarge the cold artifact shelf.
5. Confirm no horizontal page overflow on mobile, no clipped receipt text, no
   browser console errors, and no continuous animation after settled flow.
6. Export SVG/PNG and confirm the quality UI/receipt script does not become
   visible diagram content.

## Success criteria

Round 44 is successful when Archify can truthfully say:

> Every artifact carries a deterministic composition receipt. Safety defects
> always fail; polished showcase defects fail by profile; legitimate shared and
> renderer-specific geometry remains visible as evidence instead of being
> guessed away.

That improves both beauty and stability: canonical routes become cleaner, the
quality gate stops lying by omission, and dense user diagrams retain a viable
render-and-repair path.
