# Go and Rust source-first baseline

Work in progress, 7 November 2026. No Go/Rust capability is claimed yet.

## Baseline and ownership

Shared Labs is `bf0a29e7664f52973d06a8e6a608df2db1ecbd39`; candidate parent is Draft #1252 at `93378351dc97768fd7e0882a50f32ecc7a34e2a6`. The latter retains #1250, original A1/A2 contributor commits and earlier Java/Python/JS/TS work as ancestors. Original PRs and authors remain unchanged. #1252 is unmerged; remote CI has a failed full-regression shard and aggregate Node 22 check, despite passing package/freshness/platform checks. Do not describe it as green.

Public open/all-state PR search and team Wiki refresh found no Go/Rust implementation owner in the inspected records. A1/A2, baseline accept/revoke (#1224), Atlas (#1203) and separate CI repair (#1242) retain their scopes. This inventory does not cover unpublished member work.

## Source answers frozen before analyzer execution

`manifest.json` pins four repositories, eight commits, source hashes, exact matching lines and source excerpts. Source inspection preceded this freeze; no analyzer or implementation had run. Absence is recorded explicitly when a call does not exist in an older version. The regex workspace layout changed substantially between the selected versions; newer alias cases are head-only checks, not paired successes.

- **Go design: Cobra**, `41fd44e1` → `e392f320` (upstream #1104). `doc/man_examples_test.go` in the distinct `doc_test` package imports `github.com/spf13/cobra/doc`; `ExampleGenMan` directly calls `doc.GenMan`. The definition in `doc/man_docs.go` changes to forward `cmd.DisableAutoGenTag` into `fillHeader`. Known selected callers include the example and `GenManTreeFromOpts`; their existence does not prove the complete caller set. `w.Write` is interface dispatch and must not be assigned to an arbitrary implementation.
- **Go reserved review: Chi**, v5.1.0 → v5.2.1. `middleware/strip.go` imports the root module and calls `chi.RouteContext`. `_examples/versions/main.go` uses `v1`/`v2`/`v3` import aliases for distinct presenter packages; `v1.NewArticleResponse` must navigate only to presenter/v1/article.go. The imported package's declared name is `v1`. `next.ServeHTTP` remains interface dispatch. This pair also changes `AllowContentType` across files; its direct test caller is within package middleware. No claim that RouteContext itself changed.
- **Rust design: regex**, 1.7.0 → 1.11.1. `regex-syntax/src/lib.rs` calls `unicode::is_word_character`, whose implementation changes in `unicode.rs`. The newer root crate wrapper calls `regex_syntax::escape`, crossing a real Cargo workspace/path-dependency boundary. `regex-automata/src/dfa/special.rs` has a function-local `use crate::util::wire::write_state_id as write` followed by `write::<E>` calls; the target is `util/wire.rs`. `util/look.rs` has plain `use regex_syntax::try_is_word_character`. These are separate head-only tests. Macro calls and trait dispatch must retain reasons for unknowns; source syntax alone does not prove macro expansions or runtime targets.
- **Rust reserved review: serde_json**, 1.0.100 → 1.0.139. `src/lexical/parse.rs` imports `super::algorithm::*` and calls `fast_path`; its implementation in `algorithm.rs` changes. This module is gated by `float_roundtrip` in lib.rs; a default-feature build does not contain the same code. `F::exponent_limit` is trait/generic dispatch, not an arbitrary concrete implementation. Wildcard imports may initially stay unknown.

The reserved samples were partly inspected to freeze answers. They are held out from initial rule design and tuning, not a blind independent accuracy test. Do not change their score expectations after observing candidate output; record new questions separately.

## Build and coverage policy to validate

Go: record module identity, GOOS/GOARCH, cgo/build tags and test inclusion. Distinguish external test packages, nested modules and Go's ignored example directories. Parsing all files is not equivalent to one valid build. Ordinary and alias imports need independently checked target coordinates; receiver/interface dispatch remains unknown until evidence supports more.

Rust: record Cargo package/crate roots, edition, path dependencies, workspace membership, features, cfg and test scope. Source-only facts are conditional candidates where build conditions are unselected. A real workspace dependency does not by itself prove all feature/cfg combinations. `macro_rules!`, procedural macros, build-script output and trait dispatch are not ordinary direct calls.

Installed tools observed: Go 1.27.2; rustc/cargo 1.89.0. rust-analyzer command failed because the official stable toolchain has no such binary installed. No tool was installed for this baseline. Backend choice and fresh-user installation costs remain to be measured.

## Acceptance queue

1. Run the unchanged normal CLI on the frozen samples, retaining diagnostics and exit codes.
2. Compare a bounded Go standard-library parser/type API prototype with the real source answers and configuration cost; implement the smallest complete Go investigation.
3. Compare Rust compiler/rust-analyzer/parser approaches on the frozen crate/workspace questions before implementation.
4. For each language record correct additions, wrong targets, missing targets and reasonable unknowns; verify exact locations and reverse caller references.
5. Replay the same commands from source and extracted canonical ZIP. Keep local tests, remote CI, package parity and actual merge status separate.
6. Publish reviewable English Draft slices and Wiki capabilities as Labs / Draft-validated / unsupported. No approval, merge, release or live installation.

Every handoff must explain the source path the developer could not follow before, the next evidenced step after the change, and the remaining unknown step. After both first investigations, prioritize demonstrated wrong targets and missing references across all supported languages.

## Unchanged CLI result

At source-freeze commit `580b50393`, all eight fixed project/version invocations returned **exit 2**, `extract/adapter-unknown`, supported adapters `ts`, `py`, `java`. Both `--language go` and `--language rust` are rejected before source extraction. The developer cannot yet take the first step from Cobra's `doc.GenMan` call or regex's `unicode::is_word_character` to captured definitions/callers. No targets were produced, so this is unavailable coverage, not a target-accuracy score. `evidence/baseline-cli.json` retains commands, outputs and exits. Package replay has not yet run.

Follow-up baseline package validation: repeated all eight questions from the extracted #1252 ZIP. Parsed JSON diagnostics and exit 2 match source in every unit (`evidence/baseline-zip-cli.json`, `baseline-parity.json`). First ZIP use installed the existing module's parser dependencies; this is isolated package setup, not a live Skill installation. This confirms equivalent rejection, not language support. Recreated `manifest.json` from the four upstream clones with `python3 benchmarks/code-analysis-go-rust/freeze.py --samples-root <clones> --out <temporary-manifest>`; byte-identical SHA-256 `6278025602bf218059e238df5dfcc9b2bfc7986fc93688eb0b6b5463be0d5848`.

### Source-oracle correction before Go candidate execution

The original Chi alias expectation was wrong: `_examples/versions/go.mod` declares `module versions`, whereas the presenter import starts `github.com/go-chi/chi/v5/_examples/versions/...`. The root Chi module also does not own that nested module. Local directory adjacency is insufficient evidence for this import. The immutable original manifest is retained; this row must be graded as a reasonable unknown, not a missed valid target. Ordinary `chi.RouteContext` remains a valid independent root-module case.

A supplemental alias question is source-frozen in `supplemental-go-alias.json`: grpc-go v1.70.0 at `98a0092952dd4d8443229c3a335ec592d9c40c9b`, `clientconn.go:757 iresolver.GetConfigSelector` → `internal/resolver/config_selector.go:141`. The actual module declaration and import path match. This source inspection occurred after starting the generic Go helper, but before any candidate analyzer execution; it is explicitly supplemental, not part of the original pre-development/holdout score. No source answers were changed to match candidate output.

## Go implementation follow-up

The first bounded Go source/ZIP investigation is recorded in [GO.md](GO.md), including the Chi oracle correction, real grpc alias, build/typing scope, nine versioned positive observations, five unknowns, known baseline test failure and exact package evidence. It is Draft validation, not Labs integration. The original manifest remains immutable. Rust's first implementation/acceptance remains pending.
