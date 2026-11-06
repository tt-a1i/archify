# Presentation overflow reachability — #1026

Comparison base: `63c9263e84bd3993cab8e09b3d69888857858635`.
Candidate: this PR's one-line `justify-content: safe center` change.

Fixed input: `archify/examples/web-app.architecture.json`, rendered with the architecture renderer. Same light theme, Classic preset, presentation mode (`?present=1&theme=light`), initial 100% view, viewport height 760px, device scale factor 1, Chrome desktop emulation. No authored content or geometry changes.

| Width | Before | After | SVG left before / after | Horizontal scroll width before / after |
| --- | --- | --- | --- | --- |
| 360 | [Base](base-360-light.png) | [Candidate](head-360-light.png) | -180 / 17 | 539 / 736 |
| 540 | [Base](base-540-light.png) | [Candidate](head-540-light.png) | -90 / 17 | 629 / 736 |
| 1280 | [Base](base-1280-light.png) | [Candidate](head-1280-light.png) | 29 / 29 | 1246 / 1246 |

The before screenshots show that presentation centering places the scene start before the scroll origin. The candidate exposes that start; scrolling reaches the opposite edge. The desktop scene keeps its existing placement. Screenshots were captured through Ego Browser and inspected by the agent. This is not human or physical-phone review.

The new presentation browser regression in `test/viewer-radar-scroll-browser.test.mjs` fails against the unchanged base template (`startLeft=-180`, `frameLeft=9`) and passes with the candidate. It checks both scroll edges at 360 and 540 pixels and preserved centering without horizontal overflow at 1280 pixels. The existing Radar regression also passes (2/2 browser tests total). `test/presentation.test.mjs` passes (1/1), core smoke passes, and generated checks pass after dependency installation and the affected template refresh.

This addresses only the presentation-content part of #1026. Navigation wrapping, route-probe placement, Passport clearance (#1027), RTL, camera changes, and dedicated mobile support remain outside this change. Safe centering was originally proposed by @jahfaliabdulrahman-dev in #1026/#1027 and independently adopted by @BlueboxC in fork commit `541809efd9e50eb3350e9c42a50821b967b33a04`; this PR retains that CSS idea without the broader adaptation.

## Direct compatibility follow-up

The first candidate (`d21393c76`) made the existing Delta risk-claim check reject the valid CSS token `safe center`. All three CI package smokes and the Node 22 Delta suite exposed this; a local `compare architecture` reproduced it. This was a new-patch compatibility failure, not a baseline failure.

The correction excludes the stylesheet and its exact serialized `exportCss` JSON assignment from that text-claim scan. It retains the remaining script scan and the prohibition against visible `SAFE` claims. The paired assertions accept legal alignment CSS and still reject a visible `SAFE` paragraph. The maintained Checkout Delta artifact and receipt are regenerated because they embed the affected Viewer CSS. The package check runs against the extracted canonical ZIP rather than a repository tree with development dependencies.

## Limited route-probe recheck

The original route-probe report was rechecked separately on the unchanged dev-base web-app artifact: 360×760, light/Classic, device scale factor 1, desktop-narrow and mobile emulation, normal and presentation mode, picking and resolved `users` → `db` route (eight combinations). The panel still exists. In picking state its complete instruction body and Find start/Clear controls remain visible; only its bottom border intersects the navigation band by 2.8125px. In resolved-route state existing docking selects the top, with zero navigation overlap. This does not reproduce the reported “only header visible” loss of content, and it does not justify a new overlay policy. It is a limited check of this input and these states, not broad mobile acceptance. No route-probe or navigation source was changed.
