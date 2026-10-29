# Explain a change before presenting its patch

[Read the preferred explanation](candidate.html) · [independent author's page](author/answer.html) · [complete patch for inspection](../diff-export/candidate/real.html) · [review index](../index.html#pie)

Round 24 explores Chinese content organization on a fixed public Archify change. A complete phone patch from round 23 is 780 × 9282 px: useful for inspecting code, but completeness alone does not explain the change. Here the reading question is narrower: why did moving a pie legend to the bottom make its values disappear, and how does the fix preserve both?

This is a discovery case. The patch page was parent-authored for export checks, asks a different question and is **not an independent or controlled reading baseline**. No human reading test, generation-speed comparison or general instruction benefit is claimed.

## Fixed facts and source checks

- Before source: `87747b86e145c03ab3aca7a559f4759a48913302`.
- Fix: `e5e03d185ce0617aa4fc7645bac0317e4079f421` ([public commit](https://github.com/tt-a1i/archify/commit/e5e03d185ce0617aa4fc7645bac0317e4079f421)).
- Frozen author/runtime revision: `fc79568e08b8128cb569deab2429cbc8cb8e9407`. Its chart compiler and vendored chart implementation are byte-identical to the fix revision.
- Latest remote `dev` observed for this round: `5ecbd1bfdbf83ea747072112493c940e707569cb`, still an ancestor of this branch. Runtime source does not change in this round.

The parent inspected the before/fixed compiler and ran [eight inputs](evidence/probe.mjs) against both frozen trees twice. [Run 1](evidence/probe-1.json) and [run 2](evidence/probe-2.json) are byte-identical. Raw SVG output is retained in [probe-svg](evidence/probe-svg/).

| Input | Observed result |
| --- | --- |
| Plain pie | Before/after output identical; A=10, B=3, C=8 gives 48%, 14%, 38%. |
| Comment, frontmatter, init directive | Old legend shows A/B/C; fixed legend includes values and rounded shares. The frontmatter example retains a bottom legend and 256 × 354 SVG dimensions. |
| Legacy multiline pie | Still accepted; before/after output identical for this input. |
| Duplicate A=1, A=9, B=1 | Fixed parser accepts the first A value, producing two 50% slices. The old source rewrite incorrectly creates three distinct labels/slices. |
| Negative slice | Both reject it; the diagnostic's label text differs. |
| Bar control | Before/after output identical. |

The reading page focuses on the prefix example. It does not explain duplicate-label semantics or claim to cover the whole commit. Its “only category names” observation is explicitly tied to this example, which does not set `showData`. The fixed decoration uses accepted parser values and only adds shares when their total is positive. The retained table has total 21; it does not imply all-zero or malformed input gets percentages. These boundaries are not a statement about every Mermaid implementation.

## Authorship and revisions

A separate gpt-6.1-terra author with medium reasoning read frozen source and the [source packet](author/source-packet.md), then wrote [the first draft](author/first-draft.archify.md). It remains byte-identical to [the author's submitted source](author/answer.archify.md). Strict finalize passed once; the author did not run the fixture or a browser. [Author report](author/report.md) and [timing record](author/author-trace.json) preserve those limits.

Parent review changed the title from “configuration prefix” to the visible problem, replaced “decorate the model” with “complete the legend,” removed a duplicate category column, and grouped five internal steps into three reading stages. Type detection and legacy multiline normalization remain stated. The full pinned code change stays linked. This is a deliberate scope reduction from the whole patch, not a lossless rewrite of its implementation details.

The parent retained three attempts:

1. [Initial content edit](attempts/intermediate-1.archify.md) passes strict finalize, but its category-only claim was broader than the demonstrated example.
2. [Qualified wording and explicit spans](attempts/intermediate-2.archify.md) pass strict finalize. [Desktop capture](screenshots/candidate-1440-light-top.png) shows the conclusion and table expanded to separate full-width rows. This layout is not preferred.
3. [Final source](candidate.archify.md) keeps the qualified wording and omits manual spans. Automatic packing restores the compact two-column desktop reading path. No layout algorithm or general writing rule was changed.

All three strict runs passed; the second layout was rejected by visual judgment, not by a validator. [Attempt logs](attempts/) and original-path receipts are retained. Copied author/attempt receipts describe their original tuning paths and times; they are not fresh provenance acceptance at their archived paths. The final candidate has a newly generated receipt at its actual repository path.

## Visual and artifact evidence

| State | Author | Preferred content |
| --- | --- | --- |
| 390 px, light | [Top](screenshots/author-390-light-top.png), [bottom](screenshots/author-390-light-bottom.png) | [Top](screenshots/automatic-390-light-top.png), [middle](screenshots/final-390-light-middle.png), [bottom](screenshots/automatic-390-light-bottom.png) |
| 390 px, dark | [Top](screenshots/author-390-dark-top.png), [bottom](screenshots/author-390-dark-bottom.png) | [Top](screenshots/automatic-390-dark-top.png), [bottom](screenshots/automatic-390-dark-bottom.png) |
| 1440 px, light | [Top](screenshots/author-1440-light-top.png), [bottom](screenshots/author-1440-light-bottom.png) | [Top](screenshots/automatic-1440-light-top.png), [bottom](screenshots/automatic-1440-light-bottom.png) |
| 1440 px, dark | [Top](screenshots/author-1440-dark-top.png), [bottom](screenshots/author-1440-dark-bottom.png) | [Top](screenshots/automatic-1440-dark-top.png), [bottom](screenshots/final-1440-dark-bottom.png) |

The checked states use the actual editorial/light/dark reader controls. Both pages fit the checked widths without horizontal document or table overflow. [Author measurements](evidence/author-visual-metrics.json) and [preferred measurements](evidence/automatic-visual-metrics.json) record document heights of 1930 → 1872 px at 390, and 1144 → 994 px at 1440. The rejected manual-span version reaches 1229 px on desktop. These are geometry observations, **not comprehension scores**. The opening card is the same measured height in the preferred and author pages.

The final repository HTML is byte-identical to the visually inspected final tuning HTML. [Strict finalize](evidence/candidate-finalize.stdout.log) and [current-path check](evidence/candidate-check.json) pass. [Actual phone PNG](candidate-390-light.png) was downloaded through the reader's export menu; [browser evidence](evidence/final-browser.json) records the current artifact and live state. The 780 × 3842 px image was inspected at the top, middle and bottom, including its final source list and footer; this smaller height is not a controlled comparison with the full-patch page. The index's two added variants and width controls pass [interaction checks](evidence/index-check.json); [107 local link targets](evidence/link-check.json) exist.

This round changes authored content and the local review index only. Per CONTRIBUTING's evidence-by-impact policy, no unrelated runtime suite or ZIP rebuild is needed; the prior product/package evidence remains at its original revision. The behavior-changing PR skill review is skipped for this content-only addition. The broad browser gate, Windows, human review and final integration CI are not claimed. Nothing was merged or installed.

## Reproduce

From the repository root:

```sh
node archify/bin/archify.mjs finalize explainer \
  docs/experiments/explainer-reading/pie-reading/candidate.archify.md \
  /tmp/pie-reading.html --writing strict --json
```

To replay the source probe without changing this checkout:

```sh
pie_probe_dir=$(mktemp -d)
mkdir -p "$pie_probe_dir/before-runtime" "$pie_probe_dir/runtime"
git archive 87747b86e145c03ab3aca7a559f4759a48913302 archify |
  tar -x -C "$pie_probe_dir/before-runtime"
git archive fc79568e08b8128cb569deab2429cbc8cb8e9407 archify |
  tar -x -C "$pie_probe_dir/runtime"
cp docs/experiments/explainer-reading/pie-reading/evidence/probe.mjs "$pie_probe_dir/"
node "$pie_probe_dir/probe.mjs" "$pie_probe_dir/probe.json"
```

The saved browser scripts retain absolute original paths and TaskSpace 14; they are execution records, not a portable browser runner. AI disclosure: the independent author wrote the first page; Codex performed source probing, content revisions, visual inspection and repository preparation. No human acceptance is recorded.
