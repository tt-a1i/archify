# Explicit Rust inherent-function investigation

Dependent follow-up to Go Draft #1264 (`3b2bdd1aec833f85c51aaf8c2d8c711fb7083c32`), preserving the cumulative six-language, original Rust/Go and team contribution histories. No Labs integration, approval, release or live installation.

## What a developer can now follow

In pinned serde_json, `src/value/from.rs:60 Number::from_f64(f)` follows `use crate::number::Number` to the inherent definition at `src/number.rs:183:5`. A real upstream removal of `#[inline]` and documentation edits changes the owned definition; its function body is unchanged. The paired investigation finds three source-verified callers on each side, compared with zero under the parent. All six reference locations validate. The result remains partial and exits 1: macros, traits, profile/build limits and other ambiguous definitions still prevent complete impact claims.

In pinned regex, `regex::string::Regex::new` and `regex::bytes::Regex::new` reach different bodies despite identical short names. The existing module/use/local Cargo resolver supplies nominal identity, including import aliases and local workspace dependency paths. This reuses captured positions, coverage and investigation outputs.

## Source answers and denominators

Source answers were frozen at `98cbbc7dc` before this rule; baseline observations at `84cfa26ac`. Both repositories were previously exposed in free-function studies, so neither is a blind repository. Compiler controls precede implementation. `src/map.rs` was separately reserved at `b2c93da10`, inspected after the first rule and before extraction; its misses were not tuned away. The supplemental version-pair oracle initially omitted base `value/de.rs:54`; the first paired output prompted direct source inspection, and the correction is explicitly retained in version-pair.json.

| Unit | Parent v1 | Candidate v2 |
| --- | --- | --- |
| Four design observations, three physical sites (serde repeated under default/arbitrary_precision) | 0 correct, 0 wrong, 4 missed | 4 correct, 0 wrong, 0 missed |
| Two reserved Map::new physical sites, each under two profiles | 4 known-source misses | 4 known-source misses |
| Trait deserialize and external cfg-dependent MapImpl controls, repeated under two profiles | 4 reasonable unknowns | 4 reasonable unknowns |
| Supplemental changed from_f64 definition, three callers per version | 0/3 base, 0/3 head | 3/3 base, 3/3 head |

The paired observations overlap the design corpus and are not an additional independent accuracy denominator. Macro invocations remain opaque records, outside the call-target score. Exact inner-call end coordinates distinguish chained calls sharing their start.

Raw output additionally contains **1,205 regex**, **22 default serde** and **23 arbitrary_precision serde** inherent source candidates. A later [independent rust-analyzer audit](audit/README.md) compares all 1,250 emitted observations (1,230 physical sites) and finds matching declaration locations for each. This includes the finite source cases and remains language-server agreement, not whole-project precision/recall or compilation. All previous correct targets and function inventories are preserved. Default serde now omits six formerly captured calls inside the excluded arbitrary_precision nested method, with its exact region reported; other call ranges remain.

Pins, source hashes, actual commands, configurations, exits and bounded grades are in source-first.json, review-source-first.json, version-pair.json and evidence/. The current language models remain separate: Go v2 concrete selections and Rust v2 source candidates do not imply interchangeable semantics.

## Model and explicit limits

`rust-source-direct-v2`, adapter revision 2, adds `rust-inherent-source-candidate`. Unique body-bearing receiver-free functions on explicit monomorphic nominal structs/enums may resolve through ordinary paths or use aliases. Trait impls are never entered into this inherent registry; calls from inside trait implementations can still name an inherent function. Impl/nested method/function generic scopes are respected. A rustc-accepted same-named tuple enum variant takes precedence over an inherent function; its calls stay unknown here, rather than jumping to the wrong function.

Type aliases, generic/specialized owner applicability, Self, receiver inference, trait/qualified-self dispatch, visibility and argument typing are unproved. Separate type/value namespace ambiguity can conservatively miss a valid path. The reserved generic Map<String, Value> calls are definite source-known misses, not reasonable-unknown wins. Macros and build-script cfg remain opaque/unknown. Nested methods remain contained source records, not separately attributed runtime callers. Old v1 captures retain their original scope and remain readable by source and ZIP.

Cargo still reads captured manifests with zero-byte source inventory stubs under offline/no-deps/locked; no upstream source, test, build script or proc macro executes. Profiles record local workspace targets, feature propagation, target cfg, selected/excluded files, missing modules and conditional/opaque regions, not a complete Cargo resolver/build graph.

## Reproduce source and ZIP

```sh
python3 benchmarks/code-analysis-rust-inherent-functions/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples --out /runs/source
```

For baseline use the #1264 CLI and `--expect baseline`; for ZIP use its extracted entrypoint. Samples must match all recorded revisions and hashes, including serde-json-base. Three checks and three saved questions exit 0 per distribution; the paired investigation exits 1/partial. Checks explicitly use `--fail-on never`, which does not mean no findings. The large regex file question retains 207 calls, 40 included and 167 omitted.

Three raw-facts files are byte-identical; four questions match after normalizing only installation/output paths. A historical v1 question also matches. Two canonical Node 22.23.3 / bundled zlib 1.3.1-e00f703 ZIP builds agree; all 168 tracked module files match. See evidence/parity.json for the archive digest.

## Tools, cost and separate checks

The original acceptance used existing rustc/cargo 1.89.0 for the helper and authored compiler controls, with no new toolchain or dependency. A later optional independent audit installed RA 1.89.0; its setup and cost are separately recorded in audit/. The declared helper floor remains Rust/Cargo 1.71+. Missing cargo or rustc was exercised: exit 2, extract/rust-unavailable, installation and ARCHIFY_CARGO/ARCHIFY_RUSTC guidance. The original acceptance did not use RA; the later audit compares real-project declaration navigation without claiming rustc compilation.

The baseline replay exposed a legacy shared Cargo helper executable returning v2 output to a v1 reader. Candidate cache directories now key the exact helper manifest, lockfile and main source contents. Identical source/ZIP content shares builds; changed versions compile separately. The observed current helper target cache occupies 103,840 KiB, including dependencies. Cold setup/download costs were not controlled; replay timings are cache-dependent and not a speedup claim. Verified parent replay followed cleaning only our legacy helper artifacts for its host triple.

- Local source: Rust 14/14; complete six-language module suite 380/380, zero skips, at runtime `1a1f6677e`. Core smoke 19/19 and release-identity check pass after installing checkout test dependencies.
- Extracted package: Rust/question/change selection 42/42, zero skips; source/ZIP developer questions and historical reader parity pass.
- Remote: final-head CI is tracked on the Draft; local passes do not establish a remote result or Windows execution.
- Integration: unmerged Draft work. Maintainers retain approval, formal merge, release and installation decisions.

The next investigation remains visible: generic/type-alias owner paths and remaining coverage gaps, while retaining Go's 37 compiler-confirmed known method misses and the other languages' source-backed backlog.
