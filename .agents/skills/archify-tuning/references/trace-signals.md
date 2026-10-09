# Trace signals

Read `<round>/<type>.trace.txt` with the subagent's own report. Each signal below points at a likely cause; confirm it on the first draft before changing anything.

| Signal in the trace | Likely cause | Check |
|---|---|---|
| The final candidate dropped nodes, edges or lanes the first draft had | The agent bought a pass with content | `collect.mjs` "lost" column, then compare the drafts. Highest priority |
| A draft without route controls fails crossing, corridor, through-node or label checks | Possible layout defect or authored placement constraint | Inspect node placement, dimensions and canvas first; render a scratch copy at `standard` to inspect routes, keeping the original failure |
| A crossing or corridor failure, then side pins, then `explicit-pin-conflict`, then a restructure | The router has no legal route the agent can request | Same as above; the hint that suggested pins is also wrong |
| The same code survives a focused repair | The fix text names a change that cannot help | Apply the advertised fix to the draft and rerun |
| Width or gap values oscillate across runs, such as `gapX` 64, 108, 72 | The diagnostic omits the target value | Make it state the required width, gap or character budget |
| The agent writes `meta.viewBox` after a width message | The message implies a path the canvas budget forbids | Make it state the reachable limit and say to omit `viewBox` |
| The agent renders a scratch copy at `standard`, reads renderer source or greps references for a rule | Evidence or documentation is missing from the required path | Add the geometry to the diagnostic, or the fact to a required read |
| `[truncated N chars]` on a read of a reference | A documentation line exceeds the read limit | Split it |
| Two or more subagents list the same unclear point | Documentation gap | Fix the document, not the agent |
| A rerun is blocked by stale evidence or output paths | Delivery friction | Give the exact command in the message |
| A pass on the first run | Nothing to fix | Still check the screenshot: a pass is not a good diagram |

## Root causes found so far

Use these as patterns; each was confirmed by replaying the first draft.

- Workflow same-lane neighbours were placed 8px apart, leaving little route space. Automatic drafts failed on crossings and shared corridors, and agents removed lanes and nodes. Unpinned drafts now use a 32px corridor and may take offset tracks; absolute route pins retain their existing geometry contract.
- Dataflow flows across several stages turned at their midpoint, inside a middle stage's node. Agents deleted nodes. They now turn in the nearest clear gap.
- Dataflow ignored perpendicular pinned sides, so agents hand-wrote `via` points.
- Sequence canvases stayed 920px wide whatever the participant labels needed, and the message suggested widening `viewBox`, which the readability budget forbids.
- Workflow diagnostics named edges by an internal sort order, so agents edited the wrong edge.
- Architecture candidate selection ignored the number of bends, and legends reserved width at a smaller font than they rendered.
- A compile-time text floor applied to tags, which `browser-check` exempts: a self-inflicted false failure, found two rounds late because the affected test file was not run.

## Rejected approaches

- Routing Workflow edges by role and span order: more crossings than the canonical order.
- Ripping up and replanning conflicting Workflow routes after the first pass: it traded crossings for shared corridors and made no draft pass.
- Shrinking or removing content automatically to fit a budget: it hides the accuracy loss this skill exists to prevent.
