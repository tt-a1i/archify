# Code Analysis

Start Archify with `npm start -- "/path/to/project" [--locale zh-CN]` from the Archify package directory. Open the printed URL for the standalone workbench and Atlas. Add `--ir architecture.json` to keep the authored diagram plus the existing click-to-analyze dual view. Use `--out` to choose an output directory; otherwise artifacts go to the system temporary directory. The legacy command below remains supported.

[Quick start guide](docs/USAGE.md) — installation, startup, and viewing analysis results.

[External diagnostics (C7)](docs/EXTERNAL-DIAGNOSTICS.md) — import existing ESLint, Ruff, SARIF and GitHub review results; browse/filter them with source coverage and evidence; export tasks and accept/revoke baseline decisions in the CLI or local viewer. Static reports retain reading and captured task export.

Imported lint errors default to warning; info stays info and the original source
level is retained. Set `external.severity: "source"` explicitly for original
error/warning/info mapping, which can show open errors in red and fail
`--fail-on error`. AI review is always warning. The CLI's default
`--fail-on warning` is unchanged. Switching an earlier source-mode import to the
new default requires baseline re-review; comparisons across that policy change
are incomparable and cannot be used for `--new-only` gating.

Code Analysis is Archify's integrated static code analysis module, imported from
Bauify (commit 4bb811c) and maintained here. It reads source dependencies
(JavaScript, TypeScript, Python, Java, Go and Rust), folds files into modules, checks import cycles, coupling,
function complexity and configured architecture boundaries, and presents a standalone workbench with Atlas. An optional authored architecture diagram remains unchanged and can be aligned with the same analysis.

It has three entry points that share the same pipeline:

- **A prepared investigation** (`prepare`): `code-analysis prepare <repo-root> --out out/analysis [--locale zh-CN] [--ir architecture.json]` creates `analysis/repo.analysis.html` with captured AI tasks, opens on the overview and exits. The reader follows `--locale`, then optional `meta.locale` (`zh-CN` or English fallback); no server stays running. See [Agent entry and investigation](docs/USAGE.md#agent-entry-and-investigation) for natural Skill delivery and restarting for comparison after edits.

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
- **In a terminal or CI** (`check`): the same analysis without a diagram (or with
  optional `--ir` / `--map` to verify diagram-to-code component mapping and
  undeclared component imports headlessly), with a baseline, a comparison with the
  previous run, and an exit code.

`archify code-analysis task` turns findings of a finished run into an AI
optimization task (JSON or Markdown) and checks its evidence against the current
working tree; the page uses the same logic through the server.

`check --json` also returns an `investigation` object for a first look: its
`leads` repeat the ranked priorities with the message, `path:line`, symbol and a
runnable `task` command, `architecture` summarizes module hotspots, strongest
cross-module edges and structural signals outside `leads`, and `ruleCounts` shows
how findings divide by rule. Run `check` with `--out` so each lead or structural
signal is drillable. See
[First look at an unfamiliar repository](docs/USAGE.md#first-look-at-an-unfamiliar-repository).

`task --question` prepares source orientation without requiring a finding: source
identity, captured function ranges and direct imports. JS/TS implementation entries
and fresh Python/Java captures can also include bounded lexical call evidence.
Python/Java entries require a saved analysis directory containing the .py/.java
entry from its matching adapter. Historical Python/Java captures without a
recognized call model retain unavailable coverage and unknown totals.
The host Agent then follows [the function analysis workflow](docs/FUNCTION-ANALYSIS.md)
to answer the question from source. The CLI output is an intermediate reading aid.
Adding `--base-root` with a required `--entry` prepares a fresh before/after source
comparison, including separate call and module-reading references and explicit
coverage limits. See [change questions](docs/FUNCTION-ANALYSIS.md#change-questions).

Optional [C6 duplicate detection](docs/USAGE.md#duplicate-code-c6-optional) uses a
separately installed jscpd 5.4.3 executable for all six languages. They use five
analysis adapters: `ts` covers JavaScript and TypeScript, alongside `py`, `java`,
`go` and `rust`. C6 preserves
both source locations, scan coverage, baselines and AI task evidence. It is
disabled by default and does not replace dependency or function analysis.

From the `archify/` package directory:

```sh
node bin/archify.mjs code-analysis serve /path/to/repo --ir architecture.json --out out/analysis --language py
```

The first run installs the module's Node parser and schema dependencies
(including typescript, java-parser and Ajv with SARIF draft/format support) into `modules/code-analysis/node_modules`; `npm ci` in
`archify/` does the same through its `postinstall`. Open the URL the command
prints and keep the process running. Options:
`--language ts|py|java|go|rust` (choose explicitly for a mixed-language root), `--map overlay-map.json`
(`{"componentId": ["moduleId", …]}` when the IR's `sources` do not say which
modules a component stands for), `--config file.json` (thresholds, include /
exclude, roles), `--quality standard|showcase` (passed to `archify deliver`).
Use `--baseline baseline.json` to retain review decisions at a stable project
path; otherwise the local viewer writes `<out>/baseline.json`.

Output under `--out`: `architecture.html` (Archify's artifact, untouched) and,
after the click, `analysis/raw-facts.json`, `analysis/module-graph.json`,
`analysis/findings.json`, `analysis/review.json`, `analysis/overview.json` and
`analysis/repo.analysis.html` — the delivered page plus the appended analysis
layer, self-contained. `analysis/view-context.json` retains the original view
mapping and scope so review decisions can rebuild that captured page without a
new analysis. Click **Re-analyze** for a fresh analysis after changing
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

Go source investigation supports root-module packages, function definitions and conservative direct function bindings. It requires Go 1.18+; build conditions, exclusions and incomplete typing are explicit. See [Go source scope and limitations](docs/GO.md).

Rust source investigation uses Cargo/rustc 1.71+ and a bundled source helper with
locked parser dependencies; its first run compiles that helper and may fetch
those dependencies. Captured Cargo metadata, cfg/features, omitted sources and
unknown dispatch remain explicit. See [Rust source scope and tooling](docs/RUST.md).
Enabling C6 retains these language tools and parsers; jscpd supplies token
duplicate detection and does not replace dependency, call or language-scope facts.
