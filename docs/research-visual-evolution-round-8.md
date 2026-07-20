# Visual evolution round 8: semantic Node Finder

Date: 2026-07-19
Status: implemented on `codex/archify-visual-evolution`

## Problem

Archify can focus a node after the reader sees it, and guided views can lead a reader through authored paths. A reader opening an unfamiliar or wide diagram still has no direct answer to “where is Redis?”, “which node owns audit?”, or “show me the worker.”

## External patterns reviewed

- [React Flow Node Search](https://reactflow.dev/ui/components/node-search) searches node labels, selects the chosen node, and fits the viewport to it.
- [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility) makes nodes keyboard-operable and automatically pans focused nodes into view.
- [G6 behavior overview](https://g6.antv.antgroup.com/en/manual/behavior/overview) separates focus, zoom, drag, and selection into composable viewer behaviors.
- [G6 Minimap](https://g6.antv.antgroup.com/en/manual/plugin/minimap) positions a thumbnail as a global locator for graphs large enough to need region navigation.

## Product decision

Add a semantic Node Finder, not a persistent minimap.

Archify's authored diagrams intentionally stay bounded—architecture guidance recommends roughly 8–12 core components, and the other renderers use constrained lanes, stages, or participants. A minimap would permanently spend diagram area to summarize a graph that already fits on one authored canvas. Search solves the actual unfamiliarity problem without adding another visual layer.

The finder:

- opens from the diagram controls or <kbd>/</kbd>;
- derives labels, sublabels, types, IDs, and relationships from the rendered semantic SVG;
- searches case-insensitively without adding schema fields or a runtime dependency;
- reports semantic type plus unique relationship count;
- supports input, arrow, Home/End, Enter, and Escape keyboard paths;
- releases a guided view, resets zoom/pan, focuses the selected node, and auto-reveals it on contained wide-mobile diagrams;
- writes only the existing `#focus=<id>` deep link;
- remains hidden in embed/print output and outside canonical SVG export.

## Invariants

- All five typed renderers ship one identical finder runtime.
- Finder HTML and runtime state never enter the SVG.
- Relationship counts deduplicate visible paths and label groups sharing the same `from`/`to` pair.
- Search and selection work inside Presentation Stage.
- Wide mobile diagrams keep the finder pinned while their 720px reading surface scrolls underneath.
- Embed mode remains a chrome-free read-only proof surface.
