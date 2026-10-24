# Code Analysis Architecture

Code Analysis is an integrated Archify module. This document describes the implemented pipeline and its current boundaries. For startup commands, see [the usage guide](docs/USAGE.md).

## Entry point and lifecycle

From the Archify package directory:

```sh
npm start -- "/path/to/project" --ir architecture.json
```

`bin/archify.mjs` dispatches `start` to this module's `bin/serve.mjs`. The legacy `archify code-analysis serve` command reaches the same implementation. The unified entry supplies a temporary output directory when `--out` is omitted.

The server first invokes Archify's `deliver architecture` command with the authored JSON. If the input pins repository evidence, delivery checks it against the project's Git repository. Delivery failures stop startup before a page is served.

The server serves the diagram on a loopback address with a Code Analysis button. Source extraction starts only when the reader clicks that button. Each analysis runs in a child process (`bin/analyze-run.mjs`), so the server stays responsive. Concurrent requests share a pending analysis, and the latest successful result is returned until the reader clicks **Re-analyze**. That runs a new analysis, which replaces the result only when it succeeds; the page then reloads and opens it. A failed analysis leaves the last good result and can be retried. Each run reads the config file again; only a changed architecture JSON requires a server restart.

`POST /task` (same origin and token checks) builds an AI optimization task for finding ids of the current result and checks its evidence against the working tree. The request carries finding ids only; the result directory and repository root are fixed by the server.

`archify code-analysis check` (`bin/check.mjs`) runs extract → graphs → evaluate without a diagram for terminals and CI, and exits non-zero when an open finding reaches the configured level.

`archify code-analysis task` (`bin/task.mjs`) builds an AI optimization task from a finished run's `findings.json` and `raw-facts.json` (`lib/task.mjs`) and optionally checks its evidence against the working tree (`lib/evidence.mjs`).

## Analysis pipeline

`lib/analysis.mjs` coordinates four stages:

1. **Extract facts** (`extract/`): select the Python, JS/TS or Java adapter, read source files, and record files, imports, available symbol information, and unresolved dependencies. Python uses an AST extractor; JS/TS uses the TypeScript Compiler API; Java uses `java-parser` CSTs reduced to a declaration/reference index one file at a time. Each run selects one language.
2. **Build the module graph** (`graphs/module.mjs`): group files by explicit configuration, package boundaries, or directory depth (Java: build modules, or packages in a single-module build); aggregate dependencies between modules; calculate file ownership and module metrics. Root-level files form individual modules. Test and generated roles are excluded by default and counted in the output.
3. **Evaluate rules** (`evaluate/`): run the import-cycle, module coupling-cycle, and hub rules; function complexity (Python, JS/TS and Java); and architecture-boundary rules when the config declares them. Java cycles describe structural dependencies, without inferring class initialization risk. Findings include severity, subjects, and supporting evidence. Configured rule suppression is counted in the summary.
4. **Build the analysis view** (`overlay/inject.mjs`): map authored components to code modules using source references or an explicit mapping, then add findings and source navigation to a copy of the delivered page.

The orchestrator validates intermediate data against JSON schemas. It also checks that supplied raw facts and module graph data agree on repository metadata, file ownership, and dependency aggregates.

## Current findings and presentation

The implemented rules inspect file-level import cycles, module-level coupling cycles, and modules with high incoming and outgoing dependency counts. Import evidence distinguishes relevant loading conditions such as lazy, conditional, and type-only imports. Findings describe static structure and potential loading risks; they do not prove a runtime failure or certify safe execution.

The analysis layer uses one reading column for the project overview, component pages, problem pages, and source pages. Desktop layouts reserve space beside that column for the architecture canvas; narrow windows show one reading page at a time and offer a View diagram / Show analysis toggle. Back buttons return to the previous page. Overview priorities include source locations and possible maintenance impact. Problem pages show the observed facts, up to two nine-line code excerpts, a suggested next step, and an expandable AI task preview. Relationships, metrics, and full rule evidence remain expandable. Function source views highlight the measured range as well as the selected line.

The AI task preview uses the shared task generator's Markdown. Live pages request it from the authenticated local server and recheck evidence before copying or downloading. Static reports embed captured tasks and explicitly state that the current source has not been checked. A network failure can fall back to that labeled snapshot; an HTTP rejection remains an error requiring retry or re-analysis. Clipboard failure selects the preview for manual copying. Exporting a task does not modify source files. Comparisons say “no longer detected”; incompatible or unknown comparison context is shown with its reasons rather than claiming a fix.

Source references with line numbers show a nine-line context window and highlight the cited line. References without a line number show a twelve-line file preview, explicitly labeled as opening lines rather than finding evidence. Readers can switch to the full captured file and back; excerpt lines wrap, while full-file mode retains original formatting. Unmapped modules retain their file evidence even without a component on the architecture diagram. Related components are highlighted and can be located using the Viewer camera while preserving the desktop zoom. The Code Analysis button toggles the layer after analysis succeeds.

## Files and responsibilities

- `bin/`: delivery, local server, and click-triggered analysis requests.
- `config/`: default source inclusion, exclusions, and file-role patterns.
- `extract/py/`: Python extraction and adapter integration.
- `extract/ts/`: JavaScript and TypeScript extraction.
- `extract/java/`: Java parsing, conservative source dependency resolution, and method/constructor metrics. See [Java support](docs/JAVA.md).
- `extract/shared/`: file, Git metadata, matching, diagnostics, semantics, and schema helpers.
- `graphs/`: module grouping and dependency aggregation.
- `evaluate/rules/coupling/`: import-cycle, module-cycle, and hub rules.
- `evaluate/rules/architecture/`: opt-in layer boundary rules declared in the config.
- `evaluate/rules/complexity/`: shared function complexity and nesting thresholds; measurements come from each language extractor.
- `lib/`: pipeline orchestration, config merging, intermediate-data checks, review (`review.mjs`: baseline, run comparison and comparability), AI tasks (`task.mjs`: task model and Markdown rendering) and evidence checks (`evidence.mjs`: captured source against the working tree).
- `bin/check.mjs`: headless analysis for terminals and CI; `bin/task.mjs`: AI task export and evidence check; `bin/analyze-run.mjs`: one analysis run in a child process for the server.
- `overlay/`: mapping and browser presentation.
- `schemas/`: raw-facts, module-graph, findings, baseline, and AI task contracts.
- `test/`: regression tests, small source fixtures, and expected extraction results.
- `docs/`: usage and technical documentation.

## Outputs

Before analysis, `<out>/architecture.html` contains Archify's delivered artifact. The server adds its startup button to the served response without overwriting that artifact.

After successful analysis, `<out>/analysis/` contains:

- `raw-facts.json`
- `module-graph.json`
- `findings.json`
- `review.json` (baseline status and comparison with the previous run)
- `overview.json`
- `repo.analysis.html`

Each run is written to a fresh `<out>/analysis.next-*` directory and swapped in only when it succeeds. The run it replaces moves to `<out>/analysis.previous/` and is the comparison for the next run. A failed run is removed, so `<out>/analysis/` always holds the last complete result.

The analysis HTML embeds source context for mapped and evidence files and can display existing results offline. It cannot rescan a project without the local server.

## Runtime dependencies and boundaries

The module uses `typescript` for JS/TS parsing, `java-parser` for Java parsing, and `ajv` for JSON schema checks. Python analysis also requires a Python interpreter. Java analysis requires no JVM. Archify's installation installs module dependencies; the server can install missing dependencies on first use.

The local server checks the request host and requires the matching origin and per-server token for analysis requests. Embedded source collection is bounded to the analyzed source root. The `serve`, `check`, and `task` entry points all initialize missing module dependencies before loading the analysis libraries, including in a freshly extracted package.

The analyzer does not execute the analyzed application or call an LLM. AI tasks are built from the analysis data by fixed templates; applying a change is left to the coding agent the reader hands the task to. It currently does not implement separate call, test, or Git-change graphs, duplication rules, taint analysis, concurrency or resource-safety verification, automatic fixes, or a composite quality score. Results identify a working-tree extraction with captured source text and a snapshot digest. Git HEAD is contextual base metadata, not the revision of the analyzed content; it is not a change-impact analysis.
