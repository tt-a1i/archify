# Archify Roadmap

After v2.3.1 ships, the only remaining planned work is a slim v3.0 focused on coordinate stability. The original v2.4 / v2.5 backlog (export-scale URL param, color-blind palette, gzip+base64 share links) was considered and dropped — see [Not planned](#not-planned) for the rationale on each.

This roadmap was rewritten on 2026-04-16 after three independent design reviews, and updated the same day after a visual-quality validation experiment conclusively failed (see `experiments/v3-mermaid-validation/RESULT.md`).

---

## v3.0 — JSON IR for coordinate stability

### What

Introduce a thin JSON intermediate representation (`diagram.json`) that captures the SVG component graph (components + connections + positions) so Claude can make targeted edits without regenerating the entire HTML. **Mermaid is no longer a first-class parser target** — the validation experiment showed that auto-layout + archify CSS is not meaningfully better than stock Mermaid. Mermaid input is handled via SKILL.md prompt engineering: user pastes Mermaid, Claude reads the structure and lays out from scratch.

### Why this shape (and not the original "diagram.yaml" plan)

Three independent reviews converged on:

1. **Auto-layout (dagre / elk-js) is a dead end for archify.** The aesthetic — Auth Provider floating outside the AWS region, S3 deliberately below CloudFront to imply a serving relationship, security-group boundary at exact 30/50 padding, summary cards, legend nested into dead space — *is* the layout decisions. Stripping the human (or Claude) out of layout strips the product of its differentiator. Dagre output of a typical 8-node graph is a uniform rectangular grid; CSS-skinning it gets you only ~30% of the way from "stock Mermaid" to "archify hand-placed."

2. **"Prettier Mermaid renderer" is already taken.** [lukilabs/beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) ships 15 themes (Tokyo Night, Catppuccin, Nord, Dracula…) with 8.1k stars and is growing fast. Mermaid 11.14 itself added Neo / Redux themes + ELK layout + Hand Drawn look. Competing as "the prettier Mermaid library" is uphill. Archify's real moat is *information architecture* (semantic colors per technology, security boundaries, summary cards, deliberate spatial narrative), not just "prettier CSS on top of Mermaid".

3. **JSON beats YAML as the IR format.** LLM-generated YAML has a high "looks right, parses wrong" failure rate due to whitespace sensitivity, and the inline-flow `pos: [40, 80]` / `sublabel: "Redis :6379"` patterns hit YAML quoting gotchas. JSON has unambiguous parsing, native browser `JSON.parse`, mature JSON Schema validation, and is human-readable enough for `git diff`.

### Architecture

```
                                              ┌→ Mermaid output (P4, v3.1+)
                                              │
   Mermaid input  ─┐                          │
                   ├→ IR (JSON) ─→ Claude ────┼→ archify HTML
   Claude direct ─┘                fills      │
                                   coords     └→ PNG / JPEG / WebP / SVG
                                   + classes
```

The "Claude in the loop" property is the moat, not a limitation. Auto-layout libraries see edges and nodes; Claude sees architectural meaning and lays out accordingly.

### IR (`diagram.json`) — minimal v1 schema

```json
{
  "schema_version": 1,
  "meta": {
    "title": "agmon",
    "subtitle": "AI agent observability",
    "theme": "dark",
    "viewBox": [1000, 680]
  },
  "components": {
    "claude_code": {
      "type": "external",
      "label": "Claude Code",
      "sublabel": "AI coding agent",
      "pos": [40, 80],
      "size": [140, 60]
    }
  },
  "connections": [
    {
      "from": "claude_code",
      "to": "agmon_emit",
      "label": "hooks (stdin)",
      "variant": "default"
    }
  ]
}
```

**Deliberately out of v1:** security-group boundaries, region boundaries, summary cards, footer, palette toggle. These stay in the HTML template where they live today. The IR is only for the SVG component graph.

`schema_version: 1` is mandatory from day 1. Validated via JSON Schema. All fields except `schema_version` and the component `type` are optional with documented defaults.

### Phasing (post-experiment, revised)

| Phase | Deliverable | Target |
|---|---|---|
| ~~**Validate**~~ | ~~5-Mermaid blind-rate experiment~~ | **DONE — FAILED** (see below) |
| **P0** | JSON IR + JSON Schema validator + `schema_version` enforcement | v3.0-alpha |
| **P0.5** | `render.js` — pure-JS renderer takes IR → HTML using existing template. Coordinates required (no auto-layout). | v3.0-alpha |
| ~~**P1**~~ | ~~Mermaid flowchart parser → IR~~ | **KILLED** — experiment showed auto-layout + CSS is not enough |
| **P2** | Updated SKILL.md teaching Claude to accept Mermaid as input and lay out from scratch (prompt engineering, no parser) | v3.0-beta |
| ~~**P3**~~ | ~~End-to-end parser pipeline~~ | **KILLED** |
| ~~**P4**~~ | ~~IR → Mermaid output + C4 input~~ | **KILLED** |

### Validation experiment — FAILED (2026-04-16)

The experiment tested whether auto-layout (dagre) + archify CSS (version B) looked meaningfully better than stock Mermaid (version A). 5 real-world Mermaid flowcharts were rendered in three versions (A/B/C), randomized, and blind-rated by the project owner.

**Result:** Owner rated C (archify hand-placed) as good-looking; A and B as both not good-looking. B was not meaningfully better than A. Both pass criteria failed. Full data in `experiments/v3-mermaid-validation/RESULT.md`.

**Takeaway:** archify's aesthetic moat is in Claude's layout judgment (semantic grouping, deliberate spacing, asymmetric placement), not in its CSS. Any path that removes Claude from the layout loop (auto-layout, parser pipeline) strips the product of its differentiator.

### Done when (revised, post-experiment)

- `render.js` reproduces today's `examples/web-app.html` from a hand-written `diagram.json`.
- `schema_version: 1` is documented in `docs/diagram-json-schema.md` with the full JSON Schema published.
- Claude, given an existing `diagram.json`, can make targeted coordinate edits without unrelated drift.
- SKILL.md updated to mention Mermaid as an accepted input dialect (prompt engineering, not parser).
- README updated to describe the new stable-iteration workflow.

### Workflow renderer pilot (2026-04-24)

Workflow diagrams became the first concrete test of typed diagram renderers inside Archify. The pilot uses a dedicated `diagram_type: "workflow"` JSON IR with lanes, semantic nodes, anchored edges, route presets, and validation checks for common visual failures such as overlapping nodes, labels on short links, unreadable arrow lengths, and legends outside the viewBox.

This does not reverse the anti-auto-layout decision above. The workflow renderer is intentionally a constrained layout assistant, not a generic graph layout engine: lanes and columns provide stability, while Claude still chooses the semantic grouping, lane order, route intent, labels, and summary cards.

### Sequence renderer pilot (2026-04-24)

Sequence diagrams became the second typed renderer pilot. They use `diagram_type: "sequence"` JSON with participants, time segments, messages, activations, and summary cards. The goal is to explain API call chains, request lifecycles, auth checks, cache fallback, async trace/logging, and return paths with Archify's theme/export shell.

Like workflow, sequence is not a generic auto-layout target. The renderer enforces readable spacing and semantic styling, while Claude still decides which participants matter, how the story is grouped, which messages deserve labels, and which return/async paths should stay quiet.

### Data-flow renderer pilot (2026-04-24)

Data-flow diagrams became the third typed renderer pilot. They use `diagram_type: "dataflow"` JSON with lifecycle stages, semantic nodes, labeled data flows, optional classifications, and summary cards. The goal is to explain analytics pipelines, ETL/ELT, PII isolation, governance boundaries, warehouse sync, derived features, and downstream consumers.

Like workflow and sequence, data-flow is not a generic graph layout engine. The renderer provides stable stage/row placement and validation checks, while Claude still decides which data assets matter, where sensitive boundaries should appear, which paths are primary, and which batch or restricted joins should stay visually secondary.

### Lifecycle renderer pilot (2026-04-24)

Lifecycle diagrams became the fourth typed renderer pilot. They use `diagram_type: "lifecycle"` JSON with lanes, states, semantic state types, routed transitions, transition labels, and summary cards. The goal is to explain state machines for agent runs, tasks, orders, deployments, subscriptions, incident tickets, retries, wait states, cancellation, timeout, and terminal outcomes.

Like the other typed renderers, lifecycle is deliberately constrained rather than fully automatic. The renderer gives stable lane/column placement and validation checks, while Claude still decides which states are worth showing, which transitions should be labeled, and how to separate happy path, waits, and exception recovery.

---

## Not planned

Each item below was considered and explicitly declined. Listed so issue submitters can find prior decision context.

| Idea | Why not |
|---|---|
| **`?exportScale=N` URL parameter** | v2.3 explicitly removed the scale selector because it encouraged users to pick a soft output. Re-adding it — even as URL-only with no UI — is a back door to the same footgun. Users needing smaller raster files can resize externally. |
| **Color-blind-safe palette (Okabe-Ito)** | Maintenance burden — every new component class needs a CB variant — outweighs adoption. The CSS-variable system means downstream forks can roll their own palette in ~30 lines without an upstream change. |
| **gzip+base64 share links** | Requires a long-running hosted decoder page, opens an XSS-via-share-link vector that's hard to fully close even with a separate hostname, and bumps URL length limits on realistic diagrams. The "send a single HTML file" workflow is already friction-free. |
| **Auto-layout (dagre / elk-js)** | Independently flagged by all three v3.0 design reviews as the primary risk to archify's aesthetic. The hand-placed coordinate system *is* the product; automating it is automating away the differentiator. |
| **YAML as the IR format** | LLM-generated YAML has a high "looks right, parses wrong" failure rate due to whitespace sensitivity. JSON is unambiguous, has native browser support, and is sufficient for `git diff` readability. |
| **Mermaid flowchart parser + dagre auto-layout** | Validation experiment (2026-04-16) conclusively showed that auto-layout + archify CSS is not meaningfully better than stock Mermaid. Layout IS the product; removing Claude from the loop strips the differentiator. Mermaid input is instead handled via SKILL.md prompt engineering. |
| **General-purpose graph IR adoption** (Cytoscape JSON / GraphViz DOT / GraphML / Mermaid AST / D2 / C4 DSL) | Each evaluated against archify's actual requirement: hybrid of graph topology + visual layout + non-graph metadata (cards, footer, region boundaries). None covers all three cleanly; the wrappers needed amount to inventing a custom schema anyway. |
| **Zoom & pan UI** | Browser native pinch / Cmd+scroll already works on the SVG. Minimal gain for significant added code. |
| **Annotation / overlay editor mode** | Pushes archify toward being an editor. Positioning is *generator + viewer*, not editor. |
| **Diagram diff UI** | Better delivered as a companion CLI / CI bot than baked into the template. Blocked on `diagram.json` shipping anyway. |
| **PDF export button** | `Cmd+P → Save as PDF` already produces clean output via the v2.2 print stylesheet. No need for a dedicated button. |
| **Font embedding in raster exports** | `local()` fallback (v2.2) covers the common case (developers with JetBrains Mono installed). Full embed adds ~150 KB to every generated HTML file for marginal benefit. |
