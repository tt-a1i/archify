# Semantic first draft: compact author-kit research note

Status: this is the pre-experiment proposal. The implemented API and frozen
protocol are documented in [the benchmark README](../benchmarks/semantic-firstdraft-20260921/README.md).
The implementation uses positional `node`/`edge` helpers, checks lossless JSON
serialization and malformed shorthand, and leaves duplicate IDs, endpoint
validity and schema fields to the unchanged production validator. Those details
differ from the suggested shape checks below. This note is not a result report.

## Question and boundary

Can a compact JavaScript author-kit reduce *serialization* work for a
source-backed Architecture first draft while leaving semantic decisions and
explicit geometry with the author? At the time of this proposal, no author run,
model benchmark, or quality comparison had been performed.

The earlier targeted TypeScript navigation experiment located tested static
definitions/references but did not establish an equal-quality end-to-end
speedup. This proposal therefore does not add a repository map, SCIP index, or
another planning/retrieval stage. It targets the remaining mechanical cost of
expressing an already-decided graph in verbose JSON.

## Primary-source observations

| Source | Direct observation | Consequence for this proposal |
| --- | --- | --- |
| [Structurizr DSL language reference](https://docs.structurizr.com/dsl/language#autolayout) and [manual-layout documentation](https://docs.structurizr.com/ui/diagrams/manual-layout) | A workspace model and its views are authored separately from `autoLayout`; manual layout retains element placement and relationship geometry. | This is a precedent for separating topology from presentation controls. It does **not** show that automatic layout is readable enough for an Archify artifact. |
| [Graphviz DOT language](https://graphviz.org/doc/info/lang.html) and [`layout` attribute](https://graphviz.org/docs/attrs/layout/) | DOT represents graph structure separately from the selected layout engine; Graphviz documents layout as an engine choice. | A serializer may produce a graph representation without becoming a layout engine. This is a representation precedent, not speed evidence. |
| [Archify authoring contract](../archify/SKILL.md) | `finalize` requires the existing validation, delivery, strict check, and browser check gates; geometry repairs must preserve source-backed components, relationships, boundaries, references, and semantic labels. | The kit can only serialize a candidate for the existing pipeline. It cannot waive evidence, infer facts, silently move nodes, or turn a generated file into acceptance proof. |

## Candidate: a constrained JS serialization surface

The author would still decide every component, relationship, label, boundary,
source reference, `pos`, `size`, and any explicit routing control. A small
local API would only make those declarations terser, for example
`node({ id, label, pos, size, ... })` and `edge({ from, to, label, ... })`, then
serialize the resulting object to the current schema-v1 JSON.

The bundled shape constraints should reject missing/duplicate IDs, unknown
endpoints, malformed source-reference objects, non-finite coordinates, and
unsupported fields before serialization. They must not supply defaults that
change meaning, select a hierarchy, calculate positions, resize nodes, route
connections, remove labels, or infer relationships. Existing schema and
`finalize` checks remain authoritative after serialization.

This is deliberately distinct from a new layout engine. The candidate preserves
the author’s explicit geometry byte-for-value in the resulting IR (apart from
normal JSON formatting) and asks no engine to derive geometry from topology.
That is compatible with the current candidate direction: compact JS authoring
plus bounded shape constraints, with no layout inference.

## Assessment and test condition

**Recommendation:** treat the author-kit as the one realistic implementation
hypothesis for the next first-draft screen. It has a narrow failure mode:
serialization defects should be caught locally or by unchanged validation,
while semantic and geometry judgment stay observable in the generated JSON.
Adding D2, Structurizr, Graphviz, or another automatic-layout engine would test
a materially different product and risks changing diagram quality.

**Unmeasured inference:** less repeated JSON punctuation/boilerplate may reduce
time to the first *schema-valid* candidate. It may also add API-learning and
debugging time, so it does not predict a faster accepted artifact.

Any comparison must freeze source revision, prompt, required semantic claims,
quality profile, viewport and model setting. Compare baseline JSON authoring
with kit authoring on first accepted candidate and final accepted delivery time.
Both arms must retain source entailment review, schema/layout/route checks,
`finalize`, browser review, and blinded semantic/readability review. Reject the
hypothesis if the kit loses a required claim/reference/label, changes explicit
geometry, adds repairs, or produces a less readable final diagram even when it
writes faster.
