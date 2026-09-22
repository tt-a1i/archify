# Independent route-preference review

## Scope and identity

- Base: `/Users/tushaokun/.codex/worktrees/archify-semantic-firstdraft-20260921` at `e484993f819ec16f3ee4c976ee14173901cdbc56`.
- Candidate runtime: `/private/tmp/archify-semantic-firstdraft-20260921/route-preference-probe/runtime`.
- Candidate `renderers/architecture/routing.mjs` SHA-256: `c6fe78c40a32f35306b30b42adfcc46ee8df22a762b247c3f3dfe3ca42ef0dc8`, matching the proposal's recorded applied-routing SHA.
- No runtime, production, install, or proposal file was changed. This directory contains the review script and results only.

## Observed behavior

1. The frozen proposal preserves the authored-geometry branch. Its supplied explicit `via` plus explicit `bottom` sides fixture had byte-for-byte identical rendered composition points (proposal test passed).
2. Seven checked-in architecture examples had no route-point or selected-side differences between base and candidate. Those seven inputs and SHA-256 values are in `route-comparison.json`; they include 11 authored connections, all unchanged. Six of the seven validate as showcase in both runtimes. `source-to-diagram` exits 1 in both runtimes, so it is not a previously passing example.
3. Candidate and base both passed `route-detour` plus `architecture-automatic-labels` (16/16 each). The proposal's own six tests passed (6/6).

## Shared-budget experiment

The deterministic stress fixture is seven non-overlapping x-translations of the frozen p-retry C1 input (77 components, 112 automatic connections). It demonstrates a concrete shared-budget cost:

- Base: 21 grid searches, 4,877 visited nodes, zero budget exhaustions/fallbacks.
- Candidate: 64 grid searches, 16,896 visited nodes, five budget exhaustions and five conflict fallbacks.

This is caused by additional side-pair searches after a clear-but-rhythm-poor result. In this specific fixture every translated cluster still improves from four rhythm issues to zero; the exhausted calls did not reproduce a visible route, side, or validation regression. It is therefore evidence of a bounded-performance/availability compatibility risk, not a demonstrated output defect.

## Isolated suffix follow-up

`seven-c1-plus-grid-suffix.json` appends an isolated three-component source/blocker/target graph after the seven C1 clusters. Its SHA-256 is `0870c66c90dba343c31817d1b7485d0c07bd12a453c0498630b8dbd44d5c7be8` (80 components, 113 automatic connections). The suffix needs a grid route in the base:

- Base: 22 searches, zero exhaustion; selected `right -> left`; six points route around the blocker; zero blocker intersections and zero rhythm issues.
- Candidate: 64 searches, six exhaustions/fallbacks; selected `right -> bottom`; five points route around the blocker; zero blocker intersections and zero rhythm issues.

So this additional deterministic construction **does** show that unrelated preceding automatic routes plus candidate budget consumption can change a late suffix's chosen side/visible route. It does **not** reproduce the requested stronger downstream obstacle or quality failure: both outputs are clear and rhythm-clean. Script/result: `suffix-grid-probe.mjs`, `suffix-grid-result.json`.

## Disposition

No correctness or authored-route compatibility blocker was reproduced within this bounded review. The proposal is supported by its C1 improvement and existing-example preservation. Before treating it as generally safe shared routing behavior, retain the shared-64 budget result as an acceptance consideration: a larger diagram can consume the budget (observed) even though this deterministic fixture did not show a downstream bad route.

## Commands and logs

- `node --test route-preference.test.mjs` -> 6 pass, 0 fail. `proposal-test.log`
- `node --test test/route-detour.test.mjs test/architecture-automatic-labels.test.mjs` in candidate -> 16 pass, 0 fail. `candidate-focused-tests.log`
- The same focused test command in base -> 16 pass, 0 fail. `base-focused-tests.log`
- `node compare-routes.mjs` -> generated the hashes, checked-example diffs, and budget experiment in `route-comparison.json`.
