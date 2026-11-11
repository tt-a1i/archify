# Ten-type discovery and Guide clipboard evidence

Issue: [#918](https://github.com/tt-a1i/archify/issues/918). Base: `63c9263e84bd3993cab8e09b3d69888857858635` (latest dev fetched on 2026-11-02). Product candidate: `b51b0d3aca20de4d98c8657ee2a8ae220932e855`.

Selecting a homepage type now opens its canonical proof instead of the unfiltered gallery. The selection survives language navigation. Guide retains keyboard focus and selected-filter semantics, and reports actual clipboard outcomes. Homepage and Start offer ten static recipe links until enhancement succeeds.

The existing canonical inventory already covers ten types. This change reuses it and preserves the existing design, routes, install commands, source/version labels, renderers and proof files. Guide copy handling reuses #987, including its clipboard helper unchanged; focus handling reuses #988, both authored by @tt-a1i and present on main but missing from this dev base. The commit retains co-author attribution. This is not a claim that every historical #918 acceptance item has been independently completed or deployed.

## Matched screenshots

These are real Chrome captures at 100% zoom, matching page state, viewport, language and theme. Images are not retouched. Original discovery/focus/static-fallback captures were recorded on the first candidate patch (`b6d60de1e2e1bc61f647bc39ed1e0423747c782f1b2ec1adef2241dca43c987d`); the later Guide clipboard addition does not change those captured states. Clipboard captures are from the final product candidate. No-JavaScript also disables theme initialization, so its captures use the default light theme.

| Case | Before | After |
| --- | --- | --- |
| Chinese homepage, Class selected, 1440px/light | [Image](before/homepage-class-zh-light-1440.png) | [Image](after/homepage-class-zh-light-1440.png) |
| Chinese homepage, Class selected, 390px/dark | [Image](before/homepage-class-zh-dark-390.png) | [Image](after/homepage-class-zh-dark-390.png) |
| Guide Class filter activated with Enter, 390px/dark | [Focus lost](before/guide-class-zh-dark-390.png) | [Focus retained](after/guide-class-zh-dark-390.png) |
| Start?type=class without JS, 1440px | [Wrong default recipe](before/no-js-start-zh-light-1440.png) | [Usable static recipe links](after/no-js-start-zh-light-1440.png) |
| Both clipboard methods fail, Chinese, 390px/dark | [False success](before/copy-failure-zh-dark-390.png) | [Failure and manual-copy recovery](after/copy-failure-zh-dark-390.png) |
| Both clipboard methods fail, English, 1440px/light | [False success](before/copy-failure-en-light-1440.png) | [Failure and manual-copy recovery](after/copy-failure-en-light-1440.png) |

Normal enhanced Start remains usable on narrow screens: [Chinese Class prompt, 390px/light](after/start-class-zh-light-390.png).

Agent-operated perceptual inspection: changed controls and recovery text are readable, the selected proof is identified, and no new overlap or horizontal overflow was seen in the reviewed captures. Mobile previews remain thumbnails; the linked proof supplies the detailed view. This does not claim human visual acceptance or a full accessibility certification.

## Checks and limits

Environment: macOS, Node 22.23.2, Chrome 156.0.8078.74. Each target was built separately and served locally: GitHub Pages `/archify/` and Cloudflare root/extensionless routes.

| Evidence | Result | Scope |
| --- | --- | --- |
| Both Astro builds | Pass | Final product contents |
| [Astro check](typecheck.log) | 0 errors, 0 warnings, 2 hints | Existing execCommand deprecations |
| [Website tests](website-tests.log) | 59 pass, 1 skip | Community browser-only test is disabled in this unit command |
| [GitHub browser regression](browser-github.log) / [Cloudflare](browser-cloudflare.log) | Both pass | Final product; language continuity plus discovery, keyboard, static fallbacks and clipboard cases |
| [Discovery/Start matrix](compatibility.json) | 40 homepage destinations; 400 Start prompt/agent/input combinations; 48 keyboard checks; 16 fallback cases | Reused first-candidate evidence; affected homepage/Start code and recipe data unchanged by the clipboard addition |
| Clipboard outcomes in browser regression | 28 combinations, plus 8 late-response scenarios | Two languages × two targets; API success/missing/rejection, fallback true/false/throw, cleanup, focus and current-request protection |
| [Additional review](review-browser.json) | 16 checks pass | Native Enter on the preview; no-JS deep-linked recipe readability at desktop/narrow widths |
| Gallery resources | 232 link checks return 200; 33 published proof files unchanged | Reachability and unchanged evidence, not newly regenerated diagram quality |

Copy API and fallback results were injected at the browser boundary. Prompt payloads, feedback, cleanup, focus and stale responses were checked; this does not verify OS clipboard authorization, assistive-technology speech or Agent installation. Safari/Firefox and hosted CDN behavior were not tested. No live installation was changed.

The new regression fails on the unfixed build. Removing the current-attempt callback permits a late rejected operation to run an obsolete fallback (0 calls with the guard, 1 without): [copy evidence](copy-evidence.json). The guard was retained. A redundant homepage lookup was removed and the behavioral checks still pass. No parallel recipe registry, extra Start CTA or routing framework was added.

The prior whole-page style inspector reports the same 14 FAIL / 9 WARN as the baseline, concerning the existing visual design. This scoped fix does not claim that separate style audit passed. Screenshots and browser assertions are reported separately; unchanged renderer assets are reused without claiming a fresh generation benchmark.

## Reproduce

From the repository root, with Node 22.23.2 and Chrome available:

```sh
npm --prefix website run build
ARCHIFY_SITE_TARGET=cloudflare npm --prefix website run build
npm --prefix website run check
npm --prefix website test
ARCHIFY_SITE_ROOT="$PWD/website/dist" ARCHIFY_SITE_BASE=/archify ARCHIFY_SITE_INTEGRATION=1 ARCHIFY_CHROME='/path/to/chrome' node --test --test-name-pattern='real Chrome' test/site-language-continuity.test.mjs
ARCHIFY_SITE_ROOT="$PWD/website/dist-cloudflare" ARCHIFY_SITE_BASE='' ARCHIFY_SITE_INTEGRATION=1 ARCHIFY_CHROME='/path/to/chrome' node --test --test-name-pattern='real Chrome' test/site-language-continuity.test.mjs
```

For manual failure reproduction, select a Guide recipe, make `navigator.clipboard.writeText` reject and `document.execCommand('copy')` return false, then activate Copy. The final build shows “Copy failed. Select the text manually.” in a live status next to the unchanged prompt; the base incorrectly changes the button to “Copied”. The copies are synthetic fault-injection evidence, not an observed end-user permission incident.

Prepared with Codex (GPT-6) assistance for investigation, implementation, tests, review, screenshots and documentation, under @testikun's direction. No human-review confirmation is implied.
