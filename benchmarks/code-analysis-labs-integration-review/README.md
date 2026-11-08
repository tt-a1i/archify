# Bounded Labs integration review

This is a cumulative integration **Draft**, not approval or a merge recommendation
without conditions. The technical blockers reproduced below are repaired. The
whole-batch personal review, the agreed A1-first/A2-separate staging decision,
and applicable Labs approval/thread rules remain human acceptance conditions.
No existing PR or native stack is retargeted. No release or live installation is
part of this review.

## 1. Confirmed scope

- Labs base: `bf0a29e7664f52973d06a8e6a608df2db1ecbd39`.
- Independently reviewed original candidate: #1279,
  `996e073ded7b99cbe885fbc4afab5d125412f6c1`.
- Repaired runtime: `3f5b75f3fff3870114bf5617cd2cba567c56dd37`.
- Original scope: **632 paths / 176 commits**. Repaired runtime scope before
  adding this report: **633 paths / 182 commits**. The report/evidence files are
  additional review-only changes; inspect the final PR for its complete count.
- Models remain JS/TS5, Python2, Java5, Go3 and Rust4. The later local Python3
  module-qualified candidate is excluded; this review adds only Python BOM
  identity handling, not that separate feature.

| Repaired runtime responsibility | Paths |
| --- | ---: |
| Analysis implementation/configuration/schema/manifests | 45 |
| Authored analysis documentation/contracts | 8 |
| Analysis tests/fixtures | 33 |
| Existing benchmark programs, fixtures and results | 543 |
| Skill ZIP | 1 |
| README proof GIF and receipt | 2 |
| DSH documentation-contract test | 1 |
| Total before this review report | 633 |

The README proof and DSH documentation-test baseline repairs inherited through
#1242 are explicit batch scope, not analysis features or DSH runtime/release
acceptance. No renderer, Viewer, workflow, root dependency or website
implementation path enters the runtime delta. The complete [original commit
inventory](evidence/history/original-commits.json), [original paths](evidence/history/initial-paths.json)
and [repaired runtime paths](evidence/history/repaired-paths.json) are inspectable.
Inventory completeness is not a claim of line-by-line semantic review of every
benchmark result.

## 2. Independent findings

Three isolated ephemeral Codex processes performed the requested review roles:
Git/GitHub/history and shared semantics were configured as `gpt-6.1-sol` with
medium reasoning; source-first ZIP checking as `gpt-6.1-terra` with medium
reasoning. The first attempts through an old CLI rejected those model names
before doing review and do not count as findings. The actual reviews used the
bundled CLI0.167.0-alpha.3.2. The two review roles independently rechecked the
repairs. Reports are AI-assisted technical evidence, not human confirmation.

| Finding at 996 | Reproduction and disposition |
| --- | --- |
| Go raw-string/block-comment and Rust block-comment bare CR | Compiler-accepted source failed shared range and point validation. Fixed by preserving the producers' LF line policy through schema, function/target navigation and paired definition slicing; source bytes and native UTF-16 coordinates are unchanged. |
| Python UTF-8 BOM | Newly captured unchanged files were falsely stale in saved and paired questions. Fixed by matching Python signature removal before identity comparison and first-line coordinate use. Non-Python BOM handling is preserved. |
| Current A2 contribution omitted | Original #1223 fixes were missing. Four original author commits are now exact ancestors, with source escaping and literal-backslash distinction retained. This was an exported formatter-contract/current-contribution omission; normal CLI C0 paths already fail schema validation, so no end-to-end terminal injection claim is made. |

Coordinator regressions failed **0 pass / 4 fail** on the original behavior and
pass **4/4** after repair. Source and extracted ZIP each ran seven public CLI
repair commands; three raw captures match byte for byte and the BOM changed-body
pair is ready with a verified known caller. [CLI receipt](evidence/repairs/source-zip-cli.json).
The shared re-review independently checked all six original contract cases,
all six shadow/unknown guards, native source slices/cache policy, BOM+CRLF+astral
imports and genuine later source edits. [Repair observations](evidence/shared-recheck/observations.json).

Original narratives and bounded re-reviews: [history before](reviews/history-initial.md),
[history after](reviews/history-recheck.md), [shared before](reviews/shared-initial.md),
[shared after](reviews/shared-recheck.md), [ZIP](reviews/zip-initial.md). They retain
historical wording; the correction above and re-reviews govern current disposition.
Some links inside archived narratives refer to retained local work artifacts;
the selected machine evidence under `evidence/` is the published subset.

## New real-project ZIP sample

Source was inspected and hashed before any candidate CLI run. The selected
repositories did not appear in the candidate's prior benchmark manifests or
READMEs; absence from all historical development is not claimed.

| Fixed project | Correct | Wrong | Missed | Omitted | Reasonable unknown |
| --- | ---: | ---: | ---: | ---: | ---: |
| google/uuid v1.6.0, `0f11ee6918f41a04c201eceeadf612a377bc7fbc` | 4 | 0 | 0 | 0 | 1 |
| BurntSushi/walkdir2.5.0, `4f26be4d450910916ea11533b2efc52b9a6483bc` | 4 | 0 | 0 | 0 | 1 |

Examples: uuid `node.go:40` reaches `node_net.go:19`; walkdir `src/lib.rs:690`
reaches `src/util.rs:5`. Interface/stdlib receiver controls stay unresolved.
[Source-first manifest](evidence/zip/source-first.json), [observations](evidence/zip/observations.json)
and [host profiles](evidence/zip/) record hashes, targets, parse/exclusion scope
and tool versions. No Labs baseline accuracy run was performed for these new
repositories; added-correct counts are therefore **not measured**. Eight narrow
observations are not a production precision/recall estimate.

The repaired ZIP repeats the same 11 CLI invocations: two captures, eight
successful question selections and one intentionally ambiguous Rust selector
(exit2; qualified selection succeeds). Both captures are byte-identical to the
original candidate's, and eight complete questions agree after install/output
path normalization. [Repaired ZIP replay](evidence/zip/repaired-zip-replay.json).
No upstream project code, tests, build scripts or proc macros were executed.

## Compatibility and validation

Nine **authentic saved** captures were read without rebinding: JS3, TS4, Python1/2,
Java4, Go1 and Rust1/2/3. All selected entries have available coverage and retain
original factIndex/fact/model identities; display omissions remain explicit.
[Receipt](evidence/legacy/receipt.json). This is not a new attribution audit of
every historical target or every historical model shape.

| Validation at repaired runtime 3f5b75f | Result |
| --- | --- |
| Local full analysis module suite | 416 pass, zero failures/skips |
| Local package/release contracts | 54 pass, zero failures, 2 environment skips |
| Targeted repair regressions | 4 pass, zero failures/skips |
| Independent shared repair re-review | S1/S2 resolved within examined contracts |
| Canonical archive rebuild | Byte-identical, Node22.23.3 / zlib1.3.1-e00f703 |
| Extracted repair and real-project CLI | Recorded separately above |
| Final integration PR CI | Must be inspected at the final PR head; this report commit precedes that run |
| Actual Labs integration | Not performed |

Final runtime archive: SHA256
`641e2c8cb495a4f7a9fb7c8098b12c9bb76e766eeeda95511bf255eebfc8c3ac`,
7,597,489 bytes. The original #1279 CI run42442200073 succeeded at996; it is
inherited evidence only and is not relabeled as final integration CI. Local
checks use macOS arm64, Node22.23.3, Go1.27.2, Rust/cargo1.89.0 and Python3.15.0
with warm existing caches. Fresh install/download cost, minimum toolchain lanes
and all host/feature combinations are not established by these observations.

Evidence limitation: a relative redirect during shared re-review overwrote the
original complete 47-test log. Its original event-stream exit and last14lines
survive in the [retained tail](evidence/shared-initial/original-focused-tail-from-events.txt).
The fresh48-test re-review and coordinator416-test run are distinct evidence.
No fabricated replacement of the lost original log is supplied.

## 3. Disposition and human gates

Technical findings examined here are addressed; **hold actual merge** until the
maintainer confirms the cumulative batch and resolves the existing staged
acceptance decision. Original author @outlier27-cell has personally confirmed
#1222/#1223. That confirmation does not cover this entire batch or the coordinator's
repairs. The cumulative accountable-human checkbox remains unchecked.

The current Labs applied rules require one approving review under the reviewed-PR
rule, with only its recorded narrow pull-request-mode exception; thread resolution,
stale-review dismissal and unattributed-change safeguards still apply. No exception
is merge authority. The saved rules contain no required-status-check rule, but
CONTRIBUTING independently requires final-head CI and refreshed base/head.
[Applied rules](evidence/history/labs-rules.json). Refresh them before actual merge.

A dedicated ordinary Draft directly to Labs preserves existing histories and
review scopes. Do not repurpose or retarget an existing lower stack PR. The
runtime merge retains exact parents d37596e (the narrow repairs) and e164cc3
(current original A2). Earlier adapted Java and README cherry-pick histories
remain attributed as documented; they are not falsely described as exact
preservation of every original overlapping PR tip. Approval, merge, release,
installation and any change to staged acceptance remain maintainer decisions.

## Reproduce original independent controls

Copy `reproduce/` into a fresh scratch directory, extract
`git archive 996e073ded7b99cbe885fbc4afab5d125412f6c1 archify/modules/code-analysis`
there under `candidate/`, and install only that isolated module's locked npm
dependencies with `--ignore-scripts`. With the recorded toolchains on PATH,
run `node probe.mjs`, `node contracts.mjs`, `node guards.mjs`, and
`node bom-pair.mjs` from the scratch directory. The scripts create only owned
source fixtures. They catch some extraction failures; inspect structured
`extractOutcome`/diagnostics rather than treating their wrapper exit0 as a pass.
For repaired results, use archive3f5b75f and update the report's revision label;
all expected source vectors and assertions stay unchanged. Run the repository's
four repair tests and full module suite on the repaired checkout. Review
`commands.json` receipts for the exact public CLI cases, source roots and profiles.
