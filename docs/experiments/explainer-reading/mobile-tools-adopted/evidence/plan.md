# Round 40: promote the existing narrow-toolbar repair on the experimental branch

Plan file created at 2026-10-29T23:15:36.252107Z (filesystem birth time); its initial approximate 23:17Z start label was corrected before archival. Budget: 25 minutes for implementation and comparison, one proposed CSS rule; evidence/package preparation follows separately. Base: 6828a8678b55dd698798ca7b0e8107eafeb7a946. Target dev: 5ecbd1bfdbf83ea747072112493c940e707569cb.

Observed problem: English reader tools overflow 390 px and Chinese tools overflow 320 px. This is repeated actual-reader evidence, not a hypothetical edge case. Reuse BlueboxC's existing PR #1076 at cd50794b794fc9f6ec4c9914dee78df0b7fddde3; refreshed metadata still identifies an open Draft PR. Preserve attribution and its original integration path. This branch qualification neither merges nor updates that PR.

Hypothesis: the exact <=760 px wrapping/container-menu rule keeps all current controls and popups visible without changing document content or desktop layout. Cost: three small CSS selectors; no state, dependencies or JavaScript. Test the contributor's existing-file regression on unchanged CSS first, then candidate; retain the failure. Keep its observable containment/focus/print assertions rather than introducing coordinate snapshots.

Fixed-input scope under the real-repository benchmark convention: re-render all 46 indexed artifacts from their frozen prepared bundles, compare all non-reader-CSS bytes. Use two complete source-backed cases (English TaskGroup and Chinese curl) at 320/390/1440, four styles, light/dark; inspect selected actual screenshots, keyboard menu activation/Escape and print state. Exercise actual UI PNG export on both languages at narrow widths and desktop. No fresh author, human-comprehension, complete-generation or speed claim.

Run affected real-Chrome suite, renderer/layout tests, core and generated checks. Commit source/test first; rebuild canonical ZIP twice with official Node 22/zlib and verify extracted behavior outside checkout. Archive selected evidence, current-path receipts and reuse boundaries; update the review index without rewriting historical artifacts. Push source and evidence/package to the existing authorized remote branch. The continuous goal remains active.

Setup note: an initial shell glob for a non-existing archify/scripts/explainer* path failed before any mutation; a prior report did not contain a browser-01.mjs file. Paths were corrected using rg --files.
