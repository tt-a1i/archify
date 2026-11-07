# Go source typing with required SDK exports

This follow-up to Rust Draft #1265 (`1788ace7a692586332bdb7ceabf17ec8eab3d54e`) preserves the cumulative six-language and original team histories. `go-source-direct-v3`, adapter revision3, uses the installed SDK's official standard-library compiler exports to recover local source bindings. No third-party product dependency, project build/test/generate invocation, approval, formal merge, release or live installation is introduced.

## One investigation step gained

In fixed Chi, `mux.go:82 rctx.Reset()` now reaches `context.go:82`. The receiver is explicitly asserted to `*Context` at71/81, but the older empty net/http/context/sync packages prevented the checker from recovering that type. SDK types let the existing go/types selector resolve it. No variable-flow guess or method-name search was added. Two `*Mux` assertions similarly recover NotFound at309→203 and MethodNotAllowed at312→223. Calls through http.Handler at73/90 remain unknown interface dispatch.

The Source→SDK→candidate comparison was frozen before implementation. All source hashes/pins, the initial interface-location oracle correction and the unchanged original Reset body are retained in source-first.json. The old Chi pair changes Match, not Reset; its two/four known callers remain a regression, not a new changed-Reset claim.

## Fixed corpus and separate denominators

| Fixed project | Newly recovered targets | Old targets changed | Full-graph compiler-known captured method bodies |
| --- | --- | --- | --- |
| Chi | 3 | 0 | 459/459 candidate matches; parent456/459 |
| gRPC | 34 | 0 | 8,070/8,070 candidate matches; parent8,036/8,070 |
| Cobra | 0 | 0 | 789/789 both sides |

All37 newly recovered targets agree with the independently configured full go/packages type graph, with zero disagreeing or unavailable targets and no full-graph diagnostics. The broader fixed cohort now matches all9,318 compiler-known captured method-body sites; no wrong or missed target remains **in that cohort**. This is not whole-project precision/recall or runtime proof. Earlier prototype and compiler observations overlap these same repositories; do not add them as independent samples. gRPC/Cobra were previously exposed but reserved from first Chi prototype tuning.

Normal source and ZIP CLI replay each score37correct,0wrong,0missed plus2reasonable interface unknowns. All64,930 call ranges,15,174 function definitions, old targets and import inventories remain. Remaining product typing diagnostics are0 Chi,10,918 gRPC and230 Cobra, reflecting untyped third-party dependencies and other source-profile limits. A lower diagnostic count does not prove complete project compilation.

## SDK and unknown scope

The default enabled scope parses the captured project sources, classifies candidate SDK imports through the SDK's own standard-package metadata, and prepares exports only for required standard-library roots/dependencies. SDK commands run in a new empty directory with modules/workspaces/cgo disabled, no project path passed to Go, GOFLAGS/GOENV disabled and module proxy/checksum access off. The shared official importer reads the recorded archive bytes into the same token file set. Current source functions/methods remain the only navigation targets; SDK bodies are not captured or invented.

`languageScope.standardLibrary` reports mode, version, requested packages, prepared dependency count, actually read packages with byte counts/SHA256, and intrinsic unsafe use. SDK source is explicitly not analyzed. `go.stdlib:false` disables export preparation and retains partial captured-only typing; questions identify that scope distinctly. v1 free-function and v2 concrete-method captures retain their historical contracts. Missing compiler/invalid SDK target gives exit2 and actionable guidance; the disabled option is explicit, not a silent fallback.

Declared GOOS/GOARCH, tags, cgo=false and test range stay visible. Architecture-dependent intrinsic typing now uses the declared architecture size. Source selection records the running SDK's release/tool tags; target CPU-feature/experimental overrides are not independently reconstructed. go.work, replace/vendor/nested-module assembly, third-party source loading and generated/cgo output remain unsupported. go.mod language/toolchain directives are captured but not enforced by this incomplete checker. Argument applicability, execution, nil safety and complete caller sets are unproved. The large question output bound remains40 records; no limit was raised to force acceptance.

## Reproduce source and extracted ZIP

```sh
python3 benchmarks/code-analysis-go-stdlib-types/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/source
```

Use the extracted entrypoint for ZIP; use #1265's CLI with `--expect baseline` for the parent. Exact source pins/hashes and the prior full compiler oracle are rechecked. Three checks/four saved questions exit0, while the retained changed-Match pair stays partial/exit1. Candidate-only disabled-scope check/question also exit0 and keep the three Chi targets unknown. Checks deliberately use --fail-on never; zero exit does not mean findings are absent.

Four raw captures (three projects plus disabled Chi) are byte-identical across source/ZIP. Six questions agree after only installation/output path normalization, and an actual historical v2 question also matches. Two canonical Node22.23.3 / zlib1.3.1-e00f703 builds agree, with all168 tracked module files equal. Archive digest and command receipts are in evidence/parity.json. Historical v1 compatibility is covered in the focused tests; no old capture gains new semantics merely from a current reader.

## Tools, cost and validation

Product floor remains Go1.18+ using only SDK libraries. These runs use preinstalled Go1.27.2 Darwin/arm64; no new toolchain/dependency was installed. The independent full-graph audit alone uses the earlier pinned x/tools0.52/Go1.26+ setup, not a packaged runtime dependency.

The first prototype prepared all379 standard packages/372 archives (214,912,504 bytes), while production prepares only needed closures. For Chi that is213 dependencies,33 actually read exports (57,067,902 bytes). Normal CLI with an initially empty local GOCACHE took6.90s and left154,952KiB, including helper compilation and required SDK data. Toolchain installation was already complete, external cache programs were absent, and warm/cold raw facts match. These are recorded local costs, not a controlled general speedup or fresh SDK installation benchmark. Prototype full-SDK setup costs remain separately recorded.

- Local runtime `61b28dc07`: focused Go12/12; complete module383/383, zero skips; core smoke19/19 and release identity pass.
- Extracted package: Go/question/change selection40/40, zero skips; source/ZIP and historical v2 developer questions pass.
- Remote: final-head CI is tracked separately on the English Draft; local/package results do not establish remote or Windows success.
- Integration: Draft work, not Labs/approved/merged/released/installed.

Scoped pre-PR review kept SDK preparation, export identities and import binding in one helper and reused go/types rather than adding a second flow resolver. Official SDK packages and gc-importer cache have distinct responsibilities; path lookup and actually read digest records were retained separately. No unrelated compatibility path or protection was retired. Real-source/independent-oracle comparisons discriminate missing receivers from interface unknowns; invalid SDK/missing compiler and32/64-bit tests protect profile/failure boundaries. Diagram generation is unchanged, so renderer generation comparisons are not applicable.

Next: inspect remaining third-party/build gaps and real investigation interruptions, continue Rust generic/trait boundaries and the JS/TS/Python/Java backlog. Resolving the37 recorded Go misses does not finish the persistent multi-language objective.
