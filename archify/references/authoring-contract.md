# Authoring contract

Read this reference only after the Fast authoring path calls for more detail. The schemas and examples remain authoritative.

## Composition repair

When correcting an authored overview's abstraction, map every affected role, relationship direction, protocol, boundary, condition, and source reference to its surviving node or relationship before regrouping. A startup citation does not prove a message protocol. Preserve each claim's inspected evidence. Keep user-supplied or agreed topology fixed; fewer routes alone do not justify merging. A boundary around one node requires an explicit isolation fact and must not merely repeat its label.

## Label repair

When a relationship label collides, move the label, adjust the route or spacing, then shorten the wording while preserving meaning. Omit wording only when both endpoints fully imply it and it conveys no protocol, action, direction, synchronous or asynchronous behavior, or cross-boundary mechanism. Spacing means clear gap rather than center distance; measured mask width takes precedence. The first-draft gap budget is in [Layout and routing](authoring-defaults.md#layout-and-routing).

For a disproportionate sublabel, keep its exact role or protocol concise and place the supplementary fact in a note or card. Preserve every required responsibility, protocol, and boundary fact. Use the first-draft node-width budget in [Layout and routing](authoring-defaults.md#layout-and-routing).

## Schema lookup

Read both the mode schema and `schemas/common.schema.json`. The mode schemas use `$ref`, so the common file is where shared enums live.

- `componentType`: `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, `external`
- Entity-relationship documents use `entities` and `relationships`; `key` accepts `pk`, `fk`, or `uk`, and `fromCardinality`/`toCardinality` accept `one` or `many`.
- `variant`: `default`, `emphasis`, `security`, `dashed`
- Relationship IDs use the shared identifier pattern and must be unique in their collection.

Do not invent fields. Before writing any new field, enum, or constrained text, read its schema definition, including common `$ref` targets. In particular, check boundary kinds, repository identity, and source-reference shapes. An example demonstrates structure; it does not enumerate every valid value. Author fresh IDs, wording, facts, and layout.

## Workflow layout contracts

Use schema v2 for new workflows and keep schema v1 when an existing source must
retain fixed geometry. In both versions, `col` stays in `0..5` and semantic
edge labels are never deleted as a spacing repair. Do not change only
`schema_version` when absolute coordinates exist: follow the canonical
[migration and layout-receipt contract](../renderers/workflow/README.md#migration-and-layout-receipt).
The complete normative invariants live in the workflow renderer's
[layout contracts](../renderers/workflow/README.md#layout-contracts).
For sequential stages stacked in one container, use one v2 lane and group,
omit `meta.viewBox`, and center nodes around the lane content with symmetric
`yOffset` values such as `-90 / 0 / 90`. Keep semantic edge labels and act on
compiler diagnostics.

## Legend contract

Omit `meta.legend` for the truthful default: `auto` lists only semantic kinds
present in typed IR. Use `mode: "all"` for a renderer reference or
`mode: "hidden"` to remove the full legend. Under `entries`, only keys listed
by the selected mode schema are valid; each key accepts `label`, `visible`, or
both. `visible: true` may show an unused supported convention, while
`visible: false` hides it. `hidden` cannot be overridden.

A label override changes reader wording only. Never infer a kind from prose or
use the legend to compensate for missing nodes, states, messages, or flows.
Long labels are measured and wrap into deterministic rows. Architecture's
implicit automatic viewBox grows from that same measured footprint, and an
automatic ERD canvas is sized the same way so its default legend is always in
the generated content. For backwards compatibility, a legacy document with no
`meta.legend` may omit an implicit auto legend that cannot fit its explicit
viewBox; this never changes its typed topology. An ERD that authors a
`meta.viewBox` keeps that fixed area and reports the capacity instead of
dropping the legend. Adding `meta.legend` makes the presentation intentional and
strict: if its resolved labels cannot fit the authored viewBox, shorten or hide
them, or widen the viewBox using the emitted diagnostic.

## Language consistency

Choose one primary authored language. An explicit user choice wins; otherwise
use the language of the request, or the conversation's dominant language when
the request itself is language-neutral. Separately choose the Viewer locale.
Always write the matching `meta.locale` as a well-formed language tag: `"en"`
for English, `"zh-CN"` for Simplified Chinese, `"es"` for Spanish, or any
other tag for another language. The renderer consumes the authored locale without inferring language
from diagram strings. Documents that omit it remain valid and default to
English.

`meta.locale` controls only renderer-owned reader surfaces: `<html lang>`, the
document-title suffix, default SVG description and focus labels, default legend
labels, and fixed Viewer controls, statuses, accessibility names, and errors.
It never translates authored content. Apply the primary language separately to
titles, subtitles, node and relationship copy, boundaries, lanes, groups,
legend label overrides, and cards. A bilingual diagram still
chooses one primary locale for the Viewer; follow an explicit primary-language
request, then prompt order or conversation dominance.

Bundled Viewer catalogs are enrolled in `locales/manifest.json`: currently
`en`, `zh-CN`, `zh-TW`, `es`, and `ko`. For these, `meta.locale` alone selects the full
catalog. Tags match case-insensitively (`zh-cn` selects `zh-CN`), but region
and script variants are distinct: `zh-Hant`, `es-MX`, or `ko-KR` select no
bundled catalog.

`meta.translations` is an optional per-key override: an object mapping the
renderer's canonical message keys (`locales/en.json`, or `catalogKeys()` in
`renderers/shared/i18n.mjs`) to translated strings whose `{placeholder}` tokens
match the English source exactly. Each message resolves as: valid
`meta.translations` value → the selected bundled catalog → English. For a
bundled locale, supply only the keys whose wording the diagram needs to change;
the rest of the language is kept. Omitting the field or supplying `{}` means no
override. For a language without a bundled catalog, supply the catalog here.
Reuse suitable translations from `examples/locales/` or a previously reviewed
catalog, translate missing keys, and use the English source to check keys and
placeholders.

An unknown key or a value with mismatched placeholders is rejected and keeps
the lower-priority message; it is reported as `i18n/invalid-translation` on
stderr and as a warning in the `validate --json`, `deliver`, and `finalize`
receipt `diagnostics[]`. Keys that still resolve to English in a
non-English locale are reported as `i18n/translation-coverage`, with the missing
keys and their English source text; add exactly those keys to repair the gap.
Coverage describes the final resolved catalog, not the size of the override.

For a requested language you cannot supply `meta.translations` for, do not
write a `meta.locale` with no bundled catalog and no translations. Keep every
reader-facing authored string in the requested language, omit `meta.locale` so
the renderer safely uses English, and explicitly tell the user that fixed
Viewer UI and `<html lang>` remain English and the artifact is not fully localized.
The fallback applies only to renderer-owned surfaces; it never
permits authored copy to fall back to English. Do not silently substitute
`zh-CN` for another language or Chinese locale, and do not machine-translate
`meta.translations` values without disclosing that they are unreviewed.

Keep exact product names, code identifiers, commands, protocols, API paths, and
environment names intact. Those terms may remain English inside localized copy,
but surrounding explanatory prose must still use the selected language.
Renderer-owned default legend labels follow `meta.locale`; author a
`meta.legend.entries.*.label` override only when the diagram needs different
domain wording, and keep that authored override in the primary language.

## Visual preset default

Omit `meta.visual_preset` by default. The renderer then opens the diagram in
`classic` for both light and dark color modes. Color mode and visual preset are
independent viewer state: switching Light / Dark must preserve the current
preset. Author `signal-flow`, `blueprint`, or `editorial` only when the user
explicitly requests that visual style.

## Engineering profile default

Omit `meta.engineering_profile` for an ordinary system architecture. Region,
cluster, and security boundary wording do not by themselves enable an
engineering profile. Enable `deployment-ownership` only when the user
explicitly asks for a production deployment topology, ownership handoff, or
fail-closed deployment review and the source facts are known. Once enabled,
do not remove the engineering profile merely to pass validation; repair the
authored facts or report the diagnostics truthfully.

## Title hierarchy

Use one concise title and let the diagram carry the explanation. Omit
`meta.subtitle` by default, and never use it to restate the title, nodes, edges,
or cards. Include one short supporting line only when the user explicitly asks
for a subtitle; an omitted or blank subtitle must not leave an empty visual row
in the generated viewer.

## Executable geometry rules

Generate one responsive artifact for laptops and external displays, preserving the authored SVG/viewBox, proportions, semantic geometry, and normal document flow. Use meaningful content rows and the Reader-declared readable page-scroll behavior when the complete diagram needs more height; viewport fitting does not authorize alternate topology or smaller typography.

- Node anchors start at side midpoints. `left`/`right` change the horizontal endpoint; `top`/`bottom` change the vertical endpoint. For an automatic Architecture relationship, unobstructed facing ports whose axis offset is under 16px may share one horizontal or vertical axis when both endpoints retain the 16px corner gutter. If exactly one endpoint belongs to a spread group, only its unshared counterpart moves; relationships spread at both endpoints keep their distinct ports and outside bridge unless a reciprocal facing pair can jointly use separate straight lanes while preserving endpoint spacing, labels, and all surrounding route and obstacle clearances.
- A side is a direction contract. The first and final route segment must be perpendicular and outward/inward in the named direction.
- In architecture and data-flow diagrams, explicit `route: "straight"` requests one direct segment, which may be diagonal when endpoint sides are not pinned. The artifact checker preserves this intent; explicit sides, opaque-node clearance, and other quality gates still apply. `via` takes precedence and retains existing rules, including data-flow's requirement for orthogonal via segments.
- Automatic Port Spread is a default renderer behavior for architecture, workflow, and data-flow diagrams. Shared automatic endpoints spread deterministically and symmetrically with a 16px corner gutter. It does not apply to sequence messages, single relationships, or explicit `via`, `channelX`, `channelY`, `labelAt`, or non-`auto` routes.
- Showcase route rhythm: every nonzero segment must be at least 8px; every interior segment must be at least 16px. When spread ports are nearly parallel, the router uses a 24px endpoint stub and a 16px outside bridge instead of manufacturing a tiny dogleg.
- Showcase route compactness: an explicit Architecture route fails with `composition/excessive-route-detour` when its orthogonal length is at least 2.5 times an obstacle-aware legal route, adds at least 200px, and sends a control point at least 96px beyond the content envelope. The evidence records both lengths, ratio, excess, bounds, and excursion. Remove an unnecessary `via` or move the diagnosed corridor inward instead of enlarging the canvas. Related relationships that overlap on the same outer corridor by at least 32px are treated as an intentional bus and remain valid.
- Shared endpoint corridors are allowed only when they remain semantically unambiguous. Unrelated collinear overlap of 8px or more fails showcase.
- Container borders are intentional pass-through geometry, but a long edge running along a structural border is not.
- An edge crossing an unrelated opaque node is always a hard failure, independent of quality profile.

### Explicit `via` coordinates

Use the resolved departure anchor `S = [sx, sy]` and arrival anchor
`T = [tx, ty]`. Anchors start at side midpoints, but automatic routing and
Port Spread can move them as described above; do not assume an anchor copied
from an automatic route is the anchor of a newly authored explicit route.
Explicit `via` routes do not receive automatic Port Spread.

For the first waypoint `F = via[0]` and last waypoint `L = via[via.length - 1]`,
use these alignments and directions (SVG y increases downward):

| Side | Departure (`fromSide`): `S` → `F` | Arrival (`toSide`): `L` → `T` |
| --- | --- | --- |
| `top` | `F[0] === sx`, `F[1] < sy` | `L[0] === tx`, `L[1] < ty` |
| `bottom` | `F[0] === sx`, `F[1] > sy` | `L[0] === tx`, `L[1] > ty` |
| `left` | `F[1] === sy`, `F[0] < sx` | `L[1] === ty`, `L[0] < tx` |
| `right` | `F[1] === sy`, `F[0] > sx` | `L[1] === ty`, `L[0] > tx` |

For example, given a bottom departure anchor `S = [180, 160]` and a left
arrival anchor `T = [360, 260]`, this relationship fragment leaves downward
and enters the target rightward:

```json
{
  "from": "source",
  "to": "target",
  "fromSide": "bottom",
  "toSide": "left",
  "via": [[180, 200], [300, 200], [300, 260]]
}
```

The full path is `[180, 160] → [180, 200] → [300, 200] → [300, 260] → [360, 260]`.
Changing only the first waypoint to `[200, 200]` makes the departure diagonal;
changing it to `[180, 120]` keeps its x aligned but leaves upward through the
source instead of outward from its bottom. Both violate `fromSide: "bottom"`
and produce `clean-flow/endpoint-side-direction`. The example establishes
endpoint direction only: keep the full route clear of unrelated nodes and
apply the other geometry rules above.

### Spacing and labels

In showcase Architecture, an unpinned connection label keeps its default position
when clear. If it collides, the renderer tries a bounded set of nearby positions
along the existing route, avoiding nodes, boundary titles, other labels and
other routes within the resolved canvas. Explicit `labelAt`, `labelDx`, `labelDy`
or `labelSegment` (including zero) disables this fallback. Routes and topology
stay unchanged; if no nearby position is clear, validation reports the original
collision. Inspect resolved labels with `--layout-json` before adding controls.
Standard placement retains its existing behavior.

Spacing recommendations mean clear gap between boxes, not center distance. A 200px center distance between 165px-wide nodes leaves only 35px of clear gap.

For a relationship label, require:

```text
clear gap > label mask width + 8px breathing room
label mask width ≈ 6.5px × ASCII units + 13px
CJK characters count as two units
```

Relationship labels are semantic data. If the gap is too small, move the label,
adjust the route or spacing, then shorten the wording while preserving meaning.
Omit only wording already fully implied by both endpoints and carrying no
protocol, action, direction, synchronous/asynchronous behavior, or
cross-boundary mechanism. Preserve every meaningful label.
Deleting it is not a spacing repair. If a relationship starts unlabeled because
its endpoints fully imply it, explain why the wording is redundant; this is a
semantic authoring choice, not a spacing repair. In workflow v2, let the compiler
allocate its measured mask before applying a diagnosed `labelAt`,
`labelDx`/`labelDy`, or `labelSegment`. Apply one diagnosed geometry control at
a time unless several edges share a constrained channel. In that case, plan the smallest coupled change from measured geometry and
validate it together. Architecture/workflow provide layout evidence through
`validate <type> <candidate.json> --layout-json`; for other types, use validation
diagnostics and the rendered SVG geometry.
Before adding manual routes, check whether unnecessary agent-added controls
disable automatic port spread; preserve user-required route intent. Use the
measured clearance rules above rather than guessing coordinates.

### Repair evidence

For architecture, `validate architecture <input.json> --layout-json` exposes the
resolved component boxes, boundary frames, connection points, and label positions.
A measurable rejected layout also returns these fields, with `ok: false`,
`contract: "archify-architecture-layout-v1"`, diagnostics, and exit 1. This is
repair evidence, not artifact acceptance; it writes no HTML. Malformed input or
an implementation failure retains the ordinary failure receipt without layout.

Use the measured failing side for `layout/boundary-out-of-bounds`. Left/top
negative coordinates need an inward move; increasing viewBox width/height only
addresses right/bottom overflow. Boundaries may wrap members across rows. Keep
real membership intact and recheck connected routes after moving members.

Automatic architecture canvases include route points as well as nodes, frames,
and labels. An authored viewBox remains authoritative. In showcase,
`layout/route-out-of-bounds` identifies clipped route points; negative coordinates
need an inward route, while right/bottom overflow can also use a larger authored
canvas. Recheck desktop readability after enlarging a canvas.

When several crossing/corridor diagnoses involve the same nodes, consider their
placement together before adding route controls. Apply one coherent repair and
validate it; independent label nudges cannot fix a shared layout bottleneck.
Compare diagnostics by code, subject, and stage instead of total count alone.

### Repair order

1. Fix missing/invalid `meta.quality_profile` and schema errors.
2. Fix node overlap or out-of-range placement.
3. Fix edge-through-node and endpoint-direction errors.
4. Fix crossings, ambiguous corridors, border runs, excessive detours, and route rhythm.
5. Fix label-to-node, label-to-label, then label-to-route clearance.
6. Fix labels that leave the canvas: move the label with `labelAt`/`labelDx`/`labelDy`/`labelSegment`, or widen `meta.viewBox`. Suggested `labelDx`/`labelDy` values replace the authored field; they are not added to it.

After every edit, rerun the complete `finalize` as the delivery contract requires; use `validate` only for focused diagnosis between finalize runs. Consume `diagnostics[]` by stable `code`, exact `subject`, measured `evidence`, and `supportedFixes`. If the diagnostic gives `labelAt`, use that point instead of estimating another offset.

## Mode placement

### Architecture

Choose overview or mechanism detail using [Composition and meaning](authoring-defaults.md#composition-and-meaning). Use one obvious primary reading path, which may step across meaningful rows when the requested topology needs room. Keep the overview readable at its chosen abstraction; expand implementation details when they answer the reader's question. Group only real ownership, trust, process, or deployment boundaries. Boundaries do not replace relationships.

Grid placement is preferred when the schema supports it. Free positions are appropriate for a bounded exception, not for prose-level coordinate planning. Keep external actors outside the system boundary when that is factually true. A boundary is drawn as the padded box around all of its members, so place them as one compact axis-aligned cluster (no empty bay that lets a non-member sit inside the padded frame) and keep every non-member outside that box; `layout/boundary-encloses-non-member` reports a component the box swallows in showcase quality. Standard retains its existing acceptance behavior.

### Workflow

Lanes express responsibility or phase. Columns `0..5` express logical
progression. Each `(lane, col)` hosts at most one node — two nodes in the same
cell fail with `workflow/node-overlap`. Start new workflows on `readable-v2`;
retain `fixed-v1` only for legacy geometry compatibility. Keep the happy path
monotonic, preserve semantic edge labels, and route retries and exception
returns outside the main lane corridor.

#### Workflow viewport repair

When `viewer/viewport-overflow` includes `workflowLanes`, inspect the tallest
rendered frames and their node span before changing the source. Measurements
are CSS pixels; space above/below nodes includes lane titles and routing, so it
is not a removable-space budget. Frame IDs identify rendered lane indices.

Run `validate workflow <source.json> --layout-json` and match those frames to
source lanes and nodes. Check whether many steps share the last logical column
and use large `yOffset` values. Readable-v2 currently reserves symmetric space
around offsets and shares the base content height between lanes, so increasing
one offset can enlarge otherwise sparse lanes.

Where the source's ownership and explicit geometry permit, redistribute steps
across logical columns and meaningful lanes, keeping the main path monotonic.
Preserve every required node, relationship, label and semantic check. If ownership
or absolute pins prevent reflow, report that constraint instead of merging lanes
or moving pins automatically. Validate the changed JSON, deliver a fresh HTML,
then rerun browser checks and inspect the first screen; a static pass alone does
not settle viewport fit. These are repair directions, not guaranteed coordinates.

### Sequence

Participants are ordered by conversation role. Messages own their vertical order. Use return/async/security variants for meaning, not decoration; sequence does not use Automatic Port Spread. A segment's `from`/`to` edges must stay at least 4px off every message arrow (`message.y`): an edge along an arrow leaves the reader unable to tell which phase the message belongs to, and showcase quality reports `sequence/segment-message-border-run`. Standard retains its existing acceptance behavior.

First-draft shape: every message needs an `id`, `from`, `to`, `label`, and integer `y` at least 160. `from` and `to` must be different participants — self-messages are unsupported (`sequence/self-message-unsupported`). Optional phase bands are `segments[]` with only `from`, `to`, and `label` (no segment `id`). Inventing `pos`/`size` on participants fails schema validation — order alone places them. Omit `meta.viewBox` so automatic height fits the timeline + legend (minimum 327px readable band) instead of a fixed 760px floor, and so 2–3 participant spreads pack below the 920px default when labels fit (4+ stay at 920px; long labels still widen).

### Dataflow

Stages express transformation or custody. Rows separate parallel streams. Label only data contracts, classifications, or cross-boundary movement that is not obvious.

First-draft shape: declare `stages[]` (each a `{label}`), then place every node with integer `stage` and `row` — not `pos`/`size`. Flows are `flows[]` with `from`, `to`, and optional `label`.

Omit `meta.viewBox` to fit canvas width to all stages and nodes in either quality
profile, including explicit node widths. Width uses content + 24px right padding
with a 480px minimum (five default stages still need ~1068); left-edge overflow
still needs a node repair. An authored viewBox stays fixed. Showcase node growth, readable typography, content height, port bridges
and bounded label placement apply only when the canvas and all node widths are
omitted. `--quality` overrides `meta.quality_profile`; without it, the renderer
uses `ARCHIFY_QUALITY_PROFILE` when set, otherwise the JSON profile.

### ERD

Treat a schema ERD as a table catalogue as well as a relationship map. If the
schema has more than 8 tables or 50 fields, it is a dense full-schema map: start
with `meta.quality_profile: "standard"` so complete field visibility is not
traded away for repeated showcase route repairs. Include every physical column in
`attributes`, keep the source SQL type, and preserve the
field's Chinese comment in the type string as `SQL_TYPE｜中文备注` because the
schema has no separate comment property. The default viewer shows these rows at
the `read` level; do not rely on hover/focus or cards to reveal physical fields.
Cards may explain constraints, inferred relationships, or domain rules, but never
replace a field list.

Before placing boxes, classify tables into functional domains using verified table
names, comments, module paths, and foreign-key meaning. Put the domain name in
`tag` and give each domain one solid rectangle of grid cells: a single row, a
single column, or a filled rectangular block — not an L or a diagonal — with
every cell of the rectangle holding one of its tables.
All tables with the same tag stay together; do not interleave unrelated tables
between members. A domain that fills one such rectangle is drawn as a labelled
band behind its tables, so the
grouping is visible without reading every box;
a tag whose tables do not fill one rectangle earns no band, and because the band
is the only place a domain name is drawn the renderer reports
`erd/domain-not-drawn` rather than publishing a diagram that cannot name the
domain. Absolute
coordinates have no grid cells at all, so a tagged table always needs `row`/`col`.
Order parent/core tables
toward the shared boundary and
place their direct children beside or beneath them. Columns read left to right and
rows read top to bottom, so a relationship between neighbouring columns is one
straight corridor. Never place an unrelated entity between two aligned anchors;
the router can detour around it, but the clear corridor is shorter and reads
better. A junction table has two parents: put it in a cell beside or between
both, not beneath one of them with tables stacked between it and the other,
and keep every table that shares its domain tag in one solid rectangle of cells. A relationship must connect two different entities; a self-reference such as manager_id stays as a foreign-key column (and optionally a card), not an `employees`→`employees` edge.
Use `row`/`col` for this normal grouped layout, and only use explicit
`pos`/`via` after a diagnostic identifies a concrete geometry problem.

State every key role a column carries in `key`, and the real references in
`references`. A column is often more than one at once — a junction table's
`tenant_id` is both part of the primary key and a foreign key to `tenant.id` — so
`key` takes a role or a list (`["pk", "fk"]`), and dropping a role claims less
than the schema does.
A many-to-many pair is a real fact about the model, so state it and identify the join
table when one exists. A relationship has two ends and each one declares its own
maximum, so a `many`-to-`one` foreign key needs both `fromCardinality` and
`toCardinality`; `fromOptional`/`toOptional` only lowers that same end's minimum
from one to zero (an optional `one` end reads zero-or-one, an optional `many` end
reads zero-or-many), and `identifying: false` draws the non-identifying dashed
line and owns that dash — the schema rejects a `variant` that would draw the
relationship solid beside it. The foot opens toward the entity it describes, so the
drawn glyph states the end's maximum, not a direction of travel.

A table side only has room for so many ends: the ports spread at most `(side
extent - 32) / (ends - 1)` apart, and a cardinality glyph is 14 units tall. More
relationship ends than that room allows is `layout/marker-capacity`, which names
the table, the side, and the ways out — add fields so the side is taller, spread
the relationships, or reduce the fan-in. Never fix it by hiding the cardinality.

Give the domains a column each when the model has to read completely inside a
laptop viewport. The Reader scales a wide canvas up to the reader width and
narrows a tall one until the whole page fits, so the same eleven tables cost text
size when they are stacked as four horizontal domains instead of four vertical
ones. Leave a whole tile of the grid free where a long relationship has to cross
a domain: a run that crosses an occupied cell forces a jog, and a jog below the
interior floor is a `composition/short-interior-segment` failure.

An automatic canvas is sized so the default legend is always in the generated
content, and a canvas the author fixes with `meta.viewBox` reports its legend
capacity instead of dropping the key; see
[`../renderers/erd/README.md`](../renderers/erd/README.md) for the band, port, and
reader contract.

### Tree

A tree answers "how is this decomposed?": one root, and every other node names
exactly one `parent`. Links mean containment only; do not use a tree for calls,
data movement, or cross-branch dependencies. Nothing is inferred: a missing
parent (`tree/missing-parent`), zero or several roots (`tree/root-count`), a
parent cycle (`tree/cycle`, which also covers every node stranded beneath it),
and duplicate ids are refused. Children read in declaration order.

Use `layout.direction: "down"` (default) for a shallow, balanced breakdown and
`"right"` for a deep or leaf-heavy tree such as a repository layout; a rightward
tree aligns each parent with its first child and scrolls vertically in the
reader. Labels wrap between words. `collapsed: true` makes a branch start
collapsed in the Viewer; it never removes content from the artifact, and every
export is the complete tree. For a real codebase, ground each node in the
observed path and attach `sources`. See
[`../renderers/tree/README.md`](../renderers/tree/README.md).

### Class

A class diagram explains the contracts inside one module: which types exist,
which members matter to the explanation, and how the types relate. Choose the
members the question needs; a type may show none. Each type states its `kind`
(`class`, `abstract`, `interface`, `enum`, `record`); every kind except `class`
draws its UML keyword, so an interface never reads as an empty class. For a real
codebase, ground every type, member, and relationship in repository evidence and
attach `sources`.

Every relationship reads `from` -> `to` and its `kind` owns the notation:
`dependency` (`from` uses `to`, dashed open arrow), `association` (`from` holds a
`to`, solid open arrow), `inheritance` (`from` extends `to`, solid hollow
triangle), `realization` (`from` implements interface `to`, dashed hollow
triangle), `composition` and `aggregation` (`from` is the whole, filled or
hollow diamond at `from`). Realization must target an interface from a
non-interface; inheritance must not cross the interface boundary; an
inheritance cycle is rejected.

Place types on the `row`/`col` grid with supertypes above their subtypes. Two
or more automatic generalizations into one supertype draw as one hierarchy bus
with a single triangle. Members never truncate: a type grows to its widest
member up to `layout.typeMaxW` and longer members wrap at parameter boundaries.
See [`../renderers/class/README.md`](../renderers/class/README.md).

First-draft shape: types use `row`/`col` (not `pos`/`size`), fields go in
`attributes[]`, operations in `methods[]` with `parameters` as one string such as
`"msg: Message"` (not an array of objects). Enum members are attributes with only
`name`. Relationships need an `id`, `from`, `to`, and `kind`.

### Timeline

A timeline answers "when did what happen, and how far apart?". Every event
needs an ISO 8601 `at` with an explicit `Z` or `±HH:MM` offset; a timestamp
without one is rejected rather than guessed. `meta.timezone` (IANA, default
`UTC`) is the display clock for ticks and labels, and the axis caption states
it. `meta.evidence` is required: `observed` for recorded events (logs, git
history, pager records) and `illustrative` for explanatory input. Never mark
invented or approximate times as observed, and never fill gaps with events the
input does not contain.

Use `lanes` for sources or categories (release, monitoring, response); every
event then names one. Each event's visible text is `title` (not `label`). `kind`
(`default`, `change`, `alert`, `action`, `recovery`) only
colours the card; inventing values such as `milestone` fails schema validation. Events are drawn in time order whatever the authored order;
simultaneous and close events stack. By default a quiet period longer than 8×
the median gap and 10% of the span is drawn as a fixed-width break labelled
with the omitted duration; `layout.breaks: "none"` keeps one proportional axis.
See [`../renderers/timeline/README.md`](../renderers/timeline/README.md).

### Waterfall

A waterfall answers "where did the time go?" for one request, job, or agent
run. Each span has `id`, `name`, `start`, and `end` or `duration` in
`meta.unit` (`us`, `ms`, `s`; default `ms`), plus optional `parent`, `status`,
`service`, and `detail`. Bar position and length come only from these numbers.
`meta.evidence` is required: `measured` only for recorded timing (trace export,
logs, profiler, timed run); otherwise `illustrative`. Never infer a duration
from code structure, and never present estimated numbers as measured.

A span with no recorded end must be `status: "incomplete"`; it is drawn as an
open lower bound to the last recorded instant. Contradictory end/duration,
an end before the start, a missing parent, or a parent cycle is refused.
Percentages are always "of the wall-clock total"; parent and child durations
are inclusive and never summed. Do not mark a critical path or waiting time
unless the input states the dependency. See
[`../renderers/waterfall/README.md`](../renderers/waterfall/README.md).

### Lifecycle

Schema v3 is the only lifecycle contract. `mainPath` lists the happy path from
the initial state; every consecutive pair needs a transition. The renderer owns
all geometry: the main path is one row, transitions back to an earlier phase
(or skipping ahead) become arcs above it, and every other state sits below the
state it branches from, one row deeper per step away from the main path.
Exits that several consecutive phases share (for example “cancel” from any
running phase) are drawn once from a composite frame around those phases; give
them the same label. There are no lanes, columns, sizes, or routing controls.

Keep the main path to the phases a reader follows, at most about six states,
and keep transition labels short. A recoverable failure needs a real transition
back to an active state; a card saying “retry” is not topology.

Pick each state's `type` by what the reader should notice, since color and the
corner sigil follow it: `waiting` for a pause on a person, time, or input;
`decision` for a review or branch point; `success` or `failure` for a good or
bad outcome; `neutral` for parked states and outcomes that are neither;
`external` when an outside party holds the work; `active` otherwise. From a
Mermaid `stateDiagram`, `[*] -->` names the first `mainPath` state, a state
with `--> [*]` is an outcome (`success`, `failure`, or `neutral`; it is drawn as
final when it has no other outgoing transition), and `<<choice>>` becomes a
`decision` state. Flatten a composite `state X { ... }` into its inner states
and repeat its exit from each of them with one label; consecutive main-path
phases sharing that exit are framed automatically. Concurrent regions (`--`)
have no lifecycle form: draw one lifecycle per region.

## Repository evidence

When the diagram must reflect real code, inspect repository entrypoints,
runtime boundaries, storage, transports, and deployment configuration before
authoring. Record only evidence you actually verified. `--repo-root <path>` is
accepted by `render`, `validate`, `deliver`, and `preview` for every diagram
type, by architecture `compare`, and by workflow `migrate`; every mode verifies `meta.repository` and
node `sources` the same way. Migrating a source-backed workflow requires the same
`--repo-root` so its candidate is verified before replacing the destination.
Never infer runtime causality from file proximity
or naming alone.

Declare `meta.repository.url` and one full 40-character `revision`, then attach
`sources` to the mode's node collection (Architecture `components[]`, Workflow
and Data Flow `nodes[]`, Sequence `participants[]`, Lifecycle `states[]`) with
repository-relative `path`, optional `line`, `end_line`, and `label`.
Verification reads blobs at that commit, independently of working-tree edits.
Verification ignores local Git replacement refs, including those selected by
`GIT_REPLACE_REF_BASE`, and always reads the original objects at the pinned SHA.
It does not change repository configuration or delete replacement refs.
A matching local origin, available commit, bounded path,
blob, and valid line range are required in every link mode. Verification is
local and makes no remote requests; it establishes neither public availability
nor the current reader's access rights.

`link_mode` defaults to `web`. GitHub, Gitee, and GitLab HTTPS repository URLs
generate revision-pinned links; the public hosts github.com, gitee.com, and
gitlab.com select the provider automatically. Optional `provider: "github"`,
`"gitee"`, or `"gitlab"` must agree with a public host. A self-managed GitLab
host declares `provider: "gitlab"`; Archify never contacts the host to detect
its forge. Existing GitHub declarations and default delivery receipt fields
remain compatible.

GitLab URLs may name nested groups (`group/subgroup/project`). Source links use
`<url>/-/blob/<revision>/<path>#L<line>-<end_line>` and the repository link
uses `<url>/-/tree/<revision>`. A Markdown source (`.md`, `.markdown`) with a
line range links to the plain view (`?plain=1`) so the cited lines are
highlighted instead of the rendered document. GitLab repository paths compare
case-insensitively, like GitHub.

```json
{
  "url": "https://gitee.com/team/service",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "provider": "gitee"
}
```

```json
{
  "url": "https://git.example.com/platform/payments/service",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "provider": "gitlab"
}
```

For an internal or unsupported forge, select `link_mode: "local-only"`. The
Viewer retains SRC markers, searchable file paths, line ranges, and revision
labels without repository or source hyperlinks. The evidence receipt adds
`linkMode: "local-only"`. `url` remains required as the expected origin identity;
local-only disables links, not identity verification. A repository without an
origin is not supported.

```json
{
  "url": "http://git.internal:3000/Platform/Services/service",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "link_mode": "local-only"
}
```

Local-only accepts HTTP(S), `git@host:path`, and `ssh://git@host[:port]/path`
addresses, including nested namespaces. Declare a credential-free address;
HTTP(S) credentials on the checkout's origin are ignored for identity and
redacted from diagnostics. Hostnames compare case-insensitively; repository
paths retain case except for GitHub and GitLab. A trailing slash
normalizes away. Only GitHub, Gitee, and GitLab (gitlab.com, or a host declared
with `provider: "gitlab"`) normalize a terminal `.git` and match standard
HTTPS/443 with Git SSH/22 on the same host; a GitLab SSH endpoint on another host
or port is not inferred. For other hosts, use the actual clone address:
transport, port, `.git` suffix, and remote-relative versus absolute paths must
match. For example, `git@host:Team/repo` differs from
`ssh://git@host/Team/repo`; `git@host:/Team/repo` matches the latter. SCP-style
paths preserve literal percent escapes, while URI paths decode them. SSH host
aliases and forge-specific browse/clone prefixes are not guessed.
Gitea/Forgejo/Bitbucket web links are not implemented in this version;
use local-only until a tested link provider is available. Unknown web providers
fail with a diagnostic rather than emitting a guessed link.

## Hand-placed fallback

Use only when no renderer can run. Start from `assets/template.html`, keep semantic CSS classes, preserve the inline SVG/accessibility structure, and run the delivery visual checklist. Never introduce inline literal colors that break dark/light parity.

## Node icons

For domain-specific diagrams, set an optional `icon` on architecture components,
workflow/dataflow nodes, sequence participants, or lifecycle states. Choose
`calendar`, `clock`, `person`, `briefcase`, `flag`, or `moon` for everyday concepts;
the complete catalog (including existing technical and lifecycle symbols) is
`common.schema.json#/$defs/nodeIcon`. Use `icon: "none"` to hide the corner symbol.
Omitting `icon` keeps the type-based default; lifecycle `start`, `active`, and
`neutral` states default to no symbol. These inline SVG symbols are
renderer-owned and export with the diagram; URLs and raw SVG are not accepted.

Icon selection changes only the corner symbol. The node's type still determines
color and semantic grouping; brand marks remain independent. For a holiday
workflow, pair `type: "backend", icon: "calendar"` with
`meta.legend.entries.backend.label: "假期"`, and use `icon: "briefcase"` plus
an appropriate legend label for make-up work. Keep the node label meaningful:
icons are decorative and are hidden from assistive technology.

See [holiday planning](../examples/holiday-planning.workflow.json) for a complete workflow example.
