# Rust first investigation: source paths and captured direct callers

Experimental Draft validation in #1258, above Go #1256 and the frozen baseline #1255. Runtime source: `bf147b0f58fad007e7aa464ad7edf90806aa9dfc`. Original team commits, authors and PR ownership are retained; no Labs integration, approval, merge, release or live installation is implied.

## One evidenced step for the developer

Before, normal `--language rust` selection returned `extract/adapter-unknown`, exit 2. After, regex's `regex-syntax/src/lib.rs:369` reaches the changed `unicode::is_word_character` implementation at `regex-syntax/src/unicode.rs:463`. On the fixed older version the same source relationship is `lib.rs:252 → unicode.rs:400`. A fresh paired question finds that verified direct caller on each side.

The next workspace boundary is real: root `src/lib.rs:1345 regex_syntax::escape` reaches `regex-syntax/src/lib.rs:201`. In regex-automata, function-local `use crate::util::wire::write_state_id as write` at special.rs:357 binds calls at 364/365 to util/wire.rs:663. Plain `use regex_syntax::try_is_word_character` at util/look.rs:1573 binds calls at 1588/1603 to regex-syntax/src/lib.rs:366.

The reserved serde_json question follows `src/lexical/parse.rs:18 fast_path` through `use super::algorithm::*` into algorithm.rs:18 at both fixed versions. The changed definition's captured caller navigates correctly. Without float_roundtrip the lexical module is excluded, not reported as an empty complete caller set. `F::exponent_limit` at algorithm.rs:24 stays unknown: there is no type/trait dispatch proof.

Paired outputs remain **partial, exit 1** because the captured Cargo manifests/crate/feature profiles differ between real upstream versions. Valid direct references do not establish equivalent builds or complete impact. Macro expansion, method dispatch, generated code and external dependency source are still beyond this investigation.

## Source-first cases and finite scoring

[manifest.json](manifest.json) was committed before implementation/analyzer execution. regex 1.7.0 `f871a8eb1d725a8aaa56e2ceea57c24fce74b5fd` → 1.11.1 `9870c06e6c772daaad7ab612faab29130753e41c`; serde_json 1.0.100 `d2fce19685bf0e3d493a9d785665137654c79e6d` → 1.0.139 `4d4f53c3b7de3259b6a8a15ef4d5f4edb47af32f`.

The five original positive versioned observations cover regex's changed module function twice, its head-only workspace wrapper, and serde_json fast_path twice. Four extra plain/use-as observations are explicitly [supplemental exposed source evidence](supplemental-rust-paths.json). serde_json was reserved from initial rule tuning, but partly inspected to freeze expectations; this is not a blind holdout. [run-rust.py](run-rust.py) checks upstream revisions/source hashes and calls only the normal public CLI.

| Selected observations | Correct targets | Wrong targets | Missed targets | Omitted calls | Reasonable unknowns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen unsupported baseline | unavailable | unavailable | unavailable | unavailable | unavailable |
| Candidate source | 9 | 0 | 0 | 0 | 2 |
| Extracted ZIP | 9 | 0 | 0 | 0 | 2 |

These are finite versioned observations, not unique call sites or whole-repository accuracy. The unchanged baseline rejects Rust selection; it has no target-accuracy denominator. Additional returned callers remain inspectable and are not silently added to this score.

| Source capture | Selected files | Functions | Syntactic calls | Parse failures |
| --- | ---: | ---: | ---: | ---: |
| regex before | 57 | 1,017 | 5,371 | 0 |
| regex after | 166 | 3,435 | 17,995 | 0 |
| serde_json before/default | 17 | 579 | 1,907 | 0 |
| serde_json before/float_roundtrip | 36 | 698 | 2,327 | 0 |
| serde_json after/default | 16 | 612 | 2,069 | 0 |
| serde_json after/float_roundtrip | 35 | 729 | 2,484 | 0 |

## Backend, build conditions and cost

The pinned syn AST parser reads immutable captured bytes. Cargo supplies package/target/library names from captured manifests plus zero-byte source inventory stubs, using metadata --offline --locked --no-deps; no project build, .cargo config, rust-toolchain, build script, proc-macro or external source is loaded. The native Rust resolver handles crate/module namespaces, editions, module paths, use aliases/globs, lexical shadowing and explicit local workspace library identities. It reuses existing range hashes, coverage and investigation consumers. It does not reuse JS/Python runtime import semantics.

Actual local profile: installed cargo/rustc 1.89.0, Darwin arm64 host cfg, workspace library/binary targets, tests false, default features plus local path forwarding; serde_json float runs additionally select float_roundtrip. Unknown build-script cfg stays unknown. This is not Cargo's complete resolve/build graph; target-specific dependencies, feature unification and externally supplied build output may affect applicability. All manifests, exclusions, opaque macros, conditional definitions, target cfg and missing modules are disclosed in each report's scope. Full user settings and required tooling: [RUST.md](../../archify/modules/code-analysis/docs/RUST.md).

Backend choice evidence is bounded. Captured-stub Cargo metadata agreed with the actual fixed regex/serde_json package names, editions and targets (about 0.017 seconds per local metadata run); syntax parsing recovered the selected source definitions/calls without project dependencies. A real offline compiler comparison for regex-syntax failed in 0.034 seconds because Cargo's workspace resolution required an uncached regex-cli dependency, lexopt. It did not reach compilation, so it is not a compiler precision result. This demonstrates a configuration/cache cost which the bounded source profile avoids; it does not prove equivalence to compilation. rust-analyzer is absent and was not benchmarked. Reusing its semantic backend remains future work, not an adopted claim.

A fresh isolated helper dependency cache build took 9.90 seconds, 7,375,348 bytes of Cargo cache and 99,915,222 bytes of build output on the existing compiler. This is one local measurement, not a clean-machine install or performance benchmark. Toolchain installation/download cost was not measured. Cargo/rustc 1.71+ is the declared helper minimum; only 1.89.0 was exercised. Missing rustc through the normal CLI returns structured extract/rust-unavailable, exit 2, with installation/override guidance. Invalid Rust source remains in selected-file coverage with parse_errors; --fail-on never retains the existing finding-gate exit 0, not a completeness guarantee.

## Verification and review

- Source and ZIP each run six checks, a saved question, and two fresh paired questions. Checks/saved question exit 0; both paired questions exit 1 with explicit partial profiles. See source.json, zip.json and parity.json under evidence/rust.
- Two canonical Node 22.23.3 / zlib 1.3.1-e00f703 builds are identical; ZIP SHA-256 `d0b45377d07bb09aa38b57ee73eca7147aab701e282a6c7c8845e677781c2760`. All 167 tracked module files match the extracted package. Local runtime Node 26.12.0; no local Windows Rust execution claim.
- Ten Rust regressions pass in source and extracted ZIP. They protect wrong-navigation boundaries: edition namespace selection, parameter/local use shadowing, cfg/path attributes, Cargo library names/aliases, exact range/hash freshness, opaque dispatch and structural cycle output. Independent rustc controls establish the source language expectations; existing shared schema/task checks cover compatibility without mirroring private resolver internals. Local module suite: 359 pass / 1 inherited TS installed-config assertion failure / 0 skipped. The fixed Go parent already reproduces that same assertion failure; cause remains unestablished. Remote CI is reported separately on the Draft.
- The first real regex candidate incorrectly described five Rust source cycles using JS/Python runtime partial-initialization language. [Rejected claims](evidence/rust/rejected-runtime-cycle-claims.json) are retained. Native structural diagnostics/task guidance now avoid that claim and allow an intentionally retained source cycle. This was corrected before accepted source/ZIP grading.
- Replay corrections: the initial script searched write( instead of the actual generic write::<E>(. A later matching attempt treated the direct call and its enclosing multiline .expect method (same starting position) as duplicate observations; the final replay distinguishes their source extent. Neither mistake was a missing analyzer target. Historical failed receipts remain local; accepted reports use the final executable replay. The supplemental custom-library fixture was restored from the final negative compiler variant to its positive baseline before publishing its reproduction instructions.
- Focused source review traced CLI → capture/staging → syn resolver → shared schema/graphs/questions/tasks. Duplicate use flattening and unused fn-position state were removed before the source freeze. No capability was removed. This is agent review, not maintainer approval.

## Reproduce and next gap

Clone the exact commits above into regex, regex-base, serde-json and serde-json-base under one sample directory. Then:

```sh
python3 benchmarks/code-analysis-go-rust/run-rust.py --cli archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/rust-source
unzip archify.zip -d /tmp/rust-package
python3 benchmarks/code-analysis-go-rust/run-rust.py --cli /tmp/rust-package/archify/bin/archify.mjs --samples-root /path/to/samples --out /tmp/rust-zip
```

The replay uses offline helper builds: cache its locked dependencies first (cargo build --locked --manifest-path archify/modules/code-analysis/extract/rust/Cargo.toml), or run an initial normal CLI capture with Rust offline disabled. Existing npm parser/schema dependencies may also need initial module setup.

Remaining Rust gaps include methods/traits/associated calls, local item targets, struct/type/field navigation, macros/build scripts/generated output, external crates, complete Cargo feature/target semantics, and complete caller/impact claims. Go retains its documented typing/workspace/method gaps. With both first bounded investigations present, continue from observed wrong targets, omissions and interrupted source investigations across Go, Rust, JS/TS, Python and Java. First priority remains preventing navigation to incorrect source.
