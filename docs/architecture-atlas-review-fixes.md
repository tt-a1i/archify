# Architecture Atlas review fixes

All six confirmed review findings are fixed on `codex/architecture-atlas-v1`. The original scope and acceptance criteria remain in [the Goal](nested-architecture-goal.md). No commit, push or deployment was performed.

| Finding | Result and regression coverage |
| --- | --- |
| Atlas diagnostics lacked evidence and supported repairs | Manifest and delivery rejection paths now include concrete actual/expected values, relevant identifiers or underlying errors, and actionable repairs. Tests assert diagnostic content. |
| Invalid Atlas input retained stale visual evidence | Visual checking clears its previous receipt, contact sheet and recognized captures before parsing. Malformed JSON and invalid inventories now produce a failed receipt for current bytes. CLI tests also prove unrelated files survive cleanup. |
| Diagram ID `atlas` collided with the outer staging filename | Members compile in a separate `members` directory. A valid member named `atlas` now passes delivery. |
| Bundle checking trusted inconsistent views and parent context | Checking reads actual embedded guided views, node labels and communication edges, reconstructs parent summaries and compares inventories. Tests reject added, removed or duplicated views and forged, missing or misdirected context, including edges without IDs and root summaries. |
| Windows absolute paths were mistaken for URI schemes | Drive-letter absolute paths pass URI classification; actual URI sources and drive-relative forms remain rejected. Tests cover both slash forms. These tests ran on macOS; native Windows filesystem delivery was not tested. |
| Manual story selection disappeared after detail navigation and Back | Explicit Atlas beat selection commits to the existing logical URL. Back restores the selected beat and reading state. Automatic playback does not rewrite that selection; standalone behavior remains covered. |

## Verification

- Full `npm test`: **1,360 passed, 0 failed, 50 skipped** (1,410 total). Browser-gated tests were run separately as described below.
- Manifest, delivery and visual-check regression tests: **48/48 passed**.
- Atlas navigation plus standalone guided-view browser regression: **12/12 passed**. File/HTTP export and lifecycle browser tests: **2/2 passed**, including 16 decoded exports.
- Actual browser: Chrome 151.0.7922.174 on macOS, launched outside the sandbox.
- Regenerated viewer template, examples, gallery and README showcase; rebuilt `archify.zip`. The extracted package contains no `node_modules`; its Atlas showcase delivery and doctor checks passed.
- Fresh visual checks passed for 24 captures across four desktop sizes and both themes. Eighteen captures are byte-identical to previously inspected images; the six changed captures were inspected again with no clipping, overlap or missing labels/controls.

The first full run caught one stale test assertion that prohibited all manual beat URL updates. It now explicitly permits the guarded Atlas selection update while still prohibiting unguarded standalone updates. The final full run above passed.

## Final evidence

Evidence directory: `/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/atlas-review-fixes`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `atlas.html` | 3,467,705 | `29bc6f138e71cff81f67c3d1f38c24dbd7a1e544a0485c72090620e37a7df8a6` |
| `desktop.html` | 1,762,096 | `1487cc10c0ad509b488eaa5d1245aa82857abe0597907b05ad0f57e56b135700` |

Delivery, export and automated visual receipts were checked against these final bytes. `visual-review.json` records separate visual inspection and byte-identity reuse; automated receipts retain their original pending-human-review field. Test logs and extracted-package verification are preserved alongside the artifacts. Original evidence in `atlas-acceptance` remains unchanged.

## Ablation

1. Removed the old per-screenshot cleanup loop after introducing bounded filename-based cleanup. All 12 visual-check tests still passed, including stale Atlas captures and unrelated-file preservation. The redundant loop stays removed.
2. Removed redundant diagnostic `errorName` metadata while retaining filename and parse-error evidence. All 22 manifest tests passed. The field stays removed.
3. Removed entity decoding from embedded node/edge attribute reading. The valid special-character parent-context regression failed. Restored decoding; all 14 delivery tests passed.

Navigation reuses the existing logical URL and restoration path; no additional snapshot fields or public runtime API were introduced.
