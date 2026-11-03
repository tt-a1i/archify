# Atlas showcase

Ten visual directions for presenting Code Analysis results, built to decide what the Atlas view should look like. Open `index.html` in a browser; each page works from the file system with no server.

| Page | Metaphor | What it makes obvious |
| --- | --- | --- |
| `01-skyline.html` | City skyline | Files as buildings, height = worst function complexity, lit windows = functions |
| `02-terrain.html` | Topographic map | Functions as hills; the contours at 15 and 25 are the info and warning thresholds |
| `03-constellations.html` | Star chart | Files as stars grouped by module; boundary violations as comets |
| `04-metro.html` | Transit map | Modules as stations ordered by dependency depth; forbidden routes are closed |
| `05-blueprint.html` | Floor plan | Files as rooms sized by lines; the worst 15 get revision clouds and a schedule |
| `06-strata.html` | Geological section | Dependency depth as rock layers; imports drill down, violations are faults |
| `07-matrix.html` | Dependency structure matrix | Every module pair; healthy imports stay above the diagonal |
| `08-seismograph.html` | Seismogram | Every function in reading order, zoomable, with an event log |
| `09-briefing.html` | Scrolling story | Headline numbers, the ten hardest functions, broken rules, what holds up |
| `10-microscope.html` | Stained slide | Modules as cells, files as nuclei, functions as granules; brown = past warning |

Every finding in every view has **Copy fix prompt for AI**: the prompt carries the file, line, measured complexity, nesting, length, thresholds and the analyzer's suggested first step (or, for boundaries, every offending import). The briefing can copy the ten hardest functions as one task.

## Data

`data.js` is the Atlas payload from `archify/modules/code-analysis/overlay/atlas.mjs` (`buildAtlas`), unchanged, plus finding messages, boundary imports, thresholds and module-level edges for the side panels. No view invents numbers or scores.

The committed sample is Archify analyzing its own `archify/` package on this branch, with a boundary config that forbids renderers from importing authoring tools and limits migrations to shared helpers (`analysis.config.json`). To show any other repository:

```sh
node archify/bin/archify.mjs code-analysis check /path/to/repo --out out/run [--config analysis.config.json]
node experiments/atlas-showcase/build-data.mjs out/run my-repo
```

`lib.js` derives per-file and per-module numbers (worst complexity, warning counts, dependency rank) from the payload and builds the AI prompts.

## Notes

- Complexity is a maintenance signal, not a defect; the pages say so where they rank functions.
- Unresolved imports draw no line, so a missing line is not proof of missing coupling.
- Motion respects `prefers-reduced-motion`. Fonts come from Google Fonts and fall back to system faces offline.
- These are design studies, not product code: nothing here is wired into `serve` or the packaged ZIP.

## Architecture health set (`pro/`)

A second set of ten views in one product design, built to show at a glance which modules are core and which have problems: complexity, coupling, separation of concerns (MVC-style roles), interfaces and entry points, locks and concurrency, duplication, and code organization. Open `pro/gallery.html` for screenshots or `pro/p01-overview.html` to start using it.

Complexity and coupling come from analyzer findings. The other five areas are heuristic signals computed by `pro/build-signals.mjs` from the same run's source text, each with file:line evidence; "How it is measured" on every page states each rule. Regenerate after `build-data.mjs`:

```sh
node experiments/atlas-showcase/pro/build-signals.mjs out/run
```
