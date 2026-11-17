# HTTPX repair and Flask holdout

Recorded 2026-11-17, Node 22.23.2/macOS. Revision 12 emits `python-source-v2`.
The generated analyzer SHA256 is
`19a7eeb28dd05c9c8f93b1c028e9141ca784cdf423e9f278c845bd76a5226697`.
The baseline is revision 11 at `3b7f5bd57181c2a343976a692a81f3b45635d779`.

## Fixed inputs and independent expectations

| Corpus | Source revision | License | Production inventory |
| --- | --- | --- | --- |
| [HTTPX 0.28.1](https://github.com/encode/httpx/tree/26d48e0634e6ee9cdc0533996db289ce4b430177) | `26d48e0634e6ee9cdc0533996db289ce4b430177` | [BSD-3-Clause](https://github.com/encode/httpx/blob/0.28.1/LICENSE.md) | 23 files, 8,828 lines, 446 functions, 1,559 calls |
| [Flask 3.1.2](https://github.com/pallets/flask/tree/2c1b30d0503cfb064f1cb252e6614a06915a362a) | `2c1b30d0503cfb064f1cb252e6614a06915a362a` | [BSD-3-Clause](https://github.com/pallets/flask/blob/3.1.2/LICENSE.txt) | 24 files, 9,202 lines, 369 functions, 1,195 calls |

HTTPX capture contains only `httpx/**/*.py`; Flask contains only
`src/flask/**/*.py`. Source file hashes, Python-target configuration hashes and
exact dependency locks accompany each frozen reference. Core dependencies live
in isolated Python 3.14.3 environments; optional extras are absent. Neither
HTTPX nor Flask is installed over the pinned source tree. Production Archify
still uses Node only and loads no Pyright package or target dependencies.

Each corpus was inventoried independently with CPython AST. Before reading
either engine's output, 60 global SHA256-ordered calls plus 20 additional
`self`/`cls` calls were inspected and their expected declarations frozen. Seeds,
sample hashes, original oracle hashes, classifications and reasons are retained
in [HTTPX evidence](python-httpx-0.28.1.json), [HTTPX oracle](python-httpx-oracle.json),
[Flask evidence](python-flask-3.1.2.json) and [Flask oracle](python-flask-oracle.json).
The inspector was Codex, **not an independent human reviewer**. Constructors are
classified separately. Additional self-method samples are a separate stratum,
so pooled fractions are not repository-wide random accuracy estimates.

Full **Pyright 1.1.414** was queried with target Python 3.14/platform `All` in the
same pinned source/environment: 1,558 HTTPX and 1,174 Flask queryable callees.
Higher-order calls without a name-token query remain inventoried. Reference
results retain only definitions matching independently inventoried captured
function-name positions; external/class/parameter locations are outside this
score. Reference agreement is separate from correctness against the oracle.

## HTTPX fixes

| Measurement | Revision 11 | Revision 12 | Full Pyright reference |
| --- | ---: | ---: | ---: |
| Selected captured function/method targets | 265 | **358** | 358 unique, 3 multiple |
| Selected targets agreeing with reference | 265/265 | **358/358** | — |
| Previously selected targets retained unchanged | — | **265/265** | — |
| Uniform sample: unique declarations found | 6/10 | **10/10** | 10/10 |
| Additional self-method sample: unique declarations found | 19/19 | **19/19** | 19/19 |
| Wrong targets in frozen sample | 0 | **0** | 0 |

All 93 reference-only unique declaration sites now resolve; three genuinely
multiple candidate sets remain unresolved. Function, import and symbol facts
and every call span are identical to the baseline. All 446 function ranges and
1,559 call spans also match the independent CPython inventory exactly.

The four pre-frozen misses covered property getter/setter grouping,
`self: U` with a bound legacy TypeVar, a reassigned parameter such as
`headers = Headers(headers)`, and a qualified `@contextlib.contextmanager`
source function. The broader repair adds bounded reaching definitions, typed
iteration/dictionary projections, generator send/yield types, awaited and
context-manager returns, source `super`, field-write agreement and guarded
narrowing. Implementations use standard protocol/import evidence, with no
HTTPX-specific names or paths in the resolver.

Controlled, network-free execution of four HTTPX cases also confirmed the
source paths for URL copying, header updates and context-manager bodies. For
async transport entry, runtime selected `AsyncHTTPTransport.__aenter__` while
the declared static anchor is `AsyncBaseTransport.__aenter__`. This explicitly
separates source declaration navigation from runtime dispatch. The upstream
HTTPX test suite was not run.

## Flask holdout and remaining gaps

Flask was selected after the HTTPX fixes, with a frozen candidate bundle and
oracle before either Flask result was read. The first holdout and the final
candidate recheck have the same target/sample counts; both bundle identities
are recorded in the evidence. Later changes hardened negative boundaries and
removed a redundant cache; no Flask-specific inference was added.

| Measurement | Archify | Full Pyright reference |
| --- | ---: | ---: |
| Source function/method targets | **154** | 230 unique, 4 multiple |
| Selected targets agreeing with reference | **154/154** | — |
| Uniform sample: unique declarations found | **5/8** | 8/8 |
| Additional self-method sample: unique declarations found | **11/16** | 16/16 |
| Wrong targets in frozen sample | **0** | 0 |

All 369 function ranges and 1,195 call spans match CPython exactly. The frozen
sample has eight unresolved positives: two use annotations imported under
`TYPE_CHECKING`, five call source methods wrapped by the custom `setupmethod`
decorator, and one follows Click's generic `Context.ensure_object(ScriptInfo)`
factory return. The complete comparison retains 76 unique reference-only sites
and four multiple candidate sets. The eight sample gaps were inspected from
source; the 76 full-corpus gaps are reference differences, not 76 independently
proved bugs.

Next semantic work should separate type-only import scope from runtime callable
evidence, establish generic decorator signature propagation without accepting
arbitrary wrappers, and decide how captured dependency declarations should
inform factory returns. Dynamic context proxies and descriptors also appear in
the full differential. These findings prevent a claim of full Pyright parity.

## Regression and ablation

Click 8.5.1 at `cf19179e8e2fd54c601378cec9e0d21bb12b6fb1` remains the regression
corpus: targets increase **447 → 514**, all 447 retained unchanged, all 514 agree
with the frozen reference, and the original source oracle remains **19/19**.
Function/import/symbol facts and all 2,027 call spans remain unchanged.

Removing recursive field seeding in an isolated candidate loses one HTTPX
declaration (**358 → 357**); the seed is retained. Removing the reaching-definition
cache preserves all HTTPX/Flask raw facts and the Click target count; the cache
was removed. No speed claim is made from these runs. Three new positive
regressions fail against the original revision-11 engine and pass after repair.

Negative coverage includes conflicting/maybe-unbound branches, loop-carried
stores, unsupported match/walrus stores, shadowed decorators, field conflicts,
slice/container identity, `next` defaults, sync/async contexts, coroutine values,
context suppression and missing protocol imports. Historical `python-source-v1`
and lexical captures retain their saved coverage.

## Reproduce against frozen references

Create the source-only layout above and copy the corresponding reference's
configuration to `pyrightconfig.json`:

```json
{"pythonVersion":"3.14","pythonPlatform":"All","venvPath":"..","venv":"env","typeCheckingMode":"off","useLibraryCodeForTypes":true}
```

Use two-space JSON indentation and a final newline to match the recorded config
hash. From the module directory:

```sh
node scripts/compare-python-reference.mjs --root /path/to/httpx-source-only \
  --reference docs/benchmarks/python-httpx-pyright-reference.json \
  --oracle docs/benchmarks/python-httpx-oracle.json

node scripts/compare-python-reference.mjs --root /path/to/flask-source-only \
  --reference docs/benchmarks/python-flask-pyright-reference.json \
  --oracle docs/benchmarks/python-flask-oracle.json
```

Input/oracle hash mismatches fail. The Flask command intentionally exits 1 for
the eight documented unresolved oracle positives; it must not be reported as a
passing accuracy gate. The HTTPX command passes. Reading frozen references does
not launch Pyright or require the isolated Python environments; those pins
document the original reference capture. Local verification and package evidence
are recorded separately in [the revision-12 validation record](python-flow-validation.md).
