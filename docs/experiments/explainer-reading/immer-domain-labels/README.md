# Immer: use object groups throughout the interaction

Round50 makes the reference map's wording match its subject. The native Viewer now says **原版独有 / 新版独有 / 两版共享**, uses Chinese controls and omits decorative architecture icons. Lens, Finder and node details use the same group names. The eight objects, eight references, geometry, explanation, code and citations are preserved.

[Read the candidate](candidate.html) · [explanation source](candidate.archify.md) · [diagram source](object-map.architecture.json) · [previous layout comparison](../immer-narrow-map/README.md) · [Immer source research and executable probes](../immer-sharing/README.md) · [comparison index](../index.html#immer).

## Observed problem and retained change

The previous native Viewer called plain JavaScript objects Frontend, Database and External. Its corner icons reinforced that architecture interpretation. The first candidate sets `meta.locale=zh-CN`, overrides the three legend labels and sets `icon=none`. Actual Lens interaction then revealed an incomplete result: its buttons still said 前端、外部系统、数据库. [First Lens snapshot](evidence/viewer-lens.snapshot.txt), [settled first screenshot](evidence/screenshots/viewer-lens-settled.png), [first specification](evidence/first-object-map.architecture.json).

The existing authoring contract supports per-document message overrides. The final candidate adds exactly five: three `viewer.kind.*` labels, the Lens title and its instruction. The instruction describes checking references rather than “real traffic.” This changes this specimen's metadata only; it does not add automatic inheritance from legend labels or change runtime behavior. [Decision](evidence/decision.md), [plan](evidence/plan.md), [preserved meaning](evidence/semantics.json).

Actual Lens selection shows **2 个两版共享节点 · 4 条相连关系**. Finder lists the shared user as 两版共享; opening its node details retains that group name and its two incoming user references. [Selected Lens](evidence/screenshots/viewer-lens-selected.png), [Finder](evidence/screenshots/viewer-finder.png), [node-detail snapshot](evidence/viewer-passport.snapshot.txt), [phone Lens snapshot](evidence/viewer-lens-phone.snapshot.txt).

## Checks and retained limits

Native showcase finalization passes validation, delivery, provenance and its browser gate with no diagnostics. Explainer strict finalization and canonical provenance pass too. [Native receipt](evidence/native-finalize.stdout), [canonical finalize](evidence/canonical-finalize.json), [canonical check](evidence/canonical-check.json). Automated receipt visual-review fields do not replace the separately recorded actual inspection.

Final canonical browser observations cover 390/1440 px and light/dark: no page, code, table or diagram horizontal overflow. Heights remain **3472 / 2041 px**. Actual Copy bytes match the round48 program previously executed against the pinned probe. [Final observations](evidence/final-browser.json), [copied program](evidence/candidate-copied.cjs). This verifies payload with clipboard instrumentation, not OS permissions.

Actual final UI PNG downloads match the first metadata candidate byte-for-byte at both widths: [phone](evidence/final-exports/candidate-390.png), [desktop](evidence/final-exports/candidate-1440.png), [equality record](evidence/export-equality.json). Viewer-only message overrides do not change those static page exports. The complete-page reading and export inspections from [round49](../immer-narrow-map/README.md) remain relevant to this unchanged composition; this round's changed static diagrams and Viewer screens were inspected separately.

The phone Viewer still has small graph text and limited toolbar room; Chinese path/Lens labels wrap. This work improves wording, not those layout limitations. The generic accessibility description still calls the underlying renderer an architecture diagram. No human reading study, assistive-technology acceptance or alternate browser/OS coverage is claimed.

Canonical HTML is byte-identical to the inspected external candidate, SHA-256 **7904a8a7ab309a03820fef297ca2ff9c42a313005ac44210ca94fd1a719a1d1d**. [Identity](evidence/canonical-difference.json). The pause interrupted a final phone screenshot call, but its completed phone Lens snapshot was retained. On resumption, the original Ego task space no longer existed; no replacement browser session was created. Existing completed browser observations were reused, and the final index addition was checked statically rather than represented as a fresh browser run. [Recovery limits](evidence/recovery.md).

## Delivery scope

Base81905d27132887032904ff72f98abe0b27c56ece. Latest fetched dev is `54b5e98355c630630ad5f70e50e1eaa584ce3018`: its only new commit removes a sponsor entry from READMEs and adjusts the README showcase test. No renderer/explainer/schema/template changes invalidate this evidence. This branch does not incorporate that unrelated documentation commit. [Final verification](evidence/final-verification.json), [resumed provenance check](evidence/resume-check.json). Runtime d300979c84b2e049101ff4d6035f19425dec7225 and the [round47 package/test evidence](../clipboard-feedback/README.md) are unchanged. Under CONTRIBUTING's impact guidance, this authored artifact uses semantic preservation, native/explainer gates and actual interaction/export evidence. No new runtime suite, ZIP build, final-head CI, merge, release or live installation is claimed. No Skill instructions changed.

Index: 25 questions, 23 projects, 64 variants. Earlier Immer versions remain available. AI assistance: Codex parent authored, inspected and documented these metadata changes at maintainer @tt-a1i's request. Human acceptance remains pending. [Manifest](evidence/manifest.json) covers archived files except itself. Generated HTML keeps its embedded native CSS whitespace; exact exclusions are in [archive formatting](evidence/archive-formatting.json). Raw working evidence remains at `/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round50/`.
