# Code Analysis Architecture

Code Analysis is an integrated Archify module. This document describes the implemented pipeline and its current boundaries. For startup commands, see [the usage guide](docs/USAGE.md).

## Entry point and lifecycle

From the Archify package directory:

```sh
npm start -- "/path/to/project" --ir architecture.json
```

`bin/archify.mjs` dispatches `start` to this module's `bin/serve.mjs`. The legacy `archify code-analysis serve` command reaches the same implementation. The unified entry supplies a temporary output directory when `--out` is omitted.

The server first invokes Archify's `deliver architecture` command with the authored JSON. If the input pins repository evidence, delivery checks it against the project's Git repository. Delivery failures stop startup before a page is served.

The server serves the diagram on a loopback address with a Code Analysis button. Source extraction starts only when the reader clicks that button. Concurrent requests share a pending analysis; successful results are cached for the server lifetime. A failed analysis can be retried. Source or configuration changes require a server restart and another analysis request.

## Analysis pipeline

`lib/analysis.mjs` coordinates four stages:

1. **Extract facts** (`extract/`): select the Python or JS/TS adapter, read source files, and record files, imports, available symbol information, and unresolved dependencies. Python uses an AST extractor; JS/TS uses the TypeScript Compiler API. Each run selects one language.
2. **Build the module graph** (`graphs/module.mjs`): group files by explicit configuration, package boundaries, or directory depth; aggregate dependencies between modules; calculate file ownership and module metrics. Root-level files form individual modules. Test and generated roles are excluded by default and counted in the output.
3. **Evaluate rules** (`evaluate/`): run the import-cycle, module coupling-cycle, and hub rules. Findings include severity, subjects, and supporting evidence. Configured rule suppression is counted in the summary.
4. **Build the analysis view** (`overlay/inject.mjs`): map authored components to code modules using source references or an explicit mapping, then add findings and source navigation to a copy of the delivered page.

The orchestrator validates intermediate data against JSON schemas. It also checks that supplied raw facts and module graph data agree on repository metadata, file ownership, and dependency aggregates.

## Current findings and presentation

The implemented rules inspect file-level import cycles, module-level coupling cycles, and modules with high incoming and outgoing dependency counts. Import evidence distinguishes relevant loading conditions such as lazy, conditional, and type-only imports. Findings describe static structure and potential loading risks; they do not prove a runtime failure or certify safe execution.

The analysis layer provides component details, dependency diagrams, findings, and a source panel. Source references with line numbers locate the associated evidence; references without a line number open the file without marking its first line as a finding. The source panel supports scrolling through context. The Code Analysis button toggles the layer after analysis succeeds.

## Files and responsibilities

- `bin/`: delivery, local server, and click-triggered analysis requests.
- `config/`: default source inclusion, exclusions, and file-role patterns.
- `extract/py/`: Python extraction and adapter integration.
- `extract/ts/`: JavaScript and TypeScript extraction.
- `extract/shared/`: file, Git metadata, matching, diagnostics, semantics, and schema helpers.
- `graphs/`: module grouping and dependency aggregation.
- `evaluate/rules/coupling/`: the three implemented finding rules.
- `lib/`: pipeline orchestration and intermediate-data checks.
- `overlay/`: mapping and browser presentation.
- `schemas/`: raw-facts, module-graph, and findings contracts.
- `test/`: regression tests, small source fixtures, and expected extraction results.
- `docs/`: usage and technical documentation.

## Outputs

Before analysis, `<out>/architecture.html` contains Archify's delivered artifact. The server adds its startup button to the served response without overwriting that artifact.

After successful analysis, `<out>/analysis/` contains:

- `raw-facts.json`
- `module-graph.json`
- `findings.json`
- `repo.analysis.html`

The analysis HTML embeds source context for mapped and evidence files and can display existing results offline. It cannot rescan a project without the local server. A failed pipeline can leave intermediate JSON files; their presence alone does not mean analysis completed successfully.

## Runtime dependencies and boundaries

The module uses `typescript` for JS/TS parsing and `ajv` for JSON schema checks. Python analysis also requires a Python interpreter. Archify's installation installs module dependencies; the server can install missing dependencies on first use.

The local server checks the request host and requires the matching origin and per-server token for analysis requests. Embedded source collection is bounded to the analyzed source root.

The analyzer does not execute the analyzed application or call an LLM. It currently does not implement separate call, test, or Git-change graphs, complexity or duplication rules, taint analysis, concurrency or resource-safety verification, automatic fixes, or a composite quality score. Results identify a working-tree extraction with captured source text and a snapshot digest. Git HEAD is contextual base metadata, not the revision of the analyzed content; it is not a change-impact analysis.
