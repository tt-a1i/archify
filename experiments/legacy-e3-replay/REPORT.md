# E3 recovery replay — September 12, 2026

The 100-step ownership replay is reconstructable. Its generated JSON matches the
archived `docs/decisions/e3-replay.json` byte for byte. The published 67-anchor
observations also match byte for byte when their recorded selection is used. The
recovered anchor script has a different selection and produces 61 anchors; that
difference is preserved rather than silently corrected.

This run used Node 26.8.1, Git 2.50.1, replay range
`b744b0b43e0507be7709a2b0ead843466f137545..10722002bb8777ecb639d93c49586fae4adf3ae4`,
and tracked input snapshot `c8816705f8db437901f6a861908ccfceb851d2ad`.
All observations were recomputed from local objects. See
[receipt.json](results/receipt.json) for hashes and Git settings, and
[comparison.json](results/comparison.json) for the exact comparisons.

## Ownership replay and statistics

| Measurement | Recomputed result |
|---|---:|
| First-parent / all commits | 100 / 139 |
| Merge commits | 13 |
| Commits requiring scheduled map repair | 9 / 100 |
| Human-authored edits applied | 10 |
| Base covered / excluded files | 230 / 105 |
| Head covered / excluded files | 378 / 105 |
| Head total files | 483 |
| Residual uncovered or ambiguous commits after edits | 0 |
| Median / mean components touched | 2 / 3.54 |
| Single-component / zero-component commits | 17 / 1 |
| Viewer-touched / viewer-only commits | 19 / 0 |

The generated head map contains the same ownership-rule sets as the published
head map. It is not byte-identical: the published file adds labels, schema/note/
revision metadata and an edit-history annotation, and reorders components and
some glob lists. Those authoring additions are available in the archived input;
they are not outputs of the recovered replay algorithm. The comparison checks
the sorted component-to-glob and exclusion sets explicitly.

The recovered `stats.mjs` formulas are implemented, but now consume the newly
computed replay and map. The original read the published replay at a hard-coded
path. No separate original stats stdout survives in this recovery, so statistics
can be recomputed and cross-checked against the archived trace, but cannot be
claimed byte-identical to an unavailable stdout record.

## Two anchor selections

| Measurement | Recovered script selection | Published report selection |
|---|---:|---:|
| Anchors / files | 61 / 21 | 67 / 23 |
| Commits first invalidating an anchor | 17 | 18 |
| Commits touching an anchor file | 49 | 50 |
| Anchors valid at HEAD | 20 | 21 |
| Percent valid at HEAD | 32.8% | 31.3% |
| Full JSON matches old decay report | No | Yes, including bytes |

The recovered `anchors.mjs` selects `archify/test/architecture-render.test.mjs`,
which does not exist at the pinned base. The published report instead contains
three coordinates from `archify/test/cli.test.mjs` and three from
`archify/test/architecture-delta.test.mjs`. Its 67-coordinate input is recoverable
from the tracked report. Reusing those coordinates and independently reading the
pinned base text and subsequent Git states reproduces the archived observations.
It does not establish which missing edit to the original script produced that
selection, or why the author chose those files.

## Evidence boundary and validation

Reconstructable: the complete commit trace, scheduled manual repairs, resulting
ownership rules, head audit/statistical formulas, original recovered-script
anchor outcome, and recorded 67-coordinate anchor cohort observations.

Not reconstructed: manual authoring deliberation/time, proof of a minimal edit
schedule, the source revision that changed anchor selection, a standalone old
stats stdout, or any human-efficiency result. The original source hashes and the
copied edit schedule are preserved in [provenance.json](provenance.json).

The self-check exercises destination-only rename classification and exclusion
precedence; first anchor invalidation followed by text recovery; per-anchor touch
counts; statistics consuming the supplied trace; and refusal to overwrite an
existing output directory. The real replay exited 0 and retained the known
selection difference. This work changes only this experiment directory; no
product, original decision documents, or ledger is modified.
