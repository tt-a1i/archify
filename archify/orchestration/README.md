# Archify orchestration

This directory contains two deep modules at separate seams:

- `RunRecorder` owns durable append-only events, non-overlapping top-level
  stages, nested spans and attempts, milestones, and canonical timing v1.
- `runSuite` owns manifest validation, repository pinning, isolated diagram
  runs, typed commands, final receipts, and mechanical reporting. Its command
  runner is injected; production uses `spawnCommandRunner`, while tests use an
  in-memory adapter.

The suite does not author candidate semantics and does not require a model.
An optional `exec` command may produce a candidate, but it runs without a
shell and its behaviour belongs to the manifest author.

## Manifest v1

```json
{
  "schemaVersion": 1,
  "id": "pi-five-diagrams",
  "qualityProfile": "showcase",
  "authoredLanguage": "zh-CN",
  "projectIndex": true,
  "viewportPreflight": true,
  "sharedViewportPreflight": true,
  "diagrams": [
    {
      "id": "workflow",
      "type": "workflow",
      "candidate": "./inputs/workflow.json",
      "artifact": "workflow.html",
      "commands": [
        { "id": "validate", "kind": "validate" },
        { "id": "deliver", "kind": "deliver" },
        { "id": "visual", "kind": "visual-check" }
      ]
    },
    {
      "id": "sequence",
      "type": "sequence",
      "candidate": "./inputs/sequence.json",
      "commands": [
        { "id": "validate", "kind": "validate" },
        { "id": "deliver", "kind": "deliver" },
        { "id": "visual", "kind": "visual-check" }
      ]
    }
  ]
}
```

`authoredLanguage` is required for every showcase suite and must be `"en"` or
`"zh-CN"`. The runner passes this single suite value to every typed `validate`
and `deliver` command, requires matching zero-violation command receipts, and
records the same value in diagram and suite final receipts.

Supported placeholders are `{manifestDirectory}`, `{diagramOutput}`,
`{outputRoot}`, `{diagramType}`, `{candidate}`, `{artifact}`, `{repoRoot}`,
`{revision}`, and `{archifyCli}`. The last five are available to `exec`
commands; candidate paths use the first four.

Every mutation-capable `exec` command invalidates the prior validation in the
static command order. A `deliver` must follow a new `validate`, and the final
typed quality command must be `visual-check`.

`viewportPreflight` defaults to `true`. Typed validation then adds
`--preflight` and fails closed unless all four light containment viewports
pass. The final full visual check and its four light/dark screenshots remain
mandatory either way.

For manifests whose candidates are already frozen, `sharedViewportPreflight:
true` moves the same pre-delivery gate into one `candidatePreflightBatch`
stage. It renders and deterministically checks every candidate, reuses one
reset Chrome session for all four-viewpoint checks, binds each candidate byte
digest, and fails if any candidate changes before validate/deliver. Because an
`exec` command can mutate a candidate, shared preflight rejects manifests that
contain `exec`; those manifests keep the isolated per-diagram preflight path.
The batch receipt separates input, renderer, deterministic-checker, and browser
preflight time so reports do not mistake orchestration marker gaps for tool runtime.

Before any diagram command, the suite runs exactly one batch capability gate:
`archify visual-check --probe --json`. An unavailable or failed Chrome/CDP
receipt stops the batch fail-closed. The runner never injects a no-sandbox
opt-out; that remains an explicit operator environment decision.

After all successful deliveries, the suite sends every artifact to one final
`archify visual-check <artifact...> --json` command. The CLI reuses one browser
process for the batch, and the suite maps each returned artifact receipt back
to its diagram timing/final receipt. Per-diagram processes are not spawned for
this final check.

Run it through the main CLI:

```sh
archify run-suite \
  --manifest ./suite.json \
  --repo-root /absolute/repository \
  --revision 0123456789abcdef0123456789abcdef01234567 \
  --output /absolute/output \
  --concurrency 5
```

## Receipts and human review

Each diagram directory receives:

- `timing.events.jsonl`: append-only, fsynced crash evidence;
- `timing.json`: canonical timing v1 compiled from those events;
- `visual-review.json`: an independent record initialized to `pending`.

The output root receives `suite-result.json` and a mechanically generated
`README.md`, plus `suite-timing.events.jsonl` and `suite-timing.json` for
batch-level capability, shared-index, diagram-run, and reporting timing.
Production command receipts also include `processTiming` measured around the
actual child process, so model/agent marker gaps are not misreported as CLI
runtime.
Deterministic validation and browser screenshots never promote the independent
human review to `passed`.

## Authoring-run library seam

Model-assisted authoring uses the `AuthoringRun` library seam; it does not ask
an agent to calculate durations or write timing/report JSON. Callers execute
named work inside `stage()` and finish with paths to the frozen candidate,
EvidenceLedger, and final validation receipt:

```js
import { AuthoringRun } from '../authoring/authoring-run.mjs';

const authoring = AuthoringRun.open({
  run: {
    id: 'repository/workflow',
    diagramType: 'workflow',
    repository,
    scopeProfile: 'project-overview',
    requiredLanguage: 'zh-CN',
  },
  outputDirectory,
  repoRoot,
  projectIndexPath,
  requirementsPath,
  candidatePath,
  expectContract,
});
await authoring.stage('candidate-authoring', authorCandidate);
await authoring.stage('deterministic-validation', validateCandidate);
const result = authoring.finalize({ candidatePath, evidencePath, validationPath });
```

`finalize()` mechanically emits `timing.events.jsonl`, canonical `timing.json`,
digest-bound `handoff.json`, and receipt-derived `authoring-report.md`. The
handoff is only ready when the validation receipt contains exactly 9/9 passing
checks, 0 errors/warnings, a digest-bound four-viewport preflight, an unchanged
candidate digest/type, no example contamination or low-information placeholder repetition,
complete semantic entity/relationship coverage, and a reverified EvidenceLedger tied to the ProjectIndex
and pinned Git revision with every required claim present. Unstaged time inside the measured authoring
envelope is explicitly reported as `agent-overhead`, never as child-process
runtime. `normalizeAuthoringTiming()` remains the migration adapter for the
five historical handwritten timing shapes; its duration fields are always
re-derived from endpoint markers.

The authoring boundary also binds the requested semantic scope, authored
language, initially absent candidate path, quality contract, and enforcement
runtime digest. A project overview cannot downgrade itself to `focused`, omit
its language contract, switch candidate paths, or finalize after those runtime
bytes drift. Schema-v1 semantic requirements remain available only through an
explicit `focused` run.

For model-assisted work that spans multiple processes, the CLI delegates to a
durable envelope adapter in the same module:

```bash
node bin/archify.mjs authoring-run start workflow \
  --run-id repository/workflow --output ./run \
  --repo-root /absolute/repository \
  --project-index ./project-index.json \
  --requirements ./workflow.requirements.json \
  --candidate ./workflow.json \
  --scope-profile project-overview \
  --expect-contract "$ARCHIFY_CONTRACT_SHA256" \
  --require-authored-language zh-CN --json

node bin/archify.mjs authoring-run finalize ./run/authoring-run.json \
  --candidate ./workflow.json \
  --evidence ./workflow.evidence-ledger.json \
  --validation ./workflow.validation.json \
  --json

node bin/archify.mjs authoring-run stop ./run/authoring-run.json \
  --status blocked --reason quality-gate-exhausted --json
```

`start` owns the wall-clock anchor plus the host monotonic start marker, binds
the ProjectIndex, semantic-requirements bytes, scope, language, expected fresh
candidate path, contract/runtime identity, and pinned repository identity, and writes only
`authoring-run.json`. `finalize` owns the monotonic end marker, revalidates the
bound index, EvidenceLedger, candidate, validation, and preflight receipts, and mechanically
writes `timing.json`, `handoff.json`, and `authoring-report.md`. The CLI accepts
no agent-supplied duration, stage timing, quality claim, or report prose.
`stop` records the same monotonic envelope timing for `failed`, `blocked`, or
`aborted` work and writes no ready handoff.
