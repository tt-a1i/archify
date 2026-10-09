# Integrating Findings

Purpose: map every imported finding to retained, consolidated, rejected, superseded, or unresolved against the destination's current contracts.

## Establish independent contribution

Compare each source with its own merge base or authoritative default branch, not only with the current working branch. Identify which code changes, proof records, design records, annotations, and validation results belong uniquely to that source. Treat stale findings as hypotheses against the current tree.

For every imported candidate:

- re-check symbols, consumers, dynamic entrypoints, history, and compatibility in the destination state;
- retain non-overlapping evidence that meets the current confidence bar;
- merge overlapping rationale into the record that owns the contract;
- discard duplicates, weaker restatements, and findings invalidated by newer code;
- preserve the strongest counterargument, tradeoff, verification boundary, and unresolved uncertainty;
- distinguish a ported proposal from a change already implemented and validated.

The integrated result is complete when every source finding is mapped to retained, consolidated, rejected, superseded, or unresolved, with a reason. Raw candidate count is not a preservation requirement.

## Integrate changes safely

Apply only the code or documentation the user authorized. Resolve overlaps according to current ownership and behavior rather than source order. Re-run residue searches and validation on the combined state; results from an isolated branch do not prove the integrated tree.

When updating a pull request, report the true retained scope, sources surveyed, consolidations and rejections, intentional exclusions, current-head validation, and remaining review gaps. Keep work draft or otherwise marked incomplete while the candidate set or verification is still changing. Close, supersede, comment on, or otherwise mutate external reviews only with the user's authority.
