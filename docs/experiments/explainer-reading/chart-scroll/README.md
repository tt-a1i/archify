# Phone chart scrolling: readable labels, broken first-view comparison

Disposition: **rejected as the default chart presentation**. The implementation is preserved in [rejected.patch](rejected.patch), not applied to product source. The overall reading goal continues.

| Fixed input | Base | Scroll candidate |
| --- | --- | --- |
| Measured gzip composition, pie | [Page](pie-base.html) | [Page](pie-candidate.html) |
| Same composition, bars | [Page](bar-base.html) | [Page](bar-candidate.html) |
| Illustrative mean/P50/P99 comparison | [Page](latency-base.html) | [Page](latency-candidate.html) |

The first two reuse [round16's unchanged inputs and data](../gzip-charts/README.md). The [third input](latency.archify.md) adapts only the valid illustrative arithmetic from the repository's P99 example: 985 requests at 80 ms plus 15 at 600 ms have mean 87.8 ms; the 990th sorted value is 600 ms. The chart rounds the mean to 88. These are constructed values, not a measurement or a diagnosis of a service.

## What changed in the frozen prototype

Base is `9ece92b3ed397380d9c85a29487ebe5a098aa818`; refreshed dev remained `5ecbd1bfdbf83ea747072112493c940e707569cb`. The [plan](plan.md) declares a fixed-input reader experiment and a narrow exemption from fresh generation benchmarks before execution.

The candidate wraps each chart SVG in a native scroll region. At screen widths up to 760 px, the SVG retains its native width; the caption stays outside the region. Existing reader relayout controls the focus stop and localized hint. Desktop keeps its previous fit. The prototype also contains print/export adaptations, but those are **not verified** by this experiment.

The first prototype failed to enlarge the SVG because its inline `max-width:100%` still capped it. [Observed failure](prototype-1-failure.json), [first patch](prototype-1.patch), and [first latency artifact](attempt-1/latency-candidate.html) preserve that attempt. The second prototype overrides that cap while retaining the desktop width rule.

## Actual result

Clean style, matching light theme, 390 and 1440 CSS px; dark phone states also inspected. The numbers below come from [browser measurements](browser-02.json), excluding transparent pie labels.

| At 390 px, with 332 px of chart space | Base | Candidate |
| --- | ---: | ---: |
| Pie legend text | 8.8 px | 11 px |
| Bar / latency value text | 6.9 px | 10 px |
| Pie explanation panel height | 629 px | 707 px |
| Bar explanation panel height | 604 px | 711 px |
| Latency explanation panel height | 404 px | 531 px |

The text-size gain is real, but the candidate hides important information on first view. In the latency chart, the 600 ms value starts at x=378.5–397.8 while the scroll viewport ends at x=361. [Initial bounds](browser-04-initial.json) and the [initial screenshot](screens/latency-candidate-390.png) show that the distinctive high bar is outside the view. Scrolling right reveals it, while the mean comparison on the left disappears. The pie's value/share legend is partly offscreen as well. This undermines the purpose of a compact comparison chart.

[Raw CDP ArrowRight input](browser-04-keyboard.json) moved the focused viewport from 0 to 1 px during the native animation. A subsequent explicit end-scroll reached 148 px and produced the [rightmost view](screens/latency-candidate-390-scrolled.png). This proves reachability, not that a reader will discover or benefit from scrolling.

At 1440 px, all three candidate screenshots are byte-identical to their paired bases ([identity record](identity.json)). Gzip pages remain 390 px wide on the phone. The English latency page remains 400 px wide in both arms because of the previously recorded toolbar overflow; this prototype does not fix it.

Parent inspected all fifteen [comparison screenshots](screens/) plus the scrolled latency view. Representative pairs: [pie base](screens/pie-base-390.png) / [candidate](screens/pie-candidate-390.png), [bar base](screens/bar-base-390.png) / [candidate](screens/bar-candidate-390.png), [latency base](screens/latency-base-390.png) / [candidate](screens/latency-candidate-390.png). No human comprehension or reading-speed result is claimed.

## Verification and stopping boundary

All six pages passed strict finalize in their original frozen runtimes with no diagnostics. The original finalize/delivery receipts are copied byte-for-byte and retain original absolute paths; relocation is not a fresh provenance acceptance. HTML hashes are recorded separately in [identity.json](identity.json).

[Browser sequence 03](browser-03.mjs) timed out before saving its combined results; [failure record](browser-03-failure.txt) keeps that limit explicit. The later bounded sequence confirms phone geometry and keyboard scrolling. It does not establish export, print, no-JavaScript behavior, resize round trips, or a full browser-gate pass. Those were planned acceptance checks for an adopted implementation; the first-view comparison failure already rejects this default, so further integration tests would not justify adoption.

No product source or guide changes, new regression tests, ZIP rebuild, live installation, Windows run, CI acceptance, merge or release. The source-only prototype is a research artifact. A future merge with PR #1015 would also need to reconcile that PR's direct-child `.chart>svg` selectors with the wrapper; this experiment does not modify or approve that PR.

Next bounded question: can chart-native layout use the narrow width while keeping all categories and a readable legend visible? Investigate supported renderer dimensions and legend layout before adding reader-side measurement or a new generic rendering framework. This is a new hypothesis, not an assertion that responsive layout will succeed.
