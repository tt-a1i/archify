# Rust source investigation

Select the experimental Rust adapter through the normal CLI:

```sh
node archify/bin/archify.mjs code-analysis check /path/to/workspace --language rust --fail-on never --out /tmp/rust-analysis --json
node archify/bin/archify.mjs code-analysis task /tmp/rust-analysis --root /path/to/workspace --entry src/lib.rs --function caller --question 'Where is this function defined?' --format json --out /tmp/rust-question.json --json
node archify/bin/archify.mjs code-analysis task --root /path/to/after --base-root /path/to/before --entry src/lib.rs --question 'Which captured direct references reach changed definitions?' --format json --out /tmp/rust-change.json --json
```

This is source orientation. Exact function ranges, immutable captured text and hashes, definition jumps and captured direct references reuse the shared investigation output. They do not establish compilation, runtime reachability or complete change impact. Saved questions require matching Rust facts; paired questions capture both versions afresh. Configuration/metadata differences can make a paired result partial (exit 1) even when individual known references navigate correctly.

## Tooling and cost

Cargo/rustc 1.71+ are required; only 1.89.0 has been exercised locally. ARCHIFY_CARGO and ARCHIFY_RUSTC select installed executables. A missing tool returns structured extract/rust-unavailable with installation guidance, exit 2. The ZIP bundles source and a locked helper, not a platform binary. Its first use compiles Archify's helper and may download its locked MIT/Apache parser dependencies (syn 2.0.119, proc-macro2 1.0.107, quote 1.0.47, serde_json 1.0.154). No rust-analyzer is needed. Set rust.offline=true only after these dependencies are cached. Toolchain installation is separate; no missing-tool installation happens automatically.

Project manifests and empty source-inventory stubs are captured into a temporary directory for cargo metadata --offline --locked --no-deps. Project source, .cargo config, rust-toolchain files, build scripts and macros are never executed. The syn helper parses the captured source bytes and uses a temporary compiler cache outside the installation. No project dependency source is downloaded or inspected. Absolute/path dependencies outside the captured root are unknown; manifest configurations which require them may fail with extract/rust-metadata-failed instead of inventing a workspace.

## Scope and settings

```json
{"rust":{"tests":false,"defaultFeatures":true,"features":{"my-package":["chosen-feature"]},"cfg":["custom_known_flag"],"target":"aarch64-apple-darwin","offline":true}}
```

Pass this JSON via --config. Defaults analyze local workspace lib/bin targets, package default features and local path dependency feature forwarding. This is a declared source profile, not Cargo's complete resolve/build graph or target-specific dependency activation. Test targets and cfg(test) are excluded unless tests=true; examples, benches, proc-macro crates and build scripts remain excluded. The host is used unless target is specified; target cfg is queried from rustc without a project build. Unknown custom/build-script cfg and opaque attributes retain uncertainty rather than choosing a branch.

The coverage.languageScope and raw-facts languageScope report actual selected files/crates, excluded files/targets/regions, missing modules, parse failures, conditional definitions, opaque macros, tool versions, cfg and captured Cargo metadata. A successful --fail-on never check exits 0 regardless of finding gates; inspect coverage and parse_errors independently. Parse failures remain visible, and do not count as complete coverage.

## Targets and boundaries

Crate-local crate/self/super paths, explicit paths, module use/use-as, grouped imports, unambiguous globs and local workspace library paths can identify free functions. Actual Cargo library names and renamed dependencies define the boundary. Module lookup observes editions, module file/path attributes, lexical shadowing and conditional imports. Unsupported or ambiguous paths stay unresolved. Cross-crate source bindings do not prove visibility or type correctness.

The original v1 model leaves methods, trait dispatch, function values, associated functions, local item functions as targets, generated/expanded macros, external crates, and full type inference unknown. Later bounded inherent-function revisions are described below; receiver/trait dispatch remains unproved. Syntactic function/method bodies form the call inventory; macros have opaque records. Type/field definitions are not navigable entities yet. Structural cycles report source coupling; they do not imply runtime import order or partial initialization.

See the pinned real-project replay and source/ZIP evidence in benchmarks/code-analysis-go-rust/RUST.md. These finite cases are not whole-repository accuracy measurements.

## Current call model and lifetime-only owners

Current captures use rust-source-direct-v4 / adapter4. Historical v1 collects free
functions; v2 additionally admits unique monomorphic inherent function paths;
v3 additionally admits bare generic-struct paths to unique concrete type
specializations. Historical facts keep their original scope without rebinding.

v4 adds receiver-free inherent source candidates on structs/enums whose generic
parameters are only unbounded lifetimes. Impl parameters must be unbounded, have
no where clause, and map one-to-one to named lifetime arguments of the owner.
Bare nominal/module/import-alias paths reuse existing crate identity and source
locations. Duplicate/conditional/unsupported sibling declarations block selection;
variant names still prevent selecting a same-named inherent function. New calls
use rust-lifetime-inherent-source-candidate.

Concrete static lifetime specializations, mixed type/lifetime owners, bounded
lifetimes, const/defaulted parameters, explicit call arguments, aliases/Self,
receiver/trait dispatch and full applicability remain unsupported. Lifetime-only
source navigation does not infer lifetimes, borrow-check, compile, execute or
establish complete impact. Native function sourceRange starts at pub/fn, while
definition.sourceRange also includes owned attributes/doc comments; target
locations use the former. Saved and paired questions retain existing freshness
and source-profile checks. Normal toolchain requirements are unchanged.
