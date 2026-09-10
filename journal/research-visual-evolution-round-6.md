# Visual evolution round 6 — contract-backed style variety

Date: 2026-07-19

## Evidence reviewed

- [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) now treats visual styles as executable profiles over shared geometry and validation contracts. Its public showcase makes one topology feel materially different without relaxing route, spacing, label, or export gates.
- [`Understand Anything`](https://github.com/Lum1104/Understand-Anything) reinforces a related product lesson: visual variety only helps when each surface answers a reader question instead of making the graph look busier.

## Decision

Archify should not chase a large style count. It should offer a small set of audience-specific identities that preserve the same semantic IDs, SVG geometry, guided views, export path, and validators.

The third preset is `blueprint`:

- use it for deployment maps, infrastructure handoffs, architecture review, and technical documentation;
- keep `classic` as the stable neutral default;
- keep `signal-flow` as the luminous motion-forward identity;
- support dark and light themes in every preset;
- prove the preset through all five renderers and one live gallery artifact.

## Product invariant

Changing `meta.visual_preset` may change variables and viewer material, but it must not change semantic IDs or diagram geometry. The same JSON topology must remain valid, explorable, exportable, and testable in every preset.

## Result

The production-deployment proof now exercises `blueprint` end to end. The preset adds a precise 32px drafting grid, squared review surfaces, corner registration marks, restrained boundary notation, and non-glowing trace choreography while retaining the existing theme, focus, guided-story, pan/zoom, and export contracts.

Browser review also exposed a cross-preset mobile failure: a 1400px deployment canvas was technically responsive but its labels became unreadable. Wide diagrams now use a contained 720px swipe surface below 720px, and guided views horizontally reveal their authored path while pinned controls stay inside the viewport. The page itself remains free of horizontal overflow.
