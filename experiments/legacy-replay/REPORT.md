# Fixed replay result

The recovered material now has an executable, offline replay: **75 fixed observations and 6 real CLI runs**, at two pinned code revisions. A second full run produced byte-identical JSON under the recorded Node/Git versions. The results include known failures as characterized behavior; they do not certify either branch as ready to merge.

| Question | Delivery `365fec9` | Presets `9306382` |
| --- | --- | --- |
| Three empty-segment glob containment counterexamples | All rejected by subset check | All accepted despite an escaping witness |
| Eight unowned path/preset probes without presets | All uncovered | All uncovered |
| Six illustrative product inputs with matching declared presets | Presets unavailable | All excluded |
| Exact migration path under docs/generated presets | Uncovered | Uncovered |
| Same eight probes with broad owner `**` | Existing ownership contract; not a preset test | All touched; ownership wins over presets |
| Twelve fixed paths against recovered Hono/FastAPI/Hugo sidecars | Expected component/exclusion boundaries retained | Same expected boundaries retained |
| Source citation without matching ownership glob | File uncovered, component untouched | Same |
| Fewer child presets, direct vs inherited classification | No preset policy | Direct uncovered, inherited excluded by tests |
| Newly added map through real CLI | Success; map_changed remains blocking; HTML + receipt | locate/git-command failure; compare directory remains |
| Ordinary range through real CLI | HTML with SVG + receipt | Small HTML without SVG + receipt |
| Lint through real CLI | HTML + receipt | Receipt only |

The first two glob witnesses include empty path segments (and one begins with `/`). They are witnesses about the glob language and subset proof, not assertions that such paths are tracked by Git. The product-input examples are explicitly illustrative: a file's name or extension cannot establish its importance. The exact `archify/migrations/workflow-v2.mjs` probe remains uncovered; the result must not be summarized as “the preset hid that migration.”

The inherited-child observation executes the same classification helper used for projection. It establishes a semantic difference at that seam. It does not prove how every bundle UI presents the count, whether every direct child CLI path inherits the policy, or that the policy is desirable.

External map bytes and original revisions are preserved with digests. Their twelve newly authored path probes are deterministic boundary fixtures, not a repeat of historical external PR coverage percentages. This replay deliberately does not use the old CLI-to-compute fallback, so the added-map failure remains visible.

These results support keeping the recovered subset fixes, deferring the broad preset design, and selectively evaluating receipt-only output under the boundaries in [receipt-only-decision.md](receipt-only-decision.md). They provide no evidence of human time savings, lower review risk, faster model generation, or improved first-file selection. The historical model first-look study is outside this fixed-input replay; its recovered transcripts and scoring inputs require a separate provenance and scoring audit.

Evidence: [pinned result](results/pinned.json), [runner and method](README.md), [fixed inputs](fixtures/scenarios.json), and [recovered source provenance](fixtures/provenance.json).
