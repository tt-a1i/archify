# Rust concrete-instantiation inherent source candidates

Dependent follow-up to current six-language Draft #1269 at1fa3cd0a097e973d653376721e6b8447f2be12b0. Original team/language commits, authors and PR ownership remain. The branch is the next native stack #1262 layer; no Labs integration, approval, formal merge, release or live installation.

## One real investigation step gained

In serde_json1.0.139 at4d4f53c3b7de3259b6a8a15ef4d5f4edb47af32f, value/index.rs:98 could previously inventory Map::new() but not navigate to a target. Now the normal CLI follows its crate::map::Map import to map.rs:29 and the ordinary stable impl Map<String,Value> at38, identifying map.rs:41 as a concrete-instantiation **source candidate**. Map::with_capacity in value/ser.rs:266 similarly reaches map.rs:49. The constructor's internal MapImpl::new remains unknown: a cfg-dependent alias selects an external BTreeMap/IndexMap implementation whose source is not captured.

This is not general type inference or proof of applicable argument types/compilation/runtime execution. Aliases and generated code can hide additional declarations outside the recognized nominal-owner model. Read the source-candidate resolution and languageScope limitations before extending a call chain.

## Source answers and competition controls

Source answers froze atd20ab450c before this round's baseline comparison or implementation. Authored compiler controls froze atbd5519d03; baseline/controls at10a06a32e. Initial rulef8ca96645 preceded all reserved cross-file candidate review. The paired test initially omitted its config argument; test-only correction1ef5ed43d fixed that wiring before the complete suite/package runs. No production retuning followed held-out observation.

The two map.rs:526/535 questions were reserved known misses in #1265 and separately located by its RA audit; they are now design inputs, not blind cases. Three cross-file questions (value/index98, value/ser215 and266) were source-inspected/frozen and reserved from initial rule tuning. Exact calls, imports, definitions and hashes remain in source-first.json. Both default and arbitrary_precision profiles are offline, tests=false; these two profiles overlap. preserve_order and other profiles are not additional measured configurations here.

| Selected source cohort | Parent Rust2 | Candidate Rust3 |
| --- | --- | --- |
| Five physical constructor calls, two profiles | 0correct/0wrong/10missed | 10correct/0wrong/0missed |
| Generic trait T::deserialize and backend alias MapImpl::new | 4unknown observations | 4unknown observations |
| Map constructor tokens in json_internal macro | Opaque unexpanded source | Opaque unexpanded source |

Ten known-target observations are five physical sites; no complete caller set or whole-project precision/recall is inferred. Macro tokens are not reported as resolved expanded callsites.

Existing rustc1.89.0 compiles the authored Unique<T>/impl Unique<String> control with a bare constructor path. A competing generic/concrete Choice impl makes the bare call ambiguous (E0034), and an explicit inapplicable Unique::<u8> path fails E0599. Controls were compiled only, never executed; no upstream code/build/test/proc macro ran. They establish why unknown competitors must block selection, rather than being discarded while a concrete impl wins by default.

## Bounded contract and preservation

rust-source-direct-v3, adapter revision3, retains old direct-function and monomorphic candidate semantics. A bare path through a selected unbounded, nondefaulted type-generic struct can identify one recognized nongeneric inherent impl with plain named type arguments. For a resolved nominal owner, generic/receiver/unsupported-argument siblings are retained as competitors. New targets use rust-specialized-inherent-source-candidate. Explicit generic call arguments, Self/type aliases, lifetime/const/bounded/defaulted owners, trait/receiver dispatch, visibility/type applicability, generated code and full Cargo builds remain unsupported. Historical v1/v2 scopes stay distinct.

All22,315 call ranges,4,730 functions and previous targets remain across regex plus the two serde profiles. All previous resolved import edges remain;18 previously unresolved import observations now have captured declaration files (10physical edges). Source-anchor review records the relevant Map, Deserializer, LineColIterator, Accels and IntervalSet declarations and complete import statements, including grouped multiline uses. This is source review, not compiler/runtime attribution.

The candidate introduces20 source-target observations at10physical serde callsites; regex adds no new call target. Independent rust-analyzer1.89.0 agrees on all20 locations,0different/0unavailable. These include the10selected observations and are not a new independent denominator. Exact LSP query points, expected function ranges and returned locations are in evidence/audit/. New wrong-target control and original v2 regex wrong-target control both reject substituted definitions.

## Independent audit setup and costs

RA is an optional research verifier, not a shipped backend/dependency. Its already installed executable was35,248,592bytes in the original audit; this round installs no toolchain. Existing Rust/Cargo1.89.0 and Node26.12.0 were used on darwin-arm64. Product helper floor remains Rust/Cargo1.71+, with locked helper dependencies cached first for offline replay. Fresh setup/download/compile time was not controlled. Missing Cargo still exits2 with extract/rust-unavailable and installation/ARCHIFY_CARGO/ARCHIFY_RUSTC guidance; see missing-tool.json.

The reused guarded audit uses isolated pinned source copies and generated audit-only locks, disables checkOnSave/buildScripts/procMacro, and verifies those disabled settings from analyzerStatus. The report's effectiveSafetySettings=true entries mean the disabled-setting assertion passed. Cargo logs across the initial audit and source-integrity replay show48metadata/16version requests executed;48rustc/-Z probes denied. These repeated requests/target queries are not added as independent observations. No Cargo build/check/test/run/rustc executes. RA makes direct SDK cfg queries. Standard-library metadata still cannot obtain cc1.2.0 offline and retries no-deps; this limitation remains in stderr. Source definition agreement does not prove a complete compiled dependency/SDK environment.

Positive RA startup+10-query times on warm caches are recorded per profile; the final replay also verifies every captured workspace source byte before querying. These are audit observations, not a speedup or fresh-install cost comparison against product analysis. The original audit driver gains optional pinned inputs and target selection; its original default wrong-nominal control remains verified.

## Reproduce normal CLI and audit

```sh
python3 benchmarks/code-analysis-rust-specialized-inherent/run.py \
  --cli archify/bin/archify.mjs --samples-root /fixed/samples \
  --out /runs/rust-specialized-accepted-source
```

Use #1269's CLI plus --expect baseline for Rust2. Use the extracted CLI and /runs/rust-specialized-accepted-zip for ZIP. The runner checks fixed source hashes before/after, preserves commands/exits and verifies selected saved-question navigation. All check/question exits are0 under explicit --fail-on never; that is not a no-findings/completeness claim. Questions select the narrowest captured enclosing function, including physically nested local impl bodies, not necessarily executed caller bodies.

Replay the older inherent and original direct-language recipes in their owning directories with outputs rust-specialized-inherent-source/zip and rust-specialized-direct-source/zip. The version-aware older grader now recognizes that its original Map misses are correct under v3; original v1/v2 outcomes remain historical. Existing Number version-pair references remain3per side and partial/exit1; original regex/serde direct-body pairs retain their partial/exit1 outputs. The new controlled changed-constructor test finds1known imported caller per side; no real changed-Map-body claim is made.

```sh
python3 benchmarks/code-analysis-rust-inherent-functions/audit/prepare.py \
  --samples-root /fixed/samples --workspaces-root /audit/workspaces --out /audit/results
# Cache the pinned audit dependencies as documented in the original audit README.
# Arrange current facts at /facts/serde-default and /facts/serde-arbitrary.
python3 benchmarks/code-analysis-rust-inherent-functions/audit/audit.py \
  --profile serde-default --workspaces-root /audit/workspaces --facts-root /facts \
  --out /audit/results --inputs benchmarks/code-analysis-rust-specialized-inherent/audit-inputs.json
```

Repeat for serde-arbitrary; use --negative-control on serde-default for the substituted-declaration check. Reproduce the old regex control with its original v2 facts/default inputs. Supplied inputs freeze complete call/function/source digests, source revisions and lock digests; this audit refuses unrelated captures.

## Separate verification states

- Local source module391/391, zero skips; Rust17/17 after fixture correction; core19/19; release identity passed.
- Extracted Rust/shared-question/paired tests46/46, zero skips.
- New source/ZIP replay both10correct/0wrong/0missed/4unknown; older inherent recipe8correct/0wrong/0missed/4unknown; original direct recipe9correct/0wrong/0missed/2unknown. These overlapping denominators must not be summed.
- Eleven raw capture instances (7distinct payloads) agree byte-for-byte;17current question instances (15distinct normalized payloads) plus actual v1/v2 historical questions agree after only install/output paths. All28CLI commands per distribution have matching arguments/exits; three partial paired commands retain exit1. Repeated captures/selections are not extra samples.
- Two canonical Node22.23.3/zlib1.3.1-e00f703 builds agree; all168tracked module files match. ZIP SHA2561be155b2e2d924c83c4850453a2d9093e295e83727e7490907d9f70b25a2fe67; evidence/parity.json lists every capture/question and historical scope. Other five languages' unchanged real-repository replays remain attributed to #1269/1fa3, not relabeled as new-head runs.
- Remote final-head CI is tracked in the English Draft/Wiki; local/package/RA success does not establish remote/Windows success.
- Not in Labs/approved/merged/released/installed. Continue real wrong targets, known misses and source investigation interruptions across all supported languages.

Scoped test-value review adds one concrete-source navigation boundary, one compiler-backed competition boundary and one changed-caller outcome. Focused simplification review reuses nominal lookup/import/source ranges and stores unsupported competitors in the same inherent inventory; no generic type inference engine or parallel resolver is added. Diagram generation is unchanged; renderer generation comparisons are not applicable.
