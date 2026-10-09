# Execution and Recovery

Purpose: retire each proved obligation completely, validate the surviving system in widening rings, and leave a recovery path proportional to every side effect.

## Choose a reviewable cut

Prefer one high-confidence ownership boundary over a mixed cleanup batch. The selected change should retire a complete obligation and have a decisive check. If investigation reveals a larger product choice or broader migration than the user authorized, present the ranked plan and obtain one scope confirmation before applying it.

Pause application when dynamic or external consumers remain unknown, stored data lacks a migration story, baseline failures erase the intended signal, the cut crosses unrelated ownership boundaries, or rollback would be impractical. Convert the result into an evidence report with the exact missing decision or fact.

## Remove the obligation vertically

Follow the contract from outside inward and back out. Account for:

- public declaration, schema, route, command, option, or manifest;
- registration, dispatch, parsing, and compatibility paths;
- implementations, adapters, state, caches, events, and cleanup;
- imports, exports, packages, build and generated inventories;
- migrations, fixtures, examples, documentation, and operational configuration;
- tests dedicated to the retired behavior and tests protecting the surviving contract;
- dependencies and scripts that become unnecessary.

Delete compatibility glue when no compatibility obligation exists. When one does exist, preserve it or provide an explicit migration with an end condition. Do not replace two representations with a new synchronization layer.

Keep unrelated working-tree changes intact. Do not commit, push, publish, deploy, or alter protected environments unless the user separately authorizes that action.

The cut is structurally complete when every affected declaration, consumer, artifact, owner, and compatibility obligation is either changed, deliberately retained with a reason, or explicitly excluded as outside scope.

## Verify in widening rings

1. **Residue check**: search removed names, strings, paths, formats, flags, and docs.
2. **Decisive check**: run the smallest test or probe that would fail if the cut were incorrect.
3. **Lead check**: re-run any analyzer or query that produced the original candidate.
4. **Local gates**: run the affected package's type, lint, unit, integration, build, generation, or smoke commands.
5. **Repository gates**: run the broader relevant suite when cost and scope justify it.
6. **Boundary comparison**: compare public output, persisted representation, wire behavior, operational lifecycle, and user-visible behavior.
7. **Diff audit**: inspect every changed file, whitespace integrity, generated artifacts, and dependency lock changes.

When the simplification claims a latency, throughput, memory, startup, or other performance effect, add a controlled before-and-after measurement whose workload and environment make that claim meaningful.

Report each gate separately. Passing a narrow unit test does not establish build, integration, runtime, deployment, or user acceptance.

If a post-change check fails, compare it with the baseline and decide whether the failure was pre-existing, the implementation is incomplete, or the candidate was load-bearing. Repair the current batch or undo it using the recorded recovery path. Preserve the meaningful check and revise the proof instead of weakening the gate to make the deletion pass.

## Produce an operation receipt

Record:

```text
Scope: ownership boundary changed
Baseline: commands and pre-existing failures
Retired obligation: contract, state, layer, or dependency removed
Artifacts: files and generated outputs changed
Realized net effect: concepts, artifacts, lines, and dependencies removed minus replacement or migration machinery added, where measurable
Behavior: preserved and intentionally changed observations
Verification: exact commands, probes, and results
Residual risk: untested boundaries or external uncertainty
Retained candidates: high-value items kept and why
Undo: files or commit range to reverse and any data/config restoration required
```

The undo path must match the side effects. Source-only changes may be reversible from the diff; migrations, published packages, deployments, and durable data require explicit restoration steps and separate authorization.

The batch is complete only when the structural cut criterion, every applicable verification ring, the complete diff audit, and the operation receipt are all satisfied or reported as unavailable with the resulting evidence limitation.
