# Route-preference feasibility probe

This is a bounded runtime experiment at base
`e484993f819ec16f3ee4c976ee14173901cdbc56`. It changes only the copied
runtime at `/private/tmp/archify-semantic-firstdraft-20260921/route-preference-probe/runtime`.

`runtime.patch` retains the first candidate that meets the existing clear-route
checks, but keeps scanning the already enumerated side pairs for one with no
`collectRouteRhythmIssues()` result. It uses the first clear candidate if none
is rhythm-clean. Authored `via` and `route` controls still take the existing
authored-geometry branch; explicit endpoint sides restrict the existing side
pair enumeration. Grid budgets and showcase validators are unchanged.

The frozen p-retry C1 first candidate was validated with
`--repo-root /private/tmp/archify-semantic-firstdraft-20260921/repos/p-retry`
at revision `1472907affe8d6107aba5884abc36d6361b3042e`. Baseline: four route
rhythm errors plus four unrelated text-width constraints. Patched runtime: the
four route errors disappear, while the same four text-width constraints remain;
overall showcase validation still fails. The p-retry B1 first candidate remains
blocked at its pre-render `schema/maxLength` error. This is a routing-only
benefit, not an end-to-end passing repair or a promotion recommendation.

Before examining the independently authored quick-lru B1 holdout, the runtime
behavior was frozen as routing-file SHA-256
`c6fe78c40a32f35306b30b42adfcc46ee8df22a762b247c3f3dfe3ca42ef0dc8`.
The initial serialized patch hash was
`07ae7f71dcf8bc44b8c078acb652bd9aa6e8472517a6364e1531477f4c30f4ab`.
After the holdout, only the artifact's omitted unified-diff context was repaired;
the runtime file was not edited. The final applyable patch is SHA-256
`ff5d1ec4c4c67b368c747e021d56faa2120e097b091dcafabb24e0dcce43854c`
and applies to a fresh runtime copy as the frozen routing-file hash above.
At quick-lru `a2190ebdf8e455b95a7138803d274ff5ed57ebcd`, baseline validation had
only `current-inspect`'s 4px `composition/micro-segment`; the frozen patched
runtime passed the full validator. No runtime-patch edit followed this holdout.

The frozen version adds local routing work: its additional side-pair attempts
run the existing grid search and charge the shared 64-search budget. On C1,
routing metrics moved from 3 grid searches (695 visited nodes) to 10 (2,611
visited nodes), while reporting no budget exhaustion. This is an observed cost,
not a demonstrated quality regression: this probe did not reproduce budget
exhaustion or a downstream route change caused by it. No accounting was reset
or gate loosened. A normal first-clear, rhythm-clean route remains identical
and uses zero grid searches in the focused regression test.

Run the focused evidence test after applying `runtime.patch` to the copied
runtime:

```sh
git -C /private/tmp/archify-semantic-firstdraft-20260921/route-preference-probe/runtime apply --check <runtime.patch>
node --test benchmarks/semantic-firstdraft-20260921/route-preference/route-preference.test.mjs
```
