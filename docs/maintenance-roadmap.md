# Maintenance roadmap: governance controls

Maintainer-facing plan for the controls introduced on branch `governance/maintenance-controls` and the phases that follow. Contributor-facing rules live in [CONTRIBUTING.md](../CONTRIBUTING.md) and [REVIEWING.md](../REVIEWING.md); the one-screen focus list lives in [.github/CURRENT_FOCUS.md](../.github/CURRENT_FOCUS.md). This document does not restate them.

## Why

As of 2026-09-08 the repository had 74 open PRs and 64 open issues, with roughly 5 new issues per day in early September and 3 collaborators with write access. Several issues attracted 3–6 parallel PRs: the lifecycle rail #243 drew #253, #268, #273, #292, #293, #304, and #306; SVG export drew #264, #272, and #328; non-positive dimensions drew #174, #177, and #186. PR diffs of +30K to +159K lines were dominated by regenerated Gallery and ZIP output rather than source. The goal of this roadmap is to reduce the reading a maintainer must do per decision without lowering the evidence standards already in CONTRIBUTING.md.

## Phase 0 — controls shipped in this change

- `.github/workflows/pr-triage-card.yml` — posts one advisory "Triage card" comment per PR: linked issues and whether they carry `accepted`, overlapping open PRs for the same issues, changed paths grouped by class, and which PR template sections are filled or empty. Sets or removes `generated-artifacts`; sets `awaiting-author` when a collaborator submits Changes Requested and removes it on push. It does not approve, reject, or fail a check.
- `.github/workflows/triage-commands.yml` with `.github/triage-allowlist.json` — comment commands `/label`, `/unlabel`, `/dup #N`, and `/needs-repro` for allowlisted users, because the repository cannot grant GitHub Triage (see below). It does not close issues or PRs; closing stays with collaborators. It never checks out or executes PR code.
- `.github/workflows/stale-awaiting-author.yml` — `actions/stale` scoped to PRs labeled `awaiting-author`: 14 days to `stale` plus a reminder, 7 more days to close with resume instructions. It does not touch issues, PRs waiting on maintainer review, or PRs without the label.
- `.github/workflows/generated-artifacts-report.yml` — Phase 1 of the generated-artifacts plan: rebuilds Gallery and ZIP for each PR, reports differences against the PR's committed output, and uploads the rebuilt artifacts. It never blocks; `zip-freshness` in `ci.yml` is unchanged.
- `governance-scripts` CI job in `ci.yml` — syntax-checks every `.github/scripts/*.mjs` and runs `node --test .github/scripts/*.test.mjs`, so the pure logic behind the workflows above is tested without network access.
- `.github/scripts/ensure-labels.mjs` — creates the fixed label set with `gh label create --force`; `--dry-run` prints the commands. Run manually once after merge, not in CI.
- Docs — `.github/CURRENT_FOCUS.md`, this roadmap, and additive paragraphs in CONTRIBUTING.md, REVIEWING.md, and the PR template covering primary implementation, the stale rule, the golden-example rule, and the triage card.

## Generated artifacts — three phases

| Phase | Contract | Automation | Exit criteria |
| --- | --- | --- | --- |
| 1 (active) | Unchanged: contributors regenerate and commit Gallery/ZIP; `zip-freshness` byte-matches a rebuild. | `generated-artifacts-report.yml` rebuilds per PR, reports differences, uploads artifacts, never blocks. | Four consecutive weeks in which the report matched the committed output for every merged PR, or every mismatch was explained by a stale contributor rebuild rather than a build nondeterminism. |
| 2 | `archify.zip` and the generated site on `main` are committed by release/CI automation. Contributors stop committing them. `zip-freshness` is re-scoped to verify the automation's commit. CONTRIBUTING.md `## Packages and generated artifacts` is rewritten. | Release/CI job commits generated output after merge; report workflow becomes informational on source-only PRs. | The automation has produced `main`'s artifacts for one release cycle with no manual rebuild, and the ZIP install path was tested from the automated output on the advertised hosts. |
| 3 | External PRs no longer commit generated-site or package paths. Golden examples (`archify/examples/*.html`, `examples/*.html`) remain in PRs forever and each change must be explained by the behavior change behind it. | Triage card or a check flags external PRs that still commit generated-site/package paths. | Two consecutive months without a PR needing a maintainer rebuild request, and the flag has produced no false positive on golden-example changes. |

Do not skip a phase. Phase 3 is the only point at which a check may fail for touching generated files.

## Repository placement decision

The repository is on a personal account. GitHub does not offer the Triage or Maintain role on personal repositories, so non-collaborators cannot be given label rights directly. Options:

- (a) Migrate the repository to an organisation. GitHub redirects the old URL and clones. Triage and Maintain roles become available, the single-owner risk is removed, and the comment-command proxy can be retired.
- (b) Keep the comment-command proxy (`triage-commands.yml` + allowlist). Live now; requires no account change; every allowlist change is a reviewed PR under CODEOWNERS.

Recommendation: (a), as a maintainer decision with its own issue, once the Phase 0 controls have run for a few weeks. (b) is in place until then and stays as a fallback.

## Manual steps after merge

1. Create labels: `node .github/scripts/ensure-labels.mjs --dry-run`, review, then run without the flag. Requires `gh auth status` to succeed for a collaborator.
2. Pin a short "Current focus" issue pointing to `.github/CURRENT_FOCUS.md`. Draft:

   > **Current focus — read before opening a feature PR**
   >
   > Maintainer focus is stability and first-diagram reliability; the active sequence is tracked in #344.
   > The one-screen list of deferred items and the evidence that would reopen each is `.github/CURRENT_FOCUS.md`.
   > Before opening an implementation PR, check whether the issue already has an open PR; if so, contribute there or open a clearly scoped complementary PR. One maintainer-designated `primary-implementation` PR per issue.
   > Narrow fixes and doc/test corrections do not need `accepted`. New contracts, defaults, diagram types, and export formats do.
   > PRs labeled `awaiting-author` go stale after 14 days and close 7 days later; push a commit or comment to resume. Waiting on maintainer review is never stale.
   > Decisions are batched into a weekly window; expect async replies otherwise.
   > This issue is a pointer. Discuss specific items on their own issues.

3. Apply `awaiting-author` once to PRs whose latest review from a collaborator is CHANGES_REQUESTED and whose head SHA is unchanged since that review. Mechanism: `gh pr list --state open --json number,headRefOid`, then `gh api repos/{owner}/{repo}/pulls/<n>/reviews` and compare the latest CHANGES_REQUESTED `commit_id` with `headRefOid`; label with `gh pr edit <n> --add-label awaiting-author`. Do not backdate; the stale clock starts at labeling. Snapshot on 2026-09-09: 29 open PRs carried a collaborator's CHANGES_REQUESTED; 12 had an unchanged head (#72, #122, #125, #127, #141, #172, #206, #207, #208, #212, #220, #260) and 17 had new commits that need a delta re-review, not a stale label. Of the 12, #125 and #141 were already superseded by merged work and #208 is a maintainer branch; close those with a reason instead of letting them age.
4. Designate `primary-implementation` on the known duplicate clusters: Windows path handling #309 over #276; lifecycle rail #253; SVG export after one command/receipt contract is agreed on the issue. Comment the designation and the reason on each affected PR.
5. Review the first 10 triage cards for noise: wrong path classes, false "overlapping PR" hits, template-section detection errors. Fix in `.github/scripts/` with a test before widening.
6. Add triagers to `.github/triage-allowlist.json` by PR, one login per line, reviewed under CODEOWNERS.

## Weekly decision window

- 2 hours, fixed weekly slot, at least one collaborator with write present.
- Inputs: triage cards, CodeRabbit summaries, CI results on the current head, the `awaiting-author` and `stale` queues.
- Outputs, one per PR or issue touched: merge; close with a stated reason; request specific evidence (name the check or decision); designate or redesignate `primary-implementation`; label `not-now` with a pointer to `.github/CURRENT_FOCUS.md`.
- Everything outside the window is asynchronous. Authors should not expect same-day dispositions.

## Measures

Review after 4 weeks and record the numbers in #344:

- Open PR count.
- Median time from "ready for review" to first maintainer disposition.
- Duplicate PRs per issue (open PRs linking the same issue).
- Share of PR diff lines in generated-site and package paths.
- Stale closures that were reopened (a high number means the clock is too short or labeling was wrong).

## Out of scope for this roadmap

Product direction, including the change-locate and architecture-delta experiments, is tracked separately. This document covers only how contributions are read, decided, and closed.
