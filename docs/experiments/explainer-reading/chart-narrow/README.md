# Native narrow chart layout: useful capability, unsafe universal default

The built-in width option improves the three-category examples, but drops category labels in a denser chart. A universal width cap is **not adopted**. Product source and the preferred gzip explanation remain unchanged.

| Fixed input | Current layout | maxWidth 332 | maxWidth 292 |
| --- | --- | --- | --- |
| Gzip pie | [Page](pie-base.html) | [Page](pie-width-332.html) | [Page](pie-width-292.html) |
| Gzip bars | [Page](bar-base.html) | [Page](bar-width-332.html) | [Page](bar-width-292.html) |
| Illustrative latency | [Page](latency-base.html) | [Page](latency-width-332.html) | [Page](latency-width-292.html) |
| Six constructed batches | [Page](dense-base.html) | [Page](dense-width-332.html) | [Page](dense-width-292.html) |

## Scope and source

The [plan](plan.md) was recorded before the runs. Base is `8ebc41afaa445ef3ad3ee3748e22e3646a4da3eb`; refreshed dev is `5ecbd1bfdbf83ea747072112493c940e707569cb`. The two frozen candidates change only the `maxWidth` render option to [332](width-332.patch) or [292](width-292.patch), retaining the original font size 13. No font enlargement, new dependency or vendored-source edit was attempted.

The vendored Pele 1.3.0 implementation already supports `maxWidth`: its constrained pie layout moves a side legend below the circle, while its XY chart computes narrower plotting geometry and may omit ticks or value labels. Current upstream [API documentation](https://pele.run/api#narrow-screens), inspected on 2026-10-30, also describes width-aware layouts and distinguishes static `render()` from browser `mount()`. That current documentation is context, not proof of the behavior of our older vendored version; the local outputs below establish that behavior. We did not upgrade or ship Pele into generated pages.

The gzip inputs/data are copied unchanged from [round16](../gzip-charts/README.md). The [latency input](inputs/latency.archify.md) and [six-batch input](inputs/dense.archify.md) are explicitly illustrative. They do not represent measured latency or production diagnoses. This is fixed-input rendering evidence, not a fresh authoring or comprehension benchmark.

## What the comparison shows

At 390 CSS px, the original charts shrink into 332 px of available content width. The 332 px native layout retains 10 px value labels in both three-category bar examples, compared with about 6.9 px in the baseline. All three categories, their values and series legends remain present. The latency chart shows the full 600 ms bar beside the mean/P50 groups. Its panel height stays approximately 404 px. The gzip bar panel stays approximately 604 px.

The denser case refutes applying that result to every chart:

| Six-batch chart | Base | Width 332 | Width 292 |
| --- | ---: | ---: | ---: |
| Category labels drawn | 6 | 3 | 3 |
| Numeric bar labels drawn | 12 | 12 | 0 |

The bars remain drawn, but `MonPM`, `TuePM` and `WedPM` no longer appear on the narrow axis. At 332 px the neighboring numeric labels are also crowded; at 292 px all numeric bar labels are omitted. Gzip's 292 px variant drops the middle category label `压缩数据` as well. [Static label inventory](static-labels.json) preserves the exact rendered text rather than counting source keywords. These are layout omissions, not missing input records; all twelve artifacts still pass strict finalize.

The pie behaves differently. Both width caps produce the same 256 × 354 SVG with a bottom legend. All value/share labels are visible at their native 11 px, including at 320 CSS px. However, the explanation panel grows from 629 to 778 px at 390, and from 618 to 716 px at 1440. This may be an author-selectable layout, but the evidence does not justify replacing every desktop pie or preferring the added graph over the shorter text-only gzip explanation.

Parent inspected all fourteen [screenshots](screens/), including the omitted labels and a 320 px and 1440 px pie. Representative comparisons: [three-category base](screens/bar-base-390.png) / [332](screens/bar-width-332-390.png), [latency base](screens/latency-base-390.png) / [332](screens/latency-width-332-390.png), [six-batch base](screens/dense-base-390.png) / [332](screens/dense-width-332-390.png) / [292](screens/dense-width-292-390.png). [Browser measurements](browser-01.json) include the transformed text sizes and bounds. Styles are clean/light throughout. No dark, print, export or human-readability acceptance is claimed. Existing English toolbar overflow and 320 px Chinese toolbar/table limitations remain outside this experiment.

## A separate concrete defect discovered

Trying the already supported Mermaid bottom-legend configuration revealed that adding valid frontmatter or an init directive makes Archify stop decorating pie legends with values and percentages. Plain input `A:10, B:3, C:8` receives value/share legends; the same input after either configuration prefix receives only `A`, `B`, `C`. Both compile successfully. The wrapper currently recognizes only text beginning with `pie` for its legend transformation.

This is a smaller, actionable correctness issue, separate from responsive layout. The [discovery note](prefix-discovery.md), [reproduction script](prefix-probe.mjs) and [baseline output](prefix-probe-base.json) record it for a focused follow-up. Any fix must retain configuration, diagnostics and labels without changing other chart types or inventing a new responsive framework.

## Verification boundary

The twelve original strict finalize summaries are archived beside their HTML files; they retain original absolute paths. [Hashes](identity.json) identify the copied HTML. Relocation is not a new provenance acceptance. No repository tests, new regression, ZIP build or installation was needed for rejected frozen option changes. No full browser gate, Windows run, remote CI acceptance, merge or release is claimed.

Disposition: confirmed renderer capability and limitations; universal narrow defaults rejected. Continue with the independently demonstrated configured-pie legend defect, while retaining this corpus for future layout work.
