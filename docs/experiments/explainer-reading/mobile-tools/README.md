# Existing toolbar proposal on complete reading cases

This round evaluates the existing [PR #1076 by BlueboxC](https://github.com/tt-a1i/archify/pull/1076), inspected at `cd50794b794fc9f6ec4c9914dee78df0b7fddde3`. Its narrow-screen rule wraps the toolbar and anchors the menus to that container. The proposal remains in its owner's draft PR; this round does not modify that PR or apply the rule to this branch's product source.

| Fixed input | Baseline | Proposal replay |
| --- | --- | --- |
| English TaskGroup | [Page](taskgroup-base.html) | [Page](taskgroup-candidate.html) |
| Chinese curl | [Page](curl-base.html) | [Page](curl-candidate.html) |

## Controlled replay

Base runtime: `87f48891a055c1f3e27f3f1f84c1d4d209ea3ced`; latest fetched dev: `5ecbd1bfdbf83ea747072112493c940e707569cb`. The frozen candidate changes only the [exact proposed media rule](proposal.patch). The English and Chinese source inputs are identical between arms. Removing that one rule from each candidate HTML makes it byte-identical to its baseline ([identity check](fixed-input-check.json)). No new author generation or content editing happened in this comparison.

All four strict finalize runs passed with zero diagnostics; their individual receipts remain beside the artifacts. The current-path receipts were produced at these paths, rather than copied from an author's directory. No runtime source, canonical ZIP, dependency or owner-PR branch changed.

## Observed effect

[Actual browser matrix](browser-matrix.json) · [Summary](summary.json)

Each arm covers two complete documents × three viewport widths (320, 390, 1440) × four styles (clean, editorial, product, swiss), in light theme. Each state checks controls, Style and Export popup bounds, keyboard activation, focused menu items, and Escape returning focus to the toggle. These are programmatically focused keyboard checks, not a complete natural Tab-order audit.

- Baseline: **12 of 24 states overflow**. English pages extend to 395–414 px at both 320 and 390 widths, depending on style. Chinese pages extend to 352 px at 320.
- Candidate: **24 of 24 states keep the page, controls and menus within the viewport**, with the checked focus behavior intact.
- At 320 px, Export moves to a second row. The English clean page's answer begins 38 px lower. This trades vertical space for access to the complete toolbar.
- The captured English clean desktop images are byte-identical. Both documents and arms still hide tools and use a white body in the checked print state ([print check](print-check.json)). This is a CSS print-state check, not printed-PDF acceptance.
- A separate 390 px dark/clean candidate check keeps the Style menu visible and focus inside it ([result](dark-check.json)). This is one additional state, not a dark-theme matrix.

Parent visual inspection covered [English before](taskgroup-base-320.png), [English after](taskgroup-candidate-320.png), [Export menu](taskgroup-candidate-export-320.png), [Chinese after](curl-candidate-320.png), [desktop](taskgroup-candidate-1440.png), and [dark Style menu](taskgroup-candidate-dark-390.png). The screenshots show readable controls and menus; content is unchanged. Human visual acceptance remains pending.

## Disposition and limits

The existing proposal transfers successfully to these two current-runtime reading cases. Keep this evidence with the experimental branch and use the original PR for any eventual product integration; no duplicate implementation PR is needed. Original author attribution and inspected revision are recorded in [identity.json](identity.json). The index loaded both added variants with matching full-page links and no outer 390 px overflow ([interaction](index-check.json)); all 28 local targets exist ([links](index-links.json)). Previous fourteen variant observations retain their original round 8/9 scope.

Menu opening does not prove image/PDF export success. No full browser gate, Windows validation, full regression suite, fresh author benchmark or final-head CI was run for this frozen, unadopted replay. Earlier checks in the owner's PR belong to its recorded revision and are not claimed as qualification of this branch. Known content/table limitations outside the toolbar remain unchanged.

Next bounded reading question: the TaskGroup answer opens with “one unit of work” and “coordinated shutdown,” while its step panel is more concrete. Compare a direct opening that names the trigger, cancellation request and wait, while preserving cancellation exceptions and error-reporting qualifications. Keep the overall goal active.
