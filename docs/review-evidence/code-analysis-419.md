# Code Analysis PR 419 validation

## P1/P2 working-tree verification (2026-09-17)

The PR branch now includes upstream `dev` at `31bfbc8` through local merge
`1cce859`. The fixes below were tested as uncommitted working-tree changes after
that merge, on Windows with Node 24.19.0. This is not final-head remote CI evidence.

- P1: JS/TS and Python extraction explicitly identifies working-tree results.
  HEAD is only `baseRevision`; source panels retain the parsed text, and results
  cannot generate commit-based source links. A snapshot digest pairs graphs and
  findings with their captured facts. Dirty, untracked, post-extraction edits,
  removed source files, and non-Git extraction are covered.
- P2: changing or removing the authored JSON after startup returns HTTP 409 with
  `analysis/architecture-changed`. The page asks the reader to regenerate the
  diagram. Original input bytes are never rewritten, and cached responses are
  checked too.

Passed: `node --test archify/modules/code-analysis/test/source-identity.test.mjs archify/modules/code-analysis/test/interactive.test.mjs` (6 tests).
Passed with `ARCHIFY_CHROME` pointing to Chrome: `node --test archify/test/code-analysis-browser.test.mjs archify/test/code-analysis.test.mjs archify/test/start.test.mjs` (5 top-level tests, including the complete module regression subprocess).
The Chrome test verifies the exact changed-architecture notification and the
button, finding, captured-source panel, and return-to-diagram flow. It is
registered in the shared browser gate; the entire browser gate was not run.

`npm test` completed with 1,571 passed, 12 failed, and 72 skipped. The Skill-length
failure was subsequently fixed and its `packaged skill puts` targeted check
passed. The other failures concern missing `unzip`, Bash/path handling in the
Star History and archive-build checks, and eight Git null-device fixture failures
on Windows. The full suite was not repeated after the documentation correction.
`git diff --check` passed. The release ZIP has not been rebuilt, no new perceptual
visual acceptance is claimed, and no changes have been pushed for remote CI.

## Latest merged-source verification

The remote PR merged main while these fixes were being validated. That update was preserved in merge commit `a3ec5820050c8cf966a85526e40361410fd8f973`.

A clean Ubuntu/Node 22.23.2 run on that source, with its freshly rebuilt archive, completed 1,372 tests: 1,323 passed, 1 failed, and 48 skipped. The sole failure was the Chinese README line budget after combining the upstream additions and the module link. The link was folded into the existing contribution paragraph, and this targeted check then passed:

```sh
node --test --test-name-pattern="README stays scannable" archify/test/readme-showcase.test.mjs
```

No runtime code changed after that full run. The full suite was not repeated for the final repository-only README/evidence edits. The archive was regenerated from the clean merged source; its SHA-256 is `305d4f6c4a026862acd155d94d9884824cc2b8b932b24d3ab987d6e3f9e6a4b4`.

The browser flow below was also rerun against the merged Viewer: source line 34, context scrolling, and toggling analysis off passed. Source-panel screenshots were inspected again. This latest run supersedes the pre-merge evidence below where upstream behavior changed; the earlier results remain identified by their original revision.

## Pre-merge verification


Runtime and package revision: `e2700b0fe5528d8a1639ce7eaa2ac7d80dd7fe5f`.
Comparison base for these fixes: `dec33fa941d3f35a4b9e36c73dd0b41d89b3e3d2`.
This evidence document is a subsequent documentation-only change and is outside the packaged skill.

## Changes verified

- Concurrent starts for one repository use separate default output directories. Both sessions can analyze their own diagram, and the delivered HTML remains unchanged.
- Python launcher selection skips unavailable or incompatible interpreters. Errors from a compatible interpreter still report `extract/python-failed`.
- Runtime packages survive production-only installation. The server defers analysis imports until dependencies are available.
- Python fixture tests generate their own isolated output. Server cleanup uses socket tracking instead of requiring Node 18.2's cleanup API.
- README commands use supported entry points. Local validator workspaces are excluded from the self-analysis fixture.

## Automated commands

From the repository root, on Windows with Node 24.19.0 and Python 3.11:

```sh
node --test archify/test/start.test.mjs archify/modules/code-analysis/test/python-launcher.test.mjs archify/modules/code-analysis/test/extract-py.test.mjs archify/modules/code-analysis/test/interactive.test.mjs
node --test --test-name-pattern="PEP 420" archify/modules/code-analysis/test/extract-py.test.mjs
node --test archify/modules/code-analysis/test/extract-self.test.mjs
```

The focused checks passed. Browser and focused runtime checks used the same runtime source as the revision above; the clean Linux run below used that exact committed revision.

A clean staged module was also checked with:

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node -e "Promise.all([import('ajv/dist/2020.js'),import('typescript'),import('./lib/analysis.mjs')]).then(()=>console.log('Production imports passed'))"
```

Result: production imports passed. A fresh archive without node_modules also loaded `code-analysis serve --help` successfully.

## Package and complete suite

Environment: clean Ubuntu checkout, Node 22.23.2, npm 10.9.8, Python 3, and unzip installed. Commands from the repository root:

```sh
bash scripts/build-zip.sh /tmp/archify-final-fresh.zip
cmp archify.zip /tmp/archify-final-fresh.zip
cd archify
npm ci --no-audit --no-fund
npm test
```

ZIP comparison passed. SHA-256: `4e50d4229c52cd6db5b2efecc095cc9e5762cd1d97b3abca04e7158e28fdc5d4`.

Result on `e2700b0fe5528d8a1639ce7eaa2ac7d80dd7fe5f`: `npm test` exited 0; 1,060 tests, 1,032 passed, 0 failed, 28 skipped. Brand-mark, validator, release-identity, and golden-render checks also passed.

An earlier Windows full-suite run had 12 failures, including Unix tooling/mode assumptions and two issues subsequently corrected here (README length and scratch-directory contamination). The first Linux run passed 1,028 tests and failed four archive checks because unzip was absent; the run above includes unzip. These earlier runs are not claimed as passing evidence.

## Browser and visual evidence

Input: the local AI Voice Assistant project at revision `591f6bc`, with its authored architecture JSON and explicit overlay map. Start from the repository root using:

```sh
node archify/bin/archify.mjs start "<ai-voice-project>" --ir "<ai-voice.manual.architecture.json>" --map "<ai-voice.overlay-map.json>" --language py
```

Comparison conditions: Edge/Chromium, 1440 x 1000 viewport, Light theme, Classic preset, 100% displayed zoom, same input and page session before/after analysis.

Automated browser actions and results:

1. Open the printed URL and click Code Analysis: the analysis toggle appears and the layer is enabled.
2. Select ASR service, then Hub module: the detail panel opens.
3. Click the visible `asr/correct.py:34` source link: the right source panel highlights line 34, containing `from tools.search import lexicon`.
4. Scroll the source container: scroll position changes, confirming context navigation.
5. Toggle Code Analysis off: the page reports `data-bauify="off"`.

The fresh-server automated regression separately verifies that no extraction occurs before the request, checks the request authorization boundary, and verifies the original delivered HTML remains unchanged.

Perceptual review: inspected before/after and source-panel screenshots locally. The Hub detail connectors stay between module boxes, and the source panel displays the selected line with context. This is a limited desktop check, not a claim of full responsive or accessibility coverage. The analysis hint overlays part of the header in the overview screenshot; this existing layout behavior was not changed in these fixes. Narrow viewports, other themes, and other browsers were not visually reviewed. Project-source screenshots and generated analysis artifacts are not included in this PR.

Required remote CI and maintainer review still apply.
