# Visual Evolution Round 46 — Role-aware Route Composition Contract

Date: 2026-07-20
Status: implementation-ready research decision

## Executive decision

Replace the three neutral global route suggestions introduced in Round 45 with
one deterministic, relationship-aware contract:

```text
semantic relationship
  + semantic role       main | branch | async | return | error
  + computed route class forward | corridor | cross-container | feedback | self-loop
  + route provenance    auto | preset | authored-via
  + segment position    terminal | internal
  -> applicable budget
  -> relationship-addressable composition receipt
  -> standard warning or showcase error
```

The important change is not simply choosing more thresholds. A bend or detour
has meaning only in context:

- a normal sequence message should be a straight horizontal line;
- a primary forward flow should remain close to the Fireworks showcase budget;
- a cross-container route often needs one extra direction change to enter and
  leave boundaries cleanly;
- a same-side channel, exception route, feedback, or recovery route may
  deliberately use an outside corridor, so direct-distance stretch is not a
  meaningful failure signal;
- a self-loop is a loop-shaped object and has no useful direct-distance
  denominator;
- an authored `via` point explains where a route came from, but does not make a
  poor showcase route acceptable;
- a short terminal port stub is not the same defect as a tiny internal dogleg.

Round 46 should turn route quality into a real composition check in
`showcase`, while keeping the more permissive `standard` profile advisory.
It should initially expose one high-confidence defect in the real Gallery:
Deployment Ownership `api_b -> events` has three bends on an otherwise forward,
same-container relationship. Its authored route can be simplified without
removing required boundary or obstacle-avoidance geometry.

The contract should accept the current intentional recovery, feedback,
cross-container, and endpoint-stub routes that the old global numbers called
out without explanation.

## Current-worktree audit

### Corpus baseline

The 11 canonical artifacts still contain 111 semantic relationships across
all five typed renderers and pass 66 artifact checks. Round 45 now records:

| Signal | Current corpus |
| --- | ---: |
| Relationships above the suggested two-bend limit | 7 |
| Maximum bends | 3 |
| Relationships above suggested 1.35 stretch | 4 |
| Maximum stretch | approximately 2.368 |
| Positive normalized segments below 16px | 2, both terminal |
| Shortest positive segment | 13px |
| Shortest internal segment | 45px |

Those counts are too mixed to become one hard gate. The underlying routes are:

| Artifact / relationship | Current geometry | Interpretation |
| --- | --- | --- |
| Agent Tool Call `approval -> blocked` | 2 bends, 13px terminal stub | intentional error branch; terminal stub is readable |
| Deployment Ownership `api_b -> events` | 3 bends, segments 25/302/50/40px | unnecessary bend on a forward async flow |
| Delivery Workflow `checks -> approval` | 2 bends, 13px terminal stub | primary drop route; acceptable terminal stub |
| Incident Runbook `page -> triage` | 2 bends, 1.800 stretch | intentional bottom corridor |
| Incident Runbook `contain -> recover` | 2 bends, 1.914 stretch | intentional main-path bottom corridor |
| Incident Runbook `declare -> update` | 3 bends, authored `via` | intentional lane/corridor route |
| Product Analytics `edge -> consent` | 3 bends, 1.369 stretch, authored `via` | cross-stage/container route |
| Product Analytics `pii -> dashboard` | 3 bends, authored `via` | cross-stage restricted flow |
| Event Stream `validate -> dlq` | 3 bends, shortest segment 34px | legitimate cross-stage dead-letter corridor |
| Agent Run `executing -> failed` | 2 bends, shortest terminal 19px | intentional failure corridor |
| Agent Run `approval -> cancelled` | 3 bends, 2.368 stretch | intentional terminal-exit corridor |
| Web App `auth -> api` | 3 bends, authored `via` | cross-container/security route |

The current corpus has no internal micro-segment: Round 45's repair work leaves
45px as the shortest internal segment. The only sub-16px pieces are two 13px
terminal stubs in workflow diagrams. This is strong evidence for keeping
terminal and internal budgets distinct. It is not evidence for relaxing
internal doglegs that may reappear in authored or generated routes.

### Current schema gap

Workflow already has the useful relationship role vocabulary:

```text
main | branch | async | return | error
```

Architecture, dataflow, lifecycle, and sequence do not expose the same role
field. All four non-sequence routing renderers have route presets and/or
authored `via` points, but those describe geometry, not business meaning.
Sequence has semantic message order and variants, but its normal messages are
constrained by the renderer to horizontal lines.

Round 46 should generalize the existing optional `role` vocabulary without
making authors classify every relationship. It must not infer semantic role
from stroke styling alone: dashed can mean asynchronous, security, projected,
or simply visual emphasis depending on renderer and diagram.

## Primary-source findings

### Fireworks Tech Graph: named profiles are useful; universal hard limits are not

Fireworks' official
[Composition Quality Contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md)
defines the attractive `showcase` target of no crossings/bridges, at most two
bends, at most 1.35 Manhattan stretch, and at least 16px per segment. Its
official
[composition-quality implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/composition_quality.py)
also proves these are profile values rather than laws of graph readability:
`standard` allows 12 bends, 5.0 stretch, and a zero minimum segment, whereas
`showcase` uses 2, 1.35, and 16px. The official
[geometry implementation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/fireworks_geometry.py)
ignores duplicate points when counting direction changes and separately
classifies segment interactions.

**Borrow:** named quality profiles, direction-change counts, Manhattan
stretch, positive segment length, and a strict showcase posture.
**Adapt:** apply the showcase numbers to ordinary forward routes, then give
necessary corridors, cross-container routes, and feedback routes explicit
budgets instead of silently grandfathering them. Distinguish terminal from
internal segments.
**Skip:** one global threshold, Fireworks' very loose standard numbers as
Archify's desired quality bar, or an aggregate score that cannot name a route.

### Graphviz: relationship participation and compound boundaries are semantic

Graphviz's official [`constraint` attribute](https://graphviz.org/docs/attrs/constraint/)
lets an edge opt out of rank constraints, proving that not every relationship
is a primary layout-flow edge. Its [`minlen` attribute](https://graphviz.org/docs/attrs/minlen/)
assigns a per-edge minimum rank distance. Its official
[`lhead`](https://graphviz.org/docs/attrs/lhead/) and
[`ltail`](https://graphviz.org/docs/attrs/ltail/) attributes give compound
relationships explicit logical head/tail clusters. The official
[`splines` documentation](https://graphviz.org/docs/attrs/splines/) separates
straight, polyline, orthogonal, curved, and spline route semantics, while
[`concentrate`](https://graphviz.org/docs/attrs/concentrate/) permits intentional
shared path segments.

**Borrow:** treat primary-flow participation and container ancestry as inputs
to routing quality.
**Adapt:** compute Archify's `cross-container` class from typed structural
ancestry; keep it separate from visual route style.
**Skip:** assuming every edge should constrain layout equally, or penalizing
intentional shared channels under a per-route bend contract.

### ELK and Libavoid: straightness is per-edge; feedback and loops are first-class

ELK Layered officially supports [self loops, ports, and compound graphs](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html).
Its [feedback-edge option](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-feedbackEdges.html)
may route feedback edges around nodes so they are visually recognizable.
ELK also exposes per-edge
[shortness priority](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-priority-shortness.html)
and [straightness priority](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-priority-straightness.html),
rather than pretending every edge has equal pressure. ELK's Libavoid adapter
exposes a
[segment penalty](https://eclipse.dev/elk/reference/options/org-eclipse-elk-alg-libavoid-segmentPenalty.html)
that prices each extra segment to avoid step-like routes.

Self-loops have separate official controls for
[distribution](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-edgeRouting-selfLoopDistribution.html),
[ordering](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-edgeRouting-selfLoopOrdering.html),
and whether they may appear
[inside a node](https://eclipse.dev/elk/reference/options/org-eclipse-elk-insideSelfLoops-activate.html).

**Borrow:** per-edge importance, feedback classification, segment penalty, and
a dedicated self-loop geometry contract.
**Adapt:** use discrete explainable Archify classes instead of exposing router
cost weights in authored JSON.
**Skip:** applying direct-distance stretch to feedback routes or self-loops,
and treating a router cost as proof that model data is invalid.

### D2: sequence and container relationships need specialized grammar

D2's official [ELK guide](https://d2lang.com/tour/elk/) values orthogonal
container routing and crossing reduction while acknowledging unnecessary
bends as a possible output weakness. Its official
[sequence diagram guide](https://d2lang.com/tour/sequence-diagrams/) gives
messages a semantic order and models self-messages such as `father -> father`
as a specialized shape. Its official [container guide](https://d2lang.com/tour/containers/)
models nesting directly.

**Borrow:** sequence messages and self-messages are not generic polylines;
container ancestry is explicit composition data.
**Adapt:** make ordinary Archify sequence messages an exact renderer invariant
and defer self-message quality to a loop-specific contract.
**Skip:** forcing all five renderers through one geometrical route grammar.

### Structurizr: authored vertices are repair controls, not exemptions

Structurizr's official [diagram editor](https://docs.structurizr.com/ui/diagrams/editor)
lets authors add and move relationship vertices and change routing among
direct, orthogonal, and curved. The official
[keyboard shortcuts](https://docs.structurizr.com/ui/diagrams/keyboard-shortcuts)
make vertex and route editing explicit author operations. Its
[DSL language reference](https://docs.structurizr.com/dsl/language) supports
relationship tags/properties and dynamic-view order.

**Borrow:** retain a visible, authored repair path and relationship metadata.
**Adapt:** serialize `authored-via` as provenance in the receipt, then validate
the final geometry against the same role/class budget.
**Skip:** treating a manual vertex as automatically correct or silently moving
it without a diagnostic.

### LikeC4: relationship kind belongs in the model, separate from layout

LikeC4's official [relationship reference](https://likec4.dev/dsl/relationships/)
models interactions/data flows with relationship kinds and metadata. Its
[styling reference](https://likec4.dev/dsl/styling/) can style a kind such as
`async`, while its [view predicates and layout reference](https://likec4.dev/dsl/views/predicates/)
keeps layout direction and spacing at the view level. Its official
[Graphviz printer](https://github.com/likec4/likec4/blob/main/packages/layouts/src/graphviz/DotPrinter.ts)
uses compound graphs, splines, node separation, and rank separation.

**Borrow:** a relationship kind is model metadata and may inform composition.
**Adapt:** reuse Archify's existing small `role` vocabulary instead of adding a
second type system; derive route class from topology and resolved layout.
**Skip:** deriving business role from color/dash style or making authors choose
raw router parameters.

## Role-aware composition contract

### Product sentence

**Archify keeps primary routes direct, gives necessary detours an explicit
budget, and explains every exception by relationship and segment.**

### Four independent dimensions

Do not collapse these concepts into one overloaded `route` or `role` field:

| Dimension | Values | Owner | Purpose |
| --- | --- | --- | --- |
| Semantic role | `main`, `branch`, `async`, `return`, `error` | authored or conservative renderer inference | business meaning and visual priority |
| Route class | `forward`, `corridor`, `cross-container`, `feedback`, `self-loop` | computed | selects the geometry budget |
| Route source | `auto`, `preset`, `authored-via` | computed from source | explains provenance and repair control |
| Segment position | `terminal`, `internal` | computed after normalization | distinguishes a port stub from an internal dogleg |

The optional relationship `role` field should be shared by architecture,
workflow, dataflow, and lifecycle. Existing workflow files remain valid.
Sequence may expose the same metadata later, but ordinary/return/self message
semantics are already known by its grammar.

Role resolution order must be deterministic:

1. use explicit authored `role`;
2. use only renderer-owned semantic facts such as workflow `mainPath` or a
   sequence return message;
3. otherwise default to `main` and record `roleSource: "default"`.

Do not infer `error` from an ID/label containing `fail`, `dlq`, or `cancel`.
Do not infer `async` solely from a dashed stroke. Canonical sources may add
roles where the semantic intent is known.

Route class resolution order:

1. `self-loop` when source and target semantic IDs are equal;
2. `feedback` when an explicit return role or renderer-owned feedback/recovery
   route reverses the renderer's primary progression or uses a designated
   outside feedback corridor;
3. `cross-container` when typed structural ancestry differs in a way that
   requires crossing a container boundary;
4. `corridor` when renderer-owned facts require a detour without semantic
   reversal—for example same-side endpoints using a channel, or a lifecycle
   exception/terminal exit using a designated outside channel;
5. `forward` otherwise.

If a route is both cross-container and feedback, feedback wins for budget
selection and `crossContainer: true` remains serialized as a modifier. That
avoids re-enabling direct-distance stretch for an intentional return detour.
Likewise, typed cross-container ancestry wins over the generic corridor class.
An authored `via` alone never creates a corridor; otherwise every manual
detour would manufacture its own exemption.

### Normalization and measurement

Use the renderer-supplied, unrounded route skeleton:

1. reject non-finite points through the existing geometry gate;
2. remove consecutive duplicates;
3. collapse collinear waypoints;
4. count direction changes as bends;
5. measure each positive Manhattan segment;
6. classify first and last positive segments as `terminal`, all others as
   `internal`;
7. compute stretch as route Manhattan length divided by direct endpoint
   Manhattan distance only when the route class permits it and denominator is
   positive;
8. retain exact internal values and round only serialized presentation values.

Rounded-corner control points, arrowheads, label leaders, animation echoes,
and casing/glow paths never create extra route segments.

### Showcase budgets

| Route class | Applies to | Max bends | Max stretch | Min terminal segment | Min internal segment |
| --- | --- | ---: | ---: | ---: | ---: |
| Sequence forward/return message | normal participant-to-participant message | 0 | exactly 1.0 | n/a | n/a |
| Forward | ordinary main, branch, async, or error flow | 2 | 1.35 | 8px | 16px |
| Corridor | same-side, exception, or terminal route that requires an outside channel without reversal | 3 | n/a | 8px | 16px |
| Cross-container | route that must enter/leave typed structural ancestry | 3 | 1.60 | 8px | 16px |
| Feedback | return/retry/recovery/outside corridor | 3 | n/a | 8px | 16px |
| Self-loop | source equals target | n/a | n/a | loop contract | loop contract |

`error` is a semantic role, not an automatic escape hatch. A forward error
branch uses the forward budget. Only a real semantic reversal receives the
feedback budget; a necessary non-reversing detour is a corridor. Similarly,
`async` does not receive more bends merely because its stroke may be dashed.

The 8px terminal threshold is an Archify adaptation below the current 13px
corpus minimum. It preserves intentional compact port stubs but still prevents
a future near-zero endpoint hook. The 16px Fireworks value remains strict for
internal doglegs, where a tiny segment has no endpoint-port justification.

Stretch is inapplicable, not automatically passing, for corridor, feedback,
and self-loop routes. The receipt serializes `null` plus an explicit
`notApplicableReason`. A corridor or feedback route can still fail bends or
segment length.

Self-loop v1 must not reuse bend/stretch numbers. Until a renderer implements
one, serialize `evaluation: "not-supported"`; standard emits a warning and
showcase emits `composition/route-self-loop-unsupported` as an error. This is
safer than a fake green result. When introduced, its contract should measure
loop clearance, minimum horizontal/vertical span, label space, and collision
with the owning node, following ELK's separate loop semantics.

### Standard budgets and severity

`standard` is a useful working-diagram profile, not a second showcase:

| Route class | Max bends | Max stretch | Min terminal | Min internal | Result on breach |
| --- | ---: | ---: | ---: | ---: | --- |
| Sequence normal message | 0 | 1.0 | n/a | n/a | renderer error |
| Forward | 4 | 2.0 | 4px | 8px | warning |
| Corridor | 5 | n/a | 4px | 8px | warning |
| Cross-container | 5 | 2.5 | 4px | 8px | warning |
| Feedback | 5 | n/a | 4px | 8px | warning |
| Self-loop | loop contract | n/a | loop contract | loop contract | warning until supported |

Standard route-budget warnings do not change CLI exit status or composition
`PASS`; they do appear in the receipt and terminal summary. Existing universal
composition defects—non-finite geometry, edge-through-node, proper showcase
crossing rules, and container-border runs—retain their existing severities.

Showcase budget breaches are errors and fail generation/checking. A canonical
Gallery source must not carry a route-budget allowlist. Necessary geometry is
represented by route class; poor geometry is repaired.

### `authored-via` policy

Authored waypoints receive no extra bend/stretch/segment allowance. They change
diagnostics, not quality:

- auto route: suggest placement, side, or route preset changes;
- preset route: name the preset and suggest a more suitable preset/channel;
- authored `via`: name the waypoint/segment index and suggest moving or
  removing the smallest responsible waypoint set.

This preserves author control without turning `via` into a permanent waiver.
It also prevents an auto-router regression and an authored mistake from
looking identical in the receipt.

## Relationship-addressable Composition Receipt

Keep aggregate metrics for Gallery scanning, but add stable per-relationship
evaluations and issues. Every route issue must answer: which collection entry,
which semantic relationship, which role/class, which measured dimension, and
which segment should the author inspect?

```json
{
  "routeQuality": {
    "profile": "showcase",
    "evaluatedRelationships": 12,
    "relationshipsWithIssues": 1,
    "issueCount": 1,
    "byClass": {
      "forward": { "count": 6, "errors": 1 },
      "corridor": { "count": 0, "errors": 0 },
      "cross-container": { "count": 6, "errors": 0 },
      "feedback": { "count": 0, "errors": 0 },
      "self-loop": { "count": 0, "notEvaluated": 0 }
    }
  },
  "routeIssues": [
    {
      "severity": "error",
      "code": "composition/route-bend-budget",
      "relationship": {
        "renderer": "architecture",
        "collection": "connections",
        "index": 7,
        "id": null,
        "sourceAddress": "connections[7]",
        "from": "api_b",
        "to": "events"
      },
      "semanticRole": { "value": "async", "source": "authored" },
      "routeClass": "forward",
      "routeSource": "authored-via",
      "measurement": {
        "bends": 3,
        "stretch": 1.0,
        "shortestTerminalSegmentPx": 25,
        "shortestInternalSegmentPx": 50
      },
      "budget": {
        "maxBends": 2,
        "maxStretch": 1.35,
        "minTerminalSegmentPx": 8,
        "minInternalSegmentPx": 16
      },
      "directionChangeIndices": [1, 2, 3],
      "excessBends": 1
    }
  ]
}
```

Use three stable budget issue codes, with at most one issue of each code per
relationship:

```text
composition/route-bend-budget
composition/route-stretch-budget
composition/route-short-segment
```

Unsupported loop capability uses the separate stable code
`composition/route-self-loop-unsupported`; it is not a bend/stretch breach.

For a short-segment issue, report the shortest offending segment and its
normalized index; retain all offending indices in structured data. For a bend
issue, report the direction-change indices. For stretch, include route length,
direct length, ratio, and applicability. Sort issues by renderer collection,
source index, then code. Never use an SVG DOM order or generated path ID as the
only locator.

Generated relationship paths should carry stable `data-relationship-id`,
`data-relationship-index`, `data-semantic-role`, `data-route-class`, and
`data-route-source` attributes. The Gallery receipt can then focus the exact
relationship and highlight the offending segment without rerunning semantic
inference in the browser.

## Renderer decisions

### Architecture

**Borrow:** Graphviz/LikeC4 compound ancestry and per-relationship kind.
**Adapt:** add optional `role`; compute region/security-group ancestry and give
true cross-container routes the 3-bend/1.60 showcase budget. A same-ancestry
async relationship stays `forward`. Preserve `via`, sides, and
`orthogonal-h/v` as repair controls.
**Skip:** granting all architecture edges three bends, assuming `via` means
cross-container, or inferring async/error from dash/color.

Immediate real-artifact target: Deployment Ownership `api_b -> events` is a
same-ancestry forward async route. Remove its third bend while preserving its
current healthy segment lengths and avoiding a border run or node crossing.

### Workflow

**Borrow:** reuse the existing role vocabulary and `mainPath` semantic fact.
**Adapt:** `drop` stays forward. A same-side `bottom-channel`/`up-channel` is a
non-reversing corridor; `return-left` and verified reverse-progression routes
are feedback. `outside-right` selects feedback only when its semantics reverse
progression, otherwise it is a corridor. Terminal stubs use 8px while internal
channels use 16px.
**Skip:** exempting every `error` role, every non-main edge, or every channel
preset. A forward rejection/error branch still uses the forward budget.

This accepts the current 13px `approval -> blocked` and `checks -> approval`
terminal stubs, and treats Incident Runbook's main-path bottom channels as
non-reversing corridors. Their 1.8–1.914 stretch is explicitly inapplicable
without falsely relabelling primary flow as feedback.

### Sequence

**Borrow:** D2's specialized message grammar and separate self-message shape.
**Adapt:** ordinary participant-to-participant messages are renderer invariants:
zero bends and stretch 1.0, including return variants. Violation is an error in
both profiles because it indicates corrupted renderer output, not merely a
composition preference. Preserve semantic order independently of geometry.
**Skip:** applying 8/16px polyline segment budgets to a single horizontal
message, or pretending a future self-message is a zero-length forward route.

### Dataflow

**Borrow:** typed stage ancestry and explicit relationship role.
**Adapt:** add optional `role`; compute stage crossings as cross-container.
Main pipeline flows remain forward and strict. A dead-letter/error flow is not
exempt: if it crosses stages it receives the cross-container budget; if it
returns against progression it receives feedback. Preserve `channelX/Y`,
route presets, sides, and `via` as named repair controls.
**Skip:** inferring error from `dlq` text, allowing all stage-crossing flows
five bends, or accepting micro-doglegs because the route is authored.

Current calibration proof: Event Stream `validate -> dlq` crosses stages and
uses exactly three bends; its shortest terminal segment is 34px and shortest
internal segment is 115px. It should pass the cross-container budget even
though it would fail a universal two-bend rule.

### Lifecycle

**Borrow:** role-aware exception/recovery routing and a separate rail concept.
**Adapt:** add optional `role`; keep the primary lifecycle rail outside the
semantic transition budget. Normal forward transitions use the forward
budget. A cancellation/terminal exit using an outside channel is a corridor;
an actual retry/recovery transition back toward active progression is
feedback. Lane/band separators are not containers, so they do not create
cross-container classification in v1.
**Skip:** using direct stretch against cancellation/recovery detours, counting
the rail as a relationship, or requiring existing 18–19px terminal stubs to
meet an internal-segment rule for the wrong reason.

This accepts Agent Run `executing -> failed` and `approval -> cancelled` when
their intentional corridor classification is explicit, while still limiting
each to three bends and 16px internal segments.

## Implementation sequence

1. Extract one shared route classifier/evaluator from the existing Round 45
   aggregate metric helper; keep duplicate/collinear normalization identical.
2. Generalize optional `role` into the common relationship schema used by
   architecture, workflow, dataflow, and lifecycle without breaking existing
   sources.
3. Have each renderer supply semantic endpoints, typed structural ancestry,
   progression facts, route preset, authored-waypoint provenance, and the
   normalized route skeleton.
4. Implement deterministic role and route-class resolution. Serialize whether
   role was `authored`, `inferred`, or `default`.
5. Replace neutral global over-threshold counts with per-class aggregates,
   per-relationship evaluations, and the three stable issue codes. Retain the
   old aggregate maxima for trend comparison.
6. Add a seventh artifact check, `role_aware_routes`, to
   `check-render-output.mjs`; standard records warnings, showcase rejects
   errors.
7. Add explicit semantic roles only where known in canonical examples; do not
   bulk-tag relationships merely to satisfy the checker.
8. Repair Deployment Ownership `api_b -> events` at its canonical source
   geometry. Keep Event Stream `validate -> dlq` as a cross-container passing
   regression fixture.
9. Regenerate all 11 Gallery artifacts, manifests/receipts, README showcase,
   guide, examples, and distribution ZIP atomically.
10. Run focused tests, the full suite, and built-in browser inspection at
    desktop/mobile widths.

## Test plan

### Shared classifier tests

- explicit authored role beats renderer inference; inference beats default;
- style/dash and label/ID text never infer semantic role;
- same source/target produces `self-loop` and `null` stretch;
- different typed ancestry produces `cross-container`;
- reverse progression or designated recovery corridor produces `feedback`;
- same-side and exception/terminal channels without semantic reversal produce
  `corridor`;
- a cross-container feedback route selects feedback budget and retains the
  cross-container modifier;
- ordinary same-ancestry routes remain `forward`;
- authored `via` alone cannot change a forward route into a corridor;
- `auto`, preset, and `authored-via` provenance select identical budgets;
- duplicate and collinear points do not inflate bend/segment counts;
- first/last positive segments are terminal and middle segments are internal;
- exactly 8px terminal and 16px internal segments pass showcase;
- 7.999px terminal and 15.999px internal segments fail showcase;
- corridor/feedback/self-loop stretch is `null` with a stable reason, not zero
  or pass;
- deterministic issue code, relationship locator, bend indices, segment index,
  measurements, budget, severity, and sort order;
- standard breaches warn without changing exit status; showcase breaches fail.

### Renderer fixtures

- architecture same-group async remains forward; a region/security-group
  crossing receives cross-container budget;
- workflow main/drop is forward, same-side main-path channel is corridor,
  return/recovery reversal is feedback, and a forward error branch remains
  forward;
- sequence forward and return messages render with zero bends/stretch 1.0;
- sequence self-message is either unsupported explicitly or evaluated by a
  dedicated loop fixture, never by generic stretch;
- dataflow stage crossing receives cross-container budget and a reverse return
  receives feedback;
- lifecycle main transition is forward, terminal-exit channel is corridor,
  actual recovery reversal is feedback, and the primary rail is excluded;
- authored `via` can both pass and fail, proving it is not an exemption;
- terminal short-segment issue differs from internal short-segment issue;
- relationship receipt locator maps back to exact source collection/index/ID.

### Corpus and artifact acceptance

Before the route repair, the role-aware showcase gate must identify this and
no other canonical relationship as an error:

```text
deployment-ownership.architecture.json
  connections[7] api_b -> events
  composition/route-bend-budget
```

After repair:

- all 11 canonical sources preserve 111 semantic relationships;
- all 11 showcase route receipts have zero route errors;
- Gallery reports seven artifact checks per artifact, 77/77 total;
- standard-profile fixtures preserve warnings and successful exit;
- all sequence messages report zero bends and stretch 1.0;
- no forward showcase route exceeds 2 bends/1.35 stretch;
- no corridor showcase route exceeds 3 bends;
- no cross-container showcase route exceeds 3 bends/1.60 stretch;
- no feedback showcase route exceeds 3 bends;
- Event Stream `flows[8] validate -> dlq` passes as cross-container with three
  bends and no short segment;
- no evaluated route has a terminal segment below 8px or internal segment
  below 16px;
- self-loops, if absent, report zero count; if present before a loop contract
  exists, they never enter generic stretch totals and fail showcase explicitly;
- container-border runs, proper X crossings, Clean Flow, finite geometry,
  relationship counts, schema validation, and ZIP integrity remain green.

## Built-in browser acceptance

### Deployment Ownership

- Inspect `deployment-ownership.architecture.html` at 1280×720 and 390×844.
- Confirm `api_b -> events` has at most two deliberate bends, still reads as an
  asynchronous ownership flow, and does not collide with API A, API B,
  PostgreSQL, the security-group border, or its label.
- Activate the relationship and confirm focus/probe identifies the same source
  relationship and the receipt shows its role/class/provenance.

### Event Stream regression proof

- Inspect `event-stream.dataflow.html` at 1280×720 and 390×844.
- Confirm `validate -> dlq` keeps its deliberate three-bend error corridor,
  remains visually distinct from the main pipeline, and keeps its
  label/arrowhead readable.
- Confirm the receipt identifies it as cross-container and passing; the new
  contract must not "improve" it into a route that creates a node crossing,
  stage-border run, or proper X crossing.

### Gallery receipt

- Gallery reports 77/77 checks and 11 passing composition receipts.
- A deliberately failing local fixture names the exact collection index, ID,
  endpoints, semantic role, route class, route source, issue dimension, and
  offending segment/bend in both the card and details view.
- Standard warning and showcase error have visibly different severity without
  implying that `n/a` stretch is a pass.
- Desktop/mobile have no horizontal overflow or clipped receipt text; focus
  targets remain at least 44px; console contains no Archify runtime errors.
- Reduced-motion mode keeps all repaired routes and issue focus visible without
  relying on animation.

## Exit gate

Round 46 is complete only when all of the following are simultaneously true:

```text
11 canonical sources / 111 semantic relationships
route role source serialized: authored | inferred | default
route class serialized: forward | corridor | cross-container | feedback | self-loop
0 showcase role-aware route errors after the real-artifact repair
0 terminal segments below 8px on evaluated showcase routes
0 internal segments below 16px on evaluated showcase routes
0 sequence-message bend/stretch violations
0 clean-flow edge-through-node defects
0 showcase proper X crossings
0 semantic relationship container-border runs
77 / 77 Gallery artifact checks
11 composition receipts: PASS
all focused and full tests green
built-in browser desktop + mobile acceptance green
README showcase and ZIP regenerated
```

The governing principle is deliberately narrow: semantic role explains why a
route exists, computed route class explains which geometry is necessary, and
provenance explains how to repair it. None of the three is permission to ship
a visibly accidental route in the showcase.
