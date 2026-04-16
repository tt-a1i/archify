# Archify Roadmap

After v2.3.1 ships, the only remaining planned work is a Mermaid-aware v3.0. The original v2.4 / v2.5 backlog (export-scale URL param, color-blind palette, gzip+base64 share links) was considered and dropped — see [Not planned](#not-planned) for the rationale on each.

This roadmap was rewritten on 2026-04-16 after three independent design reviews converged on the same architectural conclusions.

---

## v3.0 — Mermaid-aware architecture

### What

Introduce a thin JSON intermediate representation (`diagram.json`) that sits between input formats (Mermaid flowchart, Claude-written IR) and the existing HTML template. **Mermaid is a first-class input format; auto-layout is explicitly out of scope.** Claude does the layout work, just like today — only now it can ingest a Mermaid diagram as a starting point instead of starting from a chat description.

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

**Deliberately out of v1:** security-group boundaries, region boundaries, summary cards, footer, palette toggle. These stay in the HTML template where they live today. The IR is only for the SVG component graph — the part that needs to round-trip through Mermaid.

`schema_version: 1` is mandatory from day 1. Validated via JSON Schema. All fields except `schema_version` and the component `type` are optional with documented defaults.

### Phasing

| Phase | Deliverable | Target |
|---|---|---|
| **Validate** | 5-Mermaid blind-rate experiment. Continue only if it passes. | (no version) |
| **P0** | JSON IR + JSON Schema validator + `schema_version` enforcement | v3.0-alpha |
| **P0.5** | `render.js` — pure-JS renderer takes IR → HTML using existing template. Coordinates required (no auto-layout in the renderer). | v3.0-alpha |
| **P1** | Mermaid flowchart parser → IR (extracts nodes, edges, `subgraph` blocks, `:::class` hints; leaves `pos` empty) | v3.0-beta |
| **P2** | Updated SKILL.md teaching Claude to read Mermaid-derived IR, fill positions with archify spatial reasoning, apply semantic classes | v3.0-beta |
| **P3** | End-to-end pipeline + re-run validation experiment on real output | v3.0 |
| **P4** | IR → Mermaid output (round-trip) + C4 DSL input adapter | v3.1+ |

### Validation experiment (mandatory before P0)

The whole v3.0 bet rests on: "Mermaid input + Claude layout + archify CSS" looks noticeably better than stock Mermaid. If it doesn't, the architecture has no point.

**Procedure.** Pick 5 real Mermaid flowcharts:

1. Mermaid docs' canonical flowchart example
2. Kubernetes deployment diagram from a popular README
3. Microservices diagram from `awesome-architecture` or similar
4. CI/CD pipeline (GitHub Actions / GitLab style)
5. Simple 3-tier web app

For each, produce three versions:

- **(A)** Stock Mermaid via `mmdc` default theme
- **(B)** Mermaid + archify-style `themeCSS` injection — mimics the v3.0 path *before* any Claude polish (proxies "auto-layout + nice CSS, no spatial reasoning")
- **(C)** Hand-placed in archify HTML by Claude — proxies the v3.0 path *after* Claude polish

Show all 15 screenshots, unlabeled and randomized, to 5 engineers outside the project. Ask:

- Rate each diagram 1–10 for visual quality
- For each diagram (groups of 3), pick which version you'd want in your README

**Pass criterion:** B averages ≥ 7/10 **and** is rated closer to C than to A in at least 4 of the 5 diagrams.

**Fail action:** Kill the Mermaid-input-as-headline path. v3.0 collapses to "Claude-native JSON IR for stable iteration" only; Mermaid input becomes a SKILL.md prompt-engineering trick instead of a real parser. P1/P2/P3/P4 all rescoped or dropped.

### Done when

- `render.js` reproduces today's `examples/web-app.html` byte-for-byte from a hand-written `diagram.json`.
- The Mermaid flowchart parser successfully ingests the 5 validation diagrams.
- Claude, given a positionless parsed IR, produces HTML that meets the success criterion above on at least 4 of 5 diagrams.
- `schema_version: 1` is documented in `docs/diagram-json-schema.md` with the full JSON Schema published.
- Round-trip works: `mermaid → IR → Claude (fills positions) → HTML` and `Claude → IR → render.js → HTML` are both supported flows.
- README and SKILL.md updated to describe the new input pipeline.

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
| **General-purpose graph IR adoption** (Cytoscape JSON / GraphViz DOT / GraphML / Mermaid AST / D2 / C4 DSL) | Each evaluated against archify's actual requirement: hybrid of graph topology + visual layout + non-graph metadata (cards, footer, region boundaries). None covers all three cleanly; the wrappers needed amount to inventing a custom schema anyway. |
| **Zoom & pan UI** | Browser native pinch / Cmd+scroll already works on the SVG. Minimal gain for significant added code. |
| **Annotation / overlay editor mode** | Pushes archify toward being an editor. Positioning is *generator + viewer*, not editor. |
| **Diagram diff UI** | Better delivered as a companion CLI / CI bot than baked into the template. Blocked on `diagram.json` shipping anyway. |
| **PDF export button** | `Cmd+P → Save as PDF` already produces clean output via the v2.2 print stylesheet. No need for a dedicated button. |
| **Font embedding in raster exports** | `local()` fallback (v2.2) covers the common case (developers with JetBrains Mono installed). Full embed adds ~150 KB to every generated HTML file for marginal benefit. |
