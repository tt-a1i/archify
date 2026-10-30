# Source decision

Candidate 2 selected at 2026-10-30T00:44Z, within the planned 20-minute / two-candidate source experiment. Consolidation, packaging and provenance follow separately.

Two direct clipboard consumers share one async boundary. Calling writeText happens immediately, retaining user activation; an absent API or synchronous throw rejects the returned Promise. Consumers own their existing success/failure UI. No additional state or dependency. Focused Survey found no worthwhile broader cut.

The added regression covers confirmed completion, exact successful bytes, absent API, rejected promise and synchronous throw in both locales. It fails on frozen base (false Copied), passes on candidate 2, and protects the full manual-copy payload and reset when reopened. Existing browser tests retain normal dialog/keyboard behavior. No implementation-source assertion or redundant unit wrapper test added.

Candidate 1 left modal failure guidance in a blurred background toast. Candidate 2 uses the existing in-dialog note with role=status; actual Chinese/English 390 px screenshots show readable guidance and full selected text. Live assistive-technology announcement was not tested.

58 fixed-input replays change only the embedded reader script. Two complete cases at 390/1440 px have identical base/candidate geometry, screenshot bytes and actual PNG-export bytes. Selected exported images were visually inspected at readable scale, including full Polars code and English TaskGroup source/footer. Captured Copy bytes equal the previously executed round46 program and execute again with the same three results. None of this measures human comprehension or full generation speed.

34 focused browser/renderer tests, 19 core tests, and generated-output checks pass. Required final-head remote CI and non-macOS browsers/platforms remain unverified. This branch is an exploration, not final review or merge approval.
