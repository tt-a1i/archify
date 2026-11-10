# Duplicate-block thresholds: first calibration

Date: 2026-11-10. Rule: `redundancy/duplicate-block` (rule version 1).

The roadmap asks for duplicate detection to be calibrated on at least three
repositories before its thresholds are trusted. This records the first pass:
what was run, the counts at three threshold pairs, and what the sampled findings
turned out to be. It is a starting point, not an acceptance result.

## What was run

The rule was run directly on the raw facts of each repository (default
`include`/`exclude` and file roles, so test files are not compared), at three
`minLines` / `minChars` pairs. "Lines" are code lines after comments, blank
lines, brace-only lines and import lines are removed.

| Repository | Revision | Language | Source lines |
| --- | --- | --- | --- |
| Archify, `archify/` package | this branch | JS/TS | 62,165 |
| [psf/requests](https://github.com/psf/requests) | `3c7baaa05ab4aa49cc819ce3a819d260de19c157` | Python | 6,874 |
| [encode/httpx](https://github.com/encode/httpx) | `b5addb64f0161ff6bfe94c124ef76f6a1fba5254` | Python | 8,827 |
| [pallets/flask](https://github.com/pallets/flask) | `49943b5a94413a530761350f04e896f76e8d620e` | Python | 10,139 |
| [expressjs/express](https://github.com/expressjs/express) | `43fca52d28a422c8be48fd489cbd4f2d6152bab6` | JS | 4,910 |
| [google/gson](https://github.com/google/gson) | `a961b0fe088f8558d00cc1b56e506a3656907a91` | Java | 23,683 |
| [spf13/cobra](https://github.com/spf13/cobra) | `adbc8813901bba65827259daa8e22ff94ec1f30e` | Go | 6,914 |

## Counts

Findings, with the lines that would disappear if every extra copy were removed
and their share of the source lines.

| Repository | 8 / 200 | 10 / 300 (default) | 12 / 400 |
| --- | --- | --- | --- |
| Archify | 15 · 176 lines · 0.28% | 6 · 82 lines · 0.13% | 2 · 36 lines · 0.06% |
| requests | 2 · 16 · 0.23% | 0 | 0 |
| httpx | 30 · 770 · 8.72% | 21 · 524 · 5.94% | 15 · 385 · 4.36% |
| flask | 4 · 46 · 0.45% | 3 · 35 · 0.35% | 1 · 12 · 0.12% |
| express | 1 · 8 · 0.16% | 0 | 0 |
| gson | 10 · 160 · 0.68% | 6 · 111 · 0.47% | 5 · 97 · 0.41% |
| cobra | 1 · 9 · 0.13% | 0 | 0 |

The rule itself took under 0.2 s on the largest of these; extraction dominates.

## What the findings were (10 / 300)

Checked by hand. "Opened" means the cited ranges were read in the source; where only the list of ranges was read, that is said.

- **Archify, all 6 opened.** Five are copied logic: the file-opening code shared by
  `bin/preview.mjs` and `renderers/shared/cli.mjs` (19 lines, the same block the
  earlier prototype found), two copies of an attribute-parsing state machine in
  `scripts/check-render-output.mjs`, and three pairs of recovery or failure
  handling inside `bin/archify.mjs`. One is weaker: the same destructured
  `await import(...)` list in two commands. It is a real repeat, but closer to an
  import block than to logic.
- **httpx, list of 21 read, one opened.** The ranges pair the synchronous and
  asynchronous halves of `_client.py` and `_transports/default.py`, and the
  request helpers in `_api.py` and `_client.py`. The one opened (`_client.py`
  1124-1144 and its two copies) is the parameter list and forwarding call that
  `post`, `put` and `patch` share. These look like repeats by the project's
  design, the kind of finding the baseline exists to accept with a reason; the
  other 20 were not opened.
- **gson, list read, not opened.** Four of six are between
  `UtcDateTypeAdapter` and `ISO8601Utils`, which contain the same date-parsing
  code; two are between two benchmark classes.
- **flask, all 3 opened.** `app.py` against `sansio/app.py` and `blueprints.py`:
  a repeated constructor parameter list, the same type-variable declarations and
  one identical method body.

Two false-positive patterns showed up during this pass and were fixed in the
rule before the numbers above were taken: multi-line import lists
(`import {` … `} from`), and Python docstrings opened with a prefixed quote
(`r"""`). Both had produced "duplicates" that were not logic.

## Reading

- At 10 / 300 no opened finding was a coincidence of unrelated code. The weak
  ones were repeated declarations (parameter lists, import-like lists), not
  wrong matches.
- 8 / 200 roughly doubles the count, and the additions are mostly 8 and 9 line
  fragments; 12 / 400 drops findings that were worth reading (four of Archify's
  five copied-logic pairs).
- A project built on deliberate mirroring (httpx) gets many findings. The rule
  cannot tell intended from accidental repetition; that decision belongs in the
  baseline.

## Not yet done

- No comparison with jscpd or another established detector on the same trees.
- Rust and a large TypeScript application are not covered.
- No near-duplicate detection: a block that differs in one identifier is not
  reported. This is by design for now, to keep every finding checkable by reading
  the cited ranges.
- The severity (warning) and whether repeated declaration lists should be
  filtered are open product questions.
