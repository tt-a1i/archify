# Go source analysis

Go support is experimental source investigation, not a project build or a complete impact graph. Select it through the normal CLI:

```sh
node archify/bin/archify.mjs code-analysis check /path/to/module --language go --fail-on never --out /tmp/go-analysis --json
node archify/bin/archify.mjs code-analysis task /tmp/go-analysis --root /path/to/module --entry doc/man_examples_test.go --function ExampleGenMan --question 'Where does GenMan resolve?' --format json --out /tmp/go-question.json --json
node archify/bin/archify.mjs code-analysis task --root /path/to/after --base-root /path/to/before --entry doc/man_docs.go --question 'What known references reach this changed definition?' --format json --out /tmp/go-change.json --json
```

The root must have a captured `go.mod` with its module directive. One run analyzes that module; nested modules, `go.work`, `replace`, external dependencies and vendor directories are not loaded. A package import is matched by the declared module path plus its directory, not by basename or directory proximity. Missing dependencies remain external/outside and do not trigger network access.

## Toolchain and cost

An installed Go **1.18+ compiler** is required alongside Node. The helper uses only Go standard-library `go/parser`, `go/ast`, `go/build` and `go/types`. `go run` compiles Archify's bundled helper, never the analyzed module, and uses the installed local toolchain/cache. It does not invoke `go list`, download modules, run project code or build cgo. `ARCHIFY_GO` can select the Go executable. A missing executable produces structured `extract/go-unavailable` with installation guidance and exit 2; a compilation/process error produces `extract/go-failed`.

No additional npm dependency or separate language server is added. Initial helper compilation needs Go's normal compiler cache and costs more than a warm run. An isolated tiny-input measurement took 2.46 seconds with a fresh empty Go compiler cache and 0.27 seconds reusing that cache (Go 1.27.2 on this machine). These are finite local measurements, not a cold-machine or real-repository performance benchmark. The existing Homebrew Go 1.27.2 installation occupied 270 MiB; a fresh installation/download size and first-run latency were not measured. Users without Go must install the toolchain; the parser is not embedded in the ZIP as a platform binary.

## Build and source coverage

`coverage.languageScope` in the CLI JSON receipt, `raw-facts.json.languageScope`, and question scope report:

- Root module and captured `go.mod`/`go.work` inputs, with source text and hashes.
- Actual GOOS/GOARCH, explicit build tags, Go release tags/toolchain, tests and cgo scope.
- Selected source filenames, packages and external-test variants; every excluded Go filename has a reason.
- Parse failures separately from incomplete source typing, with typing error count, up to 20 diagnostic examples and the external packages not loaded.

Optional config:

```json
{"go":{"goos":"linux","goarch":"amd64","tags":["custom"],"tests":true,"cgo":false}}
```

Absent GOOS/GOARCH use those environment values when set, otherwise the host. Build tags default to empty; ambient GOFLAGS are deliberately not loaded. Test files default to included for investigation. Production packages, internal-test variants and external-test packages are checked separately; tests/generated files remain excluded from the module graph under its existing default role policy. Excluded roles affect the graph, not raw call capture or reverse-reference enumeration. Config include/exclude still applies.

`go/build.Context.MatchFile` evaluates platform filenames, `//go:build`/legacy constraints and release tags against captured bytes. Cgo source, Go-ignored directories (including examples under `_...`), vendor and nested modules are excluded explicitly. This is a source build selection, not confirmation that every selected package compiles.

## Definitions, dependencies and calls

Function/receiver declarations with bodies have exact UTF-16, end-exclusive ranges and source hashes; paired questions compare `FuncDecl` source regions and enumerate captured known direct callers across files/packages. Anonymous function bodies are included in syntactic call inventory but are not separate measured declarations. Struct/type/field navigation is not yet a separate definition capability.

`go-source-direct-v1` records Go `ast.CallExpr`, including conversions, nested literals and unresolved calls. It uses `go/types.Info.Uses` to identify captured free-function declarations. Ordinary imports, import aliases, generic instantiation syntax and same-package cross-file direct functions can bind. A native `go-direct-function` fact can target another file without an import statement when both belong to the same package.

External packages are represented by declaration-free placeholders. Consequently type information is **incomplete**: reported targets establish a source function binding, not successful compilation, argument applicability, execution or runtime dispatch. Only observed function objects whose declarations are captured can produce targets. Parse-invalid packages and duplicate function/value/type names do not select an arbitrary implementation.

Methods, interface dispatch, function variables, closures, builtins, conversions and unavailable external targets remain unresolved. No points-to/callgraph solver is implied. Package import edges refer to package source membership; they are not per-symbol definition claims. Go package grouping is used unless explicit grouping/depth changes it.

Saved questions verify captured metadata freshness as well as source; a changed `go.mod` prevents valid binding navigation. Paired questions record build options/metadata and limit attribution when they differ. These checks do not establish whole-tree atomicity, discover newly added files after capture or re-resolve the project at navigation time. Read the selected/excluded scope before interpreting a missing caller. `ready` means usable source orientation, not complete impact or successful compilation. `--fail-on never` preserves the existing finding-gate contract; consult coverage even when its exit code is 0.
