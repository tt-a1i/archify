# Go/Rust change-investigation batch (2026-11-08)

Real upstream changes used to check how far the normal `archify code-analysis task`
paired question answers four questions: which definition changed, who directly
calls it, which calls only prove an interface/trait declaration, and where the
reader can verify the call in source.

Frozen answers live in `cases/*.json`. The runner only scores the CLI output; it
does not scan source itself. Every case records the fixed base/head commits, the
changed definition, exact expected call ranges, direct caller name/line/kind,
provable target, unknowns and the expected status (`pass` or a documented
`expectedGap`).

## Baselines and ancestry

| Line | Commit | Source |
| --- | --- | --- |
| Go baseline | `209f4857c` | #1285 accepted Go interface-candidate work |
| Rust baseline | `fef42b806596313b0e02974946a73ef377259c6d` | #1288 fixed commit |
| Batch baseline | `70bdf0227` | merge of the two lines (`origin/codex/go-rust-batch-baseline`) |
| Candidate | `codex/go-rust-investigation-batch` | this branch, based on `70bdf0227` |

Both lines are ancestors of this branch, so the batch reuses the existing merged
baseline instead of duplicating it. Work ran in independent `git worktree`
checkouts; the team commits (`2db340ee7`, `31b207957`, `cca4e8066`) remain in
history.

## Cases

Four repositories were not previously used for this evaluation: `caddyserver/certmagic`,
`gin-gonic/gin`, `clap-rs/clap`, `tokio-rs/tracing`. `marshallpierce/rust-base64`
is regression only.

| Case | Lang | Repo | Definition | Status |
| --- | --- | --- | --- | --- |
| `certmagic-store` | Go | certmagic `16c9db1`→`1a2275d` | `*FileStorage.Store` | pass |
| `certmagic-load` | Go | certmagic `16c9db1`→`1a2275d` | `*FileStorage.Load` | pass |
| `certmagic-interface` | Go | certmagic `2d11419`→`9a56fcd` | `Storage.Store` (interface) | pass |
| `certmagic-interface-load` | Go | certmagic `2d11419`→`9a56fcd` | `Storage.Load` (interface) | pass, **reserved** |
| `gin-close` | Go | gin `8d0468f`→`d75fcd4` | `*responseWriter.CloseNotify` | documented gap |
| `gin-hijack` | Go | gin `8d0468f`→`d75fcd4` | `*responseWriter.Hijack` | documented gap |
| `clap-any-value-parser` | Rust | clap `b55ebc9`→`6720240` | `AnyValueParser::parse_ref_` | documented gap |
| `clap-typed-value-parser` | Rust | clap `b55ebc9`→`6720240` | `TypedValueParser::parse_ref_` | documented gap, **reserved** |
| `tracing-subscriber-event-enabled` | Rust | tracing `d3eb109`→`f42e7e6` | `Subscriber::event_enabled` | documented gap |
| `tracing-layer-event-enabled` | Rust | tracing `d3eb109`→`f42e7e6` | `Layer::event_enabled` | documented gap |
| `base64-inner-decode` | Rust | rust-base64 `a8a60f4`→`9e9c7ab` | `GeneralPurpose::internal_decode` | pass, regression |

The reserved cases were frozen in `cca4e8066` before any candidate run and were
first executed after the rules were final (`evidence/reserved`). They produced no
rule change, so no replacement reserved case was needed.

Selection notes:

- The interface cases use `Storage.Load` as the reserved Go question and
  `Storage.Store` as an already-fixed regression, so the same upstream commit
  exercises both a fresh and a known path.
- `gin` `CloseNotify`/`Hijack` were kept although they return zero: the
  implementations come from external embedded `http.CloseNotifier`/`http.Hijacker`
  interfaces, which are outside source capture. They are documented gaps, not
  scorer failures.
- `clap` `parse_ref_` calls sit inside `ok!(...)` macro arguments. The extractor
  records the macro invocation as opaque, so these cases stay as expected gaps
  until macro arguments are modeled.
- `tracing` `layer/layered.rs` calls reach `Layer::event_enabled` through a field
  whose generic name differs between the struct and the impl
  (`inner: I` vs `Layered<L, S>`). That needs generic substitution and was left
  as a documented limit rather than a wider receiver-typing change.
- Already-used repositories (Echo, client_golang, Afero, bytes, log) were not
  selected for new questions; rust-base64 appears only as regression.

## Product changes in this batch

1. **Trait-default references.** A Rust default body is registered at its `fn`
   keyword, while trait-dispatch calls target the method name, so a changed
   default method showed no direct references. `change-question.mjs` now unions
   the definition key with the name-anchor keys from `facts.traits`. Trigger:
   `tracing` `dispatcher.rs:514` (`self.subscriber.event_enabled(event)`) now
   resolves to `Subscriber::event_enabled` at `subscriber.rs:305:8` with direct
   caller `event` at line 513. Negative control: a concrete impl call is resolved
   to the impl and must not appear as a trait-default reference.
2. **Field receiver typing.** The Rust extractor records named struct field type
   hints and the impl self type, then resolves `self.<field>` (and
   `self.as_ref()/deref()/borrow()`) to a trait bound or a unique nominal impl.
   Trigger: `test/rust-calls.test.mjs` fixtures produce
   `rust-trait-method-candidate` for a generic field and `rust-trait-impl` for a
   concrete field. Negative control: the concrete call must not be reported as a
   trait candidate.

`docs/GO.md` and `docs/RUST.md` describe the supported and unsupported cases.

## Verification

```sh
# module tests
cd archify && node --test modules/code-analysis/test/*.test.mjs

# one question, normal CLI
node archify/bin/archify.mjs code-analysis task \
  --question "Which callers reach it?" \
  --base-root /private/tmp/archify-batch-20261108/samples/certmagic-load-base \
  --root     /private/tmp/archify-batch-20261108/samples/certmagic-load-head \
  --entry filestorage.go --format json --out /tmp/certmagic-load.json

# full batch (reserved included)
python3 benchmarks/code-analysis-go-rust-investigation-batch-20261108/run.py \
  --cli archify/bin/archify.mjs \
  --samples /private/tmp/archify-batch-20261108/samples \
  --out benchmarks/code-analysis-go-rust-investigation-batch-20261108/evidence/final \
  --include-reserved
```

Each sample root is a `git worktree` at the fixed base or head commit. `clap` and
`tracing` roots were read with a generated `Cargo.lock` because the extractor uses
`--locked`; no project build or test was executed. Go roots were read with Go
1.27.2, default `GOOS/GOARCH`, cgo disabled. The code-analysis module suite passed
431/431 with 0 skips at this revision.

## Results (final candidate)

| Scope | Definitions found | Calls found | Wrong targets | Missed |
| --- | ---: | ---: | ---: | ---: |
| Whole batch (11 cases) | 11/11 | 55/72 | 0 | 17 |
| Go (6 cases) | 6/6 | 50/55 | 0 | 5 |
| Rust (5 cases) | 5/5 | 5/17 | 0 | 12 |
| Reserved (2 cases) | 2/2 | 13/14 | 0 | 1 |

Target mix across the whole batch: 5 determined targets, 62 candidate targets
(interface/trait declarations), 5 explicitly unknown. No interface or trait
candidate is presented as a definite implementation; every candidate carries
`runtimeTarget: "not-determined"`.

Before/after on the affected Rust questions (same fixed commits):

| Run | Definitions | Calls found |
| --- | ---: | ---: |
| Rust baseline `fef42b806` | 0/3 | 0/12 |
| After anchor fix + receiver typing | 4/4 | 5/16 |
| Final (includes base64 regression) | 5/5 | 5/17 |

The Go path was already correct for concrete and interface definitions at the
batch baseline: certmagic 20/20 and 12/12 concrete calls, 5/5 and 13/13 interface
calls. No regression occurred.

Documented gaps that remain (all counted as misses, none as wrong targets):
macro-argument calls (`clap`), external embedded interface implementations
(`gin`), and field receivers whose generic name changes between struct and impl
plus macro-produced receivers (`tracing` `layered.rs`, `fmt/mod.rs`).

## Uninvolved reader check

A reader that did not see the answer keys ran the normal CLI on two questions.

- Go, `certmagic-store`: found the changed `*FileStorage.Store`, 3 direct
  references, 9 interface candidates with implementation lists and
  `runtimeTarget: not-determined`; verified `filestorage_test.go:21:8` in source.
  It also noted that candidate columns point at the receiver start, not the
  method name.
- Rust, `tracing-subscriber-event-enabled`: found the definition as a head-only
  unpaired definition, 1 direct reference at `dispatcher.rs:514` with caller
  `event`, and 2 trait candidates, all `not-determined`. It reported the same
  misses recorded above (`layered.rs:145`, `fmt/mod.rs:402`).

Attribution: benchmark design, scoring, extractor/query changes and tests were
written in this session on top of the team baselines above. Upstream sample
repositories and commits are the work of their maintainers.

## Evidence layout

`evidence/final` is the authoritative run. The committed `summary.json` files
record the final run and the reserved-only run. Locally, every evidence directory
also contains the full query JSON, the exact command and stderr for each case;
those files are generated by the runner and are not committed because each
paired query is up to about 1 MB. Rerunning the command above reproduces them.
The runner does not truncate the query JSON.
