# Source-first expectations

Recorded before implementation, from the fixed source commits only. The candidate
changes no call binding; it adds interface-mediated candidate call sites to the
change investigation. All expectations below are about **candidates**, not
definite runtime callers.

## Fixed scope

| Study | Repository | Base | Head | Entry | Changed definition |
| --- | --- | --- | --- | --- | --- |
| A | labstack/echo | `fa780cd` | `ebbb855` | `context.go` | `(*context).RealIP` |
| B | prometheus/client_golang | `7c438e9` | `8f7c887` | `prometheus/registry.go` | `(*Registry).Gather` |
| C | spf13/afero | `effad5e` | `8d2a95c` | `regexpfs.go` | `(*RegexpFs).OpenFile` |

Build scope for all three: root module only, Darwin/arm64, cgo disabled, no
custom tags, tests included, Go `1.27.2`, gopls `v0.24.0`. Afero's `sftpfs/` and
`gcsfs/` are nested modules and are not loaded. Echo and client_golang were used
by the earlier interface-anchor study; they are known samples. Afero did not
participate in any Go rule design.

## Source identity answer

Acceptance uses these source-derived identities, not only `file:line` positions.
A direct call targets the changed concrete method; a candidate targets the named
interface method. The declaration anchor is the call-target anchor emitted by
the analyzer: the `FuncDecl` start for a direct call, the interface method line's
indentation for a candidate. The method-name column is recorded separately where
it differs.

| Study | Base commit | Head commit | Target file | Direct declaration | Interface declaration | Owning type |
| --- | --- | --- | --- | --- | --- | --- |
| A | `fa780cdfb02db0c263e3b4212ea8d6afa31e976c` | `ebbb855f5827b76fb206e267dd91d020000baf66` | `context.go` | `context.go:298:1` (`*context.RealIP`; name column 19) | `context.go:46:2` (`Context.RealIP`) | `context` / `Context` (`context.go:20:6`) |
| B | `7c438e9a9bf011d011836bc6431bf824b82f17c2` | `8f7c8876630bc7308740fea042ddc10b9963af54` | `prometheus/registry.go` | `prometheus/registry.go:455:1` (`*Registry.Gather`; name column 20) | `prometheus/registry.go:173:2` (`Gatherer.Gather`) | `Registry` / `Gatherer` (`prometheus/registry.go:153:6`) |
| C | `effad5ec7dbd98364d26fd13f32761f56d9d7857` | `8d2a95c25179002d8b1a94a2a613c71ae698332c` | `regexpfs.go` | `regexpfs.go:118:1` (`*RegexpFs.OpenFile`; name column 20) | `afero.go:74:2` (`Fs.OpenFile`) | `RegexpFs` / `Fs` (`afero.go:57:6`) |

The analyzer omits `target.file` when the target is in the call's own file. The
grader resolves that omission to the call file before comparing the target file;
it does not treat the omission as a different file.

The negative control is a source-grounded same-named swap: client candidate
`prometheus/graphite/bridge.go:171` changes from `Gatherer.Gather`
(`prometheus/registry.go:173:2`, owner `Gatherer` at `153:6`) to
`TransactionalGatherer.Gather` (`prometheus/registry.go:1180:2`, owner
`TransactionalGatherer` at `1158:6`). The declaration and owning type differ even
though the method name is the same. The grader must report the mismatch, and
separate controls must reject a changed target file, declaration, owning type or
repository version.

## A. Echo `(*context).RealIP`

Interface: `Context` (`context.go:20`), declaration anchor `Context.RealIP`
(`context.go:46:2`). `context` methods use pointer receivers, so `*context`
implements `Context`; a `context` value does not.

Expected direct references (3):

- `client_ip_security_test.go:38` — `(&context{...}).RealIP()`
- `context_test.go:81` — addressable `context` value; direct call
- `context_test.go:1306` — `&context{...}`

Expected interface-mediated candidates (6), all with static receiver
`echo.Context`:

- `client_ip_security_test.go:37` — `NewContext(...)` returns `Context`
- `client_ip_security_test.go:51` — `NewContext(...)` returns `Context`
- `middleware/logger.go:342` — handler parameter `c Context`
- `middleware/proxy.go:292` — handler parameter `c Context`
- `middleware/rate_limiter.go:51` — `IdentifierExtractor` parameter `ctx echo.Context`
- `middleware/request_logger.go:369` — handler parameter `c Context`

`middleware/rate_limiter.go:99` is inside a block comment and is not a call.
Every candidate must carry `Context` -> `*context.RealIP` and a
runtime-target-unknown marker. The three direct positions must remain direct
references, not be duplicated as candidates.

## B. client_golang `(*Registry).Gather`

Interface: `Gatherer` (`prometheus/registry.go:154`), declaration anchor
`Gatherer.Gather` (`prometheus/registry.go:173`). `Gatherer` is implemented by
`*Registry` and by captured alternatives such as `GathererFunc` and `Gatherers`.

Expected direct references: 47, all calls whose static receiver is `*Registry`.
Expected interface-mediated candidates (9), all with static receiver
`prometheus.Gatherer`:

- `prometheus/graphite/bridge.go:171`
- `prometheus/promhttp/http_test.go:81`
- `prometheus/promhttp/http_test.go:1382`
- `prometheus/registry.go:678`
- `prometheus/registry.go:843`
- `prometheus/registry.go:1194`
- `prometheus/testutil/lint.go:38`
- `prometheus/testutil/testutil.go:147`
- `prometheus/testutil/testutil.go:256`

Same-named non-implementing declarations that must not be treated as
`Gatherer`:

- `TransactionalGatherer.Gather` (`registry.go:1158`) returns
  `([]*dto.MetricFamily, func(), error)`, so a type satisfying it is not a
  `Gatherer`.
- Test doubles such as `syncGatherCounter.Gather` and
  `mockTransactionGatherer.Gather` have the same three-result shape.

Calls through `TransactionalGatherer` or through a method whose receiver is a
different interface must not appear as candidates for `Registry.Gather`.

## C. Afero `(*RegexpFs).OpenFile`

Change: a missing file may now be created by `OpenFile` when `O_CREATE` is set
and the name matches the filter. The interface declaration anchor is
`Fs.OpenFile` (`afero.go:74:2`).

Expected direct references to `(*RegexpFs).OpenFile`: **0**. Source inspection
found no call on a concrete `*RegexpFs`; all call sites use an `Fs`-typed
receiver.

Expected interface-mediated candidates (38), all reaching `Fs` either directly or
through an embedded `Fs` field:

- `httpFs.go:97`
- `afero_test.go:88`, `96`, `104`, `117`
- `memmap_test.go:85`, `123`, `131`, `151`, `225`, `298`, `657`, `684`, `1138`
- `basepath_test.go:267`
- `basepath.go:163`
- `regexpfs.go:128`
- `cacheOnReadFs.go:224`, `228`, `235`
- `composite_test.go:127`
- `ioutil.go:127`, `196`
- `copyOnWriteFs.go:218`, `230`, `238`, `248`, `250`
- `unionFile.go:330`
- `iofs_test.go:38`, `66`
- `basepath_copy_test.go:41`
- `readonlyfs.go:79`
- `regexpfs_test.go:54`, `89`, `118`
- `tarfs/tarfs_test.go:310`, `324` — calls on `*afero.Afero`, whose `Fs` field
  supplies the promoted `OpenFile`; these are interface-reaching candidates with
  `receiverPromotion: embedded-interface`

The `regexpfs_test.go` rows point to the call-expression start, not the
`OpenFile` selector line, matching the change-question coordinate convention.

Excluded concrete calls:

- `memmap_test.go:1083`, `1105` — receiver is `*MemMapFs`, not `Fs`
- `copyOnWriteFs.go:331` — receiver is `*CopyOnWriteFs`
- `os.go:65` — `os.OpenFile`, not `afero.Fs`

Two captured types that implement `Fs` and therefore demonstrate runtime
alternatives: `*RegexpFs` and `*MemMapFs` (also `OsFs`/`*OsFs`,
`*BasePathFs`, `*ReadOnlyFs`, `*CacheOnReadFs`, `*CopyOnWriteFs`,
`FromIOFS`, `zipfs.Fs`, `tarfs.Fs`, and test wrappers). The result must list
the changed `*RegexpFs` separately from the other implementations.

Same-named non-implementing type: `HttpFs` has
`OpenFile(name string, flag int, perm os.FileMode) (File, error)`, but its
`Open` returns `(http.File, error)`. It therefore does not implement `Fs`;
`HttpFs.OpenFile` must not appear in the `Fs.OpenFile` implementation set even
though the method name and its own signature match. Its body still calls
`h.source.OpenFile`, which is an `Fs` call and remains a candidate.

`Afero` and `regexpStatErrorFs` embed an `Fs` and satisfy the interface, but
their `OpenFile` is promoted from the embedded interface, not a captured
concrete body. They must be reported with an unknown concrete method, not
silently dropped or attributed to another body.

## Acceptance rules

- A candidate position is correct only when source shows its receiver is the
  named interface and the changed type's full method set satisfies that
  interface.
- A position is wrong if it is claimed as a definite runtime caller, if the
  receiver is a different interface, or if the listed implementation does not
  satisfy the whole interface (for example `HttpFs` for `Fs`).
- A missed position is any expected candidate absent from the result.
- Incomplete typing (external embedded interfaces, type parameters, generic
  types, uncaptured method bodies) stays explicitly unknown; it is not reported
  as "no implementations".
- gopls is an independent comparison only. Disagreements are recorded, not used
  to rewrite the source answer.
