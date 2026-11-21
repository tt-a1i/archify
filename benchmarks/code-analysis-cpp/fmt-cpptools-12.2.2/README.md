# fmt C++ source navigation comparison

This report compares Archify's bounded C/C++ source facts with the **Microsoft C/C++ VS Code extension (cpptools)** on one pinned open-source project. It tests where a selected source location navigates; it does not claim that editor navigation candidates are executable call-graph edges.

## Fixed inputs and provenance

| Input | Recorded run |
| --- | --- |
| Project | [fmt source commit `57f1b5930dc2906875534a15c209e1c39eda59ad`](https://github.com/fmtlib/fmt/commit/57f1b5930dc2906875534a15c209e1c39eda59ad), reporting `FMT_VERSION 120202` (12.2.2) |
| Source check | The 148 files in the pinned upstream archive matched the local corpus byte for byte; archive SHA-256 `48801d7ce6c02e05665cfc0f067f34d8a58dd4755850d205524959a3b9627019` |
| Build configuration | CMake + Ninja; `FMT_TEST=ON`, `FMT_DOC=OFF`, `FMT_FUZZ=OFF`, `FMT_CUDA_TEST=OFF`, `CMAKE_EXPORT_COMPILE_COMMANDS=ON` |
| Compilation database | 52 CMake commands; `select-commands.py` chose the first command for each resolved source path, yielding 32 unique translation units and omitting 20 alternatives. Both tools used that same selected database. Its SHA-256 on the recorded machine was `cca404601ed5699431b89930b3fa04a23e68b027210714833f38f0ccc6a635c3`. Paths embedded in a CDB make this digest machine-specific. |
| Toolchain | macOS, Apple libclang 14.0.3 with Python `clang==14.0.6`; VS Code 1.144.0, Microsoft C/C++ extension 1.35.6 |
| Archify output | C/C++ adapter revision 4; 32/32 units parsed, 0 parse failures, 57 selected files, 270 active include facts, 4,256 functions, 16,395 call locations, 2,044 direct source bindings |

Archify used the captured CDB and supplied selected project files to libclang as unsaved files. The VS Code test used `vscode.executeDefinitionProvider` with cpptools' default IntelliSense engine and the same configured CDB. It waits for the official TestHook's `IntelliSenseReady` event and queries each position once, with isolated user data, IntelliSense cache and browse database. The [raw positive results](positive-cpptools.json), [raw unresolved results](unresolved-cpptools.json), and [paired results](comparison.json) retain each requested context, its verification status, position, returned location and readiness. `make-paired.mjs` independently locates each sample in Archify's raw facts and rejects a missing or non-unique fact.

For a source-file entry, the requested context is the queried translation unit itself. For a header, opening its requested source file first does **not** prove the plugin selected that source as its active TU. All 34 header queries are marked `unverified-header-association`; they establish navigation-location agreement only. Of the 48 positive queries, 24 are source-file entries and 24 have unverified header associations.

## Results

| Sample group | Archify reference | cpptools result |
| --- | --- | --- |
| 32 already-bound direct calls | Captured target file **and line** | 32 unique exact targets |
| 16 resolved active includes | Captured target file | 16 unique exact files |
| 20 Archify-unresolved call positions | Four each from `cpp-unbound`, `cpp-context-dependent`, `cpp-template`, `cpp-macro-expansion`, and `cpp-virtual-dispatch` | 16 positions have one navigation target; 4 have multiple candidates, all in the virtual-dispatch group |

Across the 48 positive samples, cpptools included the Archify target in **48/48**, each with one returned location. **24/24 source-file entries** matched; the other 24 positives retain the header-context limitation above. The fixed positions were sampled from already-bound calls and resolved includes, so this establishes sampled positive target agreement, not recall over all 16,395 calls. The 20 unresolved positions were selected separately from single-line call ranges containing a function-like name and exclude bundled GTest source locations. They show a capability gap for editor navigation, but several land on macro definitions or declarations. A navigation result is not proof of a unique runtime callee. In particular, all four sampled virtual calls returned multiple candidates.

The current harness returned the expected target for all 48 positives and at least one target for all 20 unresolved positions. Compared with the [earlier record at cc595905](https://github.com/testikun/archify/tree/cc59590559a893a3f6a6784c8297c423065871a4/benchmarks/code-analysis-cpp/fmt-cpptools-12.2.2), 66/68 location sets were unchanged; two positive positions now returned a single expected location instead of multiple candidates. Both readiness gating and cache isolation changed, so the comparison does not attribute that difference to one cause. The command selector regenerated the recorded selected CDB byte for byte on the original machine. See [review fixes](review-fixes.md) for the regressions and remaining evidence limits.

## Reproduce

1. Check out the pinned fmt commit and configure it with the CMake flags above. Generate `compile_commands.json` without asking Archify to build the project.
2. From this repository, run `python3 benchmarks/code-analysis-cpp/fmt-cpptools-12.2.2/select-commands.py <cmake-compile_commands.json> <selected-compile_commands.json>`.
3. Provide a Code Analysis config with `cpp.compileCommands` set to the absolute selected database path and `cpp.timeoutMs` set to `600000`. With matching Python clang bindings and `ARCHIFY_LIBCLANG`, run `node archify/bin/archify.mjs code-analysis check <fmt-root> --language cpp --config <config.json> --out <analysis-out> --fail-on never`.
4. Run `node benchmarks/code-analysis-cpp/fmt-cpptools-12.2.2/make-paired.mjs <analysis-out>/raw-facts.json <paired-out.json>` to verify the recorded facts against the published cpptools results.
5. With VS Code's `code` CLI and the Microsoft C/C++ extension present, run `node benchmarks/code-analysis-cpp/fmt-cpptools-12.2.2/run-vscode.mjs <fmt-root> <selected-compile_commands.json> <cpptools-extension-dir> <live-result.json>`. This waits for IntelliSense in an isolated profile and reports location matches, source-file-context positives, unverified header associations, and location-set agreement with the committed results. Missing readiness or failed/cancelled query responses fail the run. Different SDKs can legitimately change external candidates.

The positive and unresolved samples were not selected randomly from all calls. The database represents one chosen CMake configuration, and its unselected 20 alternatives were not compared. The result does not cover Linux or Windows, arbitrary header suffixes, no-command fallback, cross-unit bindings, all template instantiations, or runtime virtual dispatch. Those boundaries remain explicit in the C/C++ adapter documentation and the linked issue/PR scope.
