# Go source analysis

Go analysis uses **official Go libraries** for captured package and call facts:
`go/packages`, `go/types`, `go/ast`, `typeutil.Callee` and the module parser.
It preserves functions and metrics, package edges, direct callers, interface
candidates and changed-definition queries. These facts do not prove a successful
project build, a runtime call graph or complete impact coverage.

```sh
node archify/bin/archify.mjs code-analysis check /path/to/module --language go --fail-on never --out /tmp/go-analysis --json
node archify/bin/archify.mjs code-analysis task /tmp/go-analysis --root /path/to/module --entry main.go --function Entry --question 'Where does this call resolve?' --format json --out /tmp/go-question.json --json
node archify/bin/archify.mjs code-analysis task --root /path/to/after --base-root /path/to/before --entry main.go --question 'What known references reach this changed definition?' --format json --out /tmp/go-change.json --json
```

## Dependencies and lifecycle

The official VS Code Go extension uses gopls by default
(`go.useLanguageServer: true`; [official settings](https://github.com/golang/vscode-go/blob/master/docs/settings.md#go.uselanguageserver)).
Archify uses gopls as a design reference and validation oracle. Its bounded
snapshot analyzer uses the public Go libraries directly, while retaining its
own metrics and interface evidence projection.

Three Go versions have separate responsibilities, as in gopls:

| Version | Selection and requirement |
| --- | --- |
| Project SDK | `ARCHIFY_GO`, otherwise `go` on PATH. Minimum Go 1.25; tested SDK families: 1.25, 1.26 and 1.27. |
| Helper compiler | `ARCHIFY_GO_BUILD`, otherwise the project Go command. Go 1.26+ and at least the project SDK's major language release. Go's toolchain selection defaults to `auto`; an explicit process `GOTOOLCHAIN` is honored for this build only. |
| Project language | The captured go.mod `go` directive, default 1.16, with Go's per-file release constraints. An older language version does not require an old SDK. |

Go 1.25 can therefore remain the project SDK while Go automatically finds or
downloads a newer compiler for the helper. This does not replace the global Go
installation or change the project's go.mod. To use two installed SDKs explicitly:

```sh
ARCHIFY_GO=/path/to/go1.25/bin/go ARCHIFY_GO_BUILD=/path/to/go1.26/bin/go node archify/bin/archify.mjs code-analysis check /path/to/module --language go --json
```

gopls and an LSP client are not runtime dependencies.
The helper locks `x/tools v0.52.0`, `x/mod v0.43.0` and `x/sync v0.24.0`
in its own go.mod/go.sum. These official tool modules are not part of the Go SDK.

Each analysis builds Archify's helper in a temporary directory, using Go's build
and module caches. The first build may download a Go toolchain and these locked
**helper** dependencies using Go's configured proxy. For offline use, prepare a
Go 1.26+ build SDK and the modules beforehand, then set `ARCHIFY_GO_BUILD` to that
SDK and `GOTOOLCHAIN=local`. For example, using the intended build SDK:

```sh
cd archify/modules/code-analysis/extract/go
GOTOOLCHAIN=local GOWORK=off /path/to/go1.26/bin/go mod download
```

The subsequent **project capture** phase disables module proxy/checksum access,
automatic toolchain downloads and external package drivers. `ARCHIFY_GO` selects
the installed SDK itself (`GOTOOLCHAIN=local`, independent of the helper build).
A project requiring a newer Go language version than that SDK fails visibly;
select a suitable installed project SDK. It runs `go list`
only on captured source in an isolated module. Project applications, tests and
generators are never executed. SDK exports and Go caches may be prepared.

A bounded Node worker supervises the build and analysis process groups and removes
their temporary files. Missing tools/dependencies, invalid modules, tool crashes,
invalid output and timeout produce structured `extract/go-*` diagnostics; the CLI
exits 2. Tool failures identify the project-SDK, helper-build or analysis phase.
Package/type errors remain partial evidence in `languageScope.typing`;
an empty package load for selected valid source is an explicit failure.

## Captured build scope

The root requires go.mod. Official module parsing handles block directives and
Go string escapes. The isolated module retains only its module path and language
version; absent a go directive, Go's default is **1.16**. Both analysis modes
enforce this version. Third-party require entries, replacements, toolchain
selection, go.work, nested modules, vendor, cgo and excluded files are not loaded.
Missing third-party types remain incomplete even when a module cache contains them.

```json
{"go":{"goos":"linux","goarch":"amd64","tags":["custom"],"tests":true,"cgo":false}}
```

Absent GOOS/GOARCH use their environment values, otherwise the host. Ambient
GOFLAGS are ignored. Official `go/build.Context.MatchFile` selects filenames and
build constraints. Selected tests remain raw evidence, but the graph's default
role policy excludes them. Production, internal-test and external-test inventories
stay distinct; receiver identity follows the actual typed package variant.
Parse failures, mixed package names, exclusions and captured metadata stay visible.
Release and tool tags come from the selected SDK's `go list` build context for
the requested target, including its CPU-feature and experiment tags; they do not
come from the compiler that built the helper.

By default, `go/packages` provides syntax/type data and SDK export types.
`go.stdlib:false` loads package metadata, then checks captured packages with
`go/types` without SDK declarations. No default-mode recheck or gopls fallback
runs. This preserves the existing partial-typing behavior; the disabled mode is
not a promise that no SDK metadata is read by the Go command.

## Responsibilities and evidence

| Responsibility | Owner |
| --- | --- |
| Module syntax | Official `x/mod/modfile` |
| Package discovery and test variants | Official `go/packages` |
| Named call objects, receiver and method sets | Official `typeutil.Callee` / `go/types` |
| UTF-16/end-exclusive ranges, hashes, complexity/nesting, direct callers | Go AST plus Archify evidence projection |
| Whole-interface satisfaction, value/pointer distinction and promotion evidence | Official type relations plus Archify projection |
| Scope, invalid/duplicate declaration guards, saved evidence and navigation | Archify adapter and consumers |

Current captures use **`go-source-direct-v6`**, producer
`go-packages@<x/tools-version>`, adapter revision 9. `languageScope.loader`
records the loading mode, tool-module versions/checksums, helper compiler
(`toolchain`), project SDK (`projectToolchain`), language version and isolated scope.
`build.toolchain` and `standardLibrary.toolchain` identify the project SDK.
`standardLibrary` records the prepared SDK export evidence;
its `projectCommands:true` acknowledges package-loading commands on the snapshot,
while `loader.projectCodeExecuted:false` distinguishes executing project code.
Loader identity participates in capture fingerprints and paired comparisons.

Bindings retain free functions, concrete methods, aliases, promotion, generic
method instances and method expressions. Interface calls bind captured declarations,
with runtime targets unknown; external embedded interface methods retain identities
without invented locations. Function variables/fields, builtins, conversions,
bodyless/external declarations and type-parameter dispatch remain unresolved.
Anonymous literals contribute calls but are not separate measured functions.

Interface implementation edges distinguish value and pointer satisfaction of the
**whole interface**, not just matching method names. Generic/type-alias and incomplete
interface coverage is explicitly reported. These candidates do not prove runtime
dispatch, successful compilation or a complete caller set.

Historical go-parser v1-v4, experimental gopls v5 and revision-8 v6 captures remain readable
without installing or starting their former producer. Freshness checks for source
and go.mod/go.work still apply. Different producers, loader/SDK/build options and
captured metadata restrict comparison; old results are not rebound as v6 facts.
These checks do not establish whole-tree atomicity or discover later file additions.
`--fail-on never` changes the findings gate, not incomplete-coverage semantics.

See [PR #1347](https://github.com/tt-a1i/archify/pull/1347) for the design decision,
validation evidence and remaining compatibility limits.
