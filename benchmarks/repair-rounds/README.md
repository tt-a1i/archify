# Repair Rounds v1

**Evidence scope:** synthetic diagnostic regression checks. The injected inputs and rules repairer are not real Agent behavior. Use [real repository generation comparisons](../real-repo-generation/README.md) for claims about authoring quality, rework or end-to-end speed.

This benchmark measures a narrow product question: **how efficiently do Archify receipts let a caller converge to a passing artifact?** It complements `ordinary-model-floor` (first-pass usability) and the `authoring-cost` studies (real agent time and token spend) by isolating the part of authoring cost that lives inside the feedback loop — how many validation rounds a defect costs, how early each defect is surfaced, and how much text each round forces the caller to read.

It is a measurement harness, not a model leaderboard, and it contains no human or model judgment. Everything is driven by deterministic defect injection against the checked-in example fixtures and the real Archify CLI.

## What it measures

| Metric | Definition |
|---|---|
| Rounds to pass | `finalize`/`validate` invocations for successful cases only; `null` when none pass (stalled and round-cap-exhausted cases are counted separately) |
| First-round disclosure rate | injected defects surfaced by round 1 ÷ injected defects |
| First-detection stage | the gate that first reports each defect (`validate`, `deliver`, `check`, `browser-check`, or `undetected`) |
| Late discovery rate | detected defects first surfaced at `check` or `browser-check` ÷ detected defects |
| Actionability | repairs a rules-only repairer could derive from diagnostics alone; `unactionable` receipts are counted honestly |
| Observable token cost | a deterministic lexical estimate over the required-reading set, each round's receipt, and each round's candidate |

A late defect such as `viewer/viewport-overflow` can add another check in this scripted loop. The benchmark does not establish its cost to a real Agent. Diagnostics that name no subject, carry no evidence, and suggest no fix produce `unactionable` repairs rather than silent passes.

## Defect classes

`defects.mjs` defines eight deterministic mutations: `meta-missing-output`, `node-invalid-type`, `node-long-label`, `node-duplicate-id`, `edge-dangling-target`, `viewbox-oversized` (architecture), `title-overflow`, and `subtitle-overflow`. Each declares the diagnostic codes it is expected to surface per diagram type, which is how the harness attributes a diagnostic to a defect inside a combined case. The two header-overflow classes use unbreakable strings so the defect can only be measured by real browser layout.

`manifest.json` holds the suite: a single-defect probe per class per applicable type, plus one mixed-defect case per type whose classes have disjoint expected codes so every attribution stays unambiguous.

## Commands

```bash
# Suite integrity: fixtures pass a clean validate, every defect injects a real change.
node benchmarks/repair-rounds/benchmark.mjs check --manifest benchmarks/repair-rounds/manifest.json

# Run the suite. Default: finalize + rules repair. Emits one JSONL receipt per case.
node benchmarks/repair-rounds/benchmark.mjs run --manifest benchmarks/repair-rounds/manifest.json > results.jsonl

# Subsets and modes:
#   --case <id>             repeat to select cases
#   --repair oracle         restore each attributed defect exactly (upper bound)
#   --command validate      never touch the browser; late classes report undetected
#   --browser-never         alias for --command validate
#   --max-rounds N          repair cap per case (default 8)
#   --work-dir <dir>        keep candidates, artifacts, and receipts for inspection

# Aggregate a results file against the manifest.
node benchmarks/repair-rounds/benchmark.mjs report --results results.jsonl --manifest benchmarks/repair-rounds/manifest.json
```

`run` sets `ARCHIFY_UPDATE_CHECK_DISABLED=1` so receipts are not perturbed by the update check. `browser-check` needs local Chrome; without it the late-discovery cases report the gate truthfully as skipped rather than passed.

Reports require one command and repair mode per input file; mixed configurations are rejected. Coverage compares unique case IDs against the manifest, so repeated cases cannot fill missing cases.

## Repair modes

- `rules` (default): the repairer sees only the receipt — `subject` paths, `evidence`, `supportedFixes`, and pixel figures inside `layout/constraint` messages. It is a mechanical consumer of repairs derivable from what the tool reports; it does not model Agent reasoning.
- `oracle`: each attributed defect is restored exactly. This upper bound isolates staging (how early defects surface) from actionability (whether the receipt suffices to fix them).

## Metrics provenance

The suite borrows three objective ideas and implements them without their original subjective or model-based parts: multi-turn feedback efficiency (ConvCodeWorld, ICLR 2025), failure attribution by pipeline stage (in the spirit of HAL, ICLR 2026), and observable token accounting (TALE, ACL 2025 Findings). The token estimate is a fixed lexical counter, not a provider tokenizer — it exists to compare configurations, not to price a model.

## Non-goals

- No human or VLM/LLM scoring; no screenshot similarity.
- No model, agent, or provider invocation — the harness only runs the CLI.
- No renderer, validator, schema, or SKILL.md changes; the suite only observes them.
- No latency claims from `wallMs`: timing is recorded context, not a gate.
- No end-to-end authoring-cost claims: repair-guide reads are approximated by the documented failure-reading set, not measured from a live agent transcript.
