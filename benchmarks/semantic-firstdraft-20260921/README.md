# Source-backed first-draft experiments — 2026-09-21

Baseline: `e484993f819ec16f3ee4c976ee14173901cdbc56` from
`labs/first-draft-cost-20260918`. This directory is an experimental authoring
surface, not a product CLI or installed Skill update. The compact-input
experiment preserves the production schema, geometry, renderer, quality checks
and finalization. The later route experiment changes only a copied architecture
router; all production validators and authored content remain unchanged.

## Hypothesis

An author can express the same inspected source semantics and explicit geometry
with less repetitive field serialization, while a short format guide avoids
unnecessary initial shape/example lookups. Test the combined author-input route
against the ordinary Skill on complete source-backed diagram tasks. It is not an
auto-layout or semantic-extraction tool. A benefit cannot be attributed uniquely
to token count, serialization, shorter reference reading or model randomness.

The candidate reads the unchanged Skill, repository-authoring and authoring
defaults. `compact-authoring.md` replaces only the initial Architecture
example/shape lookup. It uses `author-kit.mjs` to expand author-selected data into
normal JSON. Schema/example reads remain available on demand. The first draft
still has automatic routes, explicitly selected node boxes, and full evidence.

The helper preserves array order, semantic strings, source objects, additional
fields, explicit geometry and later repair controls. It rejects malformed
shorthand or data that JSON serialization would silently lose; production
validation remains authoritative. No dependencies, source scanning, cached
answers, node/edge quotas or inferred geometry are introduced.

## Frozen design

`tasks.json` defines three new task scopes and every visible semantic acceptance
clause. Two independent source audits preceded freeze; they corrected ambiguity
between filesystem access-check failures and later read failures, and clarified
retry-time limits. Reviewers must not invent additional required behavior after
authoring. Source contradiction remains a defect even in an unsolicited claim.

Initial six authors are fresh Terra/medium, serial, with alternating condition
order. Each has 600 seconds and at most three focused repairs. Both conditions
use identical pinned source and packaged Archify files. The candidate's helper
and guide are the only supplied difference. All runs, errors, failed deliveries
and mechanism non-use stay in the evidence; no result is silently replaced.

Screening requires all three candidate outputs to meet machine, source and
visual quality, at least two fully qualified B/C pairs, median full-time saving
of at least 15% and 20 seconds, and no qualified pair over 10% slower. A passing
screen triggers exactly one fresh opposite-order confirmation pair per original
task. Initial results alone never justify default promotion. Failed baselines
have no successful latency and cannot supply a counterfactual speedup.

`run.py freeze` records source revisions/file hashes, package hashes, input
hashes, task order, model, bounds and decision criteria before author dispatch.
The external observer preserves candidate byte changes. `run.py finish` extracts
only public native task/tool timing categories, not reasoning or raw tool
payloads. Provider queueing, internal HTTP retry and hidden model-time attribution
remain unknown. `evaluate.py` validates frozen snapshots and captures delivered
artifacts afterward without changing authors' results. It fails closed on missing
or changed source/package hashes (also helper/guide in compact runs), mismatched
author identity, or a censored/out-of-bound author duration. Ineligible runs
never execute the copied validator or capture tool and cannot qualify as
deliveries, even if a worker wrote a successful finalize receipt. This exclusion
gate was repaired after independent review; all twelve original runs pass it,
so no measured outcome changed.

## Measurements and quality

- `T_full`: before copying the per-run source/package/condition and dispatch,
  through native task completion. This includes author reading, writing, helper
  execution, errors, repair and final response. Primary selection metric.
- `T_author`: native single-turn start through complete. Report alongside full
  time to expose coordinator/dispatch effects.
- First structurally complete JSON: diagnostic only; not an accepted first draft.
- Earliest qualified candidate: only bytes subsequently bound to successful
  complete finalization and independent source/visual review; otherwise null.
- Local machine/helper time and output bytes: diagnostic, not speedup claims.
- Source cloning, task audit, research, prototype development and independent
  review: separate study costs, not hidden inside the performance percentages.

Independent review hides condition, timing, tool use and author narrative. It
checks visible task clauses against pinned source, citation entailment and final
diagrams at common viewports. Captures use the unchanged visual-check command:
1440×900 and 2048×1320 light/dark, in addition to normal browser measurements
including 1920×1080. Normal Reader vertical document scrolling is allowed;
clipping, illegibility, misleading boundaries or material semantic loss are not.
First and final candidates are reviewed separately where artifacts are available.

## Commands

```sh
node --test benchmarks/semantic-firstdraft-20260921/author-kit.test.mjs
python3 -m unittest discover -s benchmarks/semantic-firstdraft-20260921 -p evaluate_test.py -v
python3 benchmarks/semantic-firstdraft-20260921/run.py freeze --scratch <scratch> --out <evidence>
python3 benchmarks/semantic-firstdraft-20260921/run.py begin --run p-retry-B1 --scratch <scratch> --out <evidence>
# Dispatch one fresh independent Terra/medium author to the emitted TASK.md.
python3 benchmarks/semantic-firstdraft-20260921/run.py finish --run p-retry-B1 --agent /root/<author> --scratch <scratch> --out <evidence>
python3 benchmarks/semantic-firstdraft-20260921/evaluate.py --scratch <scratch> --out <evidence> p-retry-B1
```

The session extractor expects native Codex task events and one fresh single-turn
session per author. Other harnesses must record equivalent public event evidence
rather than fabricating those fields. Source clones must match `tasks.json`
before freeze.

## Runtime preference experiment

The compact screen failed mandatory delivery gates, so no compact confirmation
was started. Its failures exposed automatic first-clear routes that the existing
rhythm validator subsequently rejects. `route-preference/runtime.patch` is the
original feasibility patch: continue side-pair selection to prefer a clear,
rhythm-clean route, retaining the original clear candidate as fallback. It
preserves authored geometry and explicit-side constraints.

V1 removed real route failures but spent extra grid searches on preference-only
probes. An independent dense fixture exhausted the shared 64-search budget and
changed an unrelated later route, though both routes remained clear/readable.
V2 adds a private `allowGridSearch` option: after the original first clear route,
only cheap existing candidates may compete with it. V2 retains the development
improvements and restores the dense fixture's original suffix route and budget.
Neither version changes thresholds, labels, evidence or authored diagram bytes.

The selected V2 routing SHA is
`cfd259b6b06b7f48e155e10c54e7912e6a8f7338afb79df7465a5c43bd576988`.
Both p-retry and quick-lru are development inputs by this point. New runtime
authors are fresh independent runs, not unseen-repository validation.

Runtime trials use a separate scratch/output directory, ordinary Skill in both
arms, no compact guide/helper, and the same three frozen task cards. Order is
`p-retry R/B`, `quick-lru B/R`, `lilconfig R/B`. They retain the original screening
thresholds and the conditional opposite-order confirmation rule. No auxiliary
agents run during these timed authors. `run.py freeze --runtime-candidate PATH`
requires exactly one changed package file, `renderers/architecture/routing.mjs`.
Source and per-condition runtime hashes are checked again after each author.

## Reproduce the isolated regressions

Pinned public source clones are prerequisites for actual repository-evidence
validation. Existing mismatched/dirty repositories are rejected, not reset.

```sh
python3 benchmarks/semantic-firstdraft-20260921/prepare_sources.py --root /tmp/archify-firstdraft-repro/repos
ARCHIFY_STUDY_REPOS=/tmp/archify-firstdraft-repro/repos node --test benchmarks/semantic-firstdraft-20260921/route-preference/route-preference.test.mjs benchmarks/semantic-firstdraft-20260921/route-preference/v2/route-preference.test.mjs
```

These tests copy the packaged runtime into a disposable directory, apply the
recorded patch and use the frozen candidates under `evidence/compact/`. They do
not modify a live Skill. V1's six tests retain its historical behavior; V2's
three tests check the actual cache rejection, retry width-error preservation
and the independent dense-budget counterexample. Passing these regressions is
not proof of whole-author speed.

## Completed study

All twelve timed authors and both rounds of independent source/image review are
complete. Four attempts qualified; neither experiment has a fully qualified
baseline/candidate pair. Both mandatory screens failed, so no confirmation was
started and no whole-author speedup is claimed. Production `archify/` and the
live Skills are unchanged. See the
[final result](../../docs/research-semantic-firstdraft-result-20260921.md).

`evidence/compact-records.tar.gz` and `evidence/runtime-records.tar.gz` retain
all per-run first/intermediate/final candidates and receipts. Each manifest has
per-member and archive SHA-256 values, all verified by readback. Metadata, blind
reviews and three regression fixtures remain plain files. To inspect a full
cohort, extract its archive from `evidence/`; it restores the respective
`compact/` or `runtime/` prefix. HTML/PNG paths are listed in each evidence
README. Native traces contain public timing categories only, not raw sessions,
reasoning text or tool arguments. Failed samples remain part of the record.
