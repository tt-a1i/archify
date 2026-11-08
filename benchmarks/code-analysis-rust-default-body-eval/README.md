# Rust default-body evaluation: base64 `Engine::decode`

This benchmark checks whether the normal CLI finds calls inside a changed trait
default body in a Rust repository not used by the earlier Rust evaluations.

## Case

- Repository: [`marshallpierce/rust-base64`](https://github.com/marshallpierce/rust-base64)
- Base: `1e8246a889f2b43299279e0c7ebd849dcaa7cb32`
- Head: `d021c39ae782c91d88cf3a76030f3f7b1eed892b`
- Change: `Optimize generic functions` (`d021c39`), which rewrites the `Engine`
  default methods around nested `inner` helpers.
- Modified method: `Engine::decode`
  (`src/engine/mod.rs:246`, `engine::Engine::decode`), default body lines
  246-264.
- Profile: base64 0.21.2, rustc 1.89.0, `aarch64-apple-darwin`, default
  features (`std`), tests disabled, extractor offline. The extractor parses
  source; it does not build the project.

The source answer was frozen in [source-first.json](source-first.json) from the
upstream diff and head source before the scored runs.

## Expected calls inside `Engine::decode`

| Call | Range | Expected target | Target identity |
| --- | --- | --- | --- |
| `engine.internal_decoded_len_estimate(input_bytes.len())` | `251:28-251:83` | `Engine::internal_decoded_len_estimate` (`src/engine/mod.rs:66:8`) | verified |
| `input_bytes.len()` | `251:65-251:82` | none, external slice method | unknown |
| `vec![0; estimate.decoded_len_estimate()]` | `252:30-252:70` | none, opaque macro | unknown |
| `engine.internal_decode(input_bytes, &mut buffer, estimate)?` | `254:33-255:69` | `Engine::internal_decode` (`src/engine/mod.rs:91:8`) | verified |
| `buffer.truncate(bytes_written)` | `258:13-258:43` | none, external `Vec` method | unknown |
| `Ok(buffer)` | `260:13-260:23` | none, tuple-variant constructor | unknown |
| `input.as_ref()` | `263:21-263:35` | none, external `AsRef` method | unknown |
| `inner(self, input.as_ref())` | `263:9-263:36` | none, nested local function outside the entity inventory | unknown |

No call in this body resolves to a concrete `Engine` implementation: the
receiver is the generic `E: Engine` inside the nested helper. The two trait
methods prove use of the declarations, not runtime dispatch.

## Results

Baseline `rust-source-direct-v5` and candidate `rust-source-direct-v6` were run
with the normal CLI on the same head checkout.

| Measure | v5 baseline | v6 candidate |
| --- | ---: | ---: |
| Calls found inside `Engine::decode` | 0 / 8 | 8 / 8 |
| Exact call ranges matched | 0 | 8 |
| Target declarations verified | 0 | 2 |
| Calls retained unknown | 0 | 6 |
| Wrong targets | 0 | 0 |
| Missed calls | 8 | 0 |

Itemized comparison:

- **Previously correct:** 0. v5 records no call in the default body.
- **Newly correct:** 8. Every expected call is captured once with the correct
  range; the two trait-method calls point to `src/engine/mod.rs:66:8` and
  `src/engine/mod.rs:91:8`.
- **Wrong target:** 0. The six calls with no captured source target remain
  unresolved instead of being pointed at a guessed implementation.
- **Missed:** v5 misses all eight positions because its call inventory omits
  trait default bodies. Those positions are counted as known source positions
  outside the v5 call list. v6 misses none.

The nested `inner` call is the one local target that remains unverified. It is
a real source declaration but not a navigable entity in the current function
inventory. The candidate keeps it unknown rather than reporting a wrong
implementation, so this benchmark records it as a target-identity gap, not as a
misleading result.

## Scoring

The two versions use different, explicitly separated flows in [run.py](run.py):

- **v5 baseline:** calls are selected by containment in the changed method's
  source range (`src/engine/mod.rs:246-264`), because v5 has no
  `defaultMethod` field. This is the version-appropriate equivalent of its
  inventory.
- **v6 candidate:** calls are selected by the `defaultMethod` context for
  `Engine::decode`, then matched by exact `(file, line, column, endLine,
  endColumn)` and checked for the expected target declaration or a retained
  unknown.

This does not use `benchmarks/code-analysis-rust-trait-change/run.py
--baseline-cli`: that path assumes the baseline has zero known references to an
implementation, which is not the question here. The scorer also rejects a
same-trait wrong target, an overclaimed unknown, and a shortened call range as
negative controls.

## Reproduce

```sh
git clone https://github.com/marshallpierce/rust-base64.git /tmp/base64-eval
cd /tmp/base64-eval
git worktree add /tmp/base64-samples/base64-base 1e8246a889f2b43299279e0c7ebd849dcaa7cb32
git worktree add /tmp/base64-samples/base64-head d021c39ae782c91d88cf3a76030f3f7b1eed892b
```

With the baseline checkout at `7d228fb5c` (the #1286 source branch) and the
candidate checkout at `77cecd0ca` (the #1287 source branch):

```sh
python3 benchmarks/code-analysis-rust-default-body-eval/run.py \
  --baseline-cli /path/to/archify-7d228fb5c/archify/bin/archify.mjs \
  --candidate-cli /path/to/archify-77cecd0ca/archify/bin/archify.mjs \
  --samples /tmp/base64-samples \
  --out /tmp/base64-default-body-eval
```

The script verifies both pinned revisions and the recorded head hashes, then
runs each CLI separately. Evidence from the recorded run is in
[evidence/summary.json](evidence/summary.json),
[evidence/baseline.json](evidence/baseline.json) and
[evidence/candidate.json](evidence/candidate.json).

## Limits

The result covers captured local source declarations only. External standard
library methods, the unexpanded `vec!` macro, and the nested local `inner`
function remain unknown. No concrete `Engine` implementation, compiler fact,
runtime dispatch, or complete impact is claimed. This case does not modify the
extractor; it evaluates the fixed v6 candidate.
