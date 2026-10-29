# Source packet: explain a pie-legend fix

This is a content/reading experiment, not a generation-speed or human-comprehension benchmark. The parent-authored full-patch page is a comparison artifact, not an independent author baseline.

Reader question: Adding a supported layout/configuration prefix used to remove legend values and shares. Why does the fixed compiler preserve them?

Pinned source before: 87747b86e145c03ab3aca7a559f4759a48913302, archify/explainer/charts.mjs. Local frozen file: ../before-runtime/archify/explainer/charts.mjs. The old pieLegend source-text wrapper only decorates text starting with pie (leading whitespace allowed); a comment/frontmatter/init prefix bypasses it.

Pinned fix: e5e03d185ce0617aa4fc7645bac0317e4079f421, archify/explainer/charts.mjs. Current frozen runtime at fc79568e08b8128cb569deab2429cbc8cb8e9407 has byte-identical charts.mjs and vendor files (Git diff checked). Read ../runtime/archify/explainer/charts.mjs lines13-49. New order: detectType; normalize accepted legacy plain-pie whitespace; parse pie; decorate accepted sections in model; render that same model. This preserves parsed configuration. This is specific to Archify's compiler wrapper, not a universal Mermaid behavior claim.

Known fixed fixture: pie categories A:10,B:3,C:8, with YAML frontmatter config.pie.legendPosition=bottom. Before legend contains category names only; after A · 10 (48%), B · 3 (14%), C · 8 (38%). Values sum21; displayed shares are rounded. Do not invent speed, usage, or reading-improvement measurements.

Additional exact boundaries to audit against source/tests: legacy multiline plain-pie forms remain accepted through pieInput; duplicate category labels follow the existing parser's first-value semantics (A:1,A:9,B:1 becomes two accepted slices A=1/B=1, each50%); negatives still fail; non-pie charts follow the original path. The page may focus on the prefix problem rather than explain every changed line; do not imply that removing all normalization or supporting every malformed input is the fix.

Full commit: https://github.com/tt-a1i/archify/commit/e5e03d185ce0617aa4fc7645bac0317e4079f421
Before source: https://github.com/tt-a1i/archify/blob/87747b86e145c03ab3aca7a559f4759a48913302/archify/explainer/charts.mjs
After source: https://github.com/tt-a1i/archify/blob/e5e03d185ce0617aa4fc7645bac0317e4079f421/archify/explainer/charts.mjs
Existing fixed-input evidence (historical): /Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/pie-legends/README.md and compare.json. Parent is separately rerunning direct comparison this round.

Current full-patch reading baseline: /Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/diff-export/candidate/real.archify.md. Its phone export is780x9282 px and includes61diffrows. That is evidence of length, not evidence of human understanding. A concise content variant should make the effect and cause accessible before optional source inspection.
