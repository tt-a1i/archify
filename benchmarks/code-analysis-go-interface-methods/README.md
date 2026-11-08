# Go interface method declaration anchors

This study evaluates one additive Go binding: an interface-typed method call now targets the captured interface method declaration, while the runtime implementation stays unknown. Baseline is candidate #1283 commit `0c81af0ea` (`codex/code-analysis-labs-integration-review-20261108`). Work branch: `codex/code-analysis-go-gopls-eval`.

## Questions and fixed commits

Neither repository appears in the existing Go method benchmarks (cobra, chi, grpc-go).

| Question | Repository | Base | Head | Changed definition |
| --- | --- | --- | --- | --- |
| A: client IP after the v4 security fix | labstack/echo | `fa780cd` | `ebbb855` (`origin/v4`) | `*context.RealIP` (`context.go:298`); interface declaration `Context.RealIP` (`context.go:46`) already existed |
| B: registry cleanup | prometheus/client_golang | `7c438e9` | `8f7c887` | `(*Registry).Gather` (`prometheus/registry.go:455`); interface `Gatherer.Gather` (`prometheus/registry.go:173`) |

Source-first expectations were recorded before measurement. For A, `Context` is still an interface; six interface-typed call sites were expected, plus three direct `*context` calls. For B, `Registry.Gather` is reached through `prometheus.Gatherer` in graphite, testutil, promhttp and registry code, plus direct `*Registry` calls. Function variables, type-parameter receivers and uncaptured external bodies were expected to remain unknown.

Build scope: root module only, Darwin/arm64, cgo disabled, no custom tags, tests included. Go `1.27.2`; gopls `v0.24.0` built with the same toolchain. The Go helper uses incomplete source typing and never builds the project; gopls loads the module graph independently.

## How to reproduce

Capture the baseline with the unmodified candidate and the head with this branch; the adapter revision changed from 3 to 4, so captures cannot be mixed.

```sh
# preserved checkouts at the fixed commits
git clone https://github.com/labstack/echo && git -C echo checkout ebbb855
git clone https://github.com/prometheus/client_golang && git -C client_golang checkout 8f7c887

# baseline worktree at 0c81af0ea, fixed worktree at the review branch
node <baseline>/archify/modules/code-analysis/bin/check.mjs echo --language go --out runs/baseline/echo --fail-on never --json
node <fixed>/archify/modules/code-analysis/bin/check.mjs echo --language go --out runs/fixed/echo --fail-on never --json

gopls references echo/context.go:46:2 > runs/echo-refs.txt
gopls references client_golang/prometheus/registry.go:455:20 > runs/client-refs.txt

node benchmarks/code-analysis-go-interface-methods/compare.mjs runs/echo-refs.txt "$PWD/echo" runs/baseline/echo/raw-facts.json runs/fixed/echo/raw-facts.json
```

`run.py` automates the same steps for both repositories and writes `summary.json` plus one JSON per repository. gopls and both CLI entrypoints are explicit arguments; nothing is guessed. The checked-in `evidence/summary.json` is its output, with the local checkout paths replaced by the fixed commits.

## Per-reference results

Each gopls reference is matched to the innermost captured call range containing the method identifier, then classified against the declaration targets that gopls itself reports.

| Question | Ref set | Before correct / wrong / missed / unknown | After correct / wrong / missed / unknown |
| --- | ---: | --- | --- |
| A `RealIP` | 9 | 3 / 0 / 6 / 0 | 9 / 0 / 0 / 0 |
| B `Registry.Gather` | 56 | 47 / 0 / 9 / 0 | 56 / 0 / 0 / 0 |

New correct call-site targets: 6 (A) and 9 (B), all six/nine previously recorded as `go-method-dispatch`. Existing correct targets gaining no extra evidence: 3 (A) and 47 (B); they already resolved to the concrete methods and are unchanged. No target changed to a different declaration, so wrong count stays 0.

Repo-wide effect, from the same captures:

| Repository | Calls | `go-interface-method` calls | Captured `InterfaceMethod` records | Declarations reached | Unresolved before → after |
| --- | ---: | ---: | ---: | ---: | --- |
| echo head | 11,019 | 734 | 98 | 68 | 7,685 → 6,951 |
| client_golang head | 9,435 | 501 | 70 | 46 | 6,883 → 6,382 |

Every new target matched a captured `InterfaceMethod` record (0 unmatched). Existing `go-direct-function` and `go-direct-method` counts are byte-for-byte unchanged.

## Interface case

- A: gopls `definition` on either the interface call or the declaration reaches `context.go:46:2 RealIP`; `gopls implementation` finds `*context.RealIP` at `context.go:298:19`. Archify now reaches the same declaration for the six interface calls; the three direct calls still reach `context.go:298`. The runtime implementation is not asserted.
- B: gopls references on `Gatherer.Gather` return 61 positions (all implementations), while references on `Registry.Gather` return 56 (nine interface-mediated plus 47 direct). Archify binds the nine interface-mediated sites to `registry.go:173` and the 47 direct sites to `registry.go:455`; it does not choose among other `Gatherer` implementations. `TransactionalGatherer.Gather` (`registry.go:1180`) is a separate captured declaration.
- Interface calls still cannot determine the runtime target, and calls through uncaptured interfaces or type-parameter constraints remain unknown by design.

## Remaining miss

A paired change question still keys changed definitions to body-bearing `FuncDecl` records. On question A the changed concrete `*context.RealIP` reports the same 3 direct callers before and after; the six interface callers are visible from the interface declaration but are not attached to the implementation. On B the changed `*Registry.Gather` reports 47 of the 56 gopls references. Closing that gap needs captured interface-to-implementation edges or gopls method-set references; name matching alone would be wrong when several implementations exist.

## gopls trial

Used only as a comparison oracle; not added as a product dependency.

- Cold first reference load on client_golang: 8.08s; warm runs 0.3–0.5s. Echo was already warm.
- Extra dependency: a 41 MiB gopls binary plus a Go toolchain and a resolvable module graph. Archify's built-in analysis still needs only its Go helper.
- Broken workspace probe: gopls prints `gopls: <file>:<line>:<col>: can't find non-Go definition of Broken` and exits 0 with no result; a failed package load is therefore easy to mistake for "no definition" unless stderr is checked.

## Acceptance

- Unpacked ZIPs of the preserved commits (`git archive ebbb855`, `8f7c887`) produce identical call totals and resolution counts, including 734 and 501 interface bindings.
- `node --test archify/modules/code-analysis/test/*.test.mjs`: 417/417 pass on the fixed branch.
- Decision input: keep improving the built-in parser. The next step is implementation edges for changed concrete methods, not adopting gopls. No PR merge, no `labs/code-analysis` update, and no live installation in this round.
