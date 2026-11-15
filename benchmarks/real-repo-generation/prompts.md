# Composing a generation prompt

For architecture/workflow, use the exact `task` text from the selected entry in [projects.json](projects.json), followed by one variant below. Save the fully composed prompt before launching either arm. Replace `<OUTPUT_DIR>` with the equivalent isolated output path and supply the chosen Archify `SKILL.md` path as environment context. Source paths and output roots may differ; all substantive task text stays identical. The recorder handles evidence collection outside the Agent task.

## Architecture

Create an architecture diagram of that implementation. Show the main components, their responsibilities, communication paths and important boundaries at a useful overview level. Ground the relationships in source code and keep relevant source references. Use readable labels and a clear layout for a laptop screen. Deliver the diagram and its source JSON in <OUTPUT_DIR> using Archify's normal workflow. Keep application source unchanged. If something cannot be established from the code, explain the uncertainty rather than inventing it.

## Workflow

Create a workflow diagram for this scenario:

<workflow_scenario from the same project entry>

Show the actual steps, decisions, branches and failure/recovery paths needed to understand the scenario. Ground them in source code and keep relevant source references. Use readable labels and a clear layout for a laptop screen. Deliver the diagram and its source JSON in <OUTPUT_DIR> using Archify's normal workflow. Keep application source unchanged. If something cannot be established from the code, explain the uncertainty rather than inventing it.

## Other diagram types

The pilot corpus is calibrated first on architecture/workflow. For another affected type, record a source-backed natural-language scenario and any project substitutions in the PR's run plan before either arm runs. Use the same prompt in both arms. Do not turn a process into an invented relational schema or assign invented durations to make the diagram type applicable.

## Reviewer context

The `reviewer_source_entrypoints` in the manifest are starting points verified to exist at the pinned revisions, not a complete semantic oracle. Reviewers trace the task and record the key facts in the report. They are not a node list or a layout supplied to the generating Agent. Source truth, not visual similarity to another generated diagram, determines correctness.
