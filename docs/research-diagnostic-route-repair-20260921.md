# Offline diagnostic route-repair prototype

## Scope

This experiment is deliberately separate from the renderer, validator, Skill,
and authored product inputs. It repairs at most one automatic Architecture
connection after a production `showcase` diagnostic. It never changes nodes,
labels, cards, sources, boundaries, views, or semantic relationship fields.

The executable is:

```sh
node benchmarks/semantic-repair-20260921/route-repair/route-repair.mjs \
  input.architecture.json [--repo-root repository] [--out candidate.json]
```

The result is one of:

- `repaired`: a candidate has passed the production layout report and the full
  showcase `validate --json` gate for its exact SHA-256 bytes.
- `unchanged`: the original input already passes those gates; no candidate is
  written or changed.
- `declined`: the input has authored route controls, another failure class, an
  ambiguous/multiple target, missing measured route data, or no bounded local
  candidate passed.

Each result has a `receipt` with local host time, the canonical input hash,
trial count, selected connection, exact candidate hashes, observed diagnostic
codes, and `finalizeRequired: true`. This is validation evidence only;
`finalize` remains required for artifact, delivery, and browser evidence.

## Production diagnostic evidence

Architecture's `validate --layout-json` report contains resolved component
boxes plus every connection's routed points. Its layout validator reports a
route-rhythm failure with the stable Architecture relationship subject:
`diagramType`, `collection`, `index`, optional `id`, `from`, and `to`.
`renderers/shared/geometry.mjs` classifies a nonzero interior segment below
16px as `composition/short-interior-segment`, and below 8px as
`composition/micro-segment`. The final artifact checker repeats those codes in
the showcase receipt.

The helper accepts only those two codes, only when every initial diagnostic is
one of them, and maps their stable relationship identity to exactly one input
connection. It declines before touching an input which already declares any of
`via`, `route`, `fromSide`, `toSide`, `channelX`, or `channelY`. That prevents
an experimental automatic-route repair from overriding authored intent.

For a target edge, it first records its automatic route from the production
layout report. A fixed measurement probe with `via: []` obtains the anchors
that an explicit route would receive after automatic port spreading is
disabled. The probe is never returned. The first candidate rebases the existing
measured outer detour on those anchors and widens only a short local turn to
the 16px floor. Two fixed local side/corridor alternatives follow when needed.
Every candidate is generated offline and independently rerun through production
layout and full showcase validation. No global layout search, model call, or
node move is used.

## Local red-to-green fixture

`benchmarks/semantic-repair-20260921/route-repair/fixtures/short-interior-route.architecture.json`
is an automatic-only three-node Architecture diagram. Before repair, production
validation reports:

```text
composition/short-interior-segment
connections[1] id "ac" "a" -> "c"
14px interior segment [107, 124] -> [93, 124]
```

The accepted first trial adds `via` only to `ac`; all component and connection
semantics remain byte-equivalent after removing that one generated `via` field.
The CLI receipt recorded one trial at local time `Mon Sep 21 2026 15:07:43
GMT+0800`, candidate SHA-256
`71a5295b890a66089e5e69d94a49627321ac10a586ca560c9e42c0bb25b1cdf8`.
A separate production validation of the written candidate returned `ok: true`,
the same candidate SHA, 9/9 passing checks, and a showcase composition summary
of zero errors and zero warnings.

## Existing Polka evidence and bounded decline

The supplied older Polka source snapshot is useful for architecture diagnostic
inspection, but it is not a safe route-only acceptance case at the current
head. Its snapshot `004`, validated with its supplied repository root, reports
`composition/desktop-readability` before any supported route-rhythm failure.
The helper returns `declined`, records zero candidate trials, and names that
unrepaired diagnostic instead of changing its geometry. Snapshot `001` also
has independent component text-fit `layout/constraint` failures. These results
are intentional evidence that this prototype does not hide unrelated layout or
reader defects to claim a route repair.

## Verification

```sh
node --test benchmarks/semantic-repair-20260921/route-repair/test-route-repair.mjs
```

Exit 0: four tests passed. They cover the automatic red-to-green fixture,
semantic projection preservation, exact-SHA showcase acceptance, valid-input
no-op, authored-route protection, and unsupported/non-geometric decline.
