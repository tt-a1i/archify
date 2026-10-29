# Wide tables: keyboard access works, PNG export loses content

Round 21 confirms a reader/export mismatch on fixed jq and gzip pages. The live wide tables can be reached and scrolled with a keyboard in the observed Chrome environment. Their phone-width PNGs flatten the scrollable region and omit later columns. Long snippets also lose text. Two export-only compression prototypes preserve more content but introduce poor line breaks, so neither table strategy is adopted as a product default.

Base runtime: `46abd16d41601d5848455fd50471f379a583a7fe`. Latest dev was fetched again and remains `5ecbd1bfdbf83ea747072112493c940e707569cb`, an ancestor of the branch. Runtime copies were frozen outside the repository; public authored inputs came from the unchanged jq/gzip corpus. This is fixed-input reader/export research, not fresh generation or a human comprehension study. Product source and ZIP are unchanged.

## What a reader sees

The actual reader Export → PNG action saved every compared image. These are full exported files, not cropped browser screenshots. The selected files below preserve the phone results; open at full size to inspect text.

| Case | Current export | Fixed columns | Automatic columns + code wrapping |
| --- | --- | --- | --- |
| gzip | [PNG](exports/base-gzip-390.png) | [PNG](exports/fixed-gzip-390.png) | [PNG](exports/autowrap-gzip-390.png) |
| jq | [PNG](exports/base-jq-390.png) | [PNG](exports/fixed-jq-390.png) | [PNG](exports/autowrap-jq-390.png) |

The gzip base cuts the `gzip 结果` column and omits `变化`, including `+20`, `−995`, `+23` and `+18`. The jq base hides the missing-key default policy and truncates three commands. The images retain visible scrollbars, but an image has no corresponding scroll interaction.

Fixed columns keep every table cell inside the image. On gzip, `DEFLATE` breaks into `DEFLAT` and `E`; long jq snippets remain clipped. Automatic column sizing restores that header but breaks the numeric value `-995` into `-99` and `5`. This is a reading regression even though the text is still present and geometry reports no overflow. The automatic prototype also wraps three overflowing jq code blocks, making their complete text visible. No source text or command bytes changed.

## Keyboard result and experiment failures

At 390 px in Chrome 156 on macOS, Tab from the first theme control reaches the jq matrix in 32 steps and gzip in 22. Neither wrapper has an explicit tabindex. The fitting jq two-column control is skipped; after 53 Tab steps focus returns to the first theme control. Browser-native scroll-container focus is sufficient in these observations; no focus code or scrolling hint was added.

- jq: high-level ArrowRight events move `scrollLeft` to its maximum 135 px; the last column is inside the 374 px clipping edge. [Trace](evidence/baseline-keyboard.json) · [Screenshot](screenshots/jq-matrix-after-arrow.png).
- gzip: high-level key screenshots show the scrolled table, while immediate DOM reads and a timed poll report zero. [Trace](evidence/gzip-keyboard-trace.json) · [Frame observations](evidence/frame-observation.json) · [Screenshot](screenshots/gzip-arrow-observed.png). This inconsistency remains a limitation of that observation path, not a demonstrated reader defect.
- Raw CDP key events give matching ordinary/protocol reads at 16.5, 48.5 and 82.5 px. A further bounded key run reaches 186 px, the maximum; the last header's right edge is 374 px, equal to the clipping edge. [Protocol observation](evidence/raw-key-observation.json) · [Boundary result](evidence/gzip-keyboard-boundary.json) · [Screenshot](screenshots/gzip-raw-boundary.png). This verifies scrolling after focus; the separate Tab trace establishes reachability.

The first script used nonexistent `data-theme-choice="system"`; the actual value is `auto`. That selector failure occurred before traversal. A later wait for nonzero gzip scroll timed out. Both [failure records](evidence/failure-01.txt) and [follow-up diagnosis](evidence/failure-02.txt) are preserved. The initial multiple-table hypothesis was rejected by DOM inspection: this gzip page has one comparison table. A setup copy also first used the wrong gzip draft filename (`answer.archify.md`); inventory identified the actual `candidate.archify.md` before generation. None of these setup/tool failures is counted as a product failure or hidden by a later pass.

## Frozen export prototypes

[Fixed-column patch](prototype-fixed.patch) adds an export-only class to cloned tables that overflow in the live document, releases cell minimum widths, wraps headers and uses fixed table layout. It reuses the existing inert-clone measurement path so changed table height is reflected in the image. It does not change the live table or add controls.

[Automatic-column/code patch](prototype-autowrap.patch) changes that layout to automatic and wraps only overflowing `pre`/`code` blocks in the clone. It remeasures for either change. This is the final prototype of this bounded round. The numeric split rules out adopting its table strategy; code wrapping remains a promising separate candidate requiring product-level coverage.

All three inputs were finalized on base and prototype 1; prototype 2 finalized the same three again: nine strict finalize passes, with validate/deliver/check passing and the browser gate not run. Inputs, HTML and receipts are in [base/](base/), [fixed/](fixed/) and [autowrap/](autowrap/). These are archived copies: receipts retain their original tuning-directory paths and hashes, not new provenance acceptance at the archive paths. The patches apply only to the declared frozen base reader. No historical artifact was relabelled as a new product delivery.

Eighteen actual PNG downloads compare three inputs × two widths for each prototype against the base. The first six matching base images are reused for the second prototype's comparisons. [First comparison](evidence/png-comparison.json) · [Second comparison](evidence/autowrap-png-comparison.json).

| 390 px case | Base table / container | Both prototypes | Base PNG | Fixed PNG | Auto/code PNG |
| --- | --- | --- | --- | --- | --- |
| gzip | 544 / 358 px | 358 / 358 px | 780 × 4322 | 780 × 4466 | 780 × 4240 |
| jq | 492.75 / 358 px | 358 / 358 px | 780 × 5338 | 780 × 5256 | 780 × 5384 |
| Fitting jq control | 358 / 358 px | unchanged | 780 × 5728 | identical bytes | identical bytes |

All three desktop PNG pairs are byte-identical at 1440 px for each prototype. The phone control is also byte-identical in both. Live table widths remain unchanged. Export markup was captured through the serializer, then measured as an inert clone: [first geometry](evidence/export-comparison.json), [second geometry](evidence/export-autowrap-comparison.json). This is supplementary geometry evidence; the exported pixels exposed the header/numeric wrapping defects that geometry alone missed. Parent inspected both base phone PNGs and all four changed phone PNGs, plus the selected keyboard screenshots. The unchanged desktop/control pixels are established by byte comparison, not a new visual-acceptance claim.

## Ownership and boundaries

Bounded searches found [PR #1015](https://github.com/tt-a1i/archify/pull/1015), whose inspected head `fe4f80d2195e0a7b49b7cfe6d3dba7ffd31a7ac8` changes table styling and other interactions but leaves `.table-scroll` behavior intact. No patch was reused. The export search also returned broad Code Analysis PR #998; its export ownership has not yet been audited. [Search and scope record](evidence/ownership-assessment.json). No claim of exhaustive search, review approval or absence of overlapping work is made, and no external message was sent.

The comparison uses editorial/light at 390/1440 × 900. It does not establish dark-theme, other-style, print, WebP/JPG, no-JavaScript, Windows, screen-reader, full-browser-gate or final-head CI acceptance. Diff tables, extreme column counts and other content types were not exercised. No unrelated runtime suite or ZIP rebuild was run for these research artifacts. Export helper changes would require focused product tests and package evidence before adoption.

Next bounded question: can a wider export canvas preserve a table's words and numbers at readable sizes, while the live page keeps its current responsive layout? Compare that against these rejected compression approaches, retaining unchanged/no-overflow controls. Continue the separate code-wrapping candidate only with evidence that complete text and footer content survive image rendering.
