# Repair-route simplification: local savings only

After editing a failed candidate, run `finalize` directly. Its embedded validation already renders and checks the candidate. The previous prescribed `validate` followed by `finalize` repeated that work. Final validation, atomic delivery, strict provenance checks and real-browser checks remain required. Standalone `validate` remains available for focused diagnosis. A repair must retain quality/repository arguments and discard a hash binding from before the edit.

This is a small repair-path improvement, not a demonstrated reduction in overall authoring time.

## Frozen identities and validation

- Base M: `fefd409eefbb1e6716f41e8cc98eb098a96042ef`.
- Model-tested E1: `65145e2400f8f32693b0645a669724f34aee5c5c`.
- Full engineering regression: `d5e5dcc2f1a046eeeac97b2ff0bf16ca1def7c5d`.
- The last commit changes only an outdated text assertion; product/package bytes are identical to model-tested E1.
- E1 ZIP SHA256: `43a922783ed093b70fa470eb0d9916b48c4cf134d8665a570931467c1c00d8ff`.
- Node 22.23.2, explicit Chrome, `npm test` from `archify/`: 1,921 passed, 0 failed, 5 skipped (1,926 total). Full log SHA256: `cad20f6ab4b154e972b575a784bce42c7ebd010320a90a9c6844896c7a648cba`.
- Skips: pinned MCO checkout unavailable; non-22 Node negative case; Windows drive-path case; serialized site-builder gate; site-language browser gate. These are not passing results.
- Extracted-package `finalize` with actual browser checks passed. No renderer, Viewer, schema or example changes. Remote CI is separate from this local evidence.

## Fixed-input measurements

Three checked-in architecture fixtures, ten alternating M/E1 pairs per fixture plus one warmup per variant. Fresh CLI/Chrome processes; OS cache uncontrolled. All 66 pipelines passed; final HTML bytes were identical within each fixture. Original local measurements used E1 `ca0bd7b25c40a51d40b8ac0f5688145668ea64a0`; later changes only refine instructions and assertions, with the measured runtime unchanged.

| Fixture | M median | E1 median | Difference of medians |
| --- | ---: | ---: | ---: |
| starter | 3.130 s | 2.761 s | 0.369 s |
| web-app | 3.365 s | 2.840 s | 0.525 s |
| production-deployment | 3.148 s | 2.724 s | 0.423 s |

`summary.json` retains ranges and individual paired savings. `local.py` is the exact local benchmark used (macOS Node/Chrome paths are explicit constants). With separate M and E1 checkouts and a new output directory:

```sh
python3 benchmarks/repair-finalize-20260920/local.py --base /absolute/path/to/M --candidate /absolute/path/to/E1 --out /absolute/path/to/new-results
```

This compares prescribed repair routes using identical JSON, not model adoption or a model request count.

## Real authoring results and limits

| Model / development task | M | E1 |
| --- | --- | --- |
| Sol/medium, p-limit | 139.372 s, qualified | 176.854 s, qualified |
| Terra/medium, synthetic audit-export service | 195.977 s, qualified | 208.215 s, failed visual boundary clarity |

All four authors completed; three outputs qualified. Every author wrote one candidate and ran one finalizer, with zero repair loops: the optimized repair path was never exercised. The two cohorts are not pooled. The single qualified Sol pair was slower on E1; the failed Terra E1 cost is not qualified delivery latency. Neither pair establishes a general causal performance effect.

Four authors and two Luna/high reviews each recorded gateway-class errors before completing. Request/retry counts, provider timing and billing were unavailable. Both author cohorts were paused by the preregistered fault rule. No new-validation tasks ran. Overall authoring improvement and quality noninferiority remain unproven; there is no statistical or tail-latency claim.

Only the narrow repair-route change is retained. Further performance work should address the time before the first complete candidate, which accounted for roughly 85–90% of these author runs.
