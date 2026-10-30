# Immer: keep the complete reference map visible

Round 49 changes the geometry of the round48 reference map. All eight objects, eight arrows, labels, prose, executable code and citations remain. The narrower graph fits a 390 px page without horizontal scrolling; the whole page becomes longer.

[Read the candidate](candidate.html) · [editable explanation](candidate.archify.md) · [native diagram specification](object-map.architecture.json) · [previous page and source research](../immer-sharing/README.md) · [comparison index](../index.html#immer).

## Fixed-input result

| Observation | Previous page | Retained candidate |
| --- | --- | --- |
| Phone diagram viewport / content | 358 / 622 px | 358 / 358 px |
| Phone diagram height | 404 px | 538 px |
| Phone projected node label size | 10.00 px | 11.12 px |
| Phone projected `tasks` edge label size | 7.27 px | 8.09 px |
| Complete 390 px page height | 3383 px | 3472 px |
| Complete 1440 px page height | 1895 px | 2041 px |

Label measurements are SVG font sizes projected through the rendered transform, not a human legibility score. The graph now shows both versions and their shared objects simultaneously. Edge labels remain small. [Base/candidate observations](evidence/browser-comparison-1.json), [selected composition](evidence/browser-candidate-2.json), [phone dark view](evidence/screenshots/candidate-2-390-dark-diagram.png), [desktop view](evidence/screenshots/candidate-2-1440-light-diagram.png).

One native geometry candidate was authored: two vertical branches, with shared objects between them. Routing remains automatic. The first composition retained the previous eight/four-column split, leaving broad blank space beside the narrow graph. The selected composition uses equal columns. It adds another 26 px of desktop height but keeps the graph's text size and gives code more width. No further coordinate repair was needed. [Plan](evidence/plan.md), [decision](evidence/decision.md), [first composition](evidence/candidate-1.html).

This is an explicitly positioned specimen. It does not change the layout engine, authoring defaults or instructions, and does not establish better automatic generation or faster authoring. There is no new independent author run: the fixed input is the round48 parent candidate, whose independent author and subsequent changes are retained in that report.

## Preserved meaning and exercised output

[Semantic comparison](evidence/semantics.json) retains every node identity, label/type and connection. [Source comparison](evidence/source-comparison.json) verifies all prose, code and sources remain unchanged after excluding the native diagram representation and two panel spans. The reused Immer 11.2.9 / Node 22.23.3 probes are linked in the page and copied byte-for-byte from round48. No new library behavior or performance claim is made.

Native showcase finalization passes validation, delivery, provenance and browser checks on the first attempt, with no diagnostics. [Native receipt](evidence/candidate-1-native-finalize.stdout). Explainer strict finalization and provenance also pass. [Canonical finalize](evidence/canonical-finalize.json), [canonical check](evidence/canonical-check.json). Automated receipts' visual-review field remains `not-requested`; the separate actual browser inspection is recorded here.

Both widths in light/dark themes have no horizontal page, code, table or graph overflow. Final canonical geometry matches the inspected candidate. Actual Copy bytes match the round48 program already executed and checked against the probe. Clipboard instrumentation checks payload, not OS permissions. [Canonical browser observations and index controls](evidence/canonical-browser.json), [copied program](evidence/canonical-copied.cjs).

The embedded native Viewer opens and reports ready at both widths. Its entire graph is visible, but its phone text is still small, toolbar space is limited, and the architecture-type legend uses generic English categories. This round does not claim those Viewer concerns are solved. [Phone Viewer](evidence/screenshots/viewer-390.png), [desktop Viewer](evidence/screenshots/viewer-1440.png).

Actual UI PNG downloads are [780 × 7042](evidence/exports/candidate-390.png) and [2880 × 4178](evidence/exports/candidate-1440.png). The complete graph, all code, table, sources and footer were inspected at readable display scale. The phone export retains the taller graph rather than compressing the old wide graph. [Dimensions and view positions](evidence/export-inspection.json), [phone export graph](evidence/screenshots/export-390-1.png), [phone code](evidence/screenshots/export-390-3.png).

Canonical HTML SHA-256: `b42c9c5dc0122f9791bfcfb4fa2d3f11afdf132e66cb83522338ed65dd80f200`. Renaming the external diagram source changes source mapping, dependency/revision metadata and digest. Prepared diagrams are identical; the parsed document differs only at that source filename. No byte-identity claim. [Comparison](evidence/canonical-difference.json), [orchestration and inspection failures](evidence/probe-failures.md).

## Delivery boundary

Base `222ce38f12b2ebab7cac0b6c4193b4807501188c`; fetched dev `5ecbd1bfdbf83ea747072112493c940e707569cb` remains an ancestor. Product runtime `d300979c84b2e049101ff4d6035f19425dec7225` and the round47 reproducible ZIP are unchanged; reuse [that revision's tests/package evidence](../clipboard-feedback/README.md). Content-only evidence was selected under CONTRIBUTING: native/explainer checks, retained meaning, visual/interaction/export checks and local links. No additional runtime suite, package rebuild, final-head CI, human study, assistive-technology check, alternate browser/OS test, merge, release or live installation is claimed.

The index now has 25 questions, 23 projects and 63 variants, including both earlier Immer versions. AI assistance: Codex parent authored and inspected this fixed-input geometry and report at maintainer `@tt-a1i`'s request. Human acceptance remains pending. [Manifest](evidence/manifest.json) covers archived files except itself. Generated native HTML preserves its existing embedded CSS whitespace; [exact scoped exceptions](evidence/archive-formatting.json). Raw working evidence is retained at `/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round49/`.
