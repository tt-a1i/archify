# Gzip composition charts: retained experiment, not the preferred page

[Text-first page](../gzip-opening/candidate.html) · [Pie trial](pie.html) · [Bar trial](bar.html)

Both charts use the existing renderer to show one measured gzip result: 10 B header + 3 B compressed data + 8 B trailer = 21 B. The [data file](one-byte.json) matches the earlier [in-memory probe](../gzip-size/probe-output.json). Removing the single added chart directive makes each input byte-identical to the text-first page ([identity](identity.json)). The chart sits after the existing qualification about optional fields and multiple members; all prose, sources, numbers and the four-input table remain intact.

The question was whether seeing the composition justified the extra chart. It did not justify replacing the preferred phone explanation in this trial. Both variants pass strict finalize and provenance checks, yet their phone labels are small. The text-first page remains selected in the review index; these trials are available through this record.

## Actual reading comparison

All captures use clean style, 390 or 1440 CSS px, and matching light-theme controls. Dark phone states were also inspected. No chart/font/runtime source was changed.

| At 390 px | Text only | Pie | Bar |
| --- | ---: | ---: | ---: |
| Explanation panel height | 359 px | 629 px | 604 px |
| Visible chart legend font | — | 8.8 px | 7.6 px |
| Visible bar-value font | — | — | 6.9 px |
| Document scroll width | 390 px | 390 px | 390 px |

The page fits horizontally because each complete SVG shrinks into the 332 px content width. The pie's native viewport is 415 px wide; the bar's is 480 px. The text shrinks along with the shapes. Those dimensions explain why a page-width check alone is insufficient. The minimum quoted for the pie is measured on its painted legend; the raw SVG also contains transparent percentage labels, which are not the basis of the visual claim.

The pie adds rounded derived percentages (48%, 14%, 38%) to the byte values. They are shares of this 21 B output, not additional observations or general gzip ratios. The bar begins at zero and compares component sizes; it does not depict their byte order in a file. Neither graph measures the compression process or time.

On desktop, both charts render at native size: pie labels 11 px, bar values 10 px. Adding either graph changes the automatic layout from a narrow answer beside a wide explanation into two equal columns; the result table moves under the answer. The wider answer is shorter, but the whole explanation occupies more space. This is not a default-layout improvement claim.

Parent inspected [pie phone](pie-parts-390.png), [bar phone](bar-parts-390.png), [pie desktop](pie-1440.png), [bar desktop](bar-1440.png), [dark pie](pie-dark-390.png) and [dark bar](bar-dark-390.png). [Light metrics](visual-metrics.json) record transformed text sizes and panel bounds; [dark metrics](dark-metrics.json) also record text fill and visibility. Baseline text-only dimensions reuse [round15](../gzip-opening/visual-metrics.json) at `a24e774ab2fa6d9a942355dd8e63f2c0b6f18448`. No human comprehension or reading-speed result is claimed.

## Confirmed next problem and ownership

Current `archify/explainer/reader.css` limits chart width to the available width; the native-diagram readability adjustment in `reader.js` only selects `.diagram-preview>svg`. These charts therefore receive no equivalent phone text protection. This is a demonstrated rendering gap on two chart types, not a speculative edge case.

The existing broad [PR #1015](https://github.com/tt-a1i/archify/pull/1015) was inspected at `fe4f80d2195e0a7b49b7cfe6d3dba7ffd31a7ac8`. Its larger-font rule targets native diagrams; its chart changes add hover spotlighting and leave the shrinking-width rule unchanged. The PR was not modified or replayed. [Ownership/search record](ownership.json) includes the bounded searches and related results; absence from those searches is not proof that no related work exists.

Next scope: compare a readable phone chart treatment against these exact artifacts and a contrasting chart before changing shared behavior. A local scrolling treatment must keep captions accessible, support keyboard use, and preserve print/export. A responsive re-layout must preserve labels, scales and data; merely enlarging text inside fixed geometry may cause overlap. No implementation choice is adopted by this report.

## Verification boundary

[Pie strict receipt](pie.finalize-summary.json), [bar strict receipt](bar.finalize-summary.json), [pie provenance](pie-check.json) and [bar provenance](bar-check.json) pass without diagnostics. The original inputs and first-attempt copies are retained. These are artifact checks; the visual review rejects using either chart as the preferred phone page. No full browser gate, runtime regression suite, ZIP rebuild, live installation, Windows result, human acceptance or final-head CI is claimed. Product source and the authoring guide remain unchanged.

Disposition: rejected presentation alternatives plus a confirmed chart-readability problem. Preserve the measured evidence, then continue the active goal with a separately scoped rendering experiment.
