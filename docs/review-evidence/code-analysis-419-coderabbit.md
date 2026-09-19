# CodeRabbit follow-up for PR 419

Reviewed PR head: `3bcad34bd55ac3758f15b7b961ee976d985c1ee8`.
Target base: `fdc5b183f743cbce1b6dacd07c43ecc224b05b78`.
The first follow-up implementation was committed as `103e8153c3df9c865765e1da43a4d221731f8b46`. Historical results below identify either that implementation or an explicitly unversioned working tree; none is a claim about later revisions.

## Disposition

- [Python source encoding](https://github.com/tt-a1i/archify/pull/419#discussion_r4043380955): fixed. Detect the declared Python encoding from captured bytes once, then reuse the decoded text for parsing and source display. Invalid encodings remain per-file parse diagnostics.
- [Concurrent dependency installation](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781943): fixed. Atomic directory locking coordinates separate processes sharing the canonical module directory. Recheck the manifests under the lock; release on failure. Waits are bounded and stale locks require explicit recovery rather than risking a second installer.
- [JSON stage contract](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781957) and [diagnostic fields](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781965): fixed in the guide, including its later description of the pipeline.
- [Recursive SCC traversal](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781969): fixed. Both rules use a shared iterative Tarjan implementation. Module-cycle and file self-cycle behavior remain distinct. A 16,000-node chain regression exercises both public rule entry points.
- [Shadowed Python loaders](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781976): fixed for lexical bindings. Eager statements respect binding order; deferred bodies use conservative enclosing bindings. Parameters, local assignments, global/nonlocal writes, aliases, classes, and comprehension bindings are accounted for. Arbitrary runtime monkey-patching remains outside static extraction's guarantees.
- [Relative imports beyond a package](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781987): fixed. Reject imports above package depth, including src layouts; retain relative imports when the analyzed root is itself a package. Corrected the hand-verified fixture, without changing the cycle policy.
- Nested glob alternatives: fixed. Brace alternatives share wildcard translation with the surrounding expression, including nested braces and escaped literals. Unclosed braces retain the existing diagnostic.
- Standalone interactive test: fixed. The IR-change regression uses the same checkout-availability guard as the other integration test.

The older scratch-workspace and AI Voice output comments are already addressed in the reviewed head: neither set of paths remains tracked. Previously addressed launcher, dependency-manifest, workflow, NOTICE, and independent test-setup changes remain intact.

## Filesystem-race finding: hardened, not fully closed

[Directory replacement race](https://github.com/tt-a1i/archify/pull/419#discussion_r4044781999): the finding is valid. The original walker trusted old directory entries, and the adapters subsequently reopened live paths.

The follow-up adopts the repository's package-stager pattern: record ancestor identities and metadata, reject symlinks and real-path escapes, open regular files with no-follow flags where supported, compare descriptor identity and path state before and after reading, and retain source bytes in memory. TypeScript's compiler host reads that snapshot; Python receives the captured bytes rather than reopening paths. Regressions reject directory replacement after enumeration and file replacement before opening, skip preexisting external links, and verify captured bytes survive later edits.

This is a practical mitigation, not an OS-atomic filesystem snapshot or a proof against every adversarial replacement sequence. In particular, portable Node APIs do not provide descriptor-relative no-follow traversal of every ancestor on all supported hosts. Fully closing that stronger security requirement needs a reviewed native/OS-specific traversal or trusted filesystem snapshot design and host-specific attack tests. Do not mark this review thread fully resolved based only on these checks.

## Historical validation and revision attribution

The PR description still describes an earlier, unversioned implementation working tree and names `main` as its comparison base. Those results (including Code Analysis, packaging, update-concurrency and Windows ESM failures) have no recoverable exact commit attribution. They are historical only, not results for `103e815` or the current patch. The actual target for the reviewed follow-up is `dev` at `fdc5b183f743cbce1b6dacd07c43ecc224b05b78`. This evidence supersedes the PR description for revision attribution without changing its recorded outcomes.

- **Implementation committed as `103e815` (pre-commit run):** `node --test archify/modules/code-analysis/test/*.test.mjs`: 88 passed, zero failed or skipped on Windows, using the bundled Python interpreter through `BAUIFY_PYTHON`.
- **Implementation committed as `103e815` (pre-commit run):** `node --test archify/modules/code-analysis/test/review-regressions.test.mjs` under Node 22.23.2: all 10 new regressions passed on the final source.
- **Unversioned, changing working tree based on `3bcad34` before `103e815`; not attributable to one commit:** `npm test` from `archify/` under Node 22.23.2: 1,691 tests, 1,616 passed, 8 failed, 67 skipped. All eight failures are in `repository-evidence-replacement.test.mjs`, at fixture `git init --template=`, with `fatal: unable to access '\\.\nul': Invalid argument`. They do not reach the code under review. The full suite is not claimed green. Its Code Analysis integration check passed; the final narrow Python changes were subsequently verified by the module and Node 22 regression runs above.
- **Implementation committed as `103e815` (pre-commit run):** Standalone checkout-availability check: setting `BAUIFY_ARCHIFY_ROOT` to an absent temporary path and running `interactive.test.mjs` produced one passing argument test and two intentional checkout-dependent skips.
- **Archive committed in `103e815`:** Final `scripts/build-zip.sh` under Node 22.23.2: 149 files. A second build compared byte-for-byte equal with `archify.zip`.
- **Archive committed in `103e815`:** `node scripts/package-smoke.mjs <temporary-extraction>/archify`: passed on Windows for the final ZIP, extracted outside the repository.
- **Staged change subsequently committed as `103e815`:** `git diff --check` and `git diff --cached --check`: passed. No new visual layout is introduced by this follow-up; no fresh perceptual review is claimed.

## TypeScript snapshot follow-up: tested patch identity

This follow-up addresses [captured TypeScript inputs](https://github.com/tt-a1i/archify/pull/419#discussion_r4048678649) and [validation revision attribution](https://github.com/tt-a1i/archify/pull/419#discussion_r4048678658).

Tested implementation: the uncommitted patch on `103e8153c3df9c865765e1da43a4d221731f8b46`, with stable patch ID `e3fe9d290a9688ba30ac0558c7575efcbde00bdd` for `archify/modules/code-analysis`. Reproduce that identifier with `git diff 103e815 -- archify/modules/code-analysis | git patch-id --stable`. No runtime or test edits were made during this follow-up's full-suite run. Subsequent edits to this evidence file only annotate results.

The compiler uses a captured in-root file inventory (including negative lookups), source bytes and JSON metadata for configuration parsing and module resolution. Config inheritance, path aliases, package entry points and excluded-file classification remain supported. Installed config packages and uncommon config extensions are memoized and revalidated; a changed required input fails with `extract/source-changed`. The earlier OS-level filesystem-race limitation still applies.

Every result in this section applies to the patch ID above, not to bare `103e815`:

- Windows, Node 22.23.2, bundled Python selected with `BAUIFY_PYTHON`: `node --test archify/modules/code-analysis/test/*.test.mjs` — 94 passed, zero failed or skipped. Six new tests cover configuration/package mutations, removed and newly created resolution candidates, excluded declarations, installed config packages, uncommon config extensions, and UTF-16 configuration.
- Windows, Node 22.23.2, `ARCHIFY_CHROME` set to installed Chrome: `node --test archify/test/code-analysis-browser.test.mjs archify/test/start.test.mjs` — three passed, zero failed or skipped. This is automated browser evidence, not a new perceptual review.
- `scripts/build-zip.sh` under Node 22.23.2 — 151 files; a second build matched exactly. Tested archive SHA-256: `16bfdd3340da2875f917ea9bd62e28ae2c1583be5cf632ec772e23b4ea596818`.
- `node scripts/package-smoke.mjs <temporary-extraction>/archify` — passed on Windows for that exact archive outside the repository.
- Full repository suite on the frozen patch: 1,691 tests, 1,615 passed, 9 failed, 67 skipped. Eight failures are the existing Windows Git `\\.\nul` fixture error in `repository-evidence-replacement.test.mjs`. The ninth was `an empty precheck snapshot cannot start a second concurrent network request`; an immediate isolated rerun with the same Node 22.23.2 runtime passed (one passed, zero failed or skipped). That result is inconclusive: without comparison against both revisions or a documented independent root cause, it does not establish whether the failure was related to the TypeScript snapshot patch. The full suite is not claimed green.

No GitHub review replies or thread-resolution actions were performed. No live Archify installation was changed.
