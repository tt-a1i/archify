# First-draft latency: bounded research note

**Question.** What can reduce repository exploration plus diagram formulation
time while preserving factual correctness and semantic completeness? This note
does not claim an observed speedup. The current author runs (118–187 s, with
first draft comprising about 85–90%) cannot attribute time to a mechanism: the
gateway errors and request timing are unknown.

## Evidence and interpretation

Information-foraging theory treats navigation as a cost/benefit search guided by
the “information scent” available at each choice, rather than as a reason to
read all available material ([Pirolli & Card, 1995](https://dl.acm.org/doi/10.1145/223904.223911)).
For Archify, that supports asking each source read to resolve a particular
unproven responsibility, edge, or boundary; it does **not** establish a target
file count or prove that a shorter trace is correct.

Recent repository experiments give this idea a more directly testable form.
[ReCUBE](https://arxiv.org/abs/2603.25770) reports that caller-centric,
dependency-graph-guided exploration improved strict pass rates by up to 7.56
points across its evaluated models. That is a paper result, not an Archify
result. The relevant extrapolation is to retrieve a connected entry/config/
call-site slice before authoring, then retain source line references for every
semantic claim. The Archify repository-authoring contract already requires
this connected-slice and evidence behavior; the experiment is whether making
the next unresolved question explicit shortens *this* author path without
losing any required relationship.

First-party agent-interface guidance independently recommends progressive
disclosure: load a tool’s name/description before its full schema, and expose
more detail only when the task needs it ([Anthropic, *Agent Skills*](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills);
[Anthropic, *Code execution with MCP*](https://www.anthropic.com/engineering/code-execution-with-mcp)).
Its claim is about conserving context and enabling on-demand discovery, not a
measured Archify latency result. Likewise, its tool-design guidance says clear,
strict input/output models can reduce ambiguous tool use ([Anthropic, *Writing
tools for agents*](https://www.anthropic.com/engineering/writing-tools-for-agents)).
Here that suggests a small, structured evidence ledger rather than prose
summaries: claim → source range → unresolved consequence. It leaves diagram
semantics in the candidate JSON, not in a lossy hand-off.

Graphviz documents a useful representation boundary: DOT defines nodes, edges,
graphs and subgraphs ([DOT language](https://graphviz.org/doc/info/lang.html)),
while a selected layout engine performs drawing; Graphviz says graphs normally
should remain independent of layout type ([`layout` attribute](https://graphviz.org/docs/attrs/layout/)).
This is a design precedent, not evidence that Archify must imitate Graphviz.
It supports retaining the semantic/evidence graph while deferring routes and
coordinates to automatic layout. Archify already defaults to automatic routes and viewBox, but node placement
and dimensions still need author input (or fixed-cell grid choices). A test
must measure author time and semantic checks, without imposing a node budget.

## Three candidate mechanisms

| Mechanism | Falsifiable prediction | Lowest-cost experiment | Correctness/completeness guard |
| --- | --- | --- | --- |
| **Question-led connected-slice retrieval.** Start from the request’s entry/config/runtime units; each additional read must answer one named unresolved responsibility, edge, ownership or persistence question. | Across two matched task pairs (four authors total), median stage-1+2 wall time falls while the finalized candidate has the same source-backed claims and no additional repair/fact corrections. | Two randomized paired tasks: current instructions vs. a disposable per-run ledger containing only `question, source range, answer, next question`; record read/tool timestamps, candidate diff, finalize receipt, and blinded semantic review. This is a feasibility screen, not a general performance estimate. | Freeze prompt/revision; compare required claims and source entailment, not node count. A missing claim, unsupported edge, or reviewer-found relationship is a failure even if faster. |
| **Progressive disclosure with precise retrieval/tool affordances.** Present only routing metadata initially, then load the exact schema/reference/source slice that the pending question needs. | Fewer irrelevant bytes/files and lower formulation time, with no increase in source revisits, invalid field choices, or post-draft repairs. | Use the same two-task-pair cap in a later, separate screen; compare current eager reference batch with a small index plus demand-loaded references, logging reads, first-candidate time, and finalize attempts. | Keep the complete required schema/contract available on demand. Audit each final semantic assertion against source ranges and each new field against the schema. |
| **Two-layer candidate: semantic evidence first, renderer-owned layout.** Capture components/relationships/evidence in JSON first; preserve automatic routing/layout until a measured diagnostic names a geometry issue. | Fewer manual layout edits and a shorter stage-2, without worse browser/visual results or reduced semantic coverage. | Defer until a later two-task-pair screen: compare the current route policy with a recorded semantic-first checklist; measure hand edits, finalize retries, browser checks, and blinded readability review. | Same prompt, source snapshot, quality profile, browser environment and acceptance gates. A diagram that is less readable or omits a justified role is rejected regardless of elapsed time. |

## Counterevidence and limits

More repository context is not reliably beneficial. The AGENTS.md evaluation
finds context files did not generally improve task success and increased
inference cost by over 20% on average in its settings, while encouraging
broader file traversal
([Gloaguen et al., 2026](https://arxiv.org/abs/2602.11988)). This supports
minimal, task-specific context, but it studies coding-agent tasks rather than
diagram authorship.

Nor is an exploration subagent or its summary a free compression step. A
repository-QA comparison reports semantic retrieval beating deep agentic search
on its benchmark (65.2% vs. 46.2%) and attributes 41.8% of that method’s
failures to planner/subagent hand-offs ([Oskooei et al., 2026](https://arxiv.org/abs/2608.01507)).
The result is benchmark-specific, but it is strong reason to avoid inserting a
summary/extra-agent stage unless a matched trial shows its hand-off preserves
cross-file relationships and lowers end-to-end time.

These sources do not identify the cause of the current 118–187 s distribution,
do not measure the gateway, and do not justify a guaranteed speedup. Instrument
request start/end, source-read timestamps, first-candidate timestamp, repair
timestamps, and separately reported model-token estimates before choosing a
mechanism.

## Comparable open-source repositories (source inspection only)

The observations below are pinned to the listed references. They are interface
and license facts read from the projects, not vendor performance claims; this source-review pass did not run the projects. The coordinating agent
subsequently tried D2 and code2prompt locally; see
[the study result](research-firstdraft-result-20260921.md). Aider, DeepWiki-open
and Mermaid remain source-inspection comparisons only.

| Repository and fixed ref | Source-level mechanism worth examining | License and local interface/prerequisite | Archify implication and pitfall |
| --- | --- | --- | --- |
| [Aider](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c) `5dc9490` | The README exposes a repository map and links its dedicated repo-map interface ([README](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/README.md#maps-your-codebase)). | Apache-2.0 ([license](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/LICENSE.txt)); its package declares Python `>=3.10,<3.15` ([pyproject](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/pyproject.toml)). | Borrow only the idea of a compact repository *index* that points to evidence; do not make a whole-repo map first-draft context. It can add stale/irrelevant structure and requires model-facing integration to assess usefulness. |
| [code2prompt](https://github.com/mufeedvh/code2prompt/tree/8966895913ab23cbb7ef9557ad240d1007ff2efc) `v4.2.0` | CLI accepts a repository directory and emits structured prompt content; its README describes ignore-aware traversal, Git metadata, token tracking and stdout/clipboard output ([README](https://github.com/mufeedvh/code2prompt/blob/8966895913ab23cbb7ef9557ad240d1007ff2efc/README.md#quick-start)). | MIT ([license](https://github.com/mufeedvh/code2prompt/blob/8966895913ab23cbb7ef9557ad240d1007ff2efc/LICENSE)); release binary avoids source prerequisites, while source build names Git, Rust and Cargo. | A safe comparison tool for measuring selected-path context size/read time. Do not use its whole-repository prompt as factual diagram evidence: it loses the question-led connected-slice constraint and can inflate context. |
| [DeepWiki-open](https://github.com/AsyncFuncAI/deepwiki-open/tree/d92819a9c9f3b99416e3580ff235fc9d3adf8b89) `d92819a` | README advertises generated code maps for guided tours ([README](https://github.com/AsyncFuncAI/deepwiki-open/blob/d92819a9c9f3b99416e3580ff235fc9d3adf8b89/README.md)); the checked package defines a Next start command and pins Yarn 1.22.22 ([package.json](https://github.com/AsyncFuncAI/deepwiki-open/blob/d92819a9c9f3b99416e3580ff235fc9d3adf8b89/package.json)). | MIT ([license](https://github.com/AsyncFuncAI/deepwiki-open/blob/d92819a9c9f3b99416e3580ff235fc9d3adf8b89/LICENSE)); local use entails dependency installation plus its web-server path. | A reference for navigable, on-demand code tours, not a low-cost author-path dependency. Generated summaries/maps could omit cross-file semantics, so require source-range proof before using any output in a diagram. |
| [D2](https://github.com/terrastruct/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda) `v0.9.0` | A text diagram language compiled by a CLI; its quickstart provides a `.d2` input and rendered output ([README](https://github.com/terrastruct/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/README.md#quickstart)). | MPL-2.0 ([license](https://github.com/terrastruct/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/LICENSE.txt)); release binary is the bounded local prerequisite. The repo also documents a networked install script and Go source install, neither needed for the proposed trial. | Best layout/compiler comparator: test whether its content-aware labels and layout improve a frozen semantics fixture. Do not infer factual correctness from a successful render, and do not conflate its layout with Archify’s automatic routes/viewBox behavior. |
| [Mermaid](https://github.com/mermaid-js/mermaid/tree/386bbcaad2ce3ed0cbbba88fab75fb31c5b251e6) `386bbca` | Browser/Node diagram library supporting multiple diagram types and integrations ([README](https://github.com/mermaid-js/mermaid/blob/386bbcaad2ce3ed0cbbba88fab75fb31c5b251e6/README.md)). | MIT ([license](https://github.com/mermaid-js/mermaid/blob/386bbcaad2ce3ed0cbbba88fab75fb31c5b251e6/LICENSE)); local rendering requires its Node/browser dependency path. | Useful external readability baseline only. It is not a repository-evidence compiler, so translating an Archify candidate into Mermaid can discard provenance and presentation semantics. |

### Two safe minimal local trials

1. **code2prompt v4.2.0 release binary, fixed fixture only.** Verify the
   provided `darwin-arm64` digest, inspect `--help`, then run it with network
   disabled, no global writes and no clipboard against one already-redacted
   Archify fixture. Compare elapsed time, output bytes and selected paths with
   the existing source slice. It can test whether a directory/index artifact
   speeds navigation; it cannot validate diagram facts. Stop if output expands
   the context or misses any source needed by the frozen claim inventory.
2. **D2 v0.9.0 release binary, frozen semantic fixture only.** Verify the
   supplied macOS-arm64 digest, inspect `--help`, then render a hand-transcribed
   non-sensitive topology with network disabled and isolated outputs. Compare
   canvas bounds, label collisions/readability and elapsed renderer time under
   a matched viewport. It tests rendering/layout behavior only; it must not
   replace Archify source evidence, browser gates or architecture semantics.

The layout comparison has a specific scope. Archify’s automatic **routes** and
automatic **viewBox** are separate renderer behaviors. The current Architecture
grid uses fixed cells and its default 30px gaps; it is not content-aware and
can therefore contribute to label failures. A later content-aware grid-sizing
experiment would need frozen semantic inputs and the normal browser/readability
gates. It should not be justified by the D2 trial alone, and it should not
rewrite automatic routing or viewBox policy.
