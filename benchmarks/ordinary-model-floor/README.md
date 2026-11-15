# Ordinary-Model Floor v1

**Metric scope:** historical `firstPassUsable` means usability after one complete Agent invocation, which may include repairs. It is not first-draft success. For PR comparisons with draft history and full sessions, use [real repository generation comparisons](../real-repo-generation/README.md).

This benchmark measures a narrow product question: can an ordinary coding agent produce an Archify diagram that is usable on attempt 1, without a human repairing the JSON?

It is a delivery gate, not a model leaderboard. A run is `firstPassUsable` only when all three gates pass:

1. Semantic requirements are present and correctly connected.
2. The real Archify CLI passes `validate --quality showcase --json`.
3. An identified reviewer inspects the final rendered artifact, records `passed`, and reports no defects.

A renderer-valid but semantically wrong diagram is a failure. A visually pleasing diagram that fails deterministic validation is also a failure. A missing visual review is reported truthfully, never upgraded to a pass.

## Suite

`manifest.json` contains five bounded tasks: architecture, workflow, sequence, data flow, and lifecycle. Each case declares semantic keys, accepted technical labels, accepted visual-role types where more than one rendering is legitimate, and required relationships. The model remains free to choose internal IDs and layout. Vocabulary aliases never replace topology: every required node must bind once and every required relationship must still exist in the declared direction.

The checked-in reference fixtures only prove that the suite and verifier are wired correctly. **Reference fixtures are not benchmark evidence** and must not be published as model results.

Check suite integrity from the repository root:

```bash
node benchmarks/ordinary-model-floor/benchmark.mjs check --manifest benchmarks/ordinary-model-floor/manifest.json
```

## Fair-run protocol

Every compared configuration must use the same prompt, the same repository commit, the same Archify skill and schema, the same time limit, identical tool access, and a clean candidate output path. Record the exact agent and model names. One complete agent invocation is attempt 1; the resulting `benchmark-candidate.json` is frozen when the invocation ends. The agent may use the bundled Archify CLI to validate and repair its candidate during that invocation; the external harness independently revalidates the frozen file and remains the final authority. Preserve that unedited candidate and permit no post-hoc edits, including human edits, before verification.

Run candidate generation from the extracted **packaged skill root** produced by that commit, not from the development repository root. Keep the benchmark harness, cases, prompts, and reference fixtures outside the model-visible working tree; deliver the selected prompt through the external runner. This tests the surface users actually install and prevents benchmark internals from changing exploration cost or leaking evaluation evidence.

Do not let a later correction replace attempt 1. Correction attempts may be retained for diagnosis, but the first-pass report accepts only attempt 1 receipts. Run every case in the manifest for every configuration; an incomplete or duplicated matrix is not evidence-eligible.

The harness deliberately does not launch model providers. The external runner owns authentication, model selection, timeouts, prompt delivery, and raw transcript retention. This keeps provider code and secrets out of Archify while making the artifact checks deterministic.

## Verify one run

Create a run metadata file after the agent has produced its candidate:

```json
{
  "schema_version": 1,
  "case_id": "web-runtime-architecture",
  "agent": "agent-name",
  "model": "model-name",
  "attempt": 1,
  "visual_review": {
    "status": "passed",
    "reviewer": "reviewer-name",
    "defects": []
  }
}
```

Then verify the original candidate:

```bash
node benchmarks/ordinary-model-floor/benchmark.mjs verify --case benchmarks/ordinary-model-floor/cases/web-runtime.architecture.case.json --candidate /path/to/candidate.architecture.json --run /path/to/run.json
```

The command writes one machine-readable receipt to stdout. Exit code `0` means first-pass usable, `1` means the candidate failed one or more gates, and `2` means the inputs or benchmark invocation were invalid.

If the agent invocation ends without a candidate, preserve the provider's raw operational record and use `record-failure` to emit a first-pass failure receipt instead of dropping the run:

```bash
node benchmarks/ordinary-model-floor/benchmark.mjs record-failure --case benchmarks/ordinary-model-floor/cases/web-runtime.architecture.case.json --run /path/to/run.json --failure timeout
```

The allow-listed reasons are `timeout`, `no_candidate`, and `provider_error`. These receipts count toward complete matrix coverage and the operational failure cluster, but semantic, validation, and visual-review gates remain truthfully `not_run` or `skipped`. Never turn an absent candidate into a fabricated invalid JSON file.

## Visual review

Review the final browser artifact or canonical raster, not the source JSON alone:

- `passed`: no visible defect, with a non-empty reviewer identity.
- `failed`: one or more concrete defects were observed.
- `skipped`: no capable reviewer or image reader was available.

Use short defect tags such as `clipping`, `node-overlap`, `label-overlap`, `hidden-route`, `stacked-edge`, `weak-hierarchy`, `unbalanced-whitespace`, or `theme-contrast`. A `skipped` review can never produce `firstPassUsable: true`.

## Report a complete matrix

Store one verifier receipt per line in a JSONL file, then aggregate it against the manifest:

```bash
node benchmarks/ordinary-model-floor/benchmark.mjs report --results /path/to/results.jsonl --manifest benchmarks/ordinary-model-floor/manifest.json
```

The report separates operational, semantic, deterministic-validation, and visual-review failure clusters. `evidenceEligible` is true only when every agent/model configuration has exactly one valid attempt 1 receipt for every manifest case. The report does not prove that an external transcript is authentic; retain the raw prompts, candidate files, repository commit, and reviewer evidence alongside any published claim.

No model result or leaderboard is checked in until the corresponding runs and visual reviews have actually happened.

## Dated evidence

The first complete three-model run is retained in
[`results/2026-07-26-pi-three-models.json`](results/2026-07-26-pi-three-models.json).
All 15 attempt-1 candidates use repository commit `66414c7` and the same packaged
skill SHA-256. The calibrated verifier reports 10/15 first-pass usable, with five
deterministic visual-quality failures and no semantic or operational failures.
This is a fixed diagnostic sample, not a model leaderboard or a latency claim.

The matched post-fix run is retained in
[`results/2026-07-26-pi-three-models-postfix.json`](results/2026-07-26-pi-three-models-postfix.json).
It uses generation commit `2dce766`, preserves all 15 frozen attempt-1
candidates and transcripts, and records browser review only for candidates that
pass deterministic showcase validation. The current verifier additionally
requires a lifecycle's recoverable failure to author a real retry transition.
Under that same current verifier, both the original matrix and the post-fix
matrix score 8/15: the single sample does **not** demonstrate an overall uplift.
The post-fix distribution is MiniMax 4/5, DeepSeek 2/5, and Qwen 2/5. A bounded
automatic architecture-route fix does turn the frozen Qwen architecture
candidate from a 3.5px micro-stub failure into a browser-reviewed pass, but the
remaining failures cluster in complex data-flow and lifecycle routing. Runtime
duration is recorded operational context only and is not a usability gate.

The quality-first lifecycle run is retained in
[`results/2026-07-26-pi-three-models-quality-first.json`](results/2026-07-26-pi-three-models-quality-first.json).
It uses generation commit `7eef4db`, the identical packaged skill for all 15
attempt-1 candidates, and no latency cutoff. Exact equivalent vocabulary was
calibrated only after every candidate was frozen; node type, relationship
direction, required topology, deterministic validation, and browser review
remain mandatory. Reverification keeps the overall result at 8/15
(MiniMax 3/5, Qwen 3/5, DeepSeek 2/5), so it still does **not** demonstrate an
overall uplift. The targeted lifecycle case improves from 0/3 to 1/3 and the
architecture case from 2/3 to 3/3, while workflow and data-flow regress in this
sample. Generation latency remains context rather than a quality failure.
