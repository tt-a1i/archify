# Go/Rust change-investigation batch (2026-11-09)

Real upstream changes used to check how far the normal `archify code-analysis task`
paired question answers four questions: which definition changed, who directly
calls it, which calls only prove an interface/trait declaration, and where the
reader can verify the call in source.

Frozen answers live in `cases/*.json`. The runner only scores the CLI output; it
does not scan source itself. Every case records the fixed base/head commits, the
changed definition, exact expected call ranges, direct caller name/line/kind,
provable target, unknowns and the expected status (`pass` or a documented
`expectedGap`). This revision covers 20 cases and 86 expected call positions:
the 12 cases from the first stage plus 8 new or frozen cases.

## Baselines and ancestry

| Line | Commit | Source |
| --- | --- | --- |
| Batch baseline | `70bdf0227` | merge of the accepted Go and Rust lines |
| Stage-1 candidate | `ac36a4ab0` | fixed head reviewed before this stage (Rust v7, Go v3) |
| Stage-2 baseline worktree | `/tmp/archify-batch-20261109/stage-baseline` | `ac36a4ab0`, same 20 questions |
| Stage-2 candidate | `codex/go-rust-investigation-batch` | this branch (Rust v8, Go v4) |

The stage-2 baseline and candidate ran the same queries against the same sample
roots. Only the extractor/query code differs. Both lines are ancestors of this
branch, and the team commits from the earlier stage remain in history.

## Cases

New repositories for this batch: `spf13/cobra`, `labstack/echo`, `urfave/cli`,
`BurntSushi/ripgrep`, `tokio-rs/bytes`. Including the reused repositories,
`cli`, `cobra`, `echo`, `ripgrep` and `bytes` were not used by the 12-case batch.
`rust-base64` and `hyperium/http` are regression only.

| Case | Lang | Repo | Change | Definition | Scope | Expected |
| --- | --- | --- | --- | --- | --- | ---: |
| `certmagic-store` | Go | certmagic | `16c9db1`→`1a2275d` | `*FileStorage.Store` | new | 12 |
| `certmagic-load` | Go | certmagic | `16c9db1`→`1a2275d` | `*FileStorage.Load` | new | 20 |
| `certmagic-interface` | Go | certmagic | `2d11419`→`9a56fcd` | `Storage.Store` | new | 5 |
| `certmagic-interface-load` | Go | certmagic | `2d11419`→`9a56fcd` | `Storage.Load` | reserved-go | 13 |
| `gin-close` | Go | gin | `8d0468f`→`d75fcd4` | `*responseWriter.CloseNotify` | new | 2 |
| `gin-hijack` | Go | gin | `8d0468f`→`d75fcd4` | `*responseWriter.Hijack` | new | 3 |
| `raft-stage-commit-index` | Go | raft | `d3c9124`→`a2e8778` | `CommitTrackingLogStore.StageCommitIndex` | new | 1 |
| `cobra-get-completions` | Go | cobra | `f2878ba`→`746ef07` | `*Command.getCompletions` | new | 1 |
| `echo-remove-custom-method` | Go | echo | `4f7bea5`→`2968240` | `*routeMethods.set` | reserved-go | 1 |
| `cli-wrap-line` | Go | cli | `d854bb4`→`ca8f45a` | `wrapLine` | new | 4 |
| `clap-any-value-parser` | Rust | clap | `b55ebc9`→`6720240` | `AnyValueParser::parse_ref_` | new | 1 |
| `clap-typed-value-parser` | Rust | clap | `b55ebc9`→`6720240` | `TypedValueParser::parse_ref_` | reserved-rust | 1 |
| `tracing-subscriber-event-enabled` | Rust | tracing | `d3eb109`→`f42e7e6` | `Subscriber::event_enabled` | new | 5 |
| `tracing-layer-event-enabled` | Rust | tracing | `d3eb109`→`f42e7e6` | `Layer::event_enabled` | new | 6 |
| `ripgrep-file-name` | Rust | ripgrep | `4c2362d`→`7155f64` | `pathutil::file_name` | new | 2 |
| `ripgrep-parent-key` | Rust | ripgrep | `1752fb7`→`6892bc2` | `incremental::parent_path_key` | new | 1 |
| `bytes-truncate-zero` | Rust | bytes | `002df10`→`d5c8ad3` | `Bytes::truncate` | reserved-rust | 1 |
| `bytes-try-get-int` | Rust | bytes | `d5c8ad3`→`7930d93` | `Buf::try_get_int` | new | 2 |
| `http-insert-occupied-mult` | Rust | http | `c6af28b`→`3dd9f5e` | `HeaderMap::insert_occupied_mult` | regression | 1 |
| `base64-inner-decode` | Rust | rust-base64 | `a8a60f4`→`9e9c7ab` | `GeneralPurpose::internal_decode` | regression | 4 |

The reserved cases were frozen by reviewers who read only the upstream diff and
source, before any candidate run in this batch. `echo-remove-custom-method` and
`bytes-truncate-zero` were first executed after the final rules; both matched
their frozen answers. `bytes-truncate-zero` replaced
`http-insert-occupied-mult` as the Rust reserved case after the defaulted-generic
owner fix was discovered, and `http-insert-occupied-mult` moved to the regression
set.

Selection notes:

- Questions favour changes a maintainer would actually trace: a new nil-tolerant
  setter in Echo, a shared-reference release at zero length in bytes, completion
  lookup in cobra, line wrapping in cli, file-name and parent-key helpers in
  ripgrep.
- `gin` `CloseNotify`/`Hijack` implementations come from external embedded
  `net/http` interfaces. The candidate now keeps the go/types-proven interface
  evidence and reports unlocated candidates instead of returning nothing.
- `clap` `parse_ref_` calls sit behind a type-erased parser and inside an `ok!(...)`
  macro argument; both remain documented gaps.
- `tracing` `layer/mod.rs` and `reload.rs` calls sit in macro bodies or closures;
  `fmt/mod.rs` is inside a `feature!`-gated module. These remain documented gaps.
- `raft` adds a head-only interface with one dispatch call and one captured
  implementation.

## Product changes in this batch

1. **Local accessor declarations and generic field receivers (Rust v8).** The
   extractor now records trait method return hints, substitutes impl arguments
   into those hints, and uses them for `self.as_ref()/borrow()/deref()` only when
   the declaration is captured locally. It also records `Deref::Target`, trusts
   only std/core/alloc paths or prelude aliases for `Box`/`Arc`/`Rc`, and falls
   back to unknown otherwise. This removes the stage-1 wrong target where a
   local `AsRef<T>` returning `&Other` made `self.as_ref().enabled()` point at
   `First::enabled` although rustc dispatches `Other::enabled`.
2. **Generic field substitution, defaults and unsupported declarations.**
   Impl where-clause bounds and default type parameters are recorded. Structs
   whose declaration parameters cannot be modelled (defaults, where clauses,
   lifetimes) still expose their fields through `Binding::Fields`, so
   `HeaderMap<T = u8>` and `Layered<L, I, S = I>` field receivers resolve.
   Tuple-variant bindings (`match self { Some(inner) => ... }`) and inherent
   methods on defaulted owners also resolve. Direct-caller kind now distinguishes
   `function`, `method`, and `trait-default-method`.
3. **Go interface evidence across external embeddings (Go v4).** `interfaceComplete`
   no longer rejects an interface because it embeds an external named interface.
   go/types still proves the implementation relation; the edge names the external
   package and method, and the query emits a candidate at each unresolved call
   site with no target and an explicit reason. Evidence model is
   `captured-interface-implementations-v2`.
4. **Query coverage gates.** The v4/v8 models are accepted by the shared
   semantics, call-question and change-question gates. The schema accepts
   external interface edges and the `go-interface-external-method` reason.

`docs/GO.md` and `docs/RUST.md` describe the supported and unsupported cases.

## Scoring contract and counterexamples

All runs go through one `score_case(case, query)` entry. The counterexample pass
mutates the full query saved under `<out>/queries`, then sends the mutated query
back through the same entry. Each full run checks:

- deleting a required target;
- moving a declaration to a wrong line;
- adding an extra call;
- duplicating an existing call;
- changing a direct caller;
- promoting a candidate to a determined target;
- omitting an absent `target.file`;
- omitting optional end coordinates.

Results outside the expected list are split into `proven-error` (for example a
duplicate record or an unresolved record carrying a target) and
`needs-source-review`; only proven errors fail the case. The baseline run
executed 104 checks; 102 passed. The two exceptions are the `omit-target-file`
and `omit-end-position` preservation checks on the one Ripgrep item that was
already `wrong` before mutation, so their status could not change and the check
is not discriminative there. The candidate run executed 136 checks, all passed,
with every kind covered (`evidence/stage2-{baseline,final}/counterexamples.json`).

## Results (same 20 questions on both revisions)

| Scope | Definitions | Expected | Found | Wrong | Missed | Extras |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline `ac36a4ab0` (v7/v3) | 20/20 | 86 | 66 | 1 | 20 | 0 |
| Candidate (v8/v4) | 20/20 | 86 | 78 | 0 | 8 | 2 |

| Slice | Baseline found/wrong/missed | Candidate found/wrong/missed/extras |
| --- | --- | --- |
| Go (10 cases) | 57/0/5 | 62/0/0 |
| Rust (10 cases) | 9/1/15 | 16/0/8, plus 2 extras |
| New (14 cases) | 47/1/18 | 58/0/7, plus 1 extra |
| Regression (2 cases) | 4/0/1 | 5/0/0, plus 1 extra |
| Reserved Go (2 cases) | 14/0/0 | 14/0/0 |
| Reserved Rust (2 cases) | 1/0/1 | 1/0/1 |

The baseline's only wrong target is the Ripgrep direct caller: it reported the
enclosing function for a call that `rustc` attributes to an inherent method
(`types.rs:275`, caller kind `method`). The candidate reports the method.

Target mix across the batch is 18 determined, 63 candidate and 5 unknown.
The baseline displayed 15 determined, 51 candidate and 0 unknown; the candidate
displayed 16 determined, 57 candidate and 5 unknown. No interface or trait
candidate is presented as a definite implementation; every candidate carries
`runtimeTarget: "not-determined"`.

Per-case details are in `evidence/comparison/comparison.{md,json}`.

### Extra results, judged against source

The two `needs-source-review` results are real call sites that the frozen answer
keys omitted, not false targets:

- `base64` `src/read/decoder.rs:146`–`152`: `DecoderReader<'e, E: Engine, R>`
  calls `self.engine.internal_decode(...)` inside `decode_to_buf`. `E: Engine`
  makes this a real call through the changed trait method.
- `tracing` `tracing-subscriber/src/layer/layered.rs:295`: the
  `Layer<S> for Layered<A, B, S>` default forwarding method calls
  `self.inner.event_enabled(event, ctx)`, where `inner: B` and `B: Layer<S>`.
  It is the symmetric inner call next to the keyed `self.layer` call at line 293.

Both stay outside `expectedCalls` so the frozen keys remain comparable; they are
recorded here as answer-key omissions, and the scored extras are therefore 0
proven wrong targets.

### Remaining misses (8)

| Case | Missed | Cause |
| --- | ---: | --- |
| `clap-any-value-parser` | 1 | call through type-erased `AnyValueParser` (`any_value_parser()`), no captured concrete owner |
| `clap-typed-value-parser` | 1 | call is an argument of `ok!(...)` inside a forwarding impl |
| `bytes-try-get-int` | 2 | calls from the native-endian default method and the `&mut B` forwarding impl are not attributed to the concrete target |
| `tracing-layer-event-enabled` | 3 | `macro_rules! layer_impl_body` body, closure over a `Vec<L>` element, and `try_lock!` in `reload.rs` |
| `tracing-subscriber-event-enabled` | 1 | `fmt/mod.rs:402` is inside a `feature!`-gated module |

No remaining miss produces a wrong target; each is an unresolved or absent
record.

### Wrong-target counterexample (local `AsRef`)

`fixtures/rust-local-asref` is a cargo-checkable pair. It declares a local
`trait AsRef<T>` whose `as_ref` returns `&Other`, implements `AsRef<First> for
Wrap`, and calls `self.as_ref().enabled()` and `w.as_ref().enabled()`. The test
proves that `rustc` dispatches both calls to `Other::enabled` (line 11).

| Query on the fixture pair | Baseline `ac36a4ab0` | Candidate |
| --- | --- | --- |
| change `Other::enabled` | 0 references (both real calls missed) | 2 references: `src/lib.rs:32:9` and `37:5` → `Other::enabled:11` |
| change `First::enabled` | 1 false reference: `src/lib.rs:32:9` → `First::enabled:5` | 0 references |

The baseline's false reference is the wrong path a reader would follow: the local
trait argument `First` looks like the target although the declared return type is
`Other`. The candidate resolves the declaration and never points at `First`.
`fixtures/rust-local-asref/head-first` is the second head used above. Output is
under `evidence/asref-local/{baseline,candidate}`.


## Verification

```sh
# module tests
cd archify && node --test modules/code-analysis/test/*.test.mjs

# the local AsRef wrong-target counterexample, normal CLI
node archify/bin/archify.mjs code-analysis task \
  --question "Wrap's local as_ref returns &Other. Which calls reach Other::enabled?" \
  --base-root benchmarks/code-analysis-go-rust-investigation-batch-20261108/fixtures/rust-local-asref/base \
  --root     benchmarks/code-analysis-go-rust-investigation-batch-20261108/fixtures/rust-local-asref/head \
  --entry src/lib.rs --format json --out /tmp/asref-local.json

# one real question, normal CLI
node archify/bin/archify.mjs code-analysis task \
  --question "Bytes::truncate now releases a shared reference when called with zero. Which source calls reach this method?" \
  --base-root /private/tmp/archify-batch-20261108/samples/bytes-truncate-zero-base \
  --root     /private/tmp/archify-batch-20261108/samples/bytes-truncate-zero-head \
  --entry src/bytes.rs --format json --out /tmp/bytes-truncate.json

# full batch (reserved included) and its counterexample pass
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/run.py \
  --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out benchmarks/code-analysis-go-rust-investigation-batch-20261108/evidence/stage2-final \
  --include-reserved

# rescore the saved queries without re-running the CLI
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/run.py \
  --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out benchmarks/code-analysis-go-rust-investigation-batch-20261108/evidence/stage2-final \
  --include-reserved --saved

# baseline vs candidate report
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/compare.py \
  --baseline-dir evidence/stage2-baseline \
  --candidate-dir evidence/stage2-final \
  --out evidence/comparison
```

Each sample root is a `git worktree` at the fixed base or head commit. `clap`,
`tracing`, `ripgrep` and `bytes` roots were read with a generated `Cargo.lock`
because the extractor uses `--locked`; no project build or test was executed. Go
roots were read with Go 1.27.2, default `GOOS/GOARCH`, cgo disabled.

## ZIP replay

The final ZIP (`/tmp/archify-stage2.zip`, SHA256
`5b3ee9f516b19c20004b36f32313f3650a820a446e6ca9d9907f89cb7e18e58e`, built with
official Node 22 and bundled zlib `1.3.1-e00f703`) was unpacked into a fresh
directory, its module dependencies were installed with `npm ci`, and four queries
were replayed with the ZIP's own CLI. Reported identities were
`rust-syn@2.0.119` / revision 8 / `rust-source-direct-v8` and
`go-parser@1.27.2` / revision 6 / `go-source-direct-v4`.

| Replay | Result |
| --- | --- |
| AsRef fixture | `Other::enabled` at `src/lib.rs:11`; 2 references (`32:9`, `37:5`); 0 false `First` targets |
| `gin-hijack` | `*responseWriter.Hijack` at `response_writer.go:111`; 3 interface candidates, no concrete target |
| `echo-remove-custom-method` | `*routeMethods.set` at `router.go:226`; call `860:2`, caller `setHandler`, determined |
| `tracing-subscriber-event-enabled` | unpaired definition at `subscriber.rs:305`; 4 trait-method references; `fmt/mod.rs:402` missing as documented |

Query JSON, stderr and the full comparison are under `evidence/stage2-replay`.
The ZIP itself is not committed; rebuild it with `scripts/build-zip.sh` under the
canonical Node 22 toolchain.

## Uninvolved reader check

Two readers who had not seen the answer keys ran the normal candidate CLI and
verified coordinates against source. Full reports are in `evidence/readers`.

- Go, `echo-remove-custom-method` (reserved): definition `router.go:226`, direct
  call `router.go:860:2` with caller `(*node).setHandler:859` (method),
  determined `go-direct-method`. The reader reproduced the frozen key exactly and
  noted that the nil-producing `Remove` path at `router.go:446` is an indirect
  caller the reference list does not expand.
- Rust, `bytes-truncate-zero` (reserved): definition `src/bytes.rs:569`, call
  `src/bytes.rs:599:9` with caller `Bytes::clear:598` (method),
  `rust-inherent-source-candidate`. The reader reproduced the frozen key exactly
  and used `languageScope.excludedFiles` to explain why test calls are outside
  the capture profile.

Both readers found the key output in
`changedDefinitions.items[0].head.knownReferences.items[*].fact`; neither
reported a misleading target.

## Change groups

Eleven new base/head groups plus two regression groups (questions from one pair
count once):

| Group | Cases |
| --- | --- |
| certmagic `16c9db14`→`1a2275d5` | `certmagic-load`, `certmagic-store` |
| certmagic `2d114193`→`9a56fcd4` | `certmagic-interface`, `certmagic-interface-load` |
| gin `8d0468f7`→`d75fcd4c` | `gin-close`, `gin-hijack` |
| clap `b55ebc9f`→`67202405` | `clap-any-value-parser`, `clap-typed-value-parser` |
| tracing `d3eb109e`→`f42e7e6d` | `tracing-layer-event-enabled`, `tracing-subscriber-event-enabled` |
| raft `d3c91249`→`a2e87783` | `raft-stage-commit-index` |
| cobra `f2878bab`→`746ef071` | `cobra-get-completions` |
| echo `4f7bea5d`→`29682401` | `echo-remove-custom-method` |
| cli `d854bb40`→`ca8f45a9` | `cli-wrap-line` |
| ripgrep `4c2362d3`→`7155f640` | `ripgrep-file-name` |
| ripgrep `1752fb78`→`6892bc2b` | `ripgrep-parent-key` |
| bytes `002df10b`→`d5c8ad32` | `bytes-truncate-zero` |
| bytes `d5c8ad32`→`7930d93d` | `bytes-try-get-int` |
| http `c6af28b`→`3dd9f5e` | `http-insert-occupied-mult` (regression) |
| rust-base64 `a8a60f43`→`9e9c7abe` | `base64-inner-decode` (regression) |

## Attribution

Benchmark design, scoring, extractor/query changes and tests were written in this
session on top of the team baselines above. Upstream sample repositories and
commits are the work of their maintainers.

## Evidence layout

`evidence/stage2-baseline` is the same 20 questions at `ac36a4ab0`.
`evidence/stage2-final` is the authoritative candidate run.
`evidence/comparison` holds the per-case baseline/candidate report.
`evidence/asref` holds the local AsRef counterexample's question output and raw
extractor facts. `evidence/stage2-replay` holds the fresh-ZIP replay, and
`evidence/readers` holds the independent reader transcripts. Each run contains
the full query JSON, the exact command and stderr per case, `summary.json` and
`counterexamples.json`; the runner does not truncate the query JSON.
