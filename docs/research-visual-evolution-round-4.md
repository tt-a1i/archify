# Visual Evolution Round 4 — Question-first scenario recipes

Date: 2026-07-19
Status: implemented on `codex/archify-visual-evolution`

## Problem

Five renderer modes are useful only when a user can choose the right one. A type list makes users translate their real question into diagram jargon, and a large all-purpose canvas encourages clutter. This round adds a question-first choice layer without turning Archify into a broad drawing platform.

## What we learned

### Fireworks Tech Graph: visual styles need semantic contracts

The official [style-to-diagram matrix](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/style-diagram-matrix.md) does not treat every style as suitable for every diagram. Its engineering-oriented styles require domain evidence: C4 level and responsibilities, deployment ownership and boundary crossings, event topics and consumer groups, or operational signals and failure paths.

The useful idea is not “add more themes.” It is “pair each visual language with a bounded question and evidence contract.” Archify adopts that principle through scenario recipes while keeping its existing five typed renderers.

The official [composition quality contract](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/composition-quality-contract.md) also makes legibility measurable: the showcase profile budgets zero line crossings, no bridges, at most two bends, minimum node spacing, and container gutters. Its fallback is to simplify or split the topology. That reinforces Archify's existing one-main-path and small-view rules.

### Structurizr: scope before notation

Structurizr's official [workspace scope guidance](https://docs.structurizr.com/workspaces/scope) recommends scoping a workspace to a single software system and warns that an all-in-one workspace becomes cluttered. Its [notation guidance](https://docs.structurizr.com/server/diagrams/notation) deliberately uses a small vocabulary of boxes and unidirectional arrows with consistent styling across views.

The useful idea is constraint, not imitation: one technical question per recipe, a stable visual grammar, and explicit “avoid when” copy.

## Product decision

Implement 11 small scenario recipes across Archify's five existing modes:

| Mode | Recipes |
|---|---|
| Architecture | system overview; deployment ownership |
| Workflow | agent tool-call; delivery workflow; incident runbook |
| Sequence | API request; async roundtrip |
| Data flow | data lineage; event-stream topology |
| Lifecycle | object lifecycle; deployment lifecycle |

Every recipe defines:

- the exact question it answers;
- when to use and when not to use it;
- four evidence items that must appear;
- suggested preset, motion, and guided-view usage;
- English and Chinese copy-ready prompts;
- weighted bilingual signals for deterministic recommendation.

## Delivery boundary

The recipe module under `archify/recipes/` is the only product data source. The zero-dependency CLI imports it dynamically, and the static GitHub Pages chooser is generated from it. This prevents website and installed-skill advice from drifting apart.

This is intentionally not:

- a new renderer for each borrowed visual style;
- an LLM classifier or server dependency;
- a generic template marketplace;
- permission to invent missing deployment, event, or ownership facts.

## Acceptance checks

- 11 unique recipes with complete bilingual decision copy.
- Representative English and Chinese scenarios route to specialized recipes.
- `archify guide` works without `node_modules`.
- The generated website is byte-for-byte reproducible from the shared source.
- Desktop and mobile browser checks cover recommendation, filtering, localization, and console cleanliness.
