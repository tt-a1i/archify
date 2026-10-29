# Which “shortest” does NetworkX use?

Round 34, 2026-10-30. [Open the candidate](candidate.html), [authored source](candidate.archify.md), [independent original](author/answer.html).

The same graph has a one-edge route A → D with stored `cost=5`, and a two-edge route A → B → D with total `cost=2`. Omitting `weight` selects the first; specifying `weight='cost'` selects the second. The candidate puts the graph beside a two-column comparison, then pairs complete Python with its actual output. Missing attributes stay next to their consequence: a default contribution of 1 does not mean a stored cost of 1.

Base/runtime `85ebcb876f82b3dab08d7f43d8c55974e0c86911`; refreshed `dev` remains ancestor `5ecbd1bfdbf83ea747072112493c940e707569cb`. This round changes only experimental content and its index; no runtime, schema, dependency or package change.

## Pinned source and execution

NetworkX **3.7**, commit `49ca2290b80c1389eb4d8d8e49dcba73f8fec016`, in an isolated Python **3.12.13** environment. The [parameter contract](https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/generic.py#L43-L74) distinguishes omitted weight, attribute names and callables; [attribute lookup](https://github.com/networkx/networkx/blob/49ca2290b80c1389eb4d8d8e49dcba73f8fec016/networkx/algorithms/shortest_paths/weighted.py#L41-L78) supplies 1 when the selected attribute is absent. The final prose describes `weight='cost'` specifically, rather than claiming every weight argument must be an attribute name.

[Identity](source/identity.json) records that installed generic, weighted and unweighted shortest-path modules byte-match the pinned source files. [Environment log](evidence/environment.log), [source brief](source/brief.md). The initial NetworkX 3.5 lookup was research only. The isolated environment and raw third-party modules remain outside the repository; nothing was installed into the project or a live Archify destination.

[Probe](source/probe.py), [run 1](source/probe-1.json), [run 2](source/probe-2.json): six graph/call combinations, byte-identical across two runs. They cover stored `cost` with omitted/matching/wrong parameter; an attribute literally named `weight` with omitted/matching parameter; and missing direct-edge `cost`. All preserve their input graphs. These are constructed, unitless positive weights; no real route, performance, ties, negative-weight, unreachable-node or alternate-backend claim.

## Authoring and revisions

[Plan](evidence/plan.md), [assignment](evidence/author-prompt.txt), [first draft](author/first-draft.archify.md), [work log](author/work-log.txt). The independent Terra/medium author recorded work start at 22:10:36Z after reading its prompt, saved the draft at 22:10:50Z, passed its first strict finalize at 22:10:55Z and prepared handoff at 22:10:57Z. Prompt reading is outside that recorded interval. The author did not run a browser; parent review and corrections are additional, not a speed benchmark.

| Version | 390 px page height | 1440 px page height | Reading change |
| --- | ---: | ---: | --- |
| [Original](author/answer.html) | 2,564 px | 1,473 px | Two tables, narrow API-call cells, code and graph overflow on phone |
| [Revision 1](attempts/candidate-1.html) | 2,308 px | 1,233 px | Explicit half-width panels, one comparison table, multiline Python |
| [Revision 2](attempts/candidate-2.html) | 2,303 px | 1,233 px | Short row labels replace fragmented parameter names |
| [Final candidate](candidate.html) | 2,328 px | 1,233 px | Accurate node legend and graph caption; precise attribute wording |

[Original measurements](evidence/author-browser.json), [revision 1](attempts/candidate-1-browser.json), [revision 2](attempts/candidate-2-browser.json), [final measurements](evidence/canonical-browser.json). Final 390/1440 px light/dark states use the clean style selected through actual controls; none has horizontal document, diagram, table or code overflow. This does not prove improved comprehension.

The planned two revisions were exceeded by a bounded correctness pass after actual Viewer inspection. Its [scope record](evidence/scope-extension.md) preserves the reason. The [initial Viewer](screenshots/viewer-initial.png) misleadingly labels ordinary nodes “Agent 逻辑” and “外部系统”. An [explicit native specification](graph.workflow.json) uses the existing legend contract to label all three as “节点”; [final Viewer pixels](screenshots/canonical-viewer.png) confirm this. The endpoints, placement and weights remain unchanged. Revision 2's duplicated “边上” is corrected, and a caption distinguishes the graph from algorithm execution. The [intermediate legend-repair source](attempts/legend-repair-candidate.archify.md), [HTML](attempts/legend-repair-candidate.html) and [measurement](evidence/before-wording-canonical-browser.json) remain, before the final attribute wording adjustment.

Phone edge-label boxes remain about **8.5 px high**, and node-label boxes about **11.5 px**. The complete weight comparison is also in normal body text. The phone Viewer initially clips the rightmost D node; keyboard opening, readiness, Escape and focus return pass, but complete initial framing does not. These are explicit remaining limitations, not successful mobile Viewer acceptance.

## Delivery evidence

The canonical page passes [strict finalize](evidence/canonical-finalize.json) and [current-path provenance check](evidence/canonical-check.json). HTML SHA-256: `abce21b9d320bb3b4b9d2e9b7202e7da57aca9edfb8d1f3c4c57c89b563b64e0`. Historical artifacts retain their original receipt paths; those receipts do not certify the relocated copies.

Two actual Copy controls produce bytes identical to the visible program and output. [Payloads](evidence/copies.json), [runner](evidence/copy-run.py), [result](evidence/copy-run.json): the exact copied Python runs in a fresh temporary directory using the recorded environment and prints precisely the copied output plus its final newline. Clipboard API interception does not verify OS clipboard permissions.

The native spec, semantic graph, rendered node IDs and rendered edge IDs match the actual probe's three directed edges and weights: [audit](evidence/graph-audit.json), [comparison](evidence/graph-result.json). [Keyboard Viewer result](evidence/viewer-check.json). A browser script initially contained an incorrectly escaped newline and failed to parse before browser actions; [script](evidence/browser-04.mjs), [failure](evidence/browser-04-failure.txt), [corrected script](evidence/browser-05.mjs) are retained.

The [actual reader PNG](candidate-390-light.png), **780 × 4754 px**, was inspected as pixels at [top](screenshots/export-top.png), [middle](screenshots/export-middle.png) and [bottom](screenshots/export-bottom.png). It retains all three edges, table rows, complete code/output and the missing-attribute qualification. The [index verification](evidence/export-index-check.json) switches both variants at both preview widths and matches their full-page links. The index now contains **sixteen questions across fourteen projects, with thirty-six retained variants**. Archive identities are in [manifest](manifest.json). No runtime suite or ZIP rebuild is repeated for this content-only round; source-card export evidence remains at source `7a8625b10379992da6a89872430f16e20b80ee89` and package/evidence `85ebcb876f82b3dab08d7f43d8c55974e0c86911`. No full browser acceptance runner, final-head CI, Windows/Safari, assistive-technology or human comprehension result is claimed.

Under the [project benchmark convention](../../../../benchmarks/real-repo-generation/README.md), this is one new-project discovery with parent content corrections, not a controlled generation comparison. AI disclosure: Codex researched, authored, edited, executed and inspected this case. No human acceptance, merge, release or live installation is implied. The continuous goal remains active.

Archive checks: the initial local-link check ran before manifest creation and failed on that missing file; it was rerun after creation. The full cached whitespace check reports 72 trailing-space lines in preserved generated HTML (embedded native CSS). Those artifacts were not rewritten, preserving receipt identities; authored/evidence text and the hand-written index pass separate whitespace checks. [Check notes](evidence/archive-check-notes.json).
