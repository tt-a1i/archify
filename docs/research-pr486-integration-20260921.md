# PR #486 repository inspection integration

Source: [`tt-a1i/archify#486`](https://github.com/tt-a1i/archify/pull/486), authored head `2068bf7dd7c1b1581b147feaf799471f3b9fb467`. Integration base: performance branch `d8a64754381acd798bd0d33a212ae07e58caa6ff`. This research integration carries the new `inspect-repo` CLI, file filtering, configuration discovery, deterministic paging, and Git snapshot reuse. It does not pull in the PR's inherited `main` history or make the scanner mandatory for ordinary repository diagrams.

The scanner is an optional lead finder when project instructions, manifests, and known entry points do not locate the requested slice. Repository authoring still requires reading implementation source and citing supported claims. Inventory coverage does not prove semantic coverage. Only the current file page's manifests and entry points are returned, avoiding global lists on every page.

Corrections to the source PR:

- Each configuration reports `truncated` for byte limits and `factsTruncated` for the 50-item fact limit; `boundariesTruncated` reports the separate 50-item roll-up limit. These indicators remain explicit even when file coverage is complete.
- Docker Compose `depends_on` supports unquoted inline lists and long-form condition maps without inventing edges to `condition` or `restart`.
- URL userinfo and query/fragment data are removed from returned Terraform module references and other URL-like references. Output still contains selected names and paths, which may be sensitive in private repositories and should be kept local.

The reproducible synthetic benchmark and saved local result are in [`benchmarks/pr486-inspect-repo-20260921/`](../benchmarks/pr486-inspect-repo-20260921/README.md). On 2,040 tracked files, the second page had an 84.7 ms median with snapshot reuse versus 159.7 ms with a fresh scan (five alternating runs). This demonstrates only a local scanning advantage. It does not establish lower total Agent tokens, complete diagram quality, or same-quality end-to-end delivery time.

A [Luna/medium Hono authoring trial](research-pr486-luna-trial-20260921.md) likewise found no proven end-to-end speedup: both arms passed machine gates but missed the predeclared semantic/readability floor, and the recorded timing pair was confounded by a baseline pause. The tool remains opt-in.

A dogfood invocation on this clean integration checkout returned 923 retained files, 13 directory modules, and a 20-file first page of 18,993 JSON bytes. Its configuration summary identified `archify/package.json` and `.github/workflows/ci.yml`, which are useful leads. The first page also surfaced fixture CLIs before Archify's actual top-level CLI, so it is not a reliable standalone source map; targeted follow-up remains necessary.

Validation on the integration worktree: 14 focused repository-index/Level 1 tests passed; `npm test` completed with 1,730 passed, 72 skipped, and no failures; a Node 22 rebuild byte-matched `archify.zip`; the extracted archive passed `scripts/package-smoke.mjs` on macOS. The skipped browser suites are not browser acceptance for a newly drawn diagram; this integration does not change renderer or Viewer behavior.
