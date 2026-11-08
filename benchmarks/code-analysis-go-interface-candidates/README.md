# Go change investigation: interface-mediated candidate call sites

This study evaluates one change to the normal Go change investigation: when a
concrete method changes, the result now keeps the direct calls and adds the
interface-mediated call sites that may dispatch to it. Each candidate names the
interface method declaration, the satisfying type and method, the type's value
and pointer method-set status, and the other captured implementations. The
runtime receiver is always marked **not determined**.

Baseline is #1284 at `59f1a8005` (`codex/code-analysis-go-gopls-eval`), which
already binds interface calls to captured interface declarations but does not
attach them to a changed concrete method. The candidate adds capture-time
interface implementation edges and change-question candidates. It does not
change direct-call binding.

## Questions and fixed commits

| Question | Repository | Base | Head | Changed definition | Interface declaration |
| --- | --- | --- | --- | --- | --- |
| A | labstack/echo | `fa780cd` | `ebbb855` | `(*context).RealIP` (`context.go:298`) | `Context.RealIP` (`context.go:46:2`) |
| B | prometheus/client_golang | `7c438e9` | `8f7c887` | `(*Registry).Gather` (`registry.go:455`) | `Gatherer.Gather` (`registry.go:173:2`) |
| C | spf13/afero | `effad5e` | `8d2a95c` | `(*RegexpFs).OpenFile` (`regexpfs.go:118`) | `Fs.OpenFile` (`afero.go:74:2`) |

Afero did not participate in the existing Go rule design. Its change allows
`OpenFile` to create a matching missing file when `O_CREATE` is set. The
source-first expectations, including the two special interface cases, were
recorded in [expectations.md](expectations.md) before implementation.

Build scope: root module only, Darwin/arm64, cgo disabled, no custom tags, tests
included, Go `1.27.2`, gopls `v0.24.0`. Afero's `sftpfs/` and `gcsfs/` are nested
modules and are not loaded.

## How to reproduce

```sh
# preserved checkouts at the fixed commits
#   echo-base/echo-head, client-base/client-head, afero-base/afero-head
python3 benchmarks/code-analysis-go-interface-candidates/run.py \
  --candidate-cli archify/modules/code-analysis/bin/task.mjs \
  --baseline-cli <baseline-59f1a8005>/archify/modules/code-analysis/bin/task.mjs \
  --samples <preserved-snapshots> \
  --gopls <gopls-0.24.0> \
  --out <runs>/interface-candidates
```

The script runs the same paired question with the baseline and candidate
CLIs, checks the source checkout and CLI snapshot revisions, and then classifies
every direct and candidate position against the fixed source answer. A position
matches only when the call site and its target agree on four fields: repository
version, target file, declaration anchor and owning type. `evidence/summary.json`
is its normal output; [`identity-recheck.md`](identity-recheck.md) itemizes the
previous round's 15 candidates and all displayed direct calls. Positions are
repository-relative; gopls is an oracle only and is not a product dependency.

The source checkouts passed to `--samples` must expose their Git identity: a
normal checkout, a worktree, or a `.source-commit` file containing the full
commit hash. Checking out Afero inside the Archify worktree without its own
`.git` would otherwise attribute the capture to the Archify revision.

## Negative control

The grader mutates one real client candidate, `prometheus/graphite/bridge.go:171`,
from `Gatherer.Gather` (`prometheus/registry.go:173:2`, owner `Gatherer`) to the
same-named `TransactionalGatherer.Gather` (`prometheus/registry.go:1180:2`,
owner `TransactionalGatherer`). The target name stays `Gather`; the declaration
and owning type change. The run fails unless the scorer reports the mismatch.
Separate controls mutate the target file, declaration line, owning type and
repository version; each must be detected independently.

Current result: the same-named swap is detected on declaration, owner
declaration, owning type and qualname; all four field controls are detected.
The negative control is part of the normal run, not an optional check.

## Results

The candidate keeps every direct binding and adds the interface candidates.
`total` is the complete bounded list size; `included` and `omitted` show the
normal 40-item display bound.

| Study | Direct before | Direct after | Interface candidates | Wrong | Missed | Identity wrong | Reasonable unknown |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| A `RealIP` | 3 | 3 | 6 | 0 | 0 | 0 | 0 |
| B `Registry.Gather` | 47 | 47 (40 listed, 7 omitted) | 9 | 0 | 0 | 0 | 0 |
| C `RegexpFs.OpenFile` | 0 | 0 | 38 | 0 | 0 | 0 | 0 |

All 6 Echo positions, all 9 client positions, and all 38 afero positions are
the source-expected calls and carry the expected repository version, target
file, declaration anchor and owning type. The seven omitted client direct
positions are not missing bindings: `knownReferences.total` remains 47 while the
display bound shows 40. The complete position lists are in
`evidence/summary.json` and [expectations.md](expectations.md); the per-item
identity tables are in [identity-recheck.md](identity-recheck.md).

### What a candidate carries

Echo, `client_ip_security_test.go:37`:

```text
call site → Context.RealIP (context.go:46:2) → *context.RealIP (context.go:298)
```

`Context` is satisfied only by `*context` (the value `context` does not
implement it). The call is a candidate because its static receiver is
`echo.Context`; the runtime target is not determined.

Client, `prometheus/graphite/bridge.go:171`:

```text
call site → Gatherer.Gather (registry.go:173) → *Registry.Gather (registry.go:455)
             other captured implementations: GathererFunc, Gatherers
```

The nine positions are exactly the calls whose static receiver is
`prometheus.Gatherer`. Calls through `TransactionalGatherer`, or direct calls
to `Gatherers.Gather`/`GathererFunc.Gather`, are not candidates for
`*Registry.Gather`.

Afero, `afero_test.go:88`:

```text
call site → Fs.OpenFile (afero.go:74:2) → *RegexpFs.OpenFile (regexpfs.go:118)
             other captured implementations: MemMapFs, OsFs, BasePathFs,
             ReadOnlyFs, CacheOnReadFs, CopyOnWriteFs, FromIOFS, zipfs.Fs,
             tarfs.Fs, optionalIfaceFs, plus promoted wrappers
```

Afero has no direct `*RegexpFs.OpenFile` calls. The 38 candidates are 36 calls
whose static receiver is `Fs` plus two calls on `*afero.Afero`, whose `Fs` field
supplies the promoted `OpenFile` (`receiverPromotion: embedded-interface`).

### T vs \*T, same-name non-implementations, and duplicates

- `context` methods use pointer receivers: `*context` satisfies `Context`,
  `context` does not. Direct calls on an addressable value remain direct; they
  are not relabelled as interface calls.
- `RegexpFs` and `MemMapFs` both satisfy `Fs`. `RegexpFs` and the other
  pointer-receiver implementations are marked `valueSatisfies: false`,
  `pointerSatisfies: true`; `OsFs` and `FromIOFS` are marked as value-and-pointer
  implementations.
- `HttpFs` has `OpenFile(name string, flag int, perm os.FileMode) (File, error)`
  but its `Open` returns `(http.File, error)`, so the whole type does not
  implement `Fs`. `HttpFs.OpenFile` is absent from the implementation set even
  though the method spelling and its own signature match. gopls's
  `implementation` result agrees (it lists 11 concrete methods, not `HttpFs`).
- `Afero` and `regexpStatErrorFs` embed an `Fs` field. They satisfy the
  interface, but their `OpenFile` is promoted from the interface field rather
  than a captured body. They are reported as
  `reason: promoted-interface-method`, with no concrete method attributed.
- Every candidate is deduplicated by snapshot and call fact. A call is listed
  once even when the same changed method implements more than one interface;
  sibling interfaces with different declarations are kept separate.

## gopls comparison

gopls is used only as an independent oracle. It resolves the whole module graph;
Archify reads captured source with incomplete third-party typing.

| Study | gopls concrete refs | direct + candidates | gopls interface refs | interface-only extras | gopls implementations | captured concrete methods |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 9 | 3 + 6 = 9 | 9 | 0 | 1 | 1 |
| B | 56 | 47 + 9 = 56 | 61 | 5 | 3 | 3 |
| C | 38 | 0 + 38 = 38 | 41 | 3 | 11 | 11 |

- The concrete-reference count and all displayed positions agree in every
  study. For B, the seven undisplayed direct positions are still counted in the
  total; gopls confirms the complete 56.
- Interface-method references are broader than static interface calls. The five
  B extras are direct calls to `Gatherers.Gather` and `GathererFunc.Gather`
  (`examples_test.go:621,650`, `push/push.go:270`, `registry_test.go:1593,1759`).
  The three C extras are direct calls to `*CopyOnWriteFs`/`*MemMapFs`
  (`copyOnWriteFs.go:331`, `memmap_test.go:1083,1105`). They are not interface
  receivers and correctly remain outside the candidate list.
- The Afero implementation set has 11 concrete methods in gopls and in the
  captured edges, plus two promoted interface-field wrappers. `HttpFs` is in
  neither. No gopls-only concrete implementation was found.
- `gopls` was not added as a dependency. The built-in analyzer still uses only
  the Go helper and no language-server process.

## Unknowns and remaining misses

- The edge set covers named source types and complete captured interfaces.
  Interfaces with external or anonymous embedded interfaces, generic interfaces,
  generic concrete types and type aliases are omitted and counted in
  `interfaceEvidence`
  (`B`: one `delegator` interface with an external embed; `C`: `File` with
  `io` embeds). Absence of an edge is unknown, not proof of non-implementation.
- Runtime assignment is not analyzed. Every interface-typed call is a candidate,
  including calls whose local value is known to be a different implementation.
  The output never claims a definite runtime caller; `runtimeTarget` is always
  `not-determined`.
- Function variables, uncaptured third-party method bodies, anonymous interfaces
  and type-parameter receivers remain outside candidate coverage.
- A capture made before this change (no `interfaceImplementations` or
  `interfaceEvidence`) displays `coverage: unavailable`, `total: null`, and the
  direct references that were already captured. It is not shown as zero
  candidates. The change question also reports
  `interface-implementation-evidence-unavailable` for that side.

## Validation states

- Local source tests: `npm test` 19/19; code-analysis suite 424/424 with zero
  skips. The focused Go suite covers the new candidate paths.
- Source CLI: `run.py` exits 0 for A/B/C with the source-first direct and
  candidate lists; wrong = 0, missed = 0, no duplicate candidate.
- Identity recheck: every displayed direct call and all 15 previous-round
  candidates match the source repository version, target file, declaration and
  owning type; `identity-recheck.md` lists them individually. The same-named
  swap and all four field controls are rejected by the scorer.
- The unpacked `archify.zip` (SHA256
  `835c60ed21a21b16cf2be50528f24c07644539cf039be6dc56804143fd6a53de`)
  produces a byte-identical normalized `summary.json` to the source CLI for all
  three studies. The extracted tree needs the normal Code Analysis dependencies
  installed; the ZIP itself does not vendor them.
- Final remote CI status is recorded on the Draft PR after the final push. This
  report does not claim a merge, release or live installation.

## Acceptance

- Source-first lists: all 3 + 47 + 0 direct references are preserved; all
  6 + 9 + 38 interface candidates are present; wrong = 0, missed = 0.
- Every displayed position and all 15 previous-round candidates carry the
  expected source identity; the same-named interface-method swap is rejected.
- Direct and candidate positions are distinct; no duplicate candidate was
  observed. `HttpFs`, `TransactionalGatherer`, and same-named wrong-signature
  methods are not linked.
- `run.py` exits 0 with the source CLI and the gopls oracle.
- The unit suite covers the same cases, including T/\*T flags, sibling
  interfaces, embedded-interface wrappers, package tests and the old-snapshot
  unavailable path.
- Decision input: continue improving the built-in parser. The change attaches
  interface-mediated candidates with method-set evidence and keeps runtime
  identity separate; adopting gopls is not required for this question.
