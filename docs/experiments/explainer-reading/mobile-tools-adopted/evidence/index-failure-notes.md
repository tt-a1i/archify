# New review-index button caused a small overflow

The first index assertion (browser-03.mjs) failed without saving its measurement. The next invocation's observation (browser-04.mjs / index-attempt-1-failure.json) was at the browser's reset 1512 px viewport, so it does not establish the original failure's viewport or cause.

The instrumented repetition (browser-05.mjs / index-attempt-2-state.json) reproduces pageWidth=392 at innerWidth=390 while every selected frame/open/report target matches. browser-06.mjs / index-overflow.json identifies the final version button ending at x=392. Five buttons were laid out without wrapping inside a 366 px container.

The review index's existing .segmented flex container gains flex-wrap:wrap. No product CSS or packaged source changes beyond e16dbcfb8 are involved. The original failed checks and before screenshot are retained; The immediate post-edit browser-07.mjs check still failed without a saved measurement; its exact cause is unconfirmed. No further index edit was made. The instrumented subsequent navigation in browser-08.mjs records computed flexWrap=wrap, pageWidth=390, matching frame/open/report targets in all four case/preview combinations, and captures the wrapped result. The later browser invocation is not evidence about the earlier failed measurement.
