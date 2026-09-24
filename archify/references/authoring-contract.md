# Authoring contract

Read this reference only after the Fast authoring path calls for more detail. The schemas and examples remain authoritative.

## Composition repair

When correcting an authored overview's abstraction, map every affected role, relationship direction, protocol, boundary, condition, and source reference to its surviving node or relationship before regrouping. A startup citation does not prove a message protocol. Preserve each claim's inspected evidence. Keep user-supplied or agreed topology fixed; fewer routes alone do not justify merging. A boundary around one node requires an explicit isolation fact and must not merely repeat its label.

## Label repair

When a relationship label collides, move the label, adjust the route or spacing, then shorten the wording while preserving meaning. Omit wording only when both endpoints fully imply it and it conveys no protocol, action, direction, synchronous or asynchronous behavior, or cross-boundary mechanism. Spacing means clear gap rather than center distance; measured mask width takes precedence. The first-draft gap budget is in [Layout and routing](authoring-defaults.md#layout-and-routing).

For a disproportionate sublabel, keep its exact role or protocol concise and place the supplementary fact in a note or card. Preserve every required responsibility, protocol, and boundary fact. Use the first-draft node-width budget in [Layout and routing](authoring-defaults.md#layout-and-routing).

## Schema lookup

Read both the mode schema and `schemas/common.schema.json`. Most mode schemas use `$ref` for shared enums; inspect a mode-local enum before assuming it has the same choices.

- Shared `componentType`: `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, `external`. Architecture also allows `artifact` for files and generated output.
- `variant`: `default`, `emphasis`, `security`, `dashed`
- Relationship IDs use the shared identifier pattern and must be unique in their collection.

Do not invent fields. Before writing any new field, enum, or constrained text, read its schema definition, including common `$ref` targets. In particular, check boundary kinds, guided-view note lengths, repository identity, and source-reference shapes. An example demonstrates structure; it does not enumerate every valid value. Author fresh IDs, wording, facts, and layout.

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
implicit automatic viewBox grows from that same measured footprint. For
backwards compatibility, a legacy document with no `meta.legend` may omit an
implicit auto legend that cannot fit its explicit viewBox; this never changes
its typed topology. Adding `meta.legend` makes the presentation intentional and
strict: if its resolved labels cannot fit the authored viewBox, shorten or hide
them, or widen the viewBox using the emitted diagnostic.

## Language consistency

Choose one primary authored language. An explicit user choice wins; otherwise
use the language of the request, or the conversation's dominant language when
the request itself is language-neutral. Separately choose the Viewer locale.
For supported languages, always write the matching `meta.locale`: `"en"` for
English, `"zh-CN"` for Simplified Chinese, or `"es"` for Spanish. The renderer consumes the authored
locale without inferring language from diagram strings. Documents that omit it
remain valid and default to English.

`meta.locale` controls only renderer-owned reader surfaces: `<html lang>`, the
document-title suffix, default SVG description and focus labels, default legend
labels, and fixed Viewer controls, statuses, accessibility names, and errors.
It never translates authored content. Apply the primary language separately to
titles, subtitles, node and relationship copy, boundaries, lanes, groups,
guided views, legend label overrides, and cards. A bilingual diagram still
chooses one primary locale for the Viewer; follow an explicit primary-language
request, then prompt order or conversation dominance.

For a requested language outside `en`, `zh-CN`, and `es`, do not write an unsupported
locale. Keep every reader-facing authored string in the requested language,
omit `meta.locale` so the renderer safely uses English, and explicitly tell the
user that fixed Viewer UI and `<html lang>` remain English and the artifact is
not fully localized. The fallback applies only to renderer-owned surfaces; it
never permits authored copy to fall back to English. Do not silently substitute
`zh-CN` for another language or Chinese locale.

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
- In architecture, data-flow, and lifecycle diagrams, explicit `route: "straight"` requests one direct segment, which may be diagonal when endpoint sides are not pinned. The artifact checker preserves this intent; explicit sides, opaque-node clearance, and other quality gates still apply. `via` takes precedence and retains existing rules, including data-flow's requirement for orthogonal via segments.
- Automatic Port Spread is a default renderer behavior for architecture, workflow, data-flow, and lifecycle diagrams. Shared automatic endpoints spread deterministically and symmetrically with a 16px corner gutter. It does not apply to sequence messages, single relationships, or explicit `via`, `channelX`, `channelY`, `labelAt`, or non-`auto` routes.
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

Run `validate` after every edit. Consume `diagnostics[]` by stable `code`, exact `subject`, measured `evidence`, and `supportedFixes`. If the diagnostic gives `labelAt`, use that point instead of estimating another offset.

## Mode placement

### Architecture

Choose overview or mechanism detail using [Composition and meaning](authoring-defaults.md#composition-and-meaning). Use one obvious primary reading path, which may step across meaningful rows when the requested topology needs room. Keep the overview readable at its chosen abstraction; expand implementation details when they answer the reader's question. Group only real ownership, trust, process, or deployment boundaries. Boundaries do not replace relationships.

Grid placement is preferred when the schema supports it. Free positions are appropriate for a bounded exception, not for prose-level coordinate planning. Keep external actors outside the system boundary when that is factually true.

### Workflow

Lanes express responsibility or phase. Columns `0..5` express logical
progression. Start new workflows on `readable-v2`; retain `fixed-v1` only for
legacy geometry compatibility. Keep the happy path monotonic, preserve semantic
edge labels, and route retries and exception returns outside the main lane
corridor.

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

Participants are ordered by conversation role. Messages own their vertical order. Use return/async/security variants for meaning, not decoration; sequence does not use Automatic Port Spread.

### Dataflow

Stages express transformation or custody. Rows separate parallel streams. Label only data contracts, classifications, or cross-boundary movement that is not obvious.

### Lifecycle

Main phases use columns `0..4`; event and terminal bands use columns `0..2`.
Event/terminal column `N` aligns to the same x coordinate as main column
`N + 2`. A recoverable failure needs a real transition back to an active state.
A card or guided view saying “retry” is not topology.
Every lane other than `main` and `terminal` shares one middle band; states in
the same column there need distinct `yOffset` values.

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

`link_mode` defaults to `web`. GitHub and Gitee HTTPS repository URLs generate
revision-pinned links; their public hosts select the provider automatically.
Optional `provider: "github"` or `"gitee"` must agree with the host. Existing
GitHub declarations and default delivery receipt fields remain compatible.

```json
{
  "url": "https://gitee.com/team/service",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "provider": "gitee"
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
paths retain case except for the existing GitHub behavior. A trailing slash
normalizes away. Only GitHub and Gitee normalize a terminal `.git` and match
standard HTTPS/443 with Git SSH/22. For other hosts, use the actual clone address:
transport, port, `.git` suffix, and remote-relative versus absolute paths must
match. For example, `git@host:Team/repo` differs from
`ssh://git@host/Team/repo`; `git@host:/Team/repo` matches the latter. SCP-style
paths preserve literal percent escapes, while URI paths decode them. SSH host
aliases and forge-specific browse/clone prefixes are not guessed.
GitLab/Gitea/Forgejo/Bitbucket web links are not implemented in this version;
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
Omitting `icon` keeps the type-based default. These inline SVG symbols are
renderer-owned and export with the diagram; URLs and raw SVG are not accepted.

Icon selection changes only the corner symbol. The node's type still determines
color and semantic grouping; brand marks remain independent. For a holiday
workflow, pair `type: "backend", icon: "calendar"` with
`meta.legend.entries.backend.label: "假期"`, and use `icon: "briefcase"` plus
an appropriate legend label for make-up work. Keep the node label meaningful:
icons are decorative and are hidden from assistive technology.

See [holiday planning](../examples/holiday-planning.workflow.json) for a complete workflow example.
