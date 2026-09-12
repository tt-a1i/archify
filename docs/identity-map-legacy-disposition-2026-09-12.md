# Identity-map legacy disposition — 2026-09-12

The recovery is inventoried; implementation acceptance is not complete. This document routes the September 9 work without treating interrupted agents, old tests or old approvals as current results.

## Inventory and evidence

Local recovery archive: `/Users/tushaokun/code/archify-recovery-2026-09-12/`.

- `DISPOSITION.md`, `disposition.json`, `disposition.csv`: one explicit destination per 84 recovered file snapshots; **24 used for decisions/regressions, 50 retained as inputs to pending work, 10 archived with reasons**. These are file counts, not issue counts or merged changes.
- `audit/`: new bounded batch-1 review, presets red team, public-draft factcheck, current-main bug routing, maintenance routing and research decisions. Old snapshots remain unchanged.
- `ready-drafts/`: revised PR #367 status body, #368 follow-up and three scoped bug/investigation drafts. Not posted; replace local evidence pointers with attached fixtures before publication.
- `audit/main-reproductions.json`: new reproductions on freshly fetched main **6db72a9**. `audit/presets-results.json`: direct classification probes on **9306382**. These are distinct from historical c881670 measurements.

## Seven work packages

| Priority / package | Destination and acceptance | Status |
|---|---|---|
| P1: #367 classifier and keyboard correctness | Existing feature work; preserve the fixed empty-segment and ordinary-viewer regressions. Fresh focused run: 29 passed. | Used locally, not merged |
| P1: #367 HTML/bundle boundary | Forbid false positive/negative, added-map handling, projection escaping and output rollback now have local fixes and executable regressions. Final source integration and acceptance still required. | Fixed locally; integration pending |
| P1: current-main renderer/checker defects | Reserved-id finite_svg goes to existing #372/#373; render raw stacks and authored-straight mismatch have fresh reproductions and scoped drafts. CLI prose-only errors remain a contract investigation, not a blanket high-severity bug. | Existing PR + scoped backlog |
| P1: #367 source integration and visual acceptance | Port into current modular Viewer source in an isolated tree, not by overwriting the full template. Run comparable ordinary/bundle browser cases, full candidate checks and final-source artifact generation. | Integrated locally; final acceptance running |
| P2: presets / receipt presentation | Preserve four commits at 9306382. Broad build/image/fixture/docs rules excluded product inputs in fresh probes. Defer broad presets; independently evaluate simpler lint/receipt-only output. | Deferred with evidence |
| P2: public communication and maintenance queue | Use corrected cohort/model caveats; no runtime-impact claim. Route co-referencing PRs by actual scope. Retire the 15-comment bulk publishing plan. | Revised local drafts; not posted |
| P2: controlled evaluation reuse | Keep recovered maps, scripts, methods and original snapshots; restore missing inputs and pin revisions before replay. Do not invent raw results or claim human validation. | Retained, execution pending |

## Concrete decisions already applied

- Existing contribution/review policy covers impact and evidence; current main includes #394's reduction of repeated bot requests. No additional mandatory questionnaire, bot or automatic comment system added.
- CHANGELOG no longer promises byte-identical ordinary HTML or claims that the current forbid check cleanly separates chrome from data. Backspace wording now describes its scoped dismissal behavior.
- #143/#301/#242/#277 and #343 are closed. Do not reopen their old requests from the handoff. #344 is an umbrella tracker; multiple related PRs do not imply duplicate implementations.
- Old 15-PR A/B wording corrected: .767 vs .700 applies to the ten main samples; all 15 is .711 vs .644. Single model, one trial per cell, non-blind experimenter ground truth. No demonstrated human speedup.
- Presets do not hide the exact `archify/migrations/workflow-v2.mjs` path in the tested docs/generated cases, but do hide analogous source files under build and other product inputs. State both facts.

## Delivery boundary

No push, merge, issue/comment publication or review approval was performed. The original staged diff remains intact. Selected runtime fixes are committed in an isolated delivery checkout, with main integration and final acceptance underway. The original mixed feature working tree remains untouched. [The acceptance queue](identity-map-followup-2026-09-12.md) remains the implementation entry point; this file is the inventory and routing receipt.
