# External validation

Two real repositories were analyzed at fixed revisions, both in languages other
than the JS/TS product code: Python `requests` and Rust `clap`. The old entry is
the fixed start commit without this change; the new entry is this branch. No
pull request was opened against either repository.

## Repositories

| Repository | Revision | Language | Old entry | New entry |
| --- | --- | --- | --- | --- |
| `psf/requests` v2.32.3 | `0e322af87745eff34caffe4df68456ebc20d9068` | Python | 9 findings (0 warning, 9 info) | same findings; `ruleCounts` + three self-contained leads |
| `clap-rs/clap` | `ec93e71255c0b833a34f50662a3fdb22f53f6ded` | Rust | 28 findings (6 warning, 22 info) | same findings; `ruleCounts` = 23 complexity, 4 import-cycle, 1 internal-leak |

Reproduce the analyses:

```sh
node archify/bin/archify.mjs code-analysis check /path/to/requests --language py --out out/requests --json
node archify/bin/archify.mjs code-analysis check /path/to/clap --language rust --out out/clap --json
```

`external/comparison.json` records the counts, priorities, rule counts and
session measurements. `external/clap-reanalysis.json` records the clap result
before and after its patch.

## Complete case: requests empty-string cookie

This is the four-stage case requested for the deliverable.

### 1. What the scan saw

Both entries report nine `complexity/function` findings, all `info`, on
`requests` v2.32.3. The old entry exposes three bare priority ids. The new entry
attaches the message and location:

- `COMP-6fd43dc98e31` `src/requests/models.py:137` `_encode_files`
- `COMP-67a8b22fa9b7` `src/requests/auth.py:126` `build_digest_header`
- `COMP-fea11204efdb` `src/requests/adapters.py:613` `HTTPAdapter.send`

The finding that mattered was none of those three:
`COMP-15ee04958d0f` `RequestsCookieJar._find_no_duplicates`, complexity 9,
nesting 5.

### 2. Why the AI chose it

Two independent sessions received only the checkout, the one-sentence request
and one analysis entry each:

- The old-entry session chose it because it was the smallest flagged body
  (28 lines, complexity 9), so it was the cheapest to judge. The old entry gives
  no location; the session found the function from `findings.json`.
- The new-entry session chose it because it was the only nesting-only finding
  (nesting 5, complexity 9) — an unusual shape. The new entry's top three leads
  were evaluated and judged inherent or maintain-as-is first.

Neither session treated the nine info-level complexity findings as defects.

### 3. What the source showed

`src/requests/cookies.py:386-413` uses `if toReturn is not None:` at line 403 to
detect a conflict but `if toReturn:` at line 411 to decide whether a cookie was
found. An empty-string value is stored (`toReturn = ""`) and then treated as
“not found”. The sessions reproduced the consequence:

```python
from requests.cookies import cookiejar_from_dict
jar = cookiejar_from_dict({"token": ""})
jar.get("token")        # None
jar["token"]            # KeyError
"token" in jar          # False
dict(jar)               # KeyError
```

`dict_from_cookiejar(jar)` and `jar.get_dict()` still return `{"token": ""}`, so
the jar holds the value while the mapping interface loses it.

### 4. Final recommendation

Change line 411 to `if toReturn is not None:` and add a regression test for an
empty-string value. `external/requests-cookie-fix.patch` and
`external/test_cookie_empty_value.py` contain the patch and test. Copy the test
into the checkout's `tests/` directory before running it.

Validation in a temporary copy of the fixed revision:

- Original source + new test: `1 failed` (the assertion `jar.get("token") == ""`
  returns `None`).
- Patched source + new test: `1 passed`.
- Command:

```sh
PYTHONPATH=/tmp/requests-cookie-fix/src:/tmp/fc-deps python3 -m pytest tests/test_cookie_empty_value.py -q
```

This is a source-backed defect, not an adoption claim: upstream maintainers have
not been asked, and the bug may already be fixed after v2.32.3. The patch is
evidence of follow-through, not a submitted PR.

### Session cost

| Entry | Tool uses | Subagent tokens | Duration | First source-verified lead |
| --- | ---: | ---: | ---: | --- |
| Old | 20 | 680,356 | 74.5 s | `COMP-15ee04958d0f` (cookie bug) |
| New | 32 | 1,435,353 | 121.6 s | `COMP-15ee04958d0f` (cookie bug) |

On a nine-finding repository the new entry did not reduce cost; the new session
did more verification (reproduced the bug and checked an untested 4-tuple path).
Both entries found the same first lead. The entry's value is on larger result
sets, where the id-to-location join and rule distribution matter.

## Second external case: clap two-file import cycle

### 1. What the scan saw

28 findings: 23 `complexity/function`, 4 `coupling/import-cycle`, 1
`coupling/internal-leak`. The top three priorities are all complexity. The new
entry's `ruleCounts` makes the coupling signals visible even though they are
info-level and do not appear in the priority list.

### 2. Why this lead

The smallest cycle is two files, so it is the cheapest coupling claim to verify:
`COUP-9716712f94d7`, `clap_builder/src/builder/arg.rs` ↔
`clap_builder/src/builder/arg_settings.rs`.

### 3. What the source showed

- `clap_builder/src/builder/arg.rs:13` imports `ArgSettings` from
  `arg_settings.rs`.
- `clap_builder/src/builder/arg_settings.rs:1-2` has
  `#[allow(unused)] use crate::Arg;`. The main body only uses `ArgSettings`;
  the doc comments link with `crate::Arg`, and the test module imports `Arg`
  locally at line 75.

The reverse edge exists only to keep an otherwise unused import.

### 4. Final recommendation

Delete the two lines (the attribute and the import). It is a source-only change
with no behavior change.

Validation:

- `cargo check -p clap_builder`: passed.
- `cargo test -p clap_builder --lib`: 83 passed, 0 failed.
- Re-analysis of the patched copy: 28 → 27 findings; `coupling/import-cycle`
  4 → 3; the removed finding is exactly `COUP-9716712f94d7`.
- Patch: `external/clap-arg-settings.patch`.

No upstream PR was opened and no maintainer feedback was obtained.

## Limits and false-judgment checks

- Both repositories are small enough that the old entry was already usable. The
  requests sessions show the new entry is not a cost win at that scale.
- The new entry's three leads remain dominated by complexity because that rule
  produces most findings. `ruleCounts` is the escape hatch; without reading it,
  a session can miss coupling signals.
- `impact` is module-level and repeats for every function in one module, so it
  does not distinguish leads within a module. Complexity `size` is the only
  differentiator there.
- Coverage limits were treated as scope, not defects: 15 requests files were
  excluded as tests; clap's Rust run reports its own cfg/feature limits.
- No maintainer adoption is claimed for either case.
