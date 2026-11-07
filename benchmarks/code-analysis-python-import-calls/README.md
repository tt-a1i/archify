# Python explicit imported calls: source-first validation

The fixed #1250 baseline already resolves module-level explicit from-imports, including aliases. This candidate recovers **three previously unresolved selected targets** by recognizing a single unconditional function-local from-import that precedes the call in the same function block. It reuses the existing binding scanner and captured target resolver; no new dependency or runtime import is introduced.

## Revisions and provenance

- Baseline: `764a53907f8c5209280f100a4901bd457dd982e0` ([Draft #1250](https://github.com/tt-a1i/archify/pull/1250)). Its original contributed commits remain ancestors; no cherry-picking, squashing or rewriting.
- Source answers frozen in `7428fa2e36335f27c02d5d86a49663db7236efe4`, before analyzer runs or implementation. [Manifest](manifest.json) records exact calls, bindings, expected definitions, rationale and source hashes. Early AST checks rejected misread source line numbers before the freeze.
- Implementation: `474c9a4f7048c989e0f6aab77a0540076613b383`; revision-bound fixtures: `63d18cac8a015b8348b8cb0f9719874ccb780899`.
- Final tested source/package: `8b1ed343bb335c4d93a5f7bdb7e2ae6746011ffa`. Subsequent benchmark documentation/evidence commits do not alter `archify/` or the ZIP.
- Projects: Click **8.1.8**, `934813e4d421071a1b3db3973c02fe2721359a6e`; Jinja **3.1.6**, `15206881c006c79667fe5154fe80c01c65410679`. No previous tuning use was found in tracked Code Analysis benchmarks. This cannot exclude unrecorded use. These are ten selected source questions, not a blind or project-wide accuracy evaluation. Real positive alias coverage was not found in the selected cases; aliases, shadowing and rebinding are additionally covered by explicitly synthetic regressions.

## Frozen outcomes

| Unit | Call → expected target or unknown | Baseline | Source / ZIP |
| --- | --- | --- | --- |
| click-01 | `termui.py:266` → `globals.py:54 resolve_color_default` (import 12) | correct | correct |
| click-02 | `termui.py:280` → `_termui_impl.py:362 pager` (local import 278) | missed | correct |
| click-03 | `termui.py:709` → `_termui_impl.py:611 open_url` (local import 707) | missed | correct |
| click-04 | `termui.py:744 _getchar` → global cache / conditional alias | unknown | unknown |
| click-05 | `termui.py:750 f` → platform-dependent decorated definition (alias import 748) | unknown | unknown |
| click-06 | `termui.py:270 isinstance` → builtin, no captured definition | unknown | unknown |
| jinja-07 | `environment.py:694` → `compiler.py:101 generate` (import 19) | correct | correct |
| jinja-08 | `environment.py:942` → `debug.py:14 rewrite_traceback_stack` (local import 940) | missed | correct |
| jinja-09 | `environment.py:932 filter_func` → parameter / conditional nested definition | unknown | unknown |
| jinja-10 | `environment.py:920 self.loader.list_templates` → member dispatch | unknown | unknown |

File paths in the table are relative to `src/click/` and `src/jinja2/`. The manifest contains full paths, exact columns and pinned upstream repository/commit identities. Correct targets require an exact location plus valid question navigation; an unresolved expected target is **missed**, not a successful unknown. **Omitted** means the call itself is missing. Counts:

| Mode | Correct targets | Wrong targets | Missed expected targets | Omitted calls | Explicit expected unknowns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed baseline | 2 | 0 | 3 | 0 | 5 |
| Candidate source | 5 | 0 | 0 | 0 | 5 |
| Extracted candidate ZIP | 5 | 0 | 0 | 0 | 5 |

[Baseline](evidence/baseline.json), [source](evidence/source.json), [archive](evidence/archive.json) retain every selected observation and navigation result. Source anchors: [Click calls](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/termui.py#L278), [pager definition](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/_termui_impl.py#L362), [open_url definition](https://github.com/pallets/click/blob/934813e4d421071a1b3db3973c02fe2721359a6e/src/click/_termui_impl.py#L611), [Jinja import/call](https://github.com/pallets/jinja/blob/15206881c006c79667fe5154fe80c01c65410679/src/jinja2/environment.py#L940), [definition](https://github.com/pallets/jinja/blob/15206881c006c79667fe5154fe80c01c65410679/src/jinja2/debug.py#L14).

An exploratory whole-capture diff found 11 new targets, including the three scored cases. The other eight were inspected **after** the candidate run and are not added to the frozen score: Click `core.py:1156` → `shell_completion.py:17`; Jinja `nodes.py:603` → `compiler.py:125`; `tests/test_debug.py:103` → `debug.py:150`; and five `tests/test_ext.py` calls at 397/414/432/451/467 → `ext.py:774`. Their call/import/definition source agrees with the new rule; this post-hoc inspection is not independent holdout evidence.

## Tests, packaging and retained failures

Runtime checks used Node **22.23.3** and Python **3.13.16**. Canonical builds used official Node **22.23.2**, bundled zlib **1.3.1-e00f703**; the Homebrew Node has a different zlib and was not used to build.

- [49 focused tests pass](evidence/focused.log), including extraction, saved questions and paired questions. The new function-local regression [fails against #1250](evidence/baseline-regression.log); the baseline retains only its pre-existing module-level header call target.
- Final module suite: [**343 pass, 1 fail, 0 skips**](evidence/module-final.log). `ts-snapshot.test.mjs:89` reports `Missing expected exception`; [the same test fails at fixed #1250](evidence/baseline-snapshot.log), 10 pass / 1 fail. Its cause remains unestablished here; no unrelated fix is included.
- [First full run](evidence/module-tests.log): 342 pass / 2 fail. The extra failure was a stale task fixture caused by the intentional Python adapter revision bump 8→9. Regenerating the fixtures fixes it; [18 task tests pass](evidence/task-tests.log). The initial focused test also had a wrong expected line number (45 instead of 44); [failure retained](evidence/focused-first.log).
- A first archive built before fixture regeneration had 13 stale task-fixture files. The file audit rejected it even though its real-project CLI outputs matched. It was replaced at `8b1ed343b`; its old SHA-256 was `26943060ee43f1d7923269d99e253ef71132a26368eb3175bdf26e35b67d8af4`. The initial local extraction/results remain available as `work/unpacked-initial` and `work/archive` in this study, rather than being treated as final evidence.
- Final ZIP SHA-256: **`1248b19f0b283d0effe91ac8446244db702e287c7064eb8f4e1947643c5ca499`**. Two canonical builds match byte-for-byte. All **156** packaged Code Analysis files match source bytes. [Parity receipt](evidence/parity.json): 2 raw-facts files match byte-for-byte; 7 saved questions match after normalizing only `calls.provenance.rawFactsPath` and the installed `workflow` path. Entrypoint/output paths are normalized for command comparison; arguments and exits otherwise match for all **9 CLI calls per mode**. An initial comparison without workflow-path normalization correctly detected that installation-path difference.
- [All 15 Python call tests pass directly from the final extracted package](evidence/archive-tests-final.log), including the public check CLI. Final source and ZIP real-project captures have no parse errors and all 27 baseline/source/ZIP commands exit 0. Dependency installation reported eight npm advisories (1 moderate, 7 high); no dependency remediation is included.
- Scoped test-value review reused the existing fixture/helper and added one regression for the observed binding boundary, with synthetic alias, direct import, same-line import, parameter collision, rebinding, later write, call-before-import, conditional import, guarded call, closure, header and class/method cases. The existing target resolver still owns reexport/decorated/ambiguous-target rejection. Focused simplification survey found no worthwhile cut: the existing event scanner and resolver are reused; no parallel resolver, dependency or persistent state was added.

There is no new browser/UI behavior, runtime execution test, Windows run, general accuracy claim, or proof of downstream Agent benefit. Native remote CI is separate and human review is pending. Global/nonlocal, closure imports, class-local imports, conditional or repeated imports, parameter collisions, later writes, reexports, decorated/duplicate targets, dynamic/member calls and unsupported annotations remain unknown. The conservative parameter-collision rule can leave a target unknown even after an unconditional import overwrites a parameter. This is deliberate bounded source evidence, not complete Python name resolution.

## Reproduce

Use a new `$WORK` directory, Git, npm, Node 22 and Python 3.13. Run the harness from this PR's `benchmarks/code-analysis-python-import-calls` directory (`$HARNESS` below). Network access to GitHub/npm is required. Never run the target projects.

```sh
export WORK=/absolute/path/to/new-study
export NODE=/absolute/path/to/node22
export PYTHON=/absolute/path/to/python3.13
export HARNESS=/absolute/path/to/this/benchmarks/code-analysis-python-import-calls
mkdir -p "$WORK"
git clone --branch 8.1.8 https://github.com/pallets/click.git "$WORK/click"
git clone --branch 3.1.6 https://github.com/pallets/jinja.git "$WORK/jinja"
git clone https://github.com/tt-a1i/archify.git "$WORK/product"
git -C "$WORK/product" worktree add --detach "$WORK/baseline" 764a53907f8c5209280f100a4901bd457dd982e0
git -C "$WORK/product" worktree add --detach "$WORK/source" 8b1ed343bb335c4d93a5f7bdb7e2ae6746011ffa
npm --prefix "$WORK/baseline/archify/modules/code-analysis" ci --ignore-scripts
npm --prefix "$WORK/source/archify/modules/code-analysis" ci --ignore-scripts
unzip -q "$WORK/source/archify.zip" -d "$WORK/unpacked"
python3 "$HARNESS/run.py" --cli "$WORK/baseline/archify/bin/archify.mjs" --sources "$WORK" --out "$WORK/baseline-results" --node "$NODE" --python "$PYTHON" --product-sha 764a53907f8c5209280f100a4901bd457dd982e0
python3 "$HARNESS/run.py" --cli "$WORK/source/archify/bin/archify.mjs" --sources "$WORK" --out "$WORK/source-results" --node "$NODE" --python "$PYTHON" --product-sha 8b1ed343bb335c4d93a5f7bdb7e2ae6746011ffa
python3 "$HARNESS/run.py" --cli "$WORK/unpacked/archify/bin/archify.mjs" --sources "$WORK" --out "$WORK/archive-results" --node "$NODE" --python "$PYTHON" --product-sha 8b1ed343bb335c4d93a5f7bdb7e2ae6746011ffa
# Build with official Node 22 + bundled zlib on PATH:
PATH="/path/to/official-node22/bin:$PATH" "$WORK/source/scripts/build-zip.sh" "$WORK/repeat.zip"
python3 "$HARNESS/compare.py" --source "$WORK/source-results" --archive "$WORK/archive-results" --source-tree "$WORK/source" --zip "$WORK/source/archify.zip" --repeat "$WORK/repeat.zip" --out "$WORK/parity.json"
BAUIFY_PYTHON="$PYTHON" "$NODE" --test "$WORK/source/archify/modules/code-analysis/test/python-calls.test.mjs"
BAUIFY_PYTHON="$PYTHON" "$NODE" --test "$WORK/unpacked/archify/modules/code-analysis/test/python-calls.test.mjs"
```

The runner checks project SHAs, tracked cleanliness and frozen source hashes before invoking the public CLI, and rechecks source hashes afterward. It preserves stdout/stderr, raw captures, saved questions and grades. It does not execute project code. `--product-sha` records the caller-supplied product identity; the pinned worktree commands above establish that identity. Refuse a partial output directory as completed evidence. Local complete raw artifacts remain under the study's `work/baseline-fixed`, `work/final-source-v2` and `work/archive-v2`; committed records use symbolic paths to avoid publishing workstation paths.
