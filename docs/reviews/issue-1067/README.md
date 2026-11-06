# CJK punctuation wrapping: issue #1067

Base: `63c9263e84bd3993cab8e09b3d69888857858635` (dev). Initial qualified source: `eee68612a5c2696b1e9a1ebe870fbf3291c6da1f`; final qualified source: `bdff019b639b2f905f58abc990b9ba2ce59cff3e`. The later evidence-only commit does not change runtime, tests or ZIP.

Adapted from [BlueboxC's original correction](https://github.com/BlueboxC/archify/commit/a50dd164d9a31cd7b754673b3591428ad992d142) and [report](https://github.com/tt-a1i/archify/issues/1067#issuecomment-6363506522). The upstream [scope comment](https://github.com/tt-a1i/archify/issues/1067#issuecomment-6691845877) records this maintainer-authorized repair. The original issue Timeline JSON reproduces the problem on the pinned base; Tree and Sequence use the contributor's fixed-input reproductions.

## Result

| Mode | Base | Candidate |
| --- | --- | --- |
| Timeline | Comma starts a line; final full stop sits alone; opening quote ends a line | Those boundaries stay with adjacent text |
| Tree label/sublabel | Opening quote ends a label line | Quote moves with the quoted text |
| Sequence note | Full stop starts the second line | Full stop stays with the preceding text |

All authored characters in the three CJK regression fixtures are retained. Line positions change intentionally; topology, event times, message baselines, font sizes and width measurement are unchanged.

| Comparison | Before | After |
| --- | --- | --- |
| Timeline | [Base](base-timeline-issue.png) | [Candidate](candidate-timeline-issue.png) |
| Tree | [Base](base-tree-punctuation.png) | [Candidate](candidate-tree-punctuation.png) |
| Sequence | [Base](base-sequence-punctuation.png) | [Candidate](candidate-sequence-punctuation.png) |

Browser conditions: Ego Lite Chromium, identical 1051×798 CSS-pixel viewport, classic preset, dark theme, static motion, 100% Viewer zoom, fonts settled. Full-page captures retain the same state for each pair. [Browser results](browser-results.json) record SVG viewBoxes, label lines and actual SVG text bounds. Agent perceptual inspection of all six images found the intended punctuation improvement with no missing text, card overflow or new overlap on these inputs. This is an Agent inspection, not human acceptance or an export/browser regression gate.

## Verification and compatibility

Node 22.23.3, macOS arm64; canonical package zlib `1.3.1-e00f703`:

- New public-render regressions: base **0/3 pass**, candidate **3/3 pass**, no skips. They reject prohibited line boundaries and lost characters without freezing preferred line coordinates.
- `npm run test:focus -- test/cjk-punctuation-wrap.test.mjs test/timeline-rendering.test.mjs test/tree-rendering.test.mjs test/sequence-note-wrap.test.mjs test/sequence-column-fit.test.mjs`: **70/70 pass**, no skips. Existing URL-break, signed-score, grapheme and note-height coverage is reused.
- `npm run test:generated`: passed, including shipped root/package goldens. `node scripts/build-gallery.mjs docs`: 16 artifacts / 144 checks, no tracked output change.
- [Fixed-input comparison](comparison.json): 14 paired renders after the follow-up below. All nine Latin punctuation, Hangul and URL controls across the three modes are byte-identical. Four CJK punctuation cases change as intended. The narrow Tree case remains byte-identical and its actual browser text bounds fit the box. Its authored node width/max width are 120px; the existing root sizing floor produces a 180px box, so this is not a claim of 120px root containment.
- Canonical ZIP rebuilt; SHA-256 `5cf51c27be50656d83ca21e86cc759f960398f2b83b577c67209e08ea5316f71`. Extracted outside the repository; Both Timeline fixtures, Tree and Sequence reproductions render byte-identically to source.
- `git diff --check`: passed. Complete and platform CI remain separate; no full local suite or Windows acceptance is claimed.

The first generated-check attempt stopped on missing `simple-icons` before dependency setup; `npm ci --ignore-scripts` in both package roots resolved the setup gap, and the canonical-runtime rerun passed. No dependency version changed.

## Opening quote followed by authored space

A direct neighbouring reproduction inserts one ordinary space after the quote in the reported Timeline title: `先確認訂單狀態再執行「 退款」，再通知客戶。`. The base and initial candidate still ended the first line at the quote and dropped that authored space during the following trim. The follow-up passes initial Timeline word pieces through the same helper and treats whitespace after an opening quote as part of its indivisible boundary. No string replacement or whitespace deletion is introduced.

The new public-render regression fails on the pinned base and passes on `bdff019b639b2f905f58abc990b9ba2ce59cff3e`; it checks exact character preservation including the authored space, plus punctuation boundaries. Fresh focused run of CJK, Timeline, Tree and Sequence-note suites: **46/46 pass**, no skips. The earlier 70-case run retains its original source identity; unaffected column-fit cases and generated/golden checks are reused, not relabelled as fresh runs.

| Follow-up | Before | After |
| --- | --- | --- |
| Timeline quote + space | [Base](base-timeline-spaced-quote.png) | [Candidate](candidate-timeline-spaced-quote.png) |

These two additional captures use the product's `ChromeVisualBrowser.inspect` at 1051×798, dark/static state and 100% zoom; [browser metrics](spaced-quote-browser.json) retain their separate capture method from the six Ego Lite images. Agent visual inspection confirms the quote stays with following text. The second card grows from two title lines to three, an intended height tradeoff for preserving both the quote boundary and authored space. No new overlap was observed in this fixture. The inspector was initially invoked before its input render completed and returned `ERR_FILE_NOT_FOUND`; after the render completed, both inspections succeeded.

Replayed fixed inputs confirm all 13 earlier candidate HTML hashes are unchanged by the follow-up, including the nine Latin/Hangul/URL controls. The six original screenshots therefore retain their exact-byte applicability. Only the new quote+space Timeline pair needed additional visual inspection. The canonical ZIP was regenerated from final source and all four extracted reproductions match source.

## Scope and limits

This is a conservative CJK punctuation boundary grouper, not a line-layout engine or complete Unicode line-breaking implementation. It activates only for Han, Hiragana or Katakana input; Latin/Hangul-only text and existing width estimation retain their behavior. Callers retain their existing segmentation. A punctuation group is kept indivisible just like other indivisible wrap pieces; pathological groups wider than available space are outside the verified fixtures.

[#1149](https://github.com/tt-a1i/archify/pull/1149) independently changes Timeline emergency splitting to grapheme segmentation. It is not included here: its eventual integration should pass its grapheme pieces through the same boundary helper, and its existing candidate evidence is not relabelled as evidence for this branch. [#1164](https://github.com/tt-a1i/archify/pull/1164) changes CSS card prose and remains separate; no Viewer/template/CSS rule changes here.

The focused simplification check retains three renderer-specific wrapping policies and one shared punctuation rule; the earlier Sequence-only punctuation special case is replaced by that shared rule. A general wrapping refactor would add scope without improving this fix. Fixed-JSON replay is the agreed evidence route; no Agent authoring-speed or first-draft-quality claim is made.
