# Session B — repository + Archify scan

Wall clock: 135.3 s. Tool uses: 32. Subagent tokens: 1,338,666.
Scan cost: 5.0 s production plus artifact reads.
Prompt context: repository path, “帮我看看这个项目”, and the stored `check`
receipt at `/private/tmp/httpx-scan`.

## Final report (session output)

**Project:** encode/httpx **0.27.0** at commit `326b943` (checked out in
`/private/tmp/first-contact-httpx-b`). Library layout: `httpx/` (18 module files
+ 6 under `_transports/`), optional `_main.py` CLI, `tests/`, `docs/`,
`scripts/`. Archify scan was produced against the sibling path
`/private/tmp/first-contact-httpx` (same `baseRevision` `326b943…`), 8 findings,
`verdict: attention`, one gating `warning`.

### 1. First verified conclusion (decision-bearing)

**`netloc=` cannot express an IPv6 netloc, so a value round-tripped from the
public `URL.netloc` property is rejected by the constructor.**

`/private/tmp/first-contact-httpx-b/httpx/_urlparse.py:173-175` splits netloc
with a naive first-colon `str.partition(":")`:

```python
if "netloc" in kwargs:
    netloc = kwargs.pop("netloc") or ""
    kwargs["host"], _, kwargs["port"] = netloc.partition(":")
```

`URL.netloc` returns `b"[::1]:8080"` for IPv6 (`httpx/_urlparse.py:116`,
surfaced at `httpx/_urls.py:232-240`, and `netloc` is an accepted constructor
kwarg at `httpx/_urls.py:84`). Feeding that back raises:

- `httpx.URL(netloc=b"[::1]:8080", scheme="http")` →
  `InvalidURL: Invalid port: ':1]:8080'` (host becomes `"["`)
- `httpx.URL("http://[::1]:8080/a").copy_with(netloc=...)` → same failure
- `netloc=b"[::1]"` (no port) also fails: `Invalid port: ':1]'`

Non-IPv6 round-trips are fine (`example.com:80`, `example.com`, and userinfo
URLs, because `netloc` is deliberately host:port only, matching the Host header
use at `httpx/_client.py:538`). The only existing netloc test is
`tests/models/test_url.py:560-566` with `b"example.net:444"` — no IPv6 case,
which is why this survives.

**Decision:** fix before the next release — split netloc bracket-aware
(isolate `[...]` before looking for the last `:`) rather than removing
`netloc`, since IPv6 is supported on every other path
(`tests/models/test_url.py:822-829`). Contained ~4-line change in
`_urlparse.py` plus one parametrized test; the scan did not surface it because
the flagged metric is complexity, not behaviour.

### 2. Other conclusions and their verification outcome

Verified (survived):

- **The single gating warning is a metric artifact.** `COMP-c96d5a89f434`
  (`httpx/_urlparse.py:151`, complexity 39) reproduces exactly under an
  independent AST count: `1 + 14 If + 1 For + 2 comprehension + 17 BoolOp
  terms + 4 ternary (IfExp) = 39`; 21 of 38 decision points (55%) are
  `and`/`or` terms and inline ternaries, and the function's nesting depth is
  **3** (line 201 region), matching the scan. The high count comes from the flat
  kwarg-coercion prelude (`_urlparse.py:165-190`) and `kwargs.get(...) or ""`
  defaults (`:228-235`). It is also well protected: `tests/models/test_url.py`
  = 86 passing tests, 16 `InvalidURL` assertions. **Decision: waive/accept, do
  not refactor** an RFC3986 parser for this number; if the gate must stay
  meaningful, exclude boolean/ternary terms or raise the threshold.
- **All three other complexity findings are accurate but trivial:**
  `_main.py:192` `format_certificate` (16 lines, `# pragma: no cover`),
  `_main.py:450` `main`, `_models.py:1075` `Cookies.get` — recomputed nesting
  depth 5/5/5, exactly as reported.
- **`coupling/import-cycle` `_urls.py ↔ _utils.py` is real but benign:**
  `_urls.py:10` imports `_utils`; `_utils.py:361` does a function-local
  `from ._urls import URL` inside `URLPattern.__init__`. Deferred by
  construction; no action.

Qualified or withdrawn:

- **Withdrew “netloc drops userinfo”** — `url.netloc` is host:port by design
  (RFC3986 “netloc” used as-is for the Host header), so `copy_with(netloc=...)`
  on `http://u:p@example.com:8080/a` round-trips correctly to an equal URL.
- **Withdrew “str-vs-bytes kwarg asymmetry is a wart”** — `query`, `userinfo`,
  `netloc`, `raw_path` require `bytes` because their corresponding properties
  return `bytes` (`httpx/_urls.py:84-90`); consistent design.
- **Qualified the package-level “cycle” `COUP-1c4b02649d1e`**: the edges exist
  (`httpx/__init__.py:39-45` imports concrete `_transports` submodules;
  `_transports/asgi.py:7-8` imports `.._models`, `.._types`), but these are
  sibling packages inside one distribution, `import httpx` works, and the
  “cycle” is the standard re-export pattern. Same for both `internal-leak`
  findings — the rule treats `httpx/_transports/__init__.py` as a nested entry
  point and then counts the intentional `ASGITransport`/`WSGITransport`/
  `MockTransport` re-exports. **Decision: no action on all four coupling
  findings.**
- **Qualified scan fidelity:** spot-checked edges rather than all 18/24;
  `coverage.files: 24` matches 18 + 6 production files, no parse errors.

### 3. Dead ends

- `findings.json` has no `findings` key (`KeyError`) — ~20 s; records live under
  `diagnostics`, `summary` holds only counts.
- **Full test run blocked (~90 s)**: `.venv/bin/python -m pytest
  tests/models/test_url.py` aborts during config because
  `filterwarnings = ["error", ...]` turns the missing `trio` filter module into
  `PytestConfigWarning`, and `tests/conftest.py:9` imports `trustme`, which is
  not installed either. Environment gap, not a repo defect. Worked around with
  `--noconftest -o filterwarnings=` → **86 passed in 0.16 s**. This ate the
  largest single block of time and led away from any “test suite is broken”
  conclusion.
- First probe of the netloc hypothesis was `URL(netloc="example.com")` raising
  `TypeError: must be bytes`; initially looked like API inconsistency, but
  probing the bytes family showed it is intentional, so it was dropped and
  re-probed with `bytes`.

### 4. Process accounting

Commands run (31 shell, 1 file read): `date`, `ls`, `cat` of scan artifacts,
`git log`, `pyproject.toml`/`tests/conftest.py` inspection,
`grep -rn netloc`, `sed` slices of
`_urlparse.py`/`_urls.py`/`_utils.py`/`_main.py`/`_transports/asgi.py`/tests,
3 inline `python3 -` scripts (AST complexity/nesting, `findings.json` shape),
5 inline `.venv/bin/python -c` probes (URL construction, netloc round-trip,
kwarg typing), 4 `pytest tests/models/test_url.py` attempts. Files read in full
or in part: `httpx/_urlparse.py`, `httpx/_urls.py`, `httpx/_utils.py`,
`httpx/_main.py`, `httpx/_models.py` (slices), `httpx/_transports/asgi.py`,
`httpx/__init__.py`, `tests/models/test_url.py`, `tests/conftest.py`,
`pyproject.toml`, plus all scan artifacts.

Wall clock: start `1794272350` (Tue Nov 10 08:59:10 CST 2026) → end ≈
`1794272470` (**~2 min 0 s**, inside the 12-minute cap). Tool calls: **32**.
Scan cost consumed: **5.0 s** (one-shot `check`, 60 files, 8 findings) —
negligible against the run, but it also produced exactly one actionable signal
of eight, and that signal (complexity 39) is the one to waive, while the real
defect it missed (IPv6 `netloc`) is a 4-line fix found by reading the source.
