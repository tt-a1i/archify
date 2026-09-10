# Verified Source Beacons — focused follow-up

Date: 2026-07-23
Decision: make already-verified repository evidence visible on the canvas; add no parser, panel, or inferred graph data.

## Current signal from adjacent projects

- Understand Anything makes each file/function/class node clickable and pairs selection with code, relationships, and explanation. Its own positioning is “graphs that teach,” not complexity for its own sake ([README at `6ae7187`](https://github.com/Egonex-AI/Understand-Anything/blob/6ae71878beb50226a1e4b7e2f52ac6468c86f74b/README.md#L51-L80)).
- CodeVisualizer gives “click nodes to navigate to code” first-class placement alongside pan, zoom, and local parsing ([README at `5b100b8`](https://github.com/DucPhamNgoc08/CodeVisualizer/blob/5b100b847ec9a86ac07129f7f6ed1a9deafc9ecc/README.md#L96-L119)).
- Fireworks Tech Graph continues to win attention through broad visual formats, validated semantic motion, offline HTML, and geometry checks ([README at `50c819d`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/50c819d68fd4fee330b3010988cd13e98b678d44/README.md#L136-L153)). Archify should keep that artifact-level rigor while differentiating through trustworthy code evidence.

## The gap after Repository Evidence Passport

Archify already verifies a public GitHub origin, full revision, blobs, and optional line ranges before it writes an evidence artifact. It already exposes those links inside the Semantic Passport and includes their paths in Node Finder search. The remaining problem is discoverability: a reader looking at the canvas cannot tell which nodes have evidence until after selecting them.

## Bounded product contract

1. An evidence-backed node gets one quiet viewer-only `SRC n` beacon in its upper-right corner.
2. The beacon count comes only from the verified payload. Ordinary artifacts receive no beacon.
3. The node remains the single interaction target; selecting it opens the existing Semantic Passport. There is no extra toolbar item, modal, panel, or tab stop.
4. The beacon follows the node through focus, routes, stories, guided views, themes, and presets.
5. Screen-reader labels disclose the verified reference count.
6. SVG, raster, Share Card, and WebM backgrounds remove the runtime beacon and restore the canonical node label.

## Why this is the next slice

It turns a hidden trust feature into a visible reason to click without expanding Archify into an IDE, repository indexer, hosted graph, or drawing suite. The visual change is small enough to test exhaustively and useful enough to strengthen the core sentence: **see the architecture, then open the exact revision-pinned code that proves it.**
