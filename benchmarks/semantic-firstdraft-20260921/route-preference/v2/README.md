# V2 cheap-candidate route preference probe

V2 is isolated at base `e484993f819ec16f3ee4c976ee14173901cdbc56` in
`/private/tmp/archify-semantic-firstdraft-20260921/route-preference-probe-v2/runtime`.
It keeps v1 unchanged. After the first clear automatic candidate, remaining
side-pair probes use only the existing direct, rhythm bridge, outside-channel,
and midpoint candidates. `allowGridSearch: false` returns before the existing
grid allocation and counters; normal routing and all probes before first clear
retain the default `true` behavior. Explicit `via`/`route` geometry remains on
the existing authored branch, and explicit sides continue to restrict candidate
side pairs.

The behavior is promising but remains a feasibility result. C1 loses its four
route-rhythm diagnostics while retaining its four unrelated text constraints.
quick-lru B1 passes. The independent seven-C1 suffix fixture restores the base
suffix route byte-for-byte and preserves its grid metrics (22 searches, zero
exhaustion), whereas v1 exhausted its 64-search budget and changed the suffix.
No validator was relaxed.

The seven repository examples comprise six passing showcase validations. The
seventh, `source-to-diagram`, stops before routing because its deliberately
external repository evidence requires a different local origin/revision.

The exact patch is the normalized `git diff --no-index` between the base
`archify/renderers/architecture/routing.mjs` and the frozen runtime's same
file, with both diff headers normalized to `renderers/architecture/routing.mjs`.
That patch applied cleanly to a fresh copied runtime and produced the frozen
SHA-256 above; `node --check` passed afterward.
