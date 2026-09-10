# Visual Evolution Round 5 — Every recipe earns a proof

Date: 2026-07-19
Status: implemented on `codex/archify-visual-evolution`

## Problem

The question-first guide defined 11 useful scenario recipes, but only five had a matching live artifact. That weakened the promise: users could receive good advice without seeing whether Archify could actually render the recommended result.

## What we learned

### LikeC4: views are named, shareable product surfaces

LikeC4's official [Views documentation](https://likec4.dev/dsl/views/) treats views as named projections whose names become export filenames and shareable URLs. Its [dynamic-view navigation](https://likec4.dev/dsl/views/dynamic/) lets a step navigate into a more detailed view, and its project configuration can expose a curated landing-page grid.

Archify keeps its smaller boundary—one self-contained diagram rather than a persistent architecture model—but adopts the product lesson: a scenario recommendation should lead to a named, shareable proof instead of a generic gallery homepage.

### D2: presentation value comes from inherited steps

D2's official [Steps documentation](https://d2lang.com/tour/steps/) defines each step as inheriting the prior one, while [Composition](https://d2lang.com/tour/composition/) distinguishes independent layers, base-derived scenarios, and sequential steps. This makes presentation changes comprehensible because the audience retains context.

Archify's equivalent is intentionally geometry-stable: each proof keeps one typed JSON graph and one SVG layout, then uses three bounded `meta.views` to focus successive parts. Playback changes emphasis, never the underlying coordinates.

## Product decision

Create one real proof for every scenario recipe:

| Mode | Proofs |
|---|---|
| Architecture | system overview; production deployment ownership |
| Workflow | agent tool-call; delivery workflow; incident runbook |
| Sequence | API cache fallback; async job roundtrip |
| Data flow | governed analytics lineage; event-stream topology |
| Lifecycle | agent run; deployment release |

Six new JSON examples were added for the missing scenarios. The four older non-workflow examples gained trace motion where appropriate and three named views. The existing agent workflow already had the same contract.

## Invariants

- Every one of the 11 recipe `proof` IDs resolves to exactly one gallery manifest entry.
- Every proof is generated from checked-in JSON IR and receives four structural checks.
- Every proof exposes exactly three named reader views and shareable `#view=` navigation.
- Guide results link to `gallery.html#proof-<id>`, and the target card receives a visible highlight.
- Proof navigation never changes the renderer schemas or introduces a runtime dependency.

## Result

The Proof Lab grows from 5 artifacts / 20 checks to 11 artifacts / 44 checks. Richness is now demonstrated across real deployment, release, incident, asynchronous, event-stream, and rollback stories rather than inferred from a list of supported types.
