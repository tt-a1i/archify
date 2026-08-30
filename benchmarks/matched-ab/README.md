# Matched A/B benchmark harness

This harness answers a narrow question: did variant B change elapsed time while
the frozen semantic quality contract still passes? It separates deterministic
machine timing from observed agent runs so model work is never replaced with a
simulated or invented repeat.

## Public seams

- `matched-ab.mjs run` executes the same argv and fixed configuration in two
  clean worktrees at explicitly pinned revisions.
- `matched-ab.mjs quality` compares exact semantic identifiers, not only counts.
  A candidate may add detail, but it may not lose a required fact, node,
  message, or view.
- `matched-ab.mjs validate-agentic` validates one receipt from one real agent
  invocation. It rejects synthetic measurements and provenance drift.
- `schemas/*.json` are the corresponding JSON Schema contracts.

## Machine benchmark

Create two clean Git worktrees for A and B. The harness refuses a revision
mismatch or any tracked/untracked worktree change. Use the same absolute command
array for both variants and pin the current runtime in the manifest:

```json
{
  "schemaVersion": "archify.matched-ab.manifest.v1",
  "benchmarkId": "pi-five-diagram-machine",
  "machine": {
    "command": ["/absolute/path/to/node", "/absolute/path/to/observer.mjs"],
    "warmupPerVariant": 1,
    "rounds": 5,
    "order": "ABBA",
    "timeoutMs": 120000,
    "env": {},
    "runtime": {
      "nodeVersion": "v22.23.1",
      "platform": "darwin",
      "arch": "arm64"
    },
    "fixedConfig": {
      "projectRevision": "e86823096c5bad39e1ca282ec24bc5eb9bec745b",
      "diagramSet": ["architecture", "workflow", "sequence", "dataflow", "lifecycle"]
    },
    "variants": {
      "A": {
        "label": "baseline",
        "cwd": "/absolute/path/to/baseline-worktree",
        "revision": "0000000000000000000000000000000000000000"
      },
      "B": {
        "label": "candidate",
        "cwd": "/absolute/path/to/candidate-worktree",
        "revision": "1111111111111111111111111111111111111111"
      }
    }
  },
  "quality": {
    "semanticCoverage": {
      "facts": ["fact:source", "fact:sink"],
      "nodes": ["node:api", "node:database"],
      "messages": ["message:request", "message:response"],
      "views": ["light@1440x900", "dark@390x844"]
    }
  }
}
```

The observer command must write exactly one JSON object to stdout:

```json
{
  "semanticCoverage": {
    "facts": ["fact:source", "fact:sink"],
    "nodes": ["node:api", "node:database"],
    "messages": ["message:request", "message:response"],
    "views": ["light@1440x900", "dark@390x844"]
  },
  "observedConfig": {
    "projectRevision": "e86823096c5bad39e1ca282ec24bc5eb9bec745b",
    "diagramSet": ["architecture", "workflow", "sequence", "dataflow", "lifecycle"]
  }
}
```

The harness injects these variables into every observer invocation:

- `ARCHIFY_BENCHMARK_VARIANT` (`A` or `B`)
- `ARCHIFY_BENCHMARK_PHASE` (`warmup` or `measure`)
- `ARCHIFY_BENCHMARK_ROUND`
- `ARCHIFY_BENCHMARK_PAIR`
- `ARCHIFY_BENCHMARK_CONFIG_JSON`

Run it with:

```bash
node benchmarks/matched-ab/matched-ab.mjs run \
  --manifest /absolute/path/to/manifest.json \
  --receipt /absolute/path/to/receipt.json
```

Each round runs `A B B A`, producing two direction-balanced pairs. Warmups are
recorded but excluded from statistics. The receipt reports per-variant median
and nearest-rank p95, plus paired `B - A` median/p95 in milliseconds and percent.
A negative paired delta means B was faster. Use enough rounds for p95 to be
meaningful; five is a smoke benchmark, not a stable performance conclusion.

## Standalone semantic gate

Both files contain arrays named `facts`, `nodes`, `messages`, and `views`.
Identifiers must be stable and source-derived. The candidate can be a superset.

```bash
node benchmarks/matched-ab/matched-ab.mjs quality \
  --baseline /absolute/path/to/baseline-coverage.json \
  --candidate /absolute/path/to/candidate-coverage.json
```

Exit code `2` means semantic quality regressed. This gate complements, and does
not replace, Archify's deterministic validator, browser containment checks,
screenshots, evidence verification, or human visual review.

## Observed agent runs

Agent timing is intentionally not run by this machine harness. Create one
`archify.agentic-ab.manifest.v1` document and one
`archify.agentic-ab.receipt.v1` document per actual model invocation. Pin the Pi
revision, Archify revision, active skill SHA-256, prompt SHA-256, config SHA-256,
host/runtime SHA-256, model, and reasoning effort. The receipt must use:

```json
"measurement": { "kind": "observed", "clock": "epoch-ms" }
```

Validate every real receipt before aggregation:

```bash
node benchmarks/matched-ab/matched-ab.mjs validate-agentic \
  --manifest /absolute/path/to/agentic-manifest.json \
  --receipt /absolute/path/to/agentic-receipt.json
```

The validator checks manifest/receipt identity, exact fixed inputs, timestamps,
stage durations, artifact SHA-256, and quality-receipt SHA-256. It deliberately
does not manufacture repeats or infer unobserved model time. A coordinator may
compute matched statistics only after collecting independently observed A and B
receipts under the same fixed-input contract.

## Test

```bash
node --test benchmarks/matched-ab/test/matched-ab.test.mjs
```

The fixtures prove that the quality gate detects losses in all four semantic
dimensions, that the machine runner performs warmup plus multi-round ABBA, and
that synthetic agent receipts are rejected.

## Remaining manual controls

- Freeze semantic identifiers from accepted Pi source evidence before the run.
- Prepare clean, committed A and B worktrees; do not benchmark a changing branch.
- Keep power mode, background load, browser/Chrome version, fonts, and host fixed.
- Run the existing visual and deterministic quality suite for every delivered
  artifact; semantic coverage alone cannot prove visual quality.
- Execute genuine agent repeats. The harness validates their receipts but never
  claims that a machine fixture represents model behavior.
