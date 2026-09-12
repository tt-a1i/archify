# Selective reuse of receipt-only output

Recommendation: retain receipt-only lint and a smaller standalone report as separable design candidates; do not cherry-pick the presets commit or silently remove existing outputs from PR #367.

The change is in recovered commit `28daaaf88425e2b3851cf3a970ffb0515c542604`, between the preset schema change and its documentation. It combines two useful ideas with unrelated preset presentation and an older output transaction. A smaller standalone report can lead with uncovered paths without rendering the complete architecture Viewer. Lint can produce the machine-readable ownership receipt without generating an HTML artifact. Both reduce work in a classifier task. The fixed CLI replay verifies what those snapshots actually write; it does not measure maintainer speed or prove that users prefer the smaller report.

There are concrete reasons to use a selective implementation:

- The old `commitReceiptOnly` renames the previous receipt into staging, then renames the candidate, without the newer rollback logic. Failure on the second rename followed by staging cleanup can discard the prior receipt. Preserve the current output transaction and its failure tests.
- The old `htmlChrome` removes entire `details`, `ul`, `code`, and `a` blocks before checking claims. Generated chrome inside those blocks is exempt too. Preserve the current insertion-site input markers and claim-boundary tests.
- Both pinned standalone implementations hard-code a GitHub-style `/blob/` route in `blobHref`. A smaller renderer does not establish provider correctness. Include supported source-link behavior in the review rather than treating the old report as a proven replacement.
- Lint's disappearance of `locate.html` is an observable output change. A run into a previously used output directory can leave a stale range HTML file; decide ownership and stale-output behavior before enabling it. Documentation, stdout, atomic replacement, and any consumers must agree.
- Broad presets, suggestions to exclude more paths, locatorVersion 2, and uncovered-count stamping are not required for receipt-only lint. Keep their separate policy questions separate.

Adoption gate: define an explicit output mode or deliberate pre-release contract change, demonstrate receipt/schema equality on the same fixed range, retain all uncovered/ambiguous/excluded evidence and review limitations, and test clean/reused output directories plus write failure. Bundle projections must retain their existing navigation and output behavior. A small report should have real browser checks for keyboard navigation, readable long paths, and escaped user text. The source snapshot comparison alone does not satisfy those gates.

The preset revision remains useful as a design prototype and a counterexample source. The reusable part delivered here is a pinned fixture suite, evidence of the simpler output behavior, and these concrete adoption boundaries. No preset policy or output contract has been changed by this experiment.
