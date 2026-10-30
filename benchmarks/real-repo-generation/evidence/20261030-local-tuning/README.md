# Archify local tuning evidence — experimental, not accepted

This branch preserves the frozen-base local candidate and a portable evidence selection. It is **not ready for integration**. Base: `847146aeb93b492592adb78dc220f57e4a8b4636`; candidate compiler SHA256: `52cc99fa0b7c2742ab161fb14dab275f9d1e28089b4c45349e2c9d8f3867f2a1`. The dev branch was not rebased into this controlled experiment.

Open [index.html](index.html) locally for the four paired screenshot states, or inspect the PNGs directly on GitHub. [Before HTML](before/workflow.html), [after HTML](after/workflow.html), [unchanged input](input.json), [verification](records/verification/report.md), [review](records/review/report.md), [cost](records/cost.json).

## Results and limits

- Six fixed-input candidate compiles passed; five complete outputs equal frozen b98 controls. Only repair45 changed: one review→repair route and its label, width1072→843; content, nodes, remaining routes and fonts preserved.
- One focused ten-file run:174/174 PASS,0 skipped. Reused evidence at the exact compiler/test identities, not a new test run or remote CI claim.
- One finalize and one visual-check; four new screenshots. Independent Agent reported eight paired views, root viewed two. Local improvement confirmed, **whole graph still fails visual acceptance**: upper-left U detour, long retry, repair fan-in and lower-left whitespace remain. No human acceptance.
- Automatic bottom/right assertions in the new test overconstrain unauthored ports; unresolved review issue. No post-freeze edits or reruns to hide it.
- No fresh independent generation for49, no first-pass-rate or speed/cost improvement claim. Original natural prompt is supplied for context; repair45 is a controlled layout modification, not a new independent first draft. Earlier A/B semantic omissions remain.
- Full22-file candidate includes inherited Viewer/locale/diagnostic/routing work plus49 fallback; source changes are preserved as-is, without promoting the experimental candidate over selected34. Historical reports retain failures and rejected alternatives.
- Package/gallery not refreshed; full CI, integration, cross-platform and live acceptance pending. No release, merge or installation authorized. Hourly optimization remains paused.

## Evidence export

Selected reports are historical snapshots: internal links refer to the original local archive and may not resolve here. The portable entry points above and index.html are authoritative for this export. Full raw session transcripts, private automation state and unrelated machine metadata are excluded. Absolute home paths in textual exports are redacted to `/LOCAL_USER`; original/export hashes are recorded in manifest.json. Images are unchanged. HTML exports are path-redacted copies, not newly generated artifacts; original receipt hashes refer to original local bytes. Raw command records remain local; cost summaries include their scopes and cutoff identities. Nothing here claims a complete billed team cost.

Prepared with OpenAI Codex: Terra medium/xhigh diagram authors in earlier rounds; Sol medium implementation, diagnosis and review. Agent review is not maintainer acceptance.
