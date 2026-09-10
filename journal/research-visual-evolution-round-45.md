# Visual Evolution Round 45 — Clear Container Corridors

Date: 2026-07-20
Status: implementation-ready research decision

## Executive decision

Add one universal, deterministic **Clear Container Corridor** invariant:
a semantic relationship may cross a typed structural container border at a
point, but it may not run collinearly on that border for positive length.

Implement the invariant twice against the same contract:

```text
resolved relationship route skeleton + typed renderer frames
  -> pre-write authored-geometry gate
  -> final visible SVG path primitives + annotated structural frames
  -> post-write artifact receipt
  -> standard and showcase: zero container-border runs
```

Round 45 should also begin recording bend, Manhattan stretch, and shortest
normalized-segment metrics. Those three signals should be **metrics, not
warnings or errors yet**. The current corpus contains legitimate recovery,
feedback, boundary, and endpoint-stub routes that cross the borrowed Fireworks
numbers, while Archify does not yet serialize a route role rich enough to tell
an accidental detour from an intentional corridor.

This split is important:

- a positive border run is mechanically unambiguous and has a direct author
  repair path;
- bend, stretch, and short-segment numbers are useful evidence, but their
  severity still depends on renderer and route semantics.

## Current-worktree and corpus audit

### Existing quality surface

The 11 canonical sources contain 111 semantic relationships across all five
typed renderers:

| Renderer | Canonical artifacts | Relationships |
| --- | ---: | ---: |
| Architecture | 2 | 21 |
| Workflow | 3 | 31 |
| Sequence | 2 | 26 |
| Dataflow | 2 | 22 |
| Lifecycle | 2 | 11 |
| **Total** | **11** | **111** |

Round 43's Clean Flow Gate rejects a route through an unrelated semantic node.
Round 44's Composition Receipt classifies unrelated proper X crossings and
allows `standard` versus `showcase` delivery profiles. Neither rule catches a
business relationship becoming visually indistinguishable from a container
stroke.

Every renderer already resolves exact route points before writing output.
Architecture, workflow, dataflow, and sequence also render structural
rectangles, but those frames currently have only presentation classes such as
`c-region`, `c-security-group`, and `c-lane`; they do not carry stable semantic
frame identity for post-render inspection. Lifecycle renders dashed band
separators rather than container rectangles.

### Two relationship defects, three overlapping skeleton pieces

A read-only geometry audit of the generated Gallery artifacts found two
semantic relationships with positive visible collinearity against a structural
container border:

| Artifact | Relationship | Structural frame | Visible border run |
| --- | --- | --- | ---: |
| Product Analytics | `web-clickstream`, `web -> edge` | Sources dataflow stage, right side `x=184` | 114px |
| Web App | `jwt-verification`, `auth -> api` | `sg-api` security group, top side `y=270` | 99px |

The Web App route's unrounded skeleton has more border-aligned extent, but the
final rounded path contains a 99px straight `L` primitive. Its entering and
leaving quadratic corners are only tangent to the border and must not inflate
the run length. This is a concrete reason to validate final path primitives,
not a sampled curve approximation.

The current source JSON makes both defects repairable without changing
topology:

- move Product Analytics' `web -> edge` vertical channel from the Sources
  stage border into the open inter-stage gutter; and
- move Web App's `auth -> api` horizontal corridor above or below the security
  group border, then enter the destination through a perpendicular segment.

No tolerance or grandfather list should preserve either defect in the official
Gallery.

### Route-budget baseline

After normalizing duplicate/collinear waypoints and treating rounded corners as
one authored direction change, the current corpus baseline is:

| Signal | Current corpus | Decision for Round 45 |
| --- | ---: | --- |
| Relationships with more than 2 bends | 8, all with 3 bends | record metric only |
| Maximum bends | 3 | record metric only |
| Routes with Manhattan stretch above 1.35 | 4 | record metric only |
| Maximum Manhattan stretch | approximately 2.37 | record metric only |
| Positive normalized segments below 16px | 5 | record metric only |
| Shortest positive normalized segment | 13px | record metric only |
| Relationships on structural borders | 2 | hard error in both profiles |

The metrics are still valuable. They give future rounds a stable baseline and
identify routes worth inspecting. They are not yet evidence that the diagrams
are wrong.

## Primary-source findings

### Fireworks Tech Graph: borrow the corridor grammar and measurable budgets

Fireworks' official
[Composition Quality Contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md)
requires a cross-container route to use an open gap and explicitly says it
must not run on top of a container border. Its `showcase` profile also defines
at most two bends per edge, route/direct Manhattan stretch at most 1.35, and a
16px minimum route segment.

Its official
[composition-quality implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/composition_quality.py)
shows that these numbers belong to named profiles: `standard` permits 12 bends,
5.0 stretch, and zero minimum segment length, while `showcase` uses 2, 1.35,
and 16px. It calculates stretch from a route polyline and shortest length from
positive Manhattan segments. Its
[geometry implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/fireworks_geometry.py)
separates proper crossings, touches, and positive collinear overlaps.

**Borrow:** open container corridors, typed geometry, and measurable route
budgets.
**Adapt:** make border collinearity universal because it is unambiguous in
Archify's current schemas; retain the three route budgets as metrics until
route-role calibration exists.
**Skip:** copying Fireworks' showcase numbers as immediate Archify failures or
turning its topology-specific total-bend score into a universal score.

### Graphviz: containers and relationships have distinct routing semantics

Graphviz's official [`splines` documentation](https://graphviz.org/docs/attrs/splines/)
distinguishes straight, polyline, orthogonal, curved, and spline routing. Spline
routing is described as routing around nodes; orthogonal routing has explicit
port and label limitations. Graphviz's official
[`concentrate` option](https://graphviz.org/docs/attrs/concentrate/) deliberately
allows partially parallel relationships to share part of their paths.

**Borrow:** keep node avoidance, container geometry, and relationship sharing
as separate issue classes.
**Adapt:** compare a business route only with typed structural frames; do not
infer frames from every rectangle or reject relationship-to-relationship
shared channels under the container-border code.
**Skip:** treating every collinear pair of visible strokes as the same defect.

### ELK and Libavoid: bend pressure is a routing cost, not model invalidity

ELK's official [Libavoid Segment Penalty](https://eclipse.dev/elk/reference/options/org-eclipse-elk-alg-libavoid-segmentPenalty.html)
adds a cost for every connector segment after the first to avoid step-like
orthogonal paths. The official
[Fixed Shared Path Penalty](https://eclipse.dev/elk/reference/options/org-eclipse-elk-alg-libavoid-fixedSharedPathPenalty.html)
separately prices shared immutable connector segments. The
[collinear nudging option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-alg-libavoid-nudgeOrthogonalTouchingColinearSegments.html)
is optional and defaults off, while ELK Layered's
[unnecessary-bendpoint option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-unnecessaryBendpoints.html)
defaults to adding bend points only on actual direction changes.

**Borrow:** normalize direction changes, preserve separate interaction classes,
and use route complexity as optimization evidence.
**Adapt:** expose bend/segment measurements now, but do not convert a router
penalty into a schema-validation error.
**Skip:** counting rounded-corner helper points as bends or treating a
collinear endpoint touch as a positive run.

### D2: unnecessary bends exist even in a respected hierarchical router

D2's official [ELK comparison](https://d2lang.com/tour/elk/) lists clean
orthogonal routes, crossing minimization, and container-to-container routing
as strengths, while explicitly listing unnecessary bends as a weakness.

**Borrow:** keep straightness visible as a quality signal.
**Adapt:** calibrate the signal separately for architecture, workflow,
dataflow, lifecycle, and sequence.
**Skip:** claiming that one global bend count proves visual failure.

### Structurizr and LikeC4: quality needs spacing and an author-controlled repair

Structurizr's official [diagram editor](https://docs.structurizr.com/ui/diagrams/editor)
recommends manual layout for precise, consistent placement and lets an author
add/move relationship vertices or switch routing style. Its
[automatic-layout documentation](https://docs.structurizr.com/ui/diagrams/automatic-layout)
directs authors back to manual layout when automatic output is not good enough.

LikeC4's official
[Graphviz printer](https://github.com/likec4/likec4/blob/main/packages/layouts/src/graphviz/DotPrinter.ts)
uses compound graphs together with explicit node/rank separation, and its
official
[layout prompt](https://github.com/likec4/likec4/blob/main/packages/layouts/src/graphviz/ai/prompt-system.md)
asks for compounds to align with flows crossing their boundaries and for
balanced, straighter edges with fewer crossings.

**Borrow:** give every issue a concrete route or placement repair and preserve
space around compounds.
**Adapt:** point to Archify's existing `via`, channel, side, and placement
controls instead of silently editing authored JSON.
**Skip:** adding an opaque AI auto-layout step or hiding the defect with paint
order.

## Borrow / Adapt / Skip decision

### Borrow

- Open corridors for relationships crossing container boundaries.
- Typed structural-frame records rather than CSS-selector guesses.
- Positive collinear overlap as a different interaction from a point touch.
- Normalized bends, Manhattan stretch, and positive shortest-segment metrics.
- A validation result that names the relationship, frame, side, segment, and
  supported repair control.

### Adapt

- Border runs fail both Archify profiles; the Fireworks route-budget numbers
  remain metric thresholds in this slice.
- Inspect exact final `M/L/H/V/Q/Z` primitives. A quadratic curve is a border
  run only when the full relevant curve primitive is collinear, not merely
  tangent or close after sampling.
- Treat the straight portions of rounded rectangles as borders and the corner
  arcs as arcs; do not extend top/bottom/side borders through `rx` corners.
- Preserve necessary perpendicular entry/exit through nested containers.
- Keep lifecycle separator guides outside the v1 container-frame set; they are
  not closed grouping containers.

### Skip

- Distance-to-border heuristics or screenshot-pixel comparisons.
- Rejecting perpendicular boundary crossings.
- Counting a tangent point as a run.
- Node-card, label-mask, legend, activation, or overview-map rectangles as
  structural frames.
- Bend/stretch/short-segment warnings before route-role calibration.
- A cross-topology score or automatic route mutation.

## Clear Container Corridor contract

### Product sentence

**A relationship may enter or leave a container, but Archify never lets the
relationship masquerade as the container's own border.**

### Frame taxonomy

Only renderer-supplied structural frames enter this gate:

| Renderer | Included v1 frame kinds | Excluded geometry |
| --- | --- | --- |
| Architecture | region boundary, security group | components, node masks, legend boxes |
| Workflow | lane, authored group, exception inset | phase ruler, nodes, label masks |
| Dataflow | stage | nodes, label masks, legend |
| Sequence | authored time segment | participant cards, lifelines, activations |
| Lifecycle | none in v1 | dashed band separators and primary rail |

Each frame record must have stable identity and resolved SVG-user-space
geometry:

```js
{
  kind: 'security-group',
  id: 'sg-api',
  label: 'sg-api :443/:8000',
  x: 430,
  y: 270,
  width: 400,
  height: 110,
  rx: 8
}
```

Generated SVG should carry matching semantic attributes on the visible frame,
for example `data-graph-role="structural-frame"`, `data-frame-kind`, and
`data-frame-id`. Do not recover semantic identity from `c-lane` or another
presentation class.

### Exact hit definition

For every semantic relationship and every typed structural frame:

1. Resolve relationship and frame coordinates into the same SVG user space.
2. Parse the final visible route into exact primitives.
3. Represent each rounded rectangle's straight border intervals as:
   - top/bottom: `[x + rx, x + width - rx]` at `y` / `y + height`;
   - left/right: `[y + rx, y + height - rx]` at `x` / `x + width`.
4. A line primitive is collinear when its constant coordinate equals the
   border coordinate within `1e-6` SVG units and its interval has positive
   overlap greater than that epsilon.
5. A quadratic primitive counts only if start, control, and end are collinear
   with the same border; a tangent endpoint or sampled near-horizontal chord
   is not a run.
6. Merge adjacent collinear primitive overlaps owned by the same relationship,
   frame, and side before measuring.
7. Emit at most one issue per relationship/frame/side, with total visible
   overlap, the first owning segment/primitive, and the longest merged interval.
8. Sort by renderer collection/index, frame kind/ID, side, and segment index for
   deterministic output.

Any positive hit fails both `standard` and `showcase`. The issue code is:

```text
composition/container-border-run
```

Suggested diagnostic:

```text
[composition/container-border-run] dataflow flows[0] id "web-clickstream"
"web" -> "edge" runs on stage "sources" right border for 114px at x=184
(segment 1). Move channelX/via into the inter-stage gutter, or change the
endpoint side so the route crosses the border perpendicularly.
```

### Required false-positive exemptions

The detector must accept all of the following:

1. A perpendicular relationship crossing a frame border at one point.
2. A relationship endpoint touching a frame border at one point.
3. A relationship tangent to a rounded corner at one point.
4. A route parallel to but separated from a border, regardless of stroke width
   or browser anti-aliasing.
5. A route overlapping a rounded rectangle's mathematical bounding-box side
   only inside the `rx` corner interval, where no straight border exists.
6. Relationships sharing a source, target, port coordinate, or business-edge
   channel; those interactions belong to the relationship-interaction receipt.
7. Sequence messages crossing lifelines, and messages crossing segment sides
   perpendicularly.
8. Lifecycle transitions crossing dashed band separators.
9. Decorations, animation echoes, glow/casing paths, lifecycle rails,
   lifelines, activation bars, phase rulers, legends, label masks, viewer
   overlays, and background-grid paths.
10. Node-card borders: a relationship terminating on its own semantic node is
    handled by endpoint semantics, and an unrelated node remains owned by the
    Clean Flow Gate.

There is no generic source/target exemption for a structural frame in v1,
because current Archify relationships target semantic nodes, not containers.
If container endpoints are added later, the exemption must require an explicit
semantic frame ID rather than coordinate coincidence.

## Route-budget metrics contract

Add these values to the Composition Receipt without creating issues or changing
exit status:

```json
{
  "metrics": {
    "containerBorderRuns": 0,
    "maxBends": 3,
    "routesOverSuggestedBends": 2,
    "maxStretch": 1.914,
    "routesOverSuggestedStretch": 2,
    "minSegmentPx": 13,
    "shortSegmentCount": 1
  },
  "suggestedLimits": {
    "bendsPerRelationship": 2,
    "stretch": 1.35,
    "segmentPx": 16
  }
}
```

Measurement rules:

- Use the renderer-supplied unrounded route skeleton for bends, stretch, and
  segment length; use final visible primitives for border runs.
- Remove consecutive duplicate points and collapse collinear waypoints first.
- A bend is a direction change, not a waypoint count. Rounded-corner control
  points do not add bends.
- Stretch is normalized Manhattan route length divided by direct endpoint
  Manhattan distance.
- A self-loop or zero direct-distance denominator serializes `null` stretch and
  does not enter the over-threshold count.
- Ignore zero-length segments after normalization. Measure positive segments,
  including real endpoint stubs.
- Keep exact values internally; round only serialized display values.
- Retain per-relationship measurements internally so a future Gallery detail
  view can identify the owner without rerunning geometry.

Do not show a yellow warning badge merely because a metric exceeds a borrowed
suggestion. In Round 45, the receipt should say `PASS` when border/crossing
contracts pass and expose route-budget numbers as neutral evidence.

## Implementation sequence

1. Add one pure shared helper for typed-frame border runs. Reuse the existing
   path parser/normalizer rather than duplicating geometry in every renderer.
2. Have architecture, workflow, dataflow, and sequence supply typed frames to
   the pre-write gate. Lifecycle supplies an empty frame set in v1.
3. Annotate visible structural frames and relationship paths with stable
   semantic roles/IDs for post-render verification.
4. Extend `check-render-output.mjs` with a sixth artifact check,
   `container_border_runs`, and add `containerBorderRuns` to the composition
   metrics. Standard and showcase both fail on a hit.
5. Repair the two canonical sources; do not add exclusions or tolerances for
   them.
6. Add neutral bend/stretch/segment metrics from normalized renderer routes.
7. Regenerate all 11 Gallery artifacts, manifest/receipts, examples, README
   showcase animation, guide, and distribution ZIP atomically.
8. Validate tests and then inspect both repaired scenes and the Gallery receipt
   in the built-in browser.

If the current checker remains a post-render implementation rather than an
embedded single-source receipt, the pre-write and post-write helpers must share
fixtures that prove identical decisions. A future extraction into one
composition module is preferable to allowing the two algorithms to drift.

## Test plan

### Shared geometry unit tests

- horizontal route on top and bottom borders;
- vertical route on left and right borders;
- partial overlap, reversed route direction, and several adjacent primitives
  merged into one issue;
- perpendicular crossing, endpoint touch, parallel offset, and collinear point
  touch accepted;
- rounded rectangle straight-side overlap versus corner-only bounding-box
  overlap;
- quadratic tangent accepted and fully collinear quadratic rejected;
- nested frames report their own stable IDs;
- non-finite geometry skipped by this classifier and rejected by the existing
  finite-output gate;
- deterministic issue order, interval, side, overlap length, and segment index;
- duplicate/collinear normalization, bend count, stretch, shortest segment,
  and zero-denominator stretch.

### Renderer fixtures

- architecture security-group border run fails and perpendicular entry passes;
- workflow lane/group border run fails and a cross-lane edge passes;
- dataflow stage border run fails and an inter-stage crossing passes;
- sequence segment-border run fails while normal messages and lifeline
  crossings pass;
- lifecycle band-collinear transition remains outside this v1 gate;
- node borders, label masks, legends, and decorative rectangles never enter the
  frame set;
- CLI `--quality standard` and `--quality showcase` both reject the same border
  run with `composition/container-border-run`.

### Corpus and artifact acceptance

- all 11 canonical sources preserve 111 semantic relationships;
- every Gallery artifact reports six artifact checks after the checker grows;
- Gallery total becomes 66/66 checks, with 11 composition receipts passing;
- `containerBorderRuns` is zero across the canonical corpus after repair;
- no proper-crossing or Clean Flow regression is introduced;
- route-budget metric counts match the independently audited baseline or the
  documented values after intentional route repair;
- schema validation, renderer tests, Gallery generation, README showcase
  generation, and ZIP integrity all pass.

## Built-in browser acceptance

The browser pass is required because a zero count alone cannot prove that the
repair still looks deliberate.

### Product Analytics artifact

- Inspect `product-analytics.dataflow.html` at 1280×720.
- Confirm `web -> edge` uses the open gutter, does not hug the Sources stage,
  and does not collide with the Mobile flow or its label.
- Activate the `web-clickstream` relationship and confirm focus, route probe,
  story state, and animation still identify the same relationship.

### Web App artifact

- Inspect `web-app.architecture.html` at 1280×720 and 390×844.
- Confirm `auth -> api` has a visibly separate corridor, crosses the security
  group border perpendicularly, keeps the `verify JWT` label readable, and does
  not run through Redis, the load balancer, or API Server.
- Confirm overview-map and guided-view focus agree with the repaired route.

### Gallery and responsive receipt

- Gallery shows 66/66 artifact checks and 11 passing composition receipts.
- Desktop and mobile have zero horizontal overflow.
- Receipt text is not clipped and interactive targets remain at least 44px.
- Browser console logs contain no Archify runtime error.
- Reduced-motion mode keeps the routes visible without requiring animation.

## Exit gate

Round 45 is complete only when all of the following are simultaneously true:

```text
11 canonical sources / 111 semantic relationships
0 clean-flow edge-through-node defects
0 showcase proper X crossings
0 semantic relationship container-border runs
66 / 66 Gallery artifact checks
11 composition receipts: PASS
all tests green
built-in browser desktop + mobile acceptance green
README showcase and ZIP regenerated
```

The bend/stretch/short-segment baseline is a launch point for later renderer-
specific calibration, not unfinished error handling in this round.
