# Source-identity recheck

Generated from the fixed checkouts and the normal change-question output. A position
is accepted only when the call site and its target match the independent source
answer on four fields: repository version, target file, declaration anchor and
owning type. Direct calls and interface candidates are counted separately.

## Negative control: same-named interface-method swap

Call site `prometheus/graphite/bridge.go:171` was changed from `Gatherer.Gather` (`prometheus/registry.go:173:2`, owner `Gatherer`) to `TransactionalGatherer.Gather` (`prometheus/registry.go:1180:2`, owner `TransactionalGatherer`).

The scorer rejected the mutation:

| Field | Expected | Actual |
| --- | --- | --- |
| declaration | `prometheus/registry.go:173:2` | `prometheus/registry.go:1180:2` |
| ownerDeclaration | `prometheus/registry.go:153:6` | `prometheus/registry.go:1158:6` |
| ownerType | `Gatherer` | `TransactionalGatherer` |
| qualname | `Gatherer.Gather` | `TransactionalGatherer.Gather` |

Field controls also show that each criterion is independently enforced:

| Mutation | Expected field | Detected |
| --- | --- | --- |
| declaration | declaration | True |
| ownerType | ownerType | True |
| repositoryVersion | repositoryVersion | True |
| targetFile | targetFile | True |

All four controls and the same-named swap were detected. A same-named method is
therefore not sufficient to pass: the declaration and owning type must also match.

## Counts

| Study | Direct total | Direct displayed | Direct omitted | Interface candidates |
| --- | ---: | ---: | ---: | ---: |
| echo | 3 | 3 | 0 | 6 |
| client | 47 | 40 | 7 | 9 |
| afero | 0 | 0 | 0 | 38 |

## Previous round's 15 interface candidates

| # | Study | Call site | Repo version | Target file | Declaration | Owning type | Target | Verdict |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | echo | `client_ip_security_test.go:37` | `ebbb855` | `context.go` | `context.go:46:2` | `Context` | `Context.RealIP` | ok |
| 2 | echo | `client_ip_security_test.go:51` | `ebbb855` | `context.go` | `context.go:46:2` | `Context` | `Context.RealIP` | ok |
| 3 | echo | `middleware/logger.go:342` | `ebbb855` | `context.go` | `context.go:46:2` | `Context` | `Context.RealIP` | ok |
| 4 | echo | `middleware/proxy.go:292` | `ebbb855` | `context.go` | `context.go:46:2` | `Context` | `Context.RealIP` | ok |
| 5 | echo | `middleware/rate_limiter.go:51` | `ebbb855` | `context.go` | `context.go:46:2` | `Context` | `Context.RealIP` | ok |
| 6 | echo | `middleware/request_logger.go:369` | `ebbb855` | `context.go` | `context.go:46:2` | `Context` | `Context.RealIP` | ok |
| 7 | client | `prometheus/graphite/bridge.go:171` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 8 | client | `prometheus/promhttp/http_test.go:81` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 9 | client | `prometheus/promhttp/http_test.go:1382` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 10 | client | `prometheus/registry.go:678` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 11 | client | `prometheus/registry.go:843` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 12 | client | `prometheus/registry.go:1194` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 13 | client | `prometheus/testutil/lint.go:38` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 14 | client | `prometheus/testutil/testutil.go:147` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |
| 15 | client | `prometheus/testutil/testutil.go:256` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:173:2` | `Gatherer` | `Gatherer.Gather` | ok |

All 15 are `ok`: each call site resolves to the expected interface method declaration
and the expected owning interface on the expected repository version.

## Direct calls, itemized

### echo (3 total, 3 displayed, 0 omitted)

| Call site | Repo version | Target file | Declaration | Owning type | Target | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `client_ip_security_test.go:38` | `ebbb855` | `context.go` | `context.go:298:1` | `context` | `*context.RealIP` | ok |
| `context_test.go:81` | `ebbb855` | `context.go` | `context.go:298:1` | `context` | `*context.RealIP` | ok |
| `context_test.go:1306` | `ebbb855` | `context.go` | `context.go:298:1` | `context` | `*context.RealIP` | ok |

### client (47 total, 40 displayed, 7 omitted)

| Call site | Repo version | Target file | Declaration | Owning type | Target | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `prometheus/collector_test.go:58` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectorfunc_test.go:75` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/dbstats_collector_test.go:38` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/go_collector_latest_test.go:86` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/go_collector_latest_test.go:99` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/go_collector_latest_test.go:121` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/go_collector_latest_test.go:179` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/go_collector_latest_test.go:241` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/version/version_test.go:34` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/collectors/version/version_test.go:80` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/example_metricvec_test.go:125` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/examples_test.go:165` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/examples_test.go:372` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/examples_test.go:785` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/examples_test.go:818` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/examples_test.go:835` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/examples_test.go:848` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/graphite/bridge_test.go:128` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/graphite/bridge_test.go:224` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/graphite/bridge_test.go:313` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/process_collector_darwin_test.go:40` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/promhttp/http_test.go:1102` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/promhttp/instrument_client_test.go:125` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/promhttp/instrument_client_test.go:241` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/push/push_test.go:81` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry.go:444` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:803` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:940` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1010` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1112` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1487` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1511` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1532` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1545` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1622` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1658` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1691` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1735` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/registry_test.go:1740` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |
| `prometheus/value_test.go:448` | `8f7c887` | `prometheus/registry.go` | `prometheus/registry.go:455:1` | `Registry` | `*Registry.Gather` | ok |

7 direct positions are outside the normal 40-item display bound and
are counted in `total` but not individually listed; gopls confirms the complete set.

### afero (0 total, 0 displayed, 0 omitted)

No direct calls on the changed method.

## This round's acceptance: Afero interface candidates

| # | Call site | Repo version | Target file | Declaration | Owning type | Target | Verdict |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `afero_test.go:88` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 2 | `afero_test.go:96` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 3 | `afero_test.go:104` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 4 | `afero_test.go:117` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 5 | `basepath_copy_test.go:41` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 6 | `basepath_test.go:267` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 7 | `basepath.go:163` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 8 | `cacheOnReadFs.go:224` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 9 | `cacheOnReadFs.go:228` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 10 | `cacheOnReadFs.go:235` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 11 | `composite_test.go:127` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 12 | `copyOnWriteFs.go:218` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 13 | `copyOnWriteFs.go:230` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 14 | `copyOnWriteFs.go:238` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 15 | `copyOnWriteFs.go:248` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 16 | `copyOnWriteFs.go:250` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 17 | `httpFs.go:97` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 18 | `iofs_test.go:38` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 19 | `iofs_test.go:66` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 20 | `ioutil.go:127` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 21 | `ioutil.go:196` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 22 | `memmap_test.go:85` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 23 | `memmap_test.go:123` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 24 | `memmap_test.go:131` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 25 | `memmap_test.go:151` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 26 | `memmap_test.go:225` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 27 | `memmap_test.go:298` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 28 | `memmap_test.go:657` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 29 | `memmap_test.go:684` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 30 | `memmap_test.go:1138` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 31 | `readonlyfs.go:79` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 32 | `regexpfs_test.go:54` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 33 | `regexpfs_test.go:89` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 34 | `regexpfs_test.go:118` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 35 | `regexpfs.go:128` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 36 | `tarfs/tarfs_test.go:310` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 37 | `tarfs/tarfs_test.go:324` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |
| 38 | `unionFile.go:330` | `8d2a95c` | `afero.go` | `afero.go:74:2` | `Fs` | `Fs.OpenFile` | ok |

All 38 are `ok`. The two promoted wrapper calls (`tarfs/tarfs_test.go:310,324`)
resolve to the same `Fs.OpenFile` declaration and owning type; their promotion is
recorded separately from the target identity.

## gopls comparison

| Study | gopls concrete refs | direct + candidates | gopls interface refs | interface-only extras | gopls implementations | captured concrete methods |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| echo | 9 | 3 + 6 = 9 | 9 | 0 | 1 | 1 |
| client | 56 | 47 + 9 = 56 | 61 | 5 | 3 | 3 |
| afero | 38 | 0 + 38 = 38 | 41 | 3 | 11 | 11 |

The concrete-reference sets agree. Interface-method references remain broader because
they include direct calls to sibling implementations; those are not interface receivers.

## Reproduction

```sh
python3 benchmarks/code-analysis-go-interface-candidates/run.py \
  --candidate-cli archify/modules/code-analysis/bin/task.mjs \
  --baseline-cli <baseline-59f1a8005>/archify/modules/code-analysis/bin/task.mjs \
  --samples <preserved-checkouts-with-git-identity> \
  --gopls <gopls-0.24.0> \
  --out <runs>/identity
```

`--samples` must contain `echo-base/head`, `client-base/head` and `afero-base/head`
at the fixed commits with a readable Git identity (a normal checkout, a worktree, or
a `.source-commit` file). The scorer checks both the checkout revision and the CLI
snapshot revision before scoring positions.
