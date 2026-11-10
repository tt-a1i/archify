# First contact on an unfamiliar repository: repo-only vs repo + Archify scan

Two isolated sessions received the same one-sentence request, “帮我看看这个项目”,
on the same pinned repository. Session A could only read and run the repository.
Session B had the same tools and also received the Archify `check` receipt with
`investigation.leads`. This record compares the first source-verified decision,
the dead ends, and the claims that did not survive review. It records the
outcome either way; it is not a claim that the scan improves every session.

## Repository and environment

- Repository: `encode/httpx`
- Revision: tag `0.27.0`, commit `326b9431c761e1ef1e00b9f760d1f654c8db48c6`
  (2024-02-21). This repository had no earlier use in Archify's rule design or
  investigations.
- Copies: `/private/tmp/first-contact-httpx-a` and `...-b`, both cloned from the
  same pinned checkout, each with its own venv.
- Environment, identical for both: Python 3.15.0, runtime dependencies plus
  `pytest 9.2.0`. This is **not** the project's documented dev environment
  (`requirements.txt` asks for Python 3.8–3.12, `pytest==8.0.0`, `trio`,
  `trustme`, `uvicorn`, and optional extras). Both sessions hit this mismatch
  and worked around it differently.
- Sessions: same `general-purpose` agent configuration, same prompt skeleton,
  12-minute cap, separate directories, no shared scratch files.
- Start: `2026-11-10T00:59:08Z`. Both sessions returned after about two minutes,
  so the 12-minute cap was never exercised.

## Scan cost and artifacts

```sh
node archify/bin/archify.mjs code-analysis check /private/tmp/first-contact-httpx \
  --language py --out /private/tmp/httpx-scan --json
```

- Wall clock: **5.00 s** (`real 5.00`, `user 3.93`, `sys 1.06`).
- Result: 8 findings, verdict `attention`, one warning; 4 complexity,
  2 internal-leak, 1 package-level cycle, 1 import-cycle.
- Three leads. The first is `COMP-c96d5a89f434`: `urlparse` in
  `httpx/_urlparse.py:151`, complexity 39, 133 lines.
- Artifacts used by B are frozen under [scan/](scan/): `check.json` (3.9 KB),
  `overview.json` (6.2 KB), `findings.json` (19 KB). `raw-facts.json` was 2.5 MB
  and was not given to B; the module graph was 4 KB and was not read.

B consumed the 5.0 s scan production cost plus reads of the three artifacts.
A consumed no scan cost.

## Comparison

| Measure | A: repository only | B: repository + scan |
| --- | --- | --- |
| First source-verified, decision-bearing claim | The prepared venv cannot run the project suite; rebuild it before trusting tests (≈23 s) | IPv6 `netloc` cannot round-trip through `URL(netloc=...)` (≈69 s) |
| Code-level finding a maintainer can act on | None survived; its only code hypothesis was withdrawn | IPv6 `netloc` parser bug with a 9-line fix and regression test |
| Tool uses | 38 | 32 |
| Subagent tokens | 1,506,201 | 1,338,666 |
| Wall clock | 122.7 s | 135.3 s |
| Scan cost | 0 | 5.0 s production + artifact reads |
| Claims withdrawn | 2 (decoder “silent corruption”; unverified install claim) | 2 (netloc drops userinfo; bytes/str asymmetry) |
| Main false-defect risk handled | Unknown `Content-Encoding` pass-through read as corruption, then matched to an existing test | Complexity 39 read as structural debt, then recomputed and waived as a metric artifact |

A reached its environment conclusion faster in wall-clock time, but it did not
produce a code-level conclusion. B took 12.6 s longer and 6 fewer tool calls,
and produced the only actionable code defect. In this single pair the scan did
not make the session cheaper; its measurable effect was orientation.

Times in the table are the first decisive command in the saved transcript, not
the final report timestamp. A's config abort appeared at `00:59:18` and the
missing `trustme` import at `00:59:31`; it kept validating until `01:01:10`.
B's first netloc probe appeared at `01:00:16` and it finished at `01:01:23`.

B read `check.json` at `00:59:10` and opened `httpx/_urlparse.py` at
`00:59:17`, nine seconds after starting. A never opened that file. B's first
reproduction of the netloc failure ran at `01:00:16`; byte-kwarg and
`copy_with` confirmations followed at `01:00:26` and `01:00:39`.

## The scan lead and the actual bug

The scan's first lead was a complexity measurement, and B waived it:

- B recomputed the metric and got exactly 39: 14 `if`, 1 `for`, 2 comprehension
  terms, 17 boolean terms and 4 ternaries. Nesting depth is 3, not 39.
- 21 of 38 decision points are `and`/`or` terms or inline ternaries, and the
  function has 86 URL tests with 16 `InvalidURL` assertions.
- B's decision: accept the finding; do not refactor an RFC 3986 parser for this
  number.

The real defect was one function above the metric, in the same file:

```python
# httpx/_urlparse.py:173-175 at 0.27.0
if "netloc" in kwargs:
    netloc = kwargs.pop("netloc") or ""
    kwargs["host"], _, kwargs["port"] = netloc.partition(":")
```

`URL.netloc` returns `b"[::1]:8080"`. The constructor decodes it to `str` and
the first-colon split produces host `"["` and port `":1]:8080"`. Every IPv6
round-trip fails; the only netloc test used `b"example.net:444"`.

## Complete case: scan → why chosen → source → recommendation

1. **Scan saw:** `urlparse` has complexity 39 and 133 lines; it is the single
   gating warning and the top lead.
2. **AI chose it:** B verified the number, decided the metric was a false
   signal, and read the surrounding code to understand the function. That read
   exposed the `netloc.partition(":")` split.
3. **Source verified:** `URL("http://[::1]:8080/a").copy_with(netloc=...)` and
   `URL(netloc=b"[::1]:8080", scheme="http")` both raise
   `InvalidURL: Invalid port: ':1]:8080'`. The same failure is present on
   current upstream `0.28.1` (`b5addb64f`, 2026-02-23). Existing tests cover
   IPv6 URLs but not the `netloc` kwarg.
4. **Recommendation:** fix the split before the next release. A bracket-aware
   split keeps `netloc` semantics (host:port, no userinfo), handles a bare
   `[::1]`, normalizes default ports, and rejects `[::1` and `[::1]junk`.
   Regression: before the fix, 1 failed / 1 passed in `test_url.py -k netloc`;
   after, 87 passed. Default port, userinfo preservation, and malformed input
   were checked separately.

Patch: [httpx-netloc-ipv6.patch](httpx-netloc-ipv6.patch).

## Claims that did not survive review

- A: unknown `Content-Encoding` values pass through as raw bytes. A first read
  this as silent corruption, then found `tests/test_decoders.py:277-289`
  asserting the pass-through and `ACCEPT_ENCODING` derived from available
  decoders. Withdrawn.
- B: “`netloc` drops userinfo.” `netloc` is host:port by design; `copy_with`
  preserves userinfo through its defaults. Withdrawn.
- B: “str vs bytes kwargs are inconsistent.” Query, userinfo, netloc and raw
  path are bytes because their properties are bytes. Withdrawn.
- B: the package-level and internal-leak coupling findings. The edges exist,
  but they are the normal re-export pattern of a single distribution; no
  action.

## What this pair does and does not show

- It shows the scan can orient an agent to a file within seconds even when the
  ranked lead is wrong, and that the agent can then find a bug the scan missed.
- It does not show a speed or token saving: B was slightly slower and only
  slightly cheaper than A.
- A spent its time validating whether test evidence was trustworthy, which is
  a legitimate first-contact decision and a real risk with an under-provisioned
  environment. The comparison is one pair, not an attribution of all
  differences to the scan.
- Neither session hit the 12-minute cap, so the budget did not bind.
- No maintainer feedback was obtained and no pull request was opened against
  httpx. The patch exists only in a temporary copy.
