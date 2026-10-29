# Configured pie legends keep their numbers

[Before](base.html) · [Fixed page](candidate.html) · [Same input](configured-pie.archify.md)

Source fix: `e5e03d185ce0617aa4fc7645bac0317e4079f421`. A legal comment, Mermaid frontmatter or init directive no longer causes Archify's pie legend to lose its value/share formatting. The configured bottom legend in this page now reads `头部 · 10（48%）`, `压缩数据 · 3（14%）`, `尾部 · 8（38%）` instead of only the three names. Layout configuration continues to apply.

This does **not** adopt the universal narrow-width or scrolling defaults rejected in [round18](../chart-narrow/README.md) and [round17](../chart-scroll/README.md). It fixes the existing compiler when an author supplies already supported configuration. The shorter text-first gzip page remains preferred in the main index.

## Cause and bounded change

The old wrapper decorated source text only when it began with `pie`. Prefixing the same data with configuration or a comment bypassed that step. Decorating before parsing also changed repeated category identity: `A:1, A:9, B:1` became three differently named slices, even though the existing pie parser retains the first value for each category.

The compiler now parses the pie, decorates the accepted sections, then renders that same model so its configuration survives. The duplicate example therefore has two accepted slices, A=1 and B=1, each 50%. Negative values still fail, and the diagnostic now names the authored label rather than a label already decorated with an invalid share. Non-pie compilation is unchanged; no vendored code, dependency, schema, reader interaction or authoring rule changed.

The first model-only attempt passed the new configuration regression but failed the existing multiline-input compatibility test ([failed run](charts-candidate.log), [attempt source](prototype-1-charts.mjs)). The final fix retains a small whitespace normalizer for the legacy plain-pie forms. It keeps line breaks for diagnostics while placing split `showData`, label and value tokens where the underlying parser accepts them. [Follow-up chart run](charts-candidate-2.log) passes. This compatibility requirement was retained, not removed from the tests.

## Evidence

The [plan](plan.md) freezes base `87747b86e145c03ab3aca7a559f4759a48913302`; dev remained `5ecbd1bfdbf83ea747072112493c940e707569cb` at the final refresh. Fixed-input scope and its generation-benchmark exemption were recorded before implementation. [Bounded ownership searches](ownership.json) found no open PR in the two selected searches; this is not an exhaustive absence claim.

- Both new regressions fail on the unchanged base ([log](base-regressions.log)). They protect configured numerical legends and accepted category identity. Existing multiline, CRLF, zero/negative input, error-location and integration coverage remain in use.
- [54 focused tests](focused.log) pass across charts, chart data, renderer, validation and sources. [Core 19](core.log) and [generated checks](generated.log) pass. These are separate scopes, not a full-suite claim.
- [Eleven fixed direct comparisons](compare.json) retain exact output for the sampled plain pie, `showData`, entity labels, zero-total pie, bars and line chart. Changed outputs are the three prefix forms, duplicate category case and the clearer negative-value diagnostic. [First-attempt results](compare-attempt-1.json) remain available.
- Both complete authored pages passed strict finalize. Parent inspected eight matching 390/1440 px, clean-style, light/dark screenshots. The fixed legend remains 11 px, below the circle, with all three values and rounded shares visible. The explanation panel remains 778.3125 px on phone and 716 px on desktop; document widths remain 390/1440. [Measurements](browser-01.json), [phone comparison](screens/candidate-390-light.png) and [dark desktop](screens/candidate-1440-dark.png) preserve the observations.

The first candidate was built before the source commit. Copying its receipt correctly failed provenance because the recorded output identified its original path ([retained failure](original-candidate/relocated-check-failure.json)). It remains under [original-candidate](original-candidate/). The current linked candidate was regenerated at its actual repository path and passes [strict finalize](candidate.finalize-summary.json) and [provenance check](candidate-check.json). All markup outside script blocks is byte-identical to the inspected original; [identity](identity.json) records both hashes. Archived baseline/original receipts retain their original absolute paths and are not relocated acceptance claims.

## Package and review boundary

The source change was committed before rebuilding `archify.zip`. Two builds with official Node 22.23.3 and bundled zlib 1.3.1-e00f703 are byte-identical. The archive is 6,995,308 bytes, SHA-256 `a12371f61e0daa2ec317dad0ea4dcd6e86855246d591b855e93b8371155aa2ac` ([identity](package-identity.json), [build log](zip-build.log)). An extraction outside the repository matches the compiler source and independently [finalizes the configured page](package-smoke.finalize-summary.json) with all three numerical legends present. This is package execution, not a live installation.

The scoped test-value review added two inexpensive regressions where existing tests had gaps, proved both on base, and retained the compatibility test that caught the first attempt. The simplification survey rejected removing all source normalization because it owns accepted multiline behavior; number/share computation now belongs to the existing parser's model rather than a separate source-text interpretation. Direct consumers are validation, data-source preparation and rendering, all included in focused coverage.

No fresh-generation speed or human-comprehension claim. No full browser gate, new print/export run, Windows result, final-head remote CI, merge, release or installation is claimed. This is a verified local compiler fix on the experimental branch, with its narrow validation and remaining integration boundaries explicit. The continuous explainer goal remains active.
