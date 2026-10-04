# Bottom Node index row prototype (#664)

Review-only experiment from dev `7a3e1f3a`. It does not change the default
viewer, generated template, ZIP, or diagram renderers.

`prototype.css` replaces bottom-index columns with full-width group sections
and a wrapping grid of items. Existing group/node order, counts, text,
category colors, buttons, and event handlers are reused. Labels and sublabels
wrap without reducing their font size. Side and overlay selectors are untouched.

Run the matched comparison with an installed Chrome and an output directory
outside the checkout:

```powershell
$env:ARCHIFY_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node experiments/node-index-rows/compare.mjs C:\Temp\archify-node-index-review
```

The script saves HTML, PNG, and JSON observations for Sample Web App and a
26-node uneven-group fixture with long Chinese/English text. Both use
1440×900 and 390×900, light/dark, ordinary mode, and unchanged SVG contents.
It checks text/order/color identity, SVG identity, document width, text
clipping, programmatic focus, pointer-enter preview, and click selection
against the column baseline. Native Tab/Enter and panel-toggle interaction
still need an integration pass before adopting this as a default.

## Results and tradeoffs

At 1440px, Sample Web App's index height changes from 338.69px to 289.38px
(about 15% less); the uneven 26-node fixture changes from 852.69px to
610.38px (about 28% less). Node labels/subtitles remain at existing font sizes.

At 390px, preserving all text increases height: Sample Web App becomes
667.38px instead of 435.25px, and the long-text fixture becomes 1726.38px
instead of 934.25px. This is an explicit tradeoff for readable wrapping
rather than single-line truncation. No horizontal page overflow was observed.

Current dev hides the reader rail below its desktop eligibility breakpoint.
For narrow comparison only, both HTML copies expose the existing bottom CSS
using a separate experiment attribute. These screenshots test the CSS proposal,
not a shipped narrow-screen reader behavior. Whether to expose that index on
mobile remains a product decision.

The saved observations report no persistent focus preview after a frame on
either baseline or candidate. The script only compares `focusPreview` for
equality between them; it does not independently verify keyboard focus-preview
behavior. Pointer-enter preview and click selection work. These results must
not be reported as a newly fixed or verified keyboard-preview feature.

Visually reviewed the unselected Sample Web App desktop comparison and the
long-text narrow candidate. Group membership is clear; desktop whitespace is
used better, and narrow labels wrap. Exact spacing remains open for review.

Related issue: https://github.com/tt-a1i/archify/issues/664

## Checked-in comparisons

These unselected, default-camera screenshots use light theme and ordinary
mode. Matching dark-theme captures are also in `screenshots/`.

| Fixture / width | Columns | Group rows |
| --- | --- | --- |
| Sample Web App / 1440 | [Before](screenshots/sample-web-app-1440-light-columns.png) | [After](screenshots/sample-web-app-1440-light-rows.png) |
| Sample Web App / 390 | [Before](screenshots/sample-web-app-390-light-columns.png) | [After](screenshots/sample-web-app-390-light-rows.png) |
| 26 bilingual nodes / 1440 | [Before](screenshots/stress-1440-light-columns.png) | [After](screenshots/stress-1440-light-rows.png) |
| 26 bilingual nodes / 390 | [Before](screenshots/stress-390-light-columns.png) | [After](screenshots/stress-390-light-rows.png) |

Before:

![Sample Web App bottom index with columns](screenshots/sample-web-app-1440-light-columns.png)

After:

![Sample Web App bottom index with grouped rows](screenshots/sample-web-app-1440-light-rows.png)
