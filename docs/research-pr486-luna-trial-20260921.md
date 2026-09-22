# PR #486 Luna/medium authoring trial

## Question and fixed setup

Does optional `inspect-repo` help a Luna/medium author produce a source-backed Archify diagram faster, at the same quality? Two independent Luna/medium authors received the same task: diagram Hono's ordinary HTTP request path from `fetch` to response, including routing, middleware/handler execution, errors, unmatched requests, and HEAD behavior. The candidate ran `inspect-repo` first; the baseline used targeted repository navigation and was prohibited from using the scanner. Both used the Archify package at `ba978c0a592b12c53584f3d59da4b4a4aefea43d` and Hono at `28e8572cd265b4da1160ce6cd51919bb70516e2c`. Candidate ran first. This is one pair, with no randomization or model-token measurement.

The acceptance key was fixed before authoring: route registration; default router and match; Context construction; the one-handler direct path versus the composed path; response/finalization behavior; error and not-found handling; HEAD dispatch as GET with a bodyless response; readability at 1440px; and complete `finalize --quality showcase` gates. Machine pass and semantic/perceptual acceptance are separate.

## Observations

| Observation | With `inspect-repo` | Without `inspect-repo` |
| --- | --- | --- |
| Author start to recorded end | 240 s | 245 s, including a controller pause and follow-up after the first failed finalize |
| Final machine gates | validate, deliver, check, browser-check passed | Same, after four layout-repair iterations reported by the author |
| Browser capture | `visual-check` passed containment in light/dark at 1440×900 and 2048×1320 | Same |
| Source/visual acceptance | Incomplete | Incomplete |

The scanner itself took 268 ms and returned 21,312 bytes. Its first page listed 20 of 468 retained files (4.3%); of the core request-path files, it surfaced `src/index.ts` but not `src/hono.ts`, `src/hono-base.ts`, `src/compose.ts`, or `src/router/smart-router/router.ts`. The candidate still had to locate and read those implementation files. The scanner's configuration-boundary summary and entry-point lead were valid, but not enough to construct this diagram.

Both diagrams omit an explicit condition for Hono's one-handler fast path. The candidate routes every match visually through the composer. The baseline says “direct or composed” in a node but does not show when each branch runs. Both use broad Context-finalization language that can mislead for the direct path. The decisive source is `src/hono-base.ts:431-449` (one matched handler executes directly) versus `src/hono-base.ts:452-467` (other cases call `compose` and require a finalized Context). At 1440px, both diagrams fit the canvas but node and relationship labels are too small to count as comfortable default-view reading. Thus neither is a same-quality accepted diagram despite all automatic gates passing.

The five-second recorded elapsed difference is not a speed result: the baseline interval includes an intervention pause, and the outputs miss the same semantic/readability floor. This run supplies no evidence that `inspect-repo` reduces end-to-end authoring time. It also does not invalidate the separate, measured snapshot-reuse benefit for paged repository inspection. Keep the tool optional for unfamiliar, configuration-heavy repositories; do not make it a default authoring step or claim an overall speedup from this trial. `archify1` was not updated.

## Evidence

- [Pre-dispatch protocol and exact shared task](../benchmarks/pr486-hono-luna-20260921/protocol.md).
- Frozen diagram specifications: [candidate](../benchmarks/pr486-hono-luna-20260921/candidate.json) and [baseline](../benchmarks/pr486-hono-luna-20260921/baseline.json).
- Exact scanner output: [candidate.inspect-repo.json](../benchmarks/pr486-hono-luna-20260921/candidate.inspect-repo.json).
- Passing machine receipts: [candidate](../benchmarks/pr486-hono-luna-20260921/candidate.finalize-summary.json) and [baseline](../benchmarks/pr486-hono-luna-20260921/baseline.finalize-summary.json).
- Default-viewport captures: [candidate](../benchmarks/pr486-hono-luna-20260921/candidate.1440x900.light.png) and [baseline](../benchmarks/pr486-hono-luna-20260921/baseline.1440x900.light.png).
- Full local HTML, browser captures, and original timestamps remain under `/Users/tushaokun/.codex/visualizations/2026/09/21/01a0c47a-bf49-7ba3-8b07-8b43671e574d/inspect-repo-luna-medium-trial/`. These local-only artifacts are not part of the repository.
