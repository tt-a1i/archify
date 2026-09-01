# v3.0 Mermaid Validation — Results

> **Purpose:** Verify the core hypothesis: "Mermaid input + Claude layout + archify CSS" produces diagrams rated significantly better than stock Mermaid. See `../../ROADMAP.md` for the experiment design.

## Versions

| Code | What it is |
|---|---|
| **A** | Stock Mermaid via `mmdc` — default theme, dagre layout, no customization |
| **B** | Mermaid via `mmdc` + archify-style themeCSS — same dagre layout, archify color palette / font / background |
| **C** | Hand-placed archify HTML — Claude-assigned semantic classes + hand-placed coordinates + archify CSS |

## How to blind-rate

> **Provenance cleanup (2026-09-01):** The original run used 5 diagrams and 15 screenshots. Diagrams 4 and 5 and their derivatives were removed because their source repositories did not provide verifiable redistribution licenses. The retained 3-diagram / 9-screenshot evidence can still be inspected, but the original five-input run is no longer fully reproducible from HEAD.

1. Open each retained file in `screenshots/` — they're randomized, labels stripped
2. Rate each 1–10 for visual quality
3. After all 9, open `screenshots/manifest.txt` to de-anonymize
4. Fill in the tables below

## Self-evaluation (project owner)

> Fill this in first. If B clearly doesn't meet the bar, skip the 5-engineer panel.

| Image | Score (1–10) | Notes |
|---|---|---|
| img-04-12c2 | | |
| img-05-n1tw | | |
| img-06-hkrq | | |
| img-07-43uu | | |
| img-08-weo4 | | |
| img-10-rnix | | |
| img-12-nlmi | | |
| img-13-5mj4 | | |
| img-15-05g2 | | |

### De-anonymized summary (fill after rating)

| Diagram | A score | B score | C score | B closer to C or A? |
|---|---|---|---|---|
| 1 (Mermaid canonical) | | | | |
| 2 (K8s log pipeline) | | | | |
| 3 (moke-kit microservices) | | | | |

**B average:** ___  
**B closer to C in ___ / 3 retained diagrams**

## Pass criterion (from ROADMAP.md)

- [ ] B averages ≥ 7/10
- [ ] B is rated closer to C than to A in at least 4 of 5 diagrams

The 4-of-5 threshold is preserved as the original, pre-registered criterion. It must not be rewritten post hoc as a 2-of-3 criterion; after the provenance cleanup, that original threshold cannot be rerun from the current tree.

## Decision

- [ ] **PASS** → Proceed with v3.0 Mermaid-aware architecture (P0 → P3)
- [x] **FAIL** → v3.0 collapses to "JSON IR for stable iteration only"; Mermaid input becomes a SKILL.md prompt trick, not a parser

### Notes (2026-04-16)

Owner self-evaluation result: **C (archify hand-placed) looks good; A and B both don't look good.** B is not meaningfully better than A — swapping CSS without changing layout does not bridge the aesthetic gap. The experiment confirms all three pre-experiment reviews: layout is the product, not CSS.

**Consequence:**
- P1 (Mermaid flowchart parser → IR with dagre layout) is **killed**.
- P0 / P0.5 (JSON IR + render.js for coordinate stability) remain **viable** — they solve the coordinate-drift problem independent of Mermaid input.
- Mermaid input becomes a **SKILL.md prompt-engineering trick**: user pastes Mermaid, Claude reads the structure and lays out from scratch in archify style. No dagre, no parser, no auto-layout. This is already how archify works today (user describes → Claude draws), just with Mermaid as the input dialect instead of natural language.
- External 5-engineer panel is **skipped** — self-eval conclusively failed both criteria.

---

## External panel (optional, only if self-eval passes)

### Rater 1: ___

| Image | Score (1–10) |
|---|---|
| 9 retained screenshots | |

_(repeat for Raters 2–5)_

### Aggregate

| Diagram | A avg | B avg | C avg | B closer to? |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

**Panel B average:** ___  
**Panel B closer to C in ___ / 3 retained diagrams**
