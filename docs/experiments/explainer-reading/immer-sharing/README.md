# Immer: see which objects are still shared

Round 48 explores a concrete reading question: after changing the first task, why is `user` still the same object? The retained page keeps the complete reference graph, adds a five-row identity summary and fits the executable code on a phone. It distinguishes unchanged data values from the observable effect of default freezing.

[Read the candidate](candidate.html) · [candidate source](candidate.archify.md) · [author's first page](author/first-draft.html) · [first source](author/first-draft.archify.md) · [experimental index](../index.html#immer).

## Verified source and actual behavior

**Immer 11.2.9**, **Node 22.23.3**, macOS arm64. The npm gitHead and GitHub tag `v11.2.9` resolve to **`75a290e44ba14bd723c8ef8546b6559c8ef3ae88`**. Three packaged TypeScript source files match that pinned upstream commit byte-for-byte; parent separately verified a fourth module. This is not an independent rebuild of the executed JS bundle. [Supplied identity](source/identity.json), [parent verification](evidence/parent-source-identity.json), [npm metadata](source/npm-metadata.json), [lockfile](source/package-lock.json), [source audit](evidence/source-audit.md). The audit records a brief expansion and restoration of the supplied identity record after author dispatch; no probe or primary-source content changed.

Primary references: [produce](https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/produce.mdx), [finalization](https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/src/core/finalize.ts), [default freezing](https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/freezing.mdx), [tree limitation](https://github.com/immerjs/immer/blob/75a290e44ba14bd723c8ef8546b6559c8ef3ae88/website/docs/pitfalls.md). Source snapshots retain the upstream [MIT license](source/LICENSE).

The [probe](source/probe.cjs) creates a fresh plain-object/array tree for each operation. [Run 1](source/probe-1.json) and [run 2](source/probe-2.json) are separate processes with identical JSON. `sameReference` means JavaScript `===`, not equal field values or measured memory addresses.

| Operation | New objects | Shared objects |
| --- | --- | --- |
| Change first task's `done` to `true` | Root, task array, first task | User, second task |
| Empty recipe | None | Entire original root |
| Assign `false` to already-false `done` | None | Entire original root |
| Change user name | Root, user | Task array and both tasks |

Original data values remain unchanged in all four cases. With default freezing, shared objects can become frozen: in the first case, original `user` and second-task objects become frozen too. Thus “the old values stay the same” does not mean all observable object attributes stay unchanged. [Probe summary](evidence/probe-summary.json), [verified brief](source/brief.md).

Scope: a plain tree, no duplicate object aliases within one input, no cycles, plugins, inserted external objects, exotic objects or asynchronous recipes. Sharing across two versions is distinct from supporting an arbitrary graph as one input. No allocation count, timing, memory-savings or React-render-count claim.

To repeat from this directory, create an isolated dependency directory and use the retained lockfile:

```sh
mkdir -p runtime
cp source/package.json source/package-lock.json runtime/
npm ci --prefix runtime --ignore-scripts --no-audit --no-fund
node source/probe.cjs
```

## Discovery and reading decisions

[Plan](evidence/plan.md), [author prompt](evidence/author-prompt.txt), [trace](author/trace.txt). One independent `gpt-6.1-terra` author at medium reasoning used the supplied evidence and frozen runtime. Work-start-before-read is 00:46:49Z, first source 00:47:05Z, first render 00:47:07Z and review completion 00:47:59Z. One authored version passed strict showcase finalization; first HTML/source and all inspection logs are retained. This is supplied-evidence discovery with self-inspection, not a controlled full-generation or speed comparison.

The author inspected the whole page at both widths and acknowledged phone scrolling. Parent retained all **eight graph nodes and eight edges**, made arrows and array indexes explicit in prose, linked actual probes and added the two same-root controls. The wide raw stdout fence became an explicitly derived summary and identity table; it is not presented as byte-for-byte terminal output.

The [first parent composition](evidence/candidate-1.html) uses equal graph/code columns. It passes strict checks, but the desktop graph labels become smaller. The retained second composition uses eight columns for the graph and four for already-reflowed code. A bounded final copy edit shortens the table label `tasks 数组` to `tasks` after a screenshot showed the last character alone on another line. [Decision and observed tradeoffs](evidence/parent-decision.md), [pre-label candidate](evidence/candidate-2-before-label.html), [harness and comparison failures](evidence/probe-failures.md).

## Actual reading, Copy and export checks

| Observation | Author | Retained candidate |
| --- | --- | --- |
| 390 px page height | 2765 px | 3383 px |
| Phone code viewport / content | 356 / 557 px | 356 / 356 px |
| Phone raw output viewport / content | 356 / 660 px | Replaced by five-row summary |
| Phone diagram viewport / content | 358 / 622 px | 358 / 622 px |
| 1440 px page height | 1918 px | 1895 px |

The phone page is longer, and the complete graph still needs horizontal scrolling. The table offers a visible summary without requiring all graph branches on screen at once. Final light/dark checks at 390/1440 confirm complete code and table widths, all eight nodes/edges and a one-line `tasks` label. [Initial same-state comparison](evidence/browser-comparison.json), [final canonical observations](evidence/after-label-browser.json), [phone summary screenshot](evidence/screenshots/after-label-390-light-table.png).

Actual Copy-control programs from author and candidate execute in the pinned runtime and produce identical stdout. A separate console-argument capture compares all five identity values, both `done` values and both freezing checks against the actual probe. Final canonical Copy bytes remain identical to that verified candidate. [Verification](evidence/copy-verification.json), [checker](evidence/check-copy.cjs), [final copied program](evidence/canonical-copied.cjs), [stdout](evidence/candidate-1-copy-stdout.txt). Reflow adds optional trailing commas; no AST-equivalence claim. Clipboard instrumentation does not test OS permission behavior.

Actual UI PNG exports: [phone, 780 × 6306](evidence/exports/candidate-390.png) and [desktop, 2880 × 3886](evidence/exports/candidate-1440.png). The graph, full code, sources and footer are preserved. The phone export shrinks the entire graph into the page, so graph labels are smaller than in the live scrolling view; the desktop export is better for reading that diagram. Selected final export regions were inspected at readable scale, with the unchanged code/footer also inspected before the local label edit. [Export dimensions and view positions](evidence/after-label-export-inspection.json), [desktop diagram screenshot](evidence/screenshots/after-label-export-1440-1.png).

The [canonical provenance check](evidence/canonical-check-after-label.json) passes at SHA **`15c2e40dd37acbead309eaa55db6d274f51c49c490f8e359cfbc331ad219cc58`**. Renaming the source changes the embedded preparation sourcePath and its digest; all other preparation fields and everything outside that bundle are identical to the final external candidate. [Comparison](evidence/canonical-difference-after-label.json). Historical author receipts retain their original paths; only the canonical candidate is asserted current. Index controls were exercised for both variants at both preview widths; it now has **25 questions, 23 projects and 62 variants**.

## Scope of delivery

This is content-only work on base `2a29f1efeb41d4bb8002830ab80e72fb477af1d7`; refreshed dev `5ecbd1bfdbf83ea747072112493c940e707569cb` remains an ancestor. Runtime **`d300979c84b2e049101ff4d6035f19425dec7225`** and the reproducible package remain unchanged; reuse [round47 coverage and limits](../clipboard-feedback/README.md). No repeated runtime suite or ZIP rebuild is claimed. No human reading study, screen-reader test, alternate browser/OS coverage or final-head remote CI was performed. No merge, release or live installation.

AI assistance: Codex parent researched, ran probes, reviewed the artifact, edited composition/copy and wrote this record; the independent Terra author created and inspected the first specimen. Maintainer `@tt-a1i` requested the exploration; human acceptance is not claimed. [Manifest](evidence/manifest.json) covers archived files except itself. Raw working evidence remains outside the repository at `/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/`.

Archive note: six browser stderr logs have terminal empty lines removed in the archived copies; raw outputs remain outside the repository. The five retained generated HTML files preserve embedded native Viewer CSS whitespace exactly, including the canonical artifact. Scoped whitespace checking excludes only those five recorded paths. [Exact paths and normalization hashes](evidence/archive-formatting.json).
