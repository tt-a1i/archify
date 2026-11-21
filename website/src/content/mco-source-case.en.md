# Who decodes provider output and who writes artifacts in MCO

The MCO runtime architecture example in Archify separates provider execution, answer decoding, and result artifacts. Reading its source reveals an important ownership detail: the invocation runtime calls an adapter’s decoder and writes streamed answer text; InvocationArtifactWriter prepares answer files and writes the final result and metadata. The decoder is not the filesystem owner.

This case explains the existing MCO runtime diagram, not a newly executed agent run. Open the published diagram: [MCO runtime diagram](cases/mco-runtime.architecture.html)

<span class="section-anchor" id="case-reproduce"></span>

## Replay the existing architecture example

Start with the [interactive HTML](cases/mco-runtime.architecture.html) and its [typed JSON source](cases/mco-runtime.architecture.json). No installation is needed to inspect these files. Follow the Answer Transport → Invocation Artifacts relationship, then compare it with the pinned code links below: the edge describes data ownership, not a direct function call.

To render the same authored input locally, use Node.js 18 or newer, Git, and a fresh directory. These commands pin the stable Archify checkout used for this replay; they do not run MCO or invoke a model:

```sh
git clone https://github.com/tt-a1i/archify.git archify-mco-case
cd archify-mco-case
git checkout --detach ba701d20a55ed6f139484d9ead7ff45671fe40eb
git clone https://github.com/mco-org/mco.git mco-source
git -C mco-source checkout --detach 9f1a1cf1afdc04d7b5406782b40dfec76d9bc798
node archify/bin/archify.mjs render architecture docs/cases/mco-runtime.architecture.json mco-replay.html --repo-root mco-source
```

Open `mco-replay.html` in a browser. This replays an existing model; it does not rediscover the repository or establish a new validation or visual-review result. Check that the provider adapters, answer transport, invocation runtime and artifact writer are still distinct, and use the source links to verify who calls the decoder and who writes files. Rendering with another Archify revision may produce different output.

<span class="section-anchor" id="case-use-your-repo"></span>

## Make a source-backed diagram of your own repository

[Choose your agent and install Archify →](start.html?type=architecture&input=repository#install)

Use this prompt in your configured coding agent, from the repository you want it to inspect:

> Use Archify to explain one real entry-to-output path in this repository. Pin the repository commit. Trace the entry point, the components that process the input, the resulting output, and any persistence or cleanup steps that exist. If the repository has an external provider-to-retained-files pipeline, use that path; otherwise choose a path supported by this repository’s own code. Include only components and relationships supported by files you read, with source links. Distinguish dataflow edges from direct calls and temporary files from retained artifacts. Mark unknowns instead of filling them in. Deliver the architecture HTML, typed JSON and check results, then explain what I should verify in the source.

This scope suits a review of component responsibilities and file ownership. For exact message order, use a sequence diagram; for a live incident or latency claim, bring logs, traces or measurements. An architecture picture alone cannot answer those questions. Your repository may have different components; the MCO names are evidence for this case only.

<span class="section-anchor" id="case-version-boundary"></span>

## Version boundary

The diagram’s typed source pins mco-org/mco to 9f1a1cf1afdc04d7b5406782b40dfec76d9bc798. The Archify source examined here is 04dc1916e1651086564f16076eab6d2f6ba1ae42. These are different repositories and different revisions. The findings below describe that MCO snapshot, not its current or future main branch.  [Pinned diagram source](https://github.com/tt-a1i/archify/blob/04dc1916e1651086564f16076eab6d2f6ba1ae42/docs/cases/mco-runtime.architecture.json#L1-L15)

<span class="section-anchor" id="case-decoding"></span>

## Where provider output becomes answer text

In the inspected invocation path, invocation_runtime.py reads the provider’s stdout log and calls adapter.decode_transport(raw_output) when that method is available. It uses the returned deltas to obtain streamed answer text; when the provider reports SUCCEEDED, it attempts to take transport.final_answer. A decoding exception or a decoded transport status of failed can still make that invocation fail. Without a callable decoder, this path falls back to the raw output.  [Runtime decoder handling](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L339-L409)

answer_transport.py defines the shared AnswerTransport structure: deltas, final_answer, status, and optional usage. Its decoder functions cover plain text, JSON text events, Codex events, Pi events, and ACP updates. These functions turn provider output into a consistent representation; their existence does not imply that every provider follows an identical event format.  [Answer transport](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/answer_transport.py)

<span class="section-anchor" id="case-file-writes"></span>

## Where files are actually written

The invocation runtime constructs InvocationArtifactWriter, prepares its directory, and creates an answer path for each invocation. While output arrives, the runtime itself appends decoded deltas to that answer path and flushes the file. Saying that only InvocationArtifactWriter writes answer files would miss this direct write in the runtime.  [Answer-file preparation](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L470-L477) · [Streamed writes](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L364-L390)

InvocationArtifactWriter owns the final report-writing functions. write_run assembles result.md and calls _write_run_metadata, which writes run.json. The metadata records invocation identifiers, providers, models, statuses, exit codes, errors, output paths, and usage only when included in the invocation result. In the inspected runtime, usage is included only when include_token_usage is enabled and the decoded transport has non-null usage. It is a structured record of results, not proof that an answer is correct or that providers agree.  [Usage condition](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L303-L317) · [Report and metadata writer](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_artifacts.py#L31-L106)

<span class="section-anchor" id="case-persistence"></span>

## What persist_artifacts changes

For the inspected invocation runner, persist_artifacts selects a retained output directory or a TemporaryDirectory. The final write_run call is conditional on persist_artifacts. With persistence disabled, returned artifact paths are cleared, artifact_root is null, and the temporary directory is cleaned up.  [Persistence selection](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L459-L477) · [Invocation cleanup](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L601-L630)

Persistence disabled does not mean zero disk writes. The runner still prepares temporary answer files. The multi-stage workflow also writes aggregate reports inside its selected root, which can be temporary, then clears exposed artifact paths and cleans up when persistence is disabled. The distinction is retained artifacts versus temporary working files.  [Workflow root](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L747-L758) · [Aggregate write and cleanup](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L965-L993)

<span class="section-anchor" id="case-reading-the-arrow"></span>

## How to read the diagram’s arrow

The typed diagram connects Answer Transport to Invocation Artifacts. Read this as an architectural dataflow relationship: decoded answer content contributes to artifacts. It is not a literal function-call edge from a decoder to a file writer. The source-backed ownership description is more precise: decoding happens through the adapter interface, the invocation runtime coordinates it and appends streamed text, and the artifact writer produces report files.  [Runtime decoder handling](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L339-L409) [Answer-file preparation](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L470-L477) · [Streamed writes](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L364-L390) [Usage condition](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L303-L317) · [Report and metadata writer](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_artifacts.py#L31-L106) [Authored diagram edge](https://github.com/tt-a1i/archify/blob/04dc1916e1651086564f16076eab6d2f6ba1ae42/docs/cases/mco-runtime.architecture.json#L228-L233)

This makes the example useful for a concrete repository review question: “Which code changes if decoded text is wrong, and which code changes if saved output is wrong?” Inspect decoder behavior for extraction errors, then inspect runtime writes, artifact serialization, and persistence settings for output-file problems. Those are starting points for investigation, not diagnoses of a reproduced defect.

<span class="section-anchor" id="case-limits"></span>

## What this case establishes

The existing Archify artifact makes a bounded runtime model inspectable alongside pinned source. It does not prove a production deployment, a literal chronological call stack, successful execution of a new agent task, tested exports, or a performance improvement. Its animated trace is a presentation of authored relationships, not a captured runtime trace. For installation and the general authoring workflow, use the agent guide rather than treating this case as a new setup tutorial: [Agent diagramming guide](agent-diagrams.html)
