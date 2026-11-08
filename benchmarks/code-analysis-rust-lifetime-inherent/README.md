# Rust lifetime-only inherent source navigation

At regex `9870c06e6c772daaad7ab612faab29130753e41c`, a developer reading
`Translator::translate` previously stopped at `TranslatorI::new(self, pattern)`
(hir/translate.rs:174:25). The internal type and impl have only lifetime parameters;
its unique function is source-known at685. Rust4 now reaches that declaration
without treating the separate Visitor implementation as evidence for receiver calls.

This is an independently owned follow-up above Rust #1270
`3f42ee34b920b15cdd808fc54928e653f883cae1`. The latest cumulative candidate remains
Java #1273/196dd3569 until this follow-up is composed. Existing PR heads, original
contributors and commits remain intact. Nothing is merged into Labs or released.

## Source before implementation

- [Original source freeze](source-first.json), `3cfe09f5f`, preceded
  [baseline](baseline.json), `701cbff06`, and initial rule `a150e7682`.
- Three physical paths: TranslatorI::new174→685, ast::visitor::HeapVisitor::new119→201,
  and hir::visitor::HeapVisitor::new66→105. The two HeapVisitor paths were reserved
  from initial rule tuning; this was a previously analyzed corpus, not blind.
  Native module identity must keep the same-spelled owners distinct.
- [Explicit point correction](source-corrections.json), `b569acada`, also preceded
  the first candidate replay. The original translator target mistakenly used the
  owned doc-comment range684 rather than the ordinary function start685. Its source
  identity (new at685:8) was always correct. Existing register_fn/call source at #1270
  establishes the pub/fn target contract; the original freeze remains available.
- Baseline:0correct/0wrong/3missed plus2reasonable Visitor receiver unknowns.
  [Candidate](evidence/candidate.json):3correct/0wrong/0missed plus the same2unknowns.
  No rule changes followed the reserved candidate outcomes.

## Scope and preservation

Rust4 / adapter4 adds bare nominal/module/import-alias paths to receiver-free
inherent declarations on lifetime-only structs/enums. Declared and impl lifetime
parameters must be unbounded; impl names map one-to-one to owner arguments, with
no where clause. Existing crate resolution, cfg selection and exact UTF-16 ranges
are reused. New calls use rust-lifetime-inherent-source-candidate.

A shared parameter-shape enum replaces separate monomorphic/specialization flags
and distinguishes plain lifetimes from concrete type specializations. Unsupported
siblings remain in the candidate inventory as blockers. Enum variant names retain
the existing exclusion even when a same-named inherent function exists.

Concrete static lifetime specializations, repeated/subset lifetimes, mixed type
parameters, bounds/where clauses, const/defaulted owners, explicit call arguments,
aliases/Self, receiver/trait dispatch, expanded macros and full applicability remain
unknown. This does not infer lifetimes, borrow-check, establish compilation or prove
runtime behavior/full impact. Historical v1/v2/v3 facts retain their original scope.

[Preservation](evidence/preservation.json): all17,995call ranges,3,435functions,
166source files and1,968old targets are unchanged;0parse failures. Exactly73new
call candidates appear. The selected3are included in that regex denominator. A post-design preservation
replay also found11new serde_json targets per profile (11physical sites across
default/arbitrary_precision); both sets are independently LSP-audited below.
Existing serde targets127/default and186/arbitrary remain unchanged.
The [reproducible preservation checker](preserve.py) records separate source,
call-range and import evidence for all three profiles.
The shared nominal index also binds39previously unknown import records to9source
nominals; all1,477import records remain present, with no old resolved target changed.
[Their fixed source declarations/import statements](evidence/imports-source-review.json)
were reviewed after implementation; this is source review, not a separate LSP or
blind accuracy cohort. Graph findings may change as these dependencies become visible.

## Independent attribution and cost

[RA rows](evidence/ra-rows.jsonl), [receipt](evidence/ra-report.json) and
[pinned inputs](evidence/ra-inputs.json): rust-analyzer1.89.0 returns exactly one
location for each of73new calls; all73agree with the captured source declaration
range/name,0different/0unavailable. A separate deliberately wrong expectation is
[rejected](evidence/ra-negative.json) (0agree/1different), not a product wrong target.
[All-profile summary](evidence/ra-summary.json) additionally covers11/11serde
default and11/11arbitrary_precision observations, source-reviewed after design.
All95observations across84physical sites agree with exactly one LSP location each;
0different/0unavailable. Serde has2new bound imports per profile, separately
source-reviewed in its preservation receipts. These are language-server definition
agreements, not compiler/build/precision/recall
or runtime proof. The three selected questions overlap those73observations.

The retained executable is35,248,592bytes; no toolchain/component was installed.
Rust/cargo1.89.0, rust-src, existing registry caches and previous isolated fixed-source
workspaces were reused. Regex startup plus73queries took4.34s here; each serde startup plus11queries
took3.82s. These are cached local observations; fresh installation,
download cost and cross-host audit were not measured. The audit uses a separately
generated/pinned Cargo.lock, not an upstream release lock. Existing standard-library
metadata offline fallback (missing cc1.2.0, then no-deps) remains in raw local stderr.

Effective analyzer status explicitly reports checkOnSave=false,
procMacro_enable=false and cargo_buildScripts_enable=false. The legacy receipt's
boolean safety values mean these false settings were found, not that execution was
enabled. The [Cargo guard log](evidence/cargo-commands.jsonl) permits only metadata
and version commands across these audit sessions, enforces locked/offline metadata,
and rejects other probes. No upstream build/check/test, proc macro or build script
is executed. Project source bytes are checked against the captured facts before LSP
requests. The audit is optional research, not a shipped backend/dependency.

## CLI and archive reproduction

```sh
python3 benchmarks/code-analysis-rust-lifetime-inherent/run.py --cli archify/bin/archify.mjs --sample /path/to/fixed-regex --out /path/to/new-output
```

For baseline use #1270's CLI and --expect baseline. The runner verifies revision,
clean tracked source and hashes, writes the frozen explicit aarch64-apple-darwin /
default-feature / no-test profile, then invokes normal check and three saved tasks.
Repeat with the unpacked ZIP's archify/bin/archify.mjs. Source and ZIP are two
installations of one implementation, not independent accuracy samples.

`pair.py --cli <cli> --work <owned-fixtures> --out <new>` checks a renamed Cargo
project dependency with a custom actual_api library name. A controlled body change
retrieves3known sites across2caller functions on both sides, ready/exit0, from0with
#1270. This is **owned synthetic integration**, not a real upstream version change;
original real Go/Rust change-pair acceptance remains separately attributed.

`extras.py` reads actual saved v1/v2/v3 captures without rebinding and simulates an
absent Cargo/rustc path. Missing product tooling returns structured
extract/rust-unavailable / exit2, never a successful empty capture. Normal analysis
still requires installed Cargo/rustc1.71+ and locked helper dependencies; optional RA
is not needed. Product helper cold-build/cache costs keep their earlier attribution.

The older specialized-inherent run.py accepts --candidate-model rust-source-direct-v4
without changing its historical default or expectations: five physical serde_json
Map sites retain10correct/0wrong/0missed observations under two overlapping profiles,
plus4unknowns. Old facts/questions are not rewritten as new outputs.

For independent attribution, use the unchanged prior audit prepare.py / audit.py
with the new pinned inputs and --profile regex, serde-default, or serde-arbitrary. Prepare new guarded output directories
as described in that audit README; supply the captured facts at <facts-root>/regex.
Normal and --negative-control sessions keep separate result directories. The fixed
workspaces/locks are independently hashed and source-verified. Reuse/download of
pinned dependency sources is separate from running upstream code.

## Validation states

- Local module394/394, zero skips. Extracted Rust/shared-question/call tests42/42,
  zero skips. Canonical Node22 package/release54pass/0fail/2environment skips
  (non-canonical rejection lane and Windows-only drive paths).
- [Source/ZIP parity](evidence/parity.json):3current raw captures and17current/owned/
  historical question payloads agree;21normal CLI commands per distribution.
  Only the intentional missing-SDK command exits2; the other20exit0.
- Two canonical Node22.23.3/zlib1.3.1-e00f703 builds agree.168module package files
  match source. Tracked ZIP SHA256b588c11911c80ff4fb1a87b292becf80b636a3c6c0f5ca365c200fb74eb5bbfb.
- Runtime a150e7682; evidence/archive follow-up is separate. Remote final-head CI
  is pending publication. Local/RA/ZIP results do not imply approval or merge.
- No approval, merge, release or live installation. Composition with the newest
  six-language candidate is a subsequent step preserving both histories.

Scoped test-value review adds three tests for cross-crate alias/nominal navigation,
wrong variant and unsupported candidate boundaries, and changed-body callers.
The independent fixed-source answers and RA audit challenge owned-fixture assumptions.
Focused simplification review reuses the existing owner/candidate map and schema /
saved/paired readers, replacing parallel shape flags with one discriminant; no new
execution backend, cache, lifetime solver or unrelated cleanup is introduced.
