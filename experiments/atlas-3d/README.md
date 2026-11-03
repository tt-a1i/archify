# Atlas 3D (proof of concept)

The Atlas of one Code Analysis run, drawn as a particle tree in WebGL. Open `index.html` in a browser with a network connection (three.js r128 loads from cdnjs). Drag to turn, scroll to zoom, double-click to reset.

## How the tree maps to the analysis

| In the model | Comes from |
| --- | --- |
| Trunk | The module the most other modules depend on, directly or through others (`renderers/shared` in the sample). Its files make up the trunk. |
| Height | Dependency layer: the longest chain of imports from a module down to one that imports nothing in-tree. Layer 0 modules other than the trunk stand on the ground. |
| Branch | Each module's strongest dependency, the one with the most file dependencies. Thicker for more. |
| Thread | Every other dependency between two modules. |
| Blossom | A file. Each bright point is one of its functions: size is cyclomatic complexity, colour is the finding the analyzer reported for it (none, info, warning). The haze is its lines of code, 1 speck per 4 lines. |
| Bright threads on selection | The file-level imports of a selected finding (for example `coupling/internal-leak`), or the imports into a selected module's files. |

The side panel shows the selected file, module or finding with the analyzer's own message and first suggested fix, and copies a fix prompt for an AI agent.

## Data: the same as the Atlas

`data.js` is the Atlas payload, `buildAtlas()` from `archify/modules/code-analysis/overlay/atlas.mjs`, called on the run's raw facts, module graph, findings and review, unchanged. The only addition is each finding's message and first suggested fix, copied verbatim from `findings.json`. `build-data.mjs` stops if the payload and the run disagree (files, resolved in-tree imports, functions, findings).

The page also accounts for what it draws, under "Same data as the Atlas": every file and function is a particle, every finding is listed, and the file dependencies add up as branch + thread + inside-module. Dependencies inside one module are counted but not drawn as lines; the Atlas shows them.

The committed sample is Archify analyzing its own `archify/` package on this branch with the default config:

```sh
node archify/bin/archify.mjs code-analysis check archify --language ts --out out/run
node experiments/atlas-3d/build-data.mjs out/run archify
```

## Limits

- A proof of concept: not wired into `serve`, the Classic view or the packaged ZIP.
- three.js comes from a CDN, so the page needs a network connection; the overlay itself works offline.
- In a module cycle the back edge adds no layer, so cycle members can share a height.
- The tree keeps one branch per module (its strongest dependency); every other dependency is a thread, so nothing is dropped, but branch versus thread is a drawing choice, not a finding.
- WebGL is required. With reduced motion, the tree is drawn at once and does not turn by itself.
