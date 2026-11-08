# Rust call-query acceptance: default-body caller attribution

This benchmark validates the user-visible change-query path for a real changed
definition whose call site is inside a trait default body. It contains one
explored case and one new case.

## Worktree and versions

- Candidate: `#1287` fixed commit `ba24b046d7e36ed25337fa0ea114daf83de49c9d`
- Baseline: `#1286` fixed commit `7d228fb5c849c370b09ae2d1a2d315b1c9e01ee4`
- Case repository: `marshallpierce/rust-base64`
- Toolchain: rustc 1.89.0, default features, `tests=false`, offline extraction.
  Run `cargo fetch` once in each sample worktree so the change query can read
  dependency metadata; no project build or test is executed.

## Case A: explored `Engine::decode` (`d021c39`)

Base `1e8246a`, head `d021c39`. The changed definitions are the `Engine`
default methods. The query command and output are recorded in
[explored-base64.json](explored-base64.json) and
[evidence/explored-query.json](evidence/explored-query.json).

| Item | Source truth | User-visible CLI result |
| --- | --- | --- |
| `decode` | trait default method at `src/engine/mod.rs:246` | listed as a changed definition; `knownReferences.total = 0`; no outgoing calls are shown |
| `inner` | nested local function at `src/engine/mod.rs:247` inside `decode` | not a definition or a reference; no `directCaller` field |
| `internal_decode` | trait method target at `src/engine/mod.rs:91` | not a changed definition and not shown as a caller; only a target in raw facts |
| calls in the body | eight raw-fact positions, including calls inside `inner` | change query shows none because it publishes incoming references, not outgoing calls |

Source callers and context:

- The direct caller of `engine.internal_decode(...)` at `254:33-255:69` is
  `inner`, nested inside `Engine::decode`.
- The outer default method is `engine::Engine::decode` (`src/engine/mod.rs:246`).
- The target is `Engine::internal_decode` (`src/engine/mod.rs:91`).
- The macro boundary is explicit: `vec![0; estimate.decoded_len_estimate()]`
  at `252:30-252:70` is one opaque macro record. The method call inside the
  macro token tree is not separately inventoried, and the change query does not
  show the macro position.

The explored case shows the query's orientation: to find a default-body call,
the changed definition must be the callee, not merely the enclosing default
method. It is marked **explored**, not used as the acceptance success case.

## Case B: new `GeneralPurpose::internal_decode` (`9e9c7ab`)

- Base: `a8a60f43c56597259558261353b5bf7e953eed36`
- Head: `9e9c7abe65fed78c35a1e94e11446d66ff118c25`
- Change: `Engine::internal_decode now returns DecodeSliceError`
- Changed definition: `engine::general_purpose::GeneralPurpose::internal_decode`
  (`src/engine/general_purpose/mod.rs:171`)
- Question: `I changed GeneralPurpose::internal_decode in this revision. Which calls point to it, and is there a call inside a trait default method body?`

This case was not previously run through the candidate analyzer. The source
answer in [source-first.json](source-first.json) was recorded from the diff and
head source before the scored replay.

### Expected callers

| Call range | Direct caller | Outer default method | Provable target | Implementation |
| --- | --- | --- | --- | --- |
| `src/engine/mod.rs:251:33-252:69` | `inner` (`:244`) | `Engine::decode` (`:243`) | `Engine::internal_decode` (`:87:8`) | `GeneralPurpose` candidate (`:171:5`) |
| `src/engine/mod.rs:322:33-323:70` | `inner` (`:306`) | `Engine::decode_vec` (`:301`) | `Engine::internal_decode` (`:87:8`) | `GeneralPurpose` candidate (`:171:5`) |
| `src/engine/mod.rs:365:13-370:18` | `inner` (`:357`) | `Engine::decode_slice` (`:352`) | `Engine::internal_decode` (`:87:8`) | `GeneralPurpose` candidate (`:171:5`) |
| `src/engine/mod.rs:401:13-406:18` | `inner` (`:397`) | `Engine::decode_slice_unchecked` (`:392`) | `Engine::internal_decode` (`:87:8`) | `GeneralPurpose` candidate (`:171:5`) |

The receiver is generic `E: Engine`, so the calls prove the trait declaration,
not runtime dispatch to `GeneralPurpose`.

### Results

| Measure | v5 baseline | v6 candidate |
| --- | ---: | ---: |
| Changed definition reported | 1 | 1 |
| `knownReferences` | 0 | 0 |
| `traitCandidates` call sites | 0 / 4 | 4 / 4 |
| Exact call ranges correct | 0 | 4 |
| Target declarations verified | 0 | 4 |
| Runtime target determined | 0 | 0 |
| Wrong or missed calls | 0 wrong / 4 missed | 0 wrong / 0 missed |

Raw facts versus change query:

- Candidate: the extractor records four `internal_decode` calls with
  `defaultMethod` context and the change query displays all four.
- Baseline: both raw facts and change query contain zero default-body calls.
- Case A separately records the opposite boundary: eight raw-fact calls but
  zero query references for the changed enclosing default method.

Direct-caller capability: the query has no `directCaller` field. It does expose
the call location and the outer `defaultMethod`. The source answer's direct
caller is `inner`; this is reported as a capability gap, not inferred from the
outer default method.

### Negative control

The scorer rejects a record that names the outer `Engine::decode` as the direct
caller (`outer-default-method-misreported`) and accepts the nested `inner`
declaration. The control is in [evidence/summary.json](evidence/summary.json).

## Reader path

1. Change `GeneralPurpose::internal_decode` at
   `src/engine/general_purpose/mod.rs:171`.
2. Run the change query on that entry. The result reports the changed
   definition and four trait candidates at `src/engine/mod.rs:251`, `:322`,
   `:365`, and `:401`.
3. Click a candidate to open its exact call range. The source shows the call
   inside the local `fn inner` of `Engine::decode`, `decode_vec`, `decode_slice`
   or `decode_slice_unchecked`.
4. The same items carry the outer default method and the target declaration
   `Engine::internal_decode` at `src/engine/mod.rs:87`. The changed
   `GeneralPurpose` implementation is listed as a source candidate.
5. What remains unknown: runtime dispatch to `GeneralPurpose`, and the direct
   caller as a structured CLI field. Both are stated explicitly rather than
   guessed.

## Reproduce

```sh
git clone https://github.com/marshallpierce/rust-base64.git /tmp/base64-query
cd /tmp/base64-query
git worktree add /tmp/base64-query-samples/base64-9e-base a8a60f43c56597259558261353b5bf7e953eed36
git worktree add /tmp/base64-query-samples/base64-9e-head 9e9c7abe65fed78c35a1e94e11446d66ff118c25
cargo fetch --manifest-path /tmp/base64-query-samples/base64-9e-base/Cargo.toml
cargo fetch --manifest-path /tmp/base64-query-samples/base64-9e-head/Cargo.toml
```

```sh
python3 benchmarks/code-analysis-rust-call-query-acceptance/run.py \
  --baseline-cli /path/to/archify-7d228fb5c/archify/bin/archify.mjs \
  --candidate-cli /path/to/archify-ba24b046d/archify/bin/archify.mjs \
  --samples /tmp/base64-query-samples \
  --out /tmp/rust-call-query-acceptance
```

The script writes the full baseline and candidate query JSON, the scorer
summary, and exits nonzero on a missed, wrong or overclaimed caller.

## Result

The candidate query is accurate for this case: four default-body call sites,
correct outer default methods, trait-declaration targets, and an explicitly
undetermined runtime target. No product code was changed for this acceptance
round. The baseline reports the changed definition but no default-body callers.
