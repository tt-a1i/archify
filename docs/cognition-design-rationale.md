# Cognition Type Design Rationale: Three Principles Behind the Routing Semantics

> Status: design rationale / Issue context: #149, PR #150
> Version: v0.1 (2026-09-01)
> Author: FuRongJun (LingShu protocol · zcode line)
> Scope: the theoretical commitments that shaped the `cognition` diagram type —
> not implementation docs, but the reasoning a maintainer needs to evaluate
> future changes to the type.

The `cognition` diagram type (PR #150) renders how a reasoning system routed
one question through its own knowledge: which cards accepted, which branches
were demoted, which were rejected by negative routes, and where knowledge ends
(blindspots). Three principles from the source system (LingShu / CommonTrust
Protocol) shaped its schema. They are recorded here so future changes can be
evaluated against the original intent rather than rediscovering it.

---

## 1. Unified time kernel: any second kernel shape is a bug

Every time-dependent value in the source system decays with the same
exponential kernel:

```
X_i(t) = X_i,∞ + (X_i,0 − X_i,∞) · e^(−γ_i · t)
```

The kernel *shape* is unique; only the rate γ_i and the terminal value X_i,∞
vary per object class (knowledge decays slowly, caches quickly, leases in
between). Any second kernel shape — linear decay, step functions, polynomial
fade — is treated as a bug and removed by a mechanical lint.

**Why this matters for the `cognition` type:**
`node.confidence` is the snapshot of that kernel at the time the routing
decision was made. The renderer's opacity mapping
(`0.55 + 0.45 × confidence`) is the *visual projection* of the same kernel.
If confidence were rendered as a decorative label instead, the diagram would
lie about the system's actual belief state. The B1 fix (data-driven rendering)
exists because the visual encoding must be a faithful projection of the
underlying kernel, not a static annotation.

**Design commitment:** any future field that represents a time-evolving value
(trust, freshness, lease remaining) must use the same exponential kernel and
the same visual mapping discipline. A second kernel shape or a second mapping
convention would fragment the diagram's visual language.

---

## 2. Negative routing: rejection is cheap, confusion is expensive

In the source system, when a question arrives, the system first checks what it
*cannot* answer (negative routes) before scoring what it can. A rejection is
the cheapest correct answer: it costs one index probe, produces zero
hallucination risk, and shrinks the search space for everything else.

The `edge.role = "reject"` and `node.verdict = "reject"` fields exist because
**rejected routes are first-class information**, not failed matches. A
reasoning trace without visible rejections looks like the system "just picked
an answer"; with rejections visible, the reader sees that alternatives were
considered *and why they were excluded* — which is the auditability anchor.

**Why this matters for the `cognition` type:**
the renderer demotes rejected/deferred edges (dashed, reduced opacity) but
does not hide them. Hiding them would destroy the audit trail. The visual
demotion encodes: "this path was evaluated and excluded — the exclusion was
deliberate, not accidental." Future changes should preserve this visibility
guarantee.

**Design commitment:** negative information (rejections, blindspots,
unavailable) must always be *visibly present but visually demoted* — never
absent, never highlighted equally with accepted routes. The asymmetry is the
semantics.

---

## 3. Nested subgraphs: the part-whole schema is recursive

The source system's knowledge graph supports recursive nesting: a node may
contain a `subgraph` (child nodes + internal edges), and children reference
parents via `part_of` hierarchical edges. This has been validated to 5 levels
of depth (person → head → face → eyes → iris/pupil/lash).

**Why this matters for the `cognition` type:**
reasoning routes are naturally recursive — a "main path" step may itself
contain a sub-route (e.g., a verification procedure inside an acceptance
step). The schema's `subgraph` field (child nodes + internal edges) models
this without flattening. The renderer's `direction` parameter (`in`/`out`)
preserves the hierarchical semantics: `in` = children pointing at parents
(part_of), `out` = parents pointing at children (contains).

**Design commitment:** the schema should support recursive nesting to
arbitrary depth. Flattening (serialising nested subgraphs into a single level)
loses the part-whole semantics that make the diagram legible as a reasoning
trace. The renderer may choose to visualise nesting via containers/lanes, but
the IR must preserve the recursive structure.

---

## How the three principles interact

They are not independent — they compose:

```
Conditional space C
    → knowledge graph G (nodes + nested subgraphs, principle 3)
    → routing decision (accept/reject/defer/blindspot, principle 2)
    → belief snapshot (confidence, principle 1)
    → visual projection (this diagram type)
```

A change to any single principle (e.g., adding a linear decay, hiding
rejections, or flattening subgraphs) would break the composition. The three
principles are the minimum set that keeps the `cognition` type a faithful
projection of a reasoning system's actual state.

---

## Implementation cross-references

| Principle | Source implementation | This repo |
|---|---|---|
| Unified time kernel | `aeis/time_core.py` (`cred()` family), `time_core_lint.py` | `node.confidence` → fill opacity mapping |
| Negative routing | `rejected_paths` table, negative-condition index, `edge.role` | `edge.role` → dash/opacity mapping, `verdict: reject` styling |
| Nested subgraphs | `store.subgraph(direction=)`, `subgraph_replace()`, 5-level roundtrip validation | `subgraph` field in schema, `direction` parameter |
