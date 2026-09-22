# Website polish repair evidence

Date: 2026-09-22. PR: <https://github.com/tt-a1i/archify/pull/508>.
Comparison base: `e15228a207b3c019ca097ee33b4f669cad1aefcf` (PR head),
against main `5289f6867f048a7450ec5718f58459613a84cf41`.
Candidate: repair commit prepared on `codex/fix-pr-508`. The remote PR head was
rechecked and still matched the comparison base; these are local results.

Candidate changed-file SHA-256, excluding this receipt:
`4ccba3db9aaa912d2f588270075ab4654ef8e8bcaf15cd02405095941ac5015e`.
Computed over the sorted `git diff --name-only` paths, concatenating each
UTF-8 path, NUL, file bytes, NUL before hashing.

## Scope and preserved behavior

This revision repairs the reported CI and UI defects in the existing redesign.
It keeps the four page URLs, page design, package version, public assets,
diagram renderers, and language/navigation contracts. Shared decode behavior
affects index, gallery, guide and start. Page-specific reduced-motion rules
remain in index.css; shared rules remain in polish.css.

The release checker ignores style blocks containing dependency versions and
aspect ratios, while continuing to validate localized JavaScript copy. Raven
copy again states manual ZIP installation outside the agent switcher, the
extraction parent and resulting Skill directory. Active localized label decoding
stops when the language changes; untranslated wordmarks finish decoding normally.
Reduced-motion overrides cover all eight reported
scroll animations. The start button uses English static fallback text.

The legacy builders remain supported for their shared data and standalone
artifacts. Their tests compare recipe/manifest data with the Astro baselines;
website migration tests continue to compare complete page DOM, scripts and
styles. Asset-byte checks are retained. Tests tied to old prose, exact class
strings or script whitespace now match the redesigned page contract.

All four docs HTML baselines were regenerated from the Astro build. Skill
sources and packaged assets are unchanged, so no ZIP rebuild is needed.

## Automated evidence

Environment: macOS, Node 22.23.1, Google Chrome 151.0.7922.174. Browser tests
use the built site under `/archify`, desktop fine pointer at 1440 × 900, both
English and Chinese, normal and emulated reduced motion. Existing continuity
checks also cover navigation, refresh and 390 × 844 mobile navigation.

- Before repair, `node scripts/check-release-identity.mjs` failed with four
  diagnostics. The added style-block regression also failed independently.
- Before repair, all six new browser subcases failed: four language races,
  reduced-motion animation names, and the no-JavaScript English button.
- Review of the initial cancellation fix found that switching language during
  footer decoding left scrambled text on all four pages. Four additional real
  browser regressions reproduced this before restricting cancellation to
  localized elements.
- After repair, release-identity regressions: **18 passed**.
- `npm --prefix website run check`: **0 errors, 0 warnings, 2 existing
  execCommand deprecation hints**. Build: **4 pages**. Website tests: **7 passed**.
- `npm test` in archify: generation checks and golden checks passed;
  **1,350 tests passed, 0 failed, 50 skipped**. The default suite skips optional
  integration/browser tests; those skips are not passes.
- The explicit real-Chrome site run: **12 passed, 0 failed, 0 skipped**.

Reproduce the browser run after building:

```sh
ARCHIFY_SITE_ROOT="$PWD/website/dist" ARCHIFY_SITE_INTEGRATION=1 \
ARCHIFY_CHROME="/path/to/chrome" \
node --test --test-name-pattern='real Chrome' archify/test/site-language-continuity.test.mjs
```

Chrome must be launched outside the Codex sandbox on macOS. Build/check used
`ASTRO_TELEMETRY_DISABLED=1` to avoid writing global Astro preferences.

## Visual review and reproduction

In the built-in browser, inspected index.html#quickstart in English and Chinese
at desktop width and 390 × 844. The restored Raven instructions and both paths
wrap within the install card without clipping or horizontal overflow.

For each of index.html, gallery.html, guide.html and start.html, hover a nav
label and switch language within 520 ms. After the animation window, the label
must remain in the newly selected language; repeat in the other direction.
Scroll the footer into view and switch language while its wordmark is decoding;
the wordmark must finish as “Archify” on all four pages.
On index.html, enable reduced motion: the grid, footer wordmark, section-number
pseudo-elements and Cinema stage must have animation-name `none`. Normal-motion
mode must retain those animations. With JavaScript disabled, start.html must
show “Just describe it” on the first input-path button.

This receipt covers the repair. The older visual-parity.json describes the
pre-redesign migration and does not certify the broader redesign. Complete
redesign perceptual acceptance and maintainer scope approval remain separate.

## Ablation and rollback

Removed `!important` from the new index.css animation override; the complete
real-Chrome run still passed 8/8, so the removal was retained. Shared overrides
retain their priority because later shared animation rules would override them.

Removed the duplicate public-version regex in golden.mjs instead of maintaining
a second parser. The canonical release checker still rejects stale localized
versions and receipts (18/18 regressions); complete npm test passed afterward.
Both removals were retained; neither required restoration.

Temporarily removed the localized-element condition from the language-change
guard. All four footer regressions failed again, confirming that unconditional
cancellation strands untranslated wordmarks. Restored the condition and reran
the complete browser suite successfully (12/12).

Rollback is to restore the changed source/test files and four HTML baselines
from the comparison base together. This revision adds no dependency, schema,
release identity or persistent state migration. Remote CI must run after the
repair is pushed; local results do not establish remote approval or mergeability.
