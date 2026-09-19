# Adaptive Workflow pilot benchmark

This benchmark measures the deterministic machine portion of the Workflow compiler pilot on six fixed Workflow v2 sources. It records immutable input and candidate hashes, mutation outcome, diagnostic codes and families, compiler/validation durations, layout and quality receipt hashes, operation-budget outcome, environment, code snapshot, and an alternating AB/BA schedule.

It deliberately labels every run `machine-only`. These results cannot establish the Goal's 20–30% end-to-end claim because they do not observe model authoring, repair decisions, visual review, concurrent-agent wall time, or human handoff. Observed-agent receipts must be collected separately against the same manifest and exact commits.

Check the corpus:

```bash
node benchmarks/adaptive-workflow-pilot/benchmark.mjs check
```

Run three matched pairs per source against two immutable skill roots:

```bash
node benchmarks/adaptive-workflow-pilot/benchmark.mjs matched \
  --a-root /path/to/base/archify \
  --b-root /path/to/candidate/archify \
  --a-revision BASE_SHA \
  --b-revision CANDIDATE_SHA \
  --pairs 3 \
  --output benchmarks/adaptive-workflow-pilot/results/run.json
```

Evidence is attributable only when each root is an immutable checkout/archive of its declared revision, `revisionMatches` is true, and the code hashes are retained with the raw result. A dirty development worktree is diagnostic evidence only, never exact-commit performance evidence.

Diagnostic families are stable and queryable: `viewport-containment`, `viewbox-capacity`, `node-overlap`, `edge-crossing`, `label-clearance`, `readability`, `semantic`, `language`, `infrastructure`, and `other`.

Capture the real-browser evidence bundle for the 30-node/50-edge case:

```bash
ARCHIFY_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node benchmarks/adaptive-workflow-pilot/capture-visual-evidence.mjs
```

The bundle contains the materialized source, compiled layout receipt, standalone HTML, four screenshots, contact sheet, and artifact-bound visual-check receipt. It proves bounded-world reachability and canonical export behavior; it is not end-to-end authoring-time evidence.
