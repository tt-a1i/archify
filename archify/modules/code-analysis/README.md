# Code Analysis

Start Archify with `npm start -- "/path/to/project" --ir architecture.json` from the Archify package directory. Open the printed URL and click **Code Analysis**. Use `--out` to choose an output directory; otherwise artifacts go to the system temporary directory. The legacy command below remains supported.

[Quick start guide](docs/USAGE.md) — installation, startup, and viewing analysis results.

Code Analysis is Archify's integrated static code analysis module, imported from
Bauify (commit 4bb811c) and maintained here. It reads source dependencies
(Python, JS/TS and Java), folds files into modules, checks import cycles, coupling,
function complexity and configured architecture boundaries, and shows the result on the architecture diagram Archify delivered — as an
extra layer the reader switches on, never as a change to the diagram itself.

It has two entry points that share the same pipeline:

- **On the diagram** (`serve`, also reached through `npm start`):
  1. **Archify delivers the authored diagram** (`archify deliver architecture …`),
     exactly as it would without this module.
  2. The delivered page is served locally with one extra toolbar button,
     **Code Analysis**.
  3. **Clicking the button runs the analysis** — source extraction, module graph,
     rules, overlay — and switches the page to the analysis view. Nothing is
     analyzed before the click. From then on the same button shows or hides the
     layer; **Re-analyze** on the overview runs the analysis again after code or
     config changes, without a restart.
- **In a terminal or CI** (`check`): the same analysis without a diagram, with a
  baseline, a comparison with the previous run, and an exit code.

`archify code-analysis task` turns findings of a finished run into an AI
optimization task (JSON or Markdown) and checks its evidence against the current
working tree; the page uses the same logic through the server.

From the `archify/` package directory:

```sh
node bin/archify.mjs code-analysis serve /path/to/repo --ir architecture.json --out out/analysis --language py
```

No separate setup: the first run installs the module's parser and schema dependencies
(typescript, java-parser, ajv) into `modules/code-analysis/node_modules`; `npm ci` in
`archify/` does the same through its `postinstall`. Open the URL the command
prints and keep the process running. Options:
`--language ts|py|java` (required when the scan matches both JS/TS and Python, or Java beside them under a root Maven/Gradle build file), `--map overlay-map.json`
(`{"componentId": ["moduleId", …]}` when the IR's `sources` do not say which
modules a component stands for), `--config file.json` (thresholds, include /
exclude, roles), `--quality standard|showcase` (passed to `archify deliver`).

Output under `--out`: `architecture.html` (Archify's artifact, untouched) and,
after the click, `analysis/raw-facts.json`, `analysis/module-graph.json`,
`analysis/findings.json`, `analysis/review.json`, `analysis/overview.json` and
`analysis/repo.analysis.html` — the delivered page plus the appended analysis
layer, self-contained. Click **Re-analyze** for a fresh analysis after changing
source code or the `--config` file; only a changed architecture JSON needs a
restart. The previous run is kept in `analysis.previous/` and compared with.

The local process exists because a standalone HTML cannot run the source
extractors. It listens only on loopback and accepts analysis requests
only from its own page; browser requests cannot select repository or output
paths. Python analysis requires Python 3; `BAUIFY_PYTHON` can select its
executable. The analyzed code is never executed.

Java analysis runs in Node.js without a JDK. It extracts source dependencies and
method/constructor complexity; it does not build the project or resolve Maven,
Gradle, Spring, generated symbols or runtime class loading. See
[Java support and limitations](docs/JAVA.md) for resolution and syntax coverage.

Findings describe working-tree facts with evidence (file, line, import, captured source) and grade
potential import-time risks without claiming that execution is safe or that a runtime failure is proven. See
[ARCHITECTURE.md](ARCHITECTURE.md) and the [technical guide](docs/TECH-GUIDE.md).

```sh
npm run test:code-analysis
```
