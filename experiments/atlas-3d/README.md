# Atlas 3D (proof of concept)

The Atlas of one Code Analysis run, drawn as a particle tree in WebGL. Open `index.html` in a browser with a network connection (three.js r128 loads from cdnjs). Drag to turn, scroll to zoom, double-click to reset. The buttons at the top switch between the committed datasets (`#archify`, `#langchain-core`).

## How the tree maps to the analysis

| In the model | Comes from |
| --- | --- |
| Trunk | The module the most other modules depend on, directly or through others (`renderers/shared` in Archify, the `langchain_core` package root in LangChain core). Its files make up the trunk. |
| Height | Dependency layer: the longest chain of imports from a module down to one that imports nothing in-tree, computed with each module cycle collapsed to one node. Inside a cycle, where layers do not exist, height counts branches from where the cycle meets the tree; the page says so when that happens. |
| Branch | Grown outward from the trunk: each module joins the tree on its strongest dependency (most file dependencies) on a module already in it. Thicker for more. Modules that depend on nothing in the tree stand on the ground. |
| Thread | Every other dependency between two modules. |
| Blossom | A file. Each bright point is one of its functions: size is cyclomatic complexity, colour is the finding the analyzer reported for it (none, info, warning). The haze is its lines of code, 1 speck per 4 lines. |
| Bright threads on selection | The file-level imports of a selected finding (for example `coupling/internal-leak`), or the imports into a selected module's files. |

The side panel shows the selected file, module or finding with the analyzer's own message and first suggested fix, and copies a fix prompt for an AI agent.

## Data: the same as the Atlas

Each `data-<id>.js` is the Atlas payload, `buildAtlas()` from `archify/modules/code-analysis/overlay/atlas.mjs`, called on the run's raw facts, module graph, findings and review, unchanged. The only addition is each finding's message and first suggested fix, copied verbatim from `findings.json`. `build-data.mjs` stops if the payload and the run disagree (files, resolved in-tree imports, functions, findings).

The page also accounts for what it draws, under "Same data as the Atlas": every file and function is a particle, every finding is listed, and the file dependencies add up as branch + thread + inside-module. Dependencies inside one module are counted but not drawn as lines; the Atlas shows them.

Committed datasets, both with the default config:

| Dataset | Source | Run |
| --- | --- | --- |
| `archify` | this branch's `archify/` package | 20 modules, 138 files, 2,841 functions, 318 findings |
| `langchain-core` | [langchain-ai/langchain](https://github.com/langchain-ai/langchain) `libs/core` at `2775506` | 21 modules, 185 files, 2,305 functions, 125 findings (a 17-module cycle, 4 hubs, 2 import cycles, 15 internal-import signals) |

```sh
node archify/bin/archify.mjs code-analysis check archify --language ts --out out/archify
node experiments/atlas-3d/build-data.mjs out/archify archify Archify
node archify/bin/archify.mjs code-analysis check <langchain>/libs/core --language py --out out/lc-core
node experiments/atlas-3d/build-data.mjs out/lc-core langchain-core "LangChain · langchain_core"
```

Each dataset is analyzed one package at a time. The Python extractor resolves absolute imports from the analyzed root (or `src/`) only, so a whole-monorepo run of LangChain, whose packages live under `libs/<name>/` with their own `pyproject.toml`, resolves none of its 12,971 imports. Supporting several source roots in one run is an analyzer change, not part of this proof of concept.

## Limits

- A proof of concept: not wired into `serve`, the Classic view or the packaged ZIP.
- three.js comes from a CDN, so the page needs a network connection; the overlay itself works offline.
- The tree keeps one branch per module; every other dependency between modules is a thread, so nothing is dropped, but branch versus thread is a drawing choice, not a finding.
- WebGL is required. With reduced motion, the tree is drawn at once and does not turn by itself.
