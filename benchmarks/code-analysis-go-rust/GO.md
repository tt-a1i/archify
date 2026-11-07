# Go first investigation: explicit source targets and known callers

This is experimental Draft validation, not Labs integration, approval or release. Runtime source tested: `4ff07af962f5dc613f3b570d42c17a016b06e480`; its subsequent package/evidence commit does not change the module. Parent: `b7338e0b1ba97348aa7216ea0469e334abe72f07` (#1255), preserving #1252/#1250 and original team commits. Rust remains unsupported and its frozen first investigation is next.

## The developer's next evidenced step

Before this change, `--language go` stopped at `extract/adapter-unknown`, exit 2. Afterward, the public CLI follows Cobra's distinct `doc_test` package into `doc.GenMan` at `doc/man_docs.go:104`, then into `fillHeader:117`. Paired questions recognize the real upstream DisableAutoGenTag change and enumerate seven captured `GenMan` direct references per side. The two originally frozen callers—external example line 33 and production tree generator line 78—have valid source navigation. Five additional references in man_docs_test.go were subsequently source-checked (lines 28, 63, 97, 117 and 211); they are not added to the frozen target score.

`w.Write` remains interface dispatch. The tool does not establish which writer executes, whether every package compiles, or all possible runtime callers. Direct source references are useful evidence, not complete impact.

## Fixed-source grading

[Original manifest](manifest.json) froze before implementation and analyzer execution; [supplemental alias/correction](supplemental-go-alias.json) discloses the later grpc source answer and Chi oracle error. [Executed public CLI replay](run-go.py).

| Same finite versioned observations | Correct targets | Wrong targets | Missed expected targets | Omitted calls | Reasonable unknowns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unchanged parent | unavailable | unavailable | unavailable | unavailable | unavailable |
| Candidate source | 9 | 0 | 0 | 0 | 5 |
| Extracted candidate ZIP | 9 | 0 | 0 | 0 | 5 |

The nine positive observations comprise **six distinct physical call sites**, with three Cobra sites checked at both versions. They do not mean nine distinct definitions, general accuracy or a blind held-out study. The parent rejects language selection, so no target-accuracy denominator is assigned to it.

- Cobra `41fd44e1df83ad6acd8e14b304d5f2a2ae1d62f5` → `e392f3204db0445f1f4ad47448b04d8c8ad04c2a`: `doc_test.ExampleGenMan` and `GenManTreeFromOpts` reach `GenMan`; `GenMan` reaches changed `fillHeader`; `io.Writer.Write` remains unknown.
- Chi `71307f9b7e4e9527638bc951c42b782cd1560331`: both `middleware/strip.go` calls reach root `context.go:27 RouteContext`; both `next.ServeHTTP` calls remain unknown. This reserved review slice was partly source-inspected but not used for initial helper tuning.
- Supplemental grpc-go `98a0092952dd4d8443229c3a335ec592d9c40c9b`: `clientconn.go:757 iresolver.GetConfigSelector` reaches `internal/resolver/config_selector.go:141`; its `state.Attributes.Value` method call remains unknown. The module declaration matches the import path, so this is a valid real alias case.

**Corrected oracle:** the original Chi presenter alias expectation must not be treated as a local target. The nested go.mod declares `module versions`, inconsistent with the `github.com/go-chi/chi/v5/_examples/versions/...` imports. The root run explicitly excludes that nested module. The original manifest/commit is retained; the source correction is recorded before candidate execution and is not hidden as an analyzer success/miss. Analyzing by directory adjacency would have been a wrong target.

## Source, configuration and cost

The backend reuses the installed Go standard-library parser/AST, build-constraint evaluator and `go/types.Info.Uses`. It consumes immutable captured bytes; imports are resolved only within the declared root module. Production, internal tests and external tests use separate package variants. Package dependencies identify source membership; definition jumps use observed function objects. No new npm dependency or language server is added.

Full compiler comparison was performed in the pinned real repositories with `go test -c -vet=off -mod=readonly`, no test binary execution. Cobra `./doc` compiled in 5.57 seconds and downloaded five pinned modules (isolated module cache: 2.5 MiB); Chi `./middleware` compiled in 1.71 seconds using the warmed shared comparison cache. These cases are sequential and not controlled performance benchmarks. Logs/commands are in [compiler-comparison.json](evidence/go/compiler-comparison.json). The standard-library source backend avoids those dependency downloads/configuration requirements but deliberately retains incomplete external types. This tradeoff supports the first bounded source investigation; it does not replace full compilation when semantic applicability matters.

Actual analyzer scope: root module, Darwin/arm64, cgo disabled, empty custom tags, tests included, installed Go 1.27.2 release tags. GOFLAGS, go.work, replace, vendor and nested modules are not loaded. Exact metadata, exclusions, packages and errors are retained per project in the source/ZIP reports. Custom GOOS/GOARCH/tags and test exclusion are covered separately by authored regressions.

| Capture | Source files | Syntactic calls | Parse failures | Typing diagnostics across package variants | Excluded Go files |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cobra before | 48 | 2,937 | 0 | 1,414 | 1 |
| Cobra after | 48 | 2,939 | 0 | 1,414 | 1 |
| Chi | 54 | 2,879 | 0 | 2,249 | 19 |
| grpc-go | 799 | 59,112 | 0 | 28,697 | 136 |

Typing diagnostic counts include intentionally unavailable standard/external declarations and may repeat production diagnostics across test variants; they are not unique project defects. They are visible limitations, not parse failures or evidence that the official project does not compile. `--fail-on never` preserves the existing finding-gate semantics and exits 0; successful orientation does not make those limits disappear.

Go 1.18+ compiler required; only installed Go 1.27.2 was exercised locally. The installed Homebrew distribution occupied 270 MiB. A tiny helper measurement used a fresh empty compiler cache (2.46 seconds, 80 MiB cache after build) then the same cache (0.27 seconds). A fresh toolchain download/install was not measured. Missing Go is tested through the public CLI: structured `extract/go-unavailable`, installation/ARCHIFY_GO guidance, exit 2. See [GO.md](../../archify/modules/code-analysis/docs/GO.md).

## Verification layers and limitations

- **Normal source/ZIP CLI:** six invocations per distribution: four checks, one saved question and one fresh paired question, all exit 0. Four raw-facts files match byte-for-byte; the two questions match after only installation/output/workflow path normalization. Targets, source ranges, known callers and coverage agree. [Source](evidence/go/source.json), [ZIP](evidence/go/zip.json), [parity](evidence/go/parity.json).
- **Package:** 160 tracked module files match source. Two canonical Node 22.23.3 / zlib `1.3.1-e00f703` builds match. Final ZIP SHA-256 `534a2a17a2f7b813270878a8de47e9914126535fe591bcd441475760a915b85a`. Six Go regressions pass from the extracted package. Public evidence normalizes the local workspace prefix; original local receipts remain under work/. Runtime CLI Node 26.12.0, Go 1.27.2, macOS arm64; no local Windows runtime validation.
- **Local tests:** 57 focused checks pass. Final module suite at the tested source: 349 pass / 1 fail / 0 skipped. The `ts-snapshot.test.mjs:89` installed-configuration-package exception assertion fails identically on the extracted fixed parent (10 pass / 1 fail in that file); its cause is not established. [Final module log](evidence/go/module-final.log), [fixed-parent reproduction](evidence/go/baseline-ts-snapshot.log), [focused log](evidence/go/focused-final.log), [package tests](evidence/go/package-tests.log).
- **Development corrections:** stale configuration digests were regenerated after adding `.go` defaults. Initial generation with Python 3.15 caused unrelated fixture metadata churn; rerunning with existing Python 3.13.16 retained only required config-digest changes. The first package audit mistakenly enumerated untracked Python bytecode, which the package correctly excludes; the final audit uses tracked files. A later Windows path normalization/method-reason correction invalidated the first candidate package, which was rebuilt and fully replayed. That earlier ZIP is not the accepted evidence artifact.
- **Review:** scoped test-value check protects real wrong-navigation boundaries, build/test selection, UTF-16/source hashes and metadata freshness. Focused simplification traced helper → adapter → schema/graph/question consumers, reused existing snapshot/range/coverage contracts and cached declaration counts; no capability was removed. This is agent source review, not human approval.
- **Remote CI / merge:** reported on the Draft separately. Local/package passes do not imply green CI, merge, release or installation. No approval/merge/release/live installation was performed.

Remaining Go gaps: external semantic types and full compilation, methods/interfaces/function variables, closures as direct targets, struct/type/field definitions, cgo/generated output, Go workspaces/replace/vendor/nested modules and whole-tree freshness. Runtime dispatch and complete caller sets remain unknown. These gaps do not count as resolved by successful free-function navigation.

## Reproduce

Create upstream clones/worktrees at the exact commits in manifest.json/supplemental-go-alias.json, named `cobra`, `cobra-base`, `chi`, `grpc-go` under a sample directory. Keep the original source hashes intact. From this repository:

```sh
python3 benchmarks/code-analysis-go-rust/run-go.py --cli archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/archify-go-source
unzip archify.zip -d /tmp/archify-go-package
python3 benchmarks/code-analysis-go-rust/run-go.py --cli /tmp/archify-go-package/archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/archify-go-zip
```

The first CLI use may install the existing module parser/schema dependencies. This is isolated package setup, not installation into an Agent. Read each report's actual arguments, exit codes and build scope; do not generalize the finite score.

Next: complete the frozen Rust crate-local path/use/use-as question, then the real Cargo workspace boundary, with explicit cfg/feature/macro/trait unknowns and the same source/ZIP discipline. After both first rounds, prioritize observed wrong targets and investigation interruptions across all supported languages.
