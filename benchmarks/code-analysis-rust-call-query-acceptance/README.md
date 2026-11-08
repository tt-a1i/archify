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
| calls on lines 251-260 | inside the nested `inner` function | change query shows none because it publishes incoming references, not outgoing calls |
| calls on line 263 | directly in `Engine::decode`: `inner(...)` and `input.as_ref()` | change query shows none; no `directCaller` field |

Source callers and context:

- The six calls on `251:28-260:23` are inside `inner` (`:247`), so their direct
  caller is `inner`.
- The two calls at `263:9-263:36` (`inner(...)`) and `263:21-263:35`
  (`input.as_ref()`) are directly in the default method body after `inner`
  closes. Their direct caller is `Engine::decode` itself; the outer default
  method is the same `Engine::decode`.
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

Direct-caller capability: the real query has no `directCaller` field, so every
row records **`CLI 未提供`**. It does expose the call location and the outer
`defaultMethod`. The source answer's direct caller is `inner` for the four new
case calls; this is reported as a capability gap, not inferred from the outer
default method. When a `directCaller` field is present, the scorer checks its
source caller name, file and line.

### Shared scoring path and counterexample

The real query and both controls call the same `score_side` / `score_call`
path. The controls start from a deep copy of the saved full candidate query and
inject a `directCaller` into its first trait-candidate item:

| Run | Input | Actual result |
| --- | --- | --- |
| Real query | no `directCaller` field | accepted; 4/4 calls correct; caller status `CLI 未提供`; failures `[]` |
| Negative control, current scorer | first item gets outer `Engine::decode` (`:243`) | rejected; failures `calls:not-all-correct`, `calls:wrong`, `direct-caller:wrong`; offending call `src/engine/mod.rs:251:33` |
| Positive control, current scorer | first item gets correct `inner` (`:244`) | accepted; 4/4 calls correct; caller status `provided-and-checked` |

The negative run proves the whole acceptance fails and names the exact call
point when the outer default method is misreported as the direct caller. The
positive run proves the same path accepts the correct nested caller.

Counterexample before and after the scoring-path revision: with the committed
scorer at `5fdf60ae8`, the same injected outer caller was **ignored** and the
first item stayed `correct` with `wrong: []`. With the current scorer it is
`wrong` with `direct-caller`, `direct-caller-line`, `direct-caller-name`, and
`outer-default-method-misreported`, and the whole acceptance fails at
`src/engine/mod.rs:251:33`. The actual probe is in
[counterexample-before-after.json](evidence/counterexample-before-after.json).
Full injected queries are saved as
[negative-control-query.json](evidence/negative-control-query.json) and
[positive-control-query.json](evidence/positive-control-query.json); aggregate
results are in [evidence/summary.json](evidence/summary.json).

Freeze timing: `source-first.json` was written before the scored replay, but
the commit contains no independent timestamp credential. **Freeze timing is
not independently verified.**

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

The script writes the full baseline and candidate query JSON, both injected
control queries, the scorer summary, and exits nonzero on a missed, wrong or
overclaimed caller. It uses the same scoring path for the real query and both
controls.

## Result

The candidate query is accurate for this case: four default-body call sites,
correct outer default methods, trait-declaration targets, and an explicitly
undetermined runtime target. No product code was changed for this acceptance
round. The baseline reports the changed definition but no default-body callers.
