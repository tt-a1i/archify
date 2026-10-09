# Contributing to Archify

Archify is Agent-first: people describe systems, and the Skill, typed JSON, renderers, validators, and delivery receipts produce reproducible diagrams. Keep each contribution focused on one user-visible behavior or one tightly related delivery slice. Maintainers and Agents reviewing a PR or a revised head follow [Reviewing](REVIEWING.md).

## Choose the right path

- Renderer, validator, package, or Viewer defect: use the [bug report form](.github/ISSUE_TEMPLATE/bug-report.yml).
- Standalone community package: follow the [submission guide](community/README.md#submitting-a-package) and submit one metadata file to `dev`.
- Reproducible real-world diagram: use the [showcase form](.github/ISSUE_TEMPLATE/showcase.yml).
- New schema fields, defaults, acceptance rules, installation/export contracts, or broad product behavior: agree on value, compatibility, and non-goals before substantial implementation. Link the issue or recorded maintainer decision; reuse an existing agreed scope.
- Narrow fixes and small documentation or test corrections can proceed with a concrete reproduction or rationale; a separate planning issue is unnecessary.
- Security vulnerabilities: follow [SECURITY.md](SECURITY.md).

Do not include secrets, access tokens, credentials, private repository content, personal data, or customer data in fixtures, logs, screenshots, artifacts, or package tests.

## Prepare a reviewable change

Start from the latest `dev` and target `dev` for fixes and features. Check whether its existing controls already solve the reported case. Record the comparison base and candidate head.

Use Draft for unresolved scope or early implementation feedback. At this stage, provide the smallest reproduction and relevant checks. Prepare broad integration evidence and generated artifacts once the approach is settled.

Before requesting final review, explain:

- The current-base trigger, intended outcome, and why the benefit justifies the implementation and ongoing maintenance cost.
- The changed behavior and shared callers, existing behavior that must remain stable, and any intended compatibility changes.
- The applicable checks, actual results, and reproducible evidence links.

Use [the PR template](.github/PULL_REQUEST_TEMPLATE.md); link existing receipts or CI output instead of transcribing long logs. Classify impact by behavior and callers, not file extension or diff size.

## Choose evidence by impact

| Impact | Typical change | Evidence to prepare |
| --- | --- | --- |
| Text or review policy | Explanatory prose, links, contributor/reviewer procedure | Check content, links, and consistency with affected templates or automation. No local renderer suite for repository-only prose. |
| Local behavior | One CLI path, focused test correction | Reproduction or rationale, affected tests, and relevant failure/compatibility cases. |
| Shared behavior | Geometry, text measurement, shared Viewer, evidence or delivery helpers | Trace callers; identify affected modes and contracts; compare fixed representative inputs on base and candidate, including relevant historical failures. |
| Contract change | Schema, defaults, validation acceptance, Skill or authoring instructions | Agreed scope and explicit allowed/preserved behavior, plus local/shared evidence appropriate to the implementation. |

Skill instructions, authored examples, build inputs, and generated-site sources are behavioral inputs even when they look like documentation. Policy changes need process review; runtime evidence depends on whether they affect runtime inputs.

Start with `npm test` for the core product smoke or focused checks for the affected behavior. Use `npm run test:full` when shared infrastructure, broad changes, or findings require wider coverage. Final review needs sufficient evidence for the impact above; relevant CI results can supply that coverage without repeating the same run locally. Identify the revision and coverage of reused results, and explain material gaps. Required remote CI and branch protection still apply.

Tests should protect a user outcome or a real failure boundary. Prefer rendered
content, successful interaction, preserved authored intent, and bounded work to
matching implementation source or freezing automatic layout coordinates. A
better automatic route, clearer copy, or equivalent refactor should not fail a
test merely because it differs from the old implementation. Delete redundant
source assertions when a behavior test owns that protection. Keep explicit
geometry, compatibility, accessibility, failure cleanup, and protection against
lost or corrupted output as observable contracts.

### CI by affected responsibility

CI uses the ownership groups in `scripts/ci-scope.mjs`. Product changes run core
CLI coverage on the maintained Node versions and the affected regression suites.
Renderer and Viewer changes also run the real browser gate and generated-output
checks. Filesystem, process, dependency, build, and workflow changes retain the
full regression and relevant Windows/package gates. New or modified test files
are executed; test helpers and fixtures take the conservative full path.
Repository prose and website-only changes use their own checks.

Unknown paths, an empty comparison, and an unavailable development-push base
select full coverage. An invalid PR comparison fails classification. Required
job names remain present, and a failed classification cannot turn into successful
skips. Main pushes and manual CI runs use complete coverage; releases explicitly
run `test:full`. New pushes cancel obsolete CI runs for the same PR.

## Product and compatibility contracts

- Existing schema-v1 typed JSON remains valid unless a reviewed change explicitly introduces a breaking rule and migration path.
- Preserve authored topology and intent; explicit geometry remains authoritative unless the contract says otherwise. Consult the [authoring contract](archify/references/authoring-contract.md) and relevant renderer documentation for details.
- `standard` preserves broad compatibility. A new `showcase` failure must identify a real, repairable defect and avoid rejecting necessary routing.
- Agent-facing failures belong in `diagnostics[]`: use a stable `code`, precise `subject`, concrete `evidence`, and executable `supportedFixes`. Preserve non-zero CLI exits and machine-readable receipts for failed stages.
- A validation rule expressing taste should begin with evidence or a warning. Before making it a hard error, check legitimate obstacles, shared ports, explicit routes, nested boundaries, and existing examples.
- Keep one canonical contract per behavior. Link the existing source instead of copying CLI stages, receipt fields, or error tables.

## Local setup and verification

The renderer package is in `archify/`; repository tests and their dependencies live at the root. Install both dependency sets before running tests. The supported Node range is defined in both package manifests.

```sh
npm ci
npm --prefix archify ci
npm test
npm run test:focus -- test/geometry.test.mjs
```

For the development loop, select the files covering the changed behavior with
`npm run test:focus -- test/<name>.test.mjs [test/<other>.test.mjs ...]`.
This runs only those suites, without the generated-output checks or golden pass.
It requires at least one file and rejects unknown files rather than silently
running the full suite. Paths are relative to the repository root; absolute
paths also work. Use `--list` with the same selection to inspect it without
running tests. A focused pass is evidence for that selection only.

To narrow a large file further, add a quoted Node test-name pattern (Node 18.11+):

```sh
npm run test:focus -- test/cli.test.mjs '--test-name-pattern=cli: validate'
```

Nested tests follow Node's filtering rules: include their parent test names in
the pattern as well. Check the reported pass/skip counts for the intended cases.

| Command | What it establishes |
| --- | --- |
| `npm test` / `npm run test:core` | Ten diagram types run through the public CLI, frozen v1 inputs remain usable, delivery receipts bind the actual files, and failed delivery preserves the previous artifact. No browser or perceptual acceptance is implied. |
| `npm run test:focus -- test/<name>.test.mjs` | Only the selected behavior or regression. |
| `npm run test:generated` | Viewer, brand marks, validators, release identity, and checked-in examples match their authoritative sources. Freshness does not establish visual quality. |
| `npm run test:full` | Generated checks followed by every discovered Node test file, including the detailed process, filesystem, installation, and failure matrices. |

The Node 18, 20, and 24 compatibility lanes run the same core product smoke via
`test:compat`. Detailed fault-injection matrices run on canonical Node 22 when
their responsibility is affected and in complete verification. The separate
browser, WebM, Windows, and package gates retain their distinct claims. Do not
repeat an unchanged complete run locally just because CI is also running it.

The test runners accept `--concurrency=N` to tune the number of simultaneous
test files on Node 18.19+, for example `npm run test:focus -- test/geometry.test.mjs --concurrency=4`. Headless
repository and compatibility runs default to the available CPU count, capped
at 4. Setting `ARCHIFY_CHROME` or running `test:browser` keeps the default at 2.
Older Node versions that lack this concurrency option retain Node's default.
Compare timing and results on the same machine before increasing concurrency;
browser tests can become slower or unstable under CPU contention.

Test through public behavior such as `render`, `validate`, `deliver`, `visual-check`, or final SVG/HTML. Behavioral fixes should include a regression that demonstrates the original failure. Private helper checks can supplement that evidence.

For geometry and layout changes, use the smallest redacted JSON reproduction, relevant checked-in examples, and frozen compatibility fixtures. Compare base and candidate with the same input and browser conditions. Identify intended changes and investigate unexpected ones; updating golden files alone does not establish visual or compatibility acceptance.

A visual PR must provide enough evidence to evaluate whether the intended user value was achieved, using screenshots, recordings, or reproducible steps. Keep viewport, theme, preset, diagram mode, zoom, and page state comparable. Report automated or browser evidence separately from perceptual review. Non-visual changes may omit the Visual evidence section.

Static SVG/XML checks cannot establish browser layout, font settling, or interaction behavior. When the adaptive reader or Viewer layout changes, run the real browser test with Chrome available:

```sh
ARCHIFY_CHROME="/path/to/chrome" npm run test:browser -- test/desktop-reader-browser.test.mjs
```

A browser test skipped because Chrome was unavailable is **skipped**, not passed. Follow [the delivery contract](archify/references/delivery-contract.md) for visual evidence, receipts, and failure stages. Successful validation, atomic delivery, browser checks, and perceptual review establish different claims.

PR CI and tag releases run the same browser regression gate:

```sh
ARCHIFY_CHROME="/path/to/chrome" npm run test:browser
```

This command requires a usable Chrome/Chromium and fails when none is available.
Its maintained file list is in `scripts/browser-test-inventory.mjs`; add new browser
suites there so both workflows keep the same coverage. `npm run test:full`
retains optional browser skips. Real WebM decoding and site-language integration
remain in the separate `npm run test:webm` gate used by both workflows.

PR CI divides the maintained browser inventory into two disjoint file shards
with `npm run test:browser -- --shard=1/2` and `--shard=2/2`. Both run alongside
the independent WebM gate; the required `webm-artifact` check succeeds only
after both browser shards, WebM, and scope checks succeed. Tag releases and an
unqualified `npm run test:browser` still run the complete browser inventory.
`--list --shard=1/2` lists a shard without requiring Chrome. Shards cannot be
combined with explicit files or test-name filtering; every maintained file runs
in exactly one shard, and every executing shard still requires Chrome.

Only set `ARCHIFY_CHROME` for the browser run when you also plan to run the full
browser gate: many browser suites are included in `test:full` and would otherwise
execute again. The canonical regression suite, Node compatibility matrix, and
required browser gate establish their respective coverage. Reuse the applicable
final-head CI results instead of repeating an unchanged full suite locally.

## Packages and generated artifacts

Viewer maintenance starts in [`viewer/`](viewer/README.md). Edit its source
files, then run `npm run generate:viewer` from `archify/`; the delivered template
is generated and its freshness is checked by `npm run test:generated` (also part
of `test:full`).

Published artifacts must be reproducible from tracked content. Use a tracked-only, symlink-safe staging path or explicit allowlist, with negative coverage for untracked files and external symlinks. Test the extracted package outside the repository on the affected advertised hosts.

Review source and focused tests before regenerating artifacts. Regenerate only outputs whose authoritative inputs changed, from the final combined source:

```sh
node scripts/build-gallery.mjs docs
node scripts/build-guide.mjs docs/guide.html
node scripts/build-start.mjs docs/start.html
node scripts/build-readme-showcase.mjs
scripts/build-zip.sh /tmp/archify-contrib.zip
```

Canonical ZIP bytes require official Node 22 with bundled zlib `1.3.1-e00f703` (for example, the official Node 22.23.2 distribution). The builder rejects other Node majors and zlib versions before staging or replacing an archive. A distribution linked against system zlib can produce different bytes even at the same Node version; check the actual executable with `node -p 'JSON.stringify({ executable: process.execPath, node: process.versions.node, zlib: process.versions.zlib })'`. This packaging constraint does not change the Skill runtime's supported Node range. When updating the canonical toolchain, review archive reproducibility and the committed ZIP together.

Skill runtime, schema, renderer, and published Skill-instruction changes require checking ZIP freshness. Bundled example or Viewer changes normally require a Gallery rebuild.

List regenerated files and explain freshness when an affected output is left unchanged. Changes that do not affect generated outputs may omit that PR section. Resolve generated conflicts by rebuilding from combined source. Keep unrelated generated output out of the diff.

Treat published versions as immutable. Ordinary feature PRs do not change versions, tags, or distribution identities unless release work is explicitly in scope.

## Release checklist

Use this single checklist in the release PR or its linked release record. Link evidence at each stage; mark an item complete only when its stated outcome is verified, or record an explicit deferral with an owner, reason, and follow-up. PR completion, release publication, Pages deployment, and updates to live installations are separate outcomes. Existing gates in [CI](.github/workflows/ci.yml) and the [release workflow](.github/workflows/release.yml) already cover release identity, ZIP freshness, installation parser/real Skills CLI tests, three-platform package smoke, browser checks, and the published manifest's actual Release ZIP. Reuse those gates and their receipts rather than creating another release pipeline.

1. [ ] **Scope and revision.** Record the intended version/channel, release scope, final source SHA, comparison base, release notes, known issues, and required integration follow-ups. Follow the `dev` trial-use → `main` promotion process below. Pin evidence to its tested SHA; refresh the record when the candidate changes.
2. [ ] **Identity and build.** Verify package/Skill identity and generated outputs using the candidate revision's existing checks. Use the canonical Node/zlib toolchain above for `scripts/build-zip.sh`; confirm the committed `archify.zip` matches the clean tracked-source build. Do not change versions or regenerate unrelated artifacts in ordinary feature PRs. Preserve the previous stable manifest until the new stable Release exists.
3. [ ] **Final-head validation.** Account for the latest target base and verify required CI at the final candidate: identity and ZIP gates, schema/renderer tests, installation parser and real Skills CLI discovery, package smoke on Linux/macOS/Windows, browser/WebM checks, and affected website checks. Record run URLs, SHA, real-use evidence, and any skipped or unavailable checks; an earlier green head or zero checks is not final acceptance. Use commands from that revision's manifests/workflows: current `dev` installs root and renderer dependencies and runs `npm run test:full`, `npm run test:browser`, and `npm run test:webm` at the repository root (see [Local setup](#local-setup-and-verification)); older `main`/release revisions may run these from `archify/`. Website commands run in `website/`. Do not transplant a command or its working directory across revisions without checking.
4. [ ] **Authorized publication.** Confirm authorization for the exact release version/channel and source SHA before pushing a release tag. Stable `v<version>` tags must be annotated and resolve to the verified commit; the workflow checks tag/package identity and the release channel. Verify the resulting GitHub Release and its `archify.zip` asset, digest, and expected stable/prerelease status. Do not overwrite existing versions, tags, or assets to repair a release. Installing or updating a user's live installation requires its own authorization.
5. [ ] **Manifest, website, and integrations.** After the stable Release exists, publish `docs/skill-updates/archify/stable.json` in a follow-up commit through the normal branch process. Retain the `published-update-manifest` result that compares the actual Release ZIP, tagged archive, digest, and tagged Skill tree; wait for the gated `main` Pages deployment. Development/prerelease tags do not advance the stable notifier. Complete the [DSH synchronization checklist](#release-checklist-dsh-synchronization) or record an explicit deferral. Evaluate other integrations by their actual distribution mechanism: [Hermes](integrations/hermes-agent/README.md#install-shows-up-in-available-skills) installs the main Skill identifier; do not invent a separate Hermes release simply because Archify changed. Record any documentation/compatibility update or indexing lag that needs follow-up.
6. [ ] **Public acceptance and closure.** Check the public download and advertised installation/discovery paths against the released artifact in an isolated environment, without changing live user installations. Verify the public stable manifest, Pages version, installation instructions, and community catalog source/evidence/compatibility links describe what users can actually obtain; distinguish published, pending, and explicitly deferred integration versions. Record the final release/tag/SHA, asset digest, CI and deployment receipts, public acceptance result, and every remaining owner/follow-up. Only describe each channel as complete after its own verification.

### Release checklist: DSH synchronization

For every Archify release, record the DSH decision in the release PR or its linked follow-up. The Skill source is pinned: releasing Archify or updating `main` does not update the DSH package or existing installations. Use the [DSH release maintenance procedure](integrations/deepseek-harness/README.md#release-maintenance) for commands and host requirements.

- [ ] Assess whether the release needs a DSH update. Record the selected Archify source/version and plugin version, or an explicit deferral with its reason and follow-up. The plugin has its own version sequence; it need not match Archify's version.
- [ ] For a host-version change or compatibility report, complete the [host migration review](integrations/deepseek-harness/README.md#host-migration-review): pin official source tags/commits and registry identities, inventory the adapter's actual API/configuration touchpoints, and check the target host's compatibility checker (including prerelease semantics). Record applicable changes and gaps in any community reference; a heuristic scan or an accepted peer range is not support evidence. Do not widen peers or add exemptions merely to make installation pass.
- [ ] If syncing, update `integrations/deepseek-harness/release.json` to a full immutable `sourceCommit` and matching `skillVersion`; retain or deliberately update the exact tested DSH host version. Check both `archify/package.json` and `archify/skill-release.json` at that source. Identify any fixes included after the Archify version tag.
- [ ] Commit the adapter inputs before packing. Inspect the actual `.tgz`, including `release.json`, the bundled Skill version/content, license notices, and dependency exclusions; run the package contracts and real distribution acceptance (isolated install, discovery/load, installed Skill smoke, and uninstall). Before plugin publication, complete the DSH workflow's three-platform adapter release gate on the candidate commit and retain its receipts.
- [ ] Record a support-evidence matrix with the plugin version/tarball digest, bundled Skill source/version, exact host and command source, OS/Node, profile, update mechanism, host running/exited state, date, and evidence link. Separate clean install, load, CLI smoke, same-profile upgrade, and uninstall outcomes. Reuse unchanged evidence under its original identity; CLI acceptance does not validate Electron Desktop or an in-process third-party updater. Keep untested platforms and externally reported failures explicit before changing the support statement.
- [ ] Record publication separately from PR completion: verify the tested npm tarball/version and `archify-dsh-v<plugin-version>` tag, then align the integration README, public README install commands, and `community/packages/archify-dsh.json` with what users can actually obtain. Keep published and pending versions distinct while unpublished; never describe a prepared bundle as publicly available.
- [ ] Treat plugin publication and updates to users' live installations as separate authorized actions. Do not replace an existing version/tag or silently publish as part of the Archify release.

## Final integration and follow-up

`dev` is the integration and trial-use branch; `main` is the stable branch. Integrate reviewed changes into `dev` first. Promote a tested batch from `dev` to `main` through a separate PR after maintainers have used it on real diagram tasks and confirmed stability. Record the tested revision, usage evidence, and unresolved issues in that PR; passing CI alone does not establish trial-use acceptance. Keep Pages deployment on `main` and formal releases on version tags.

Refresh the target base branch and the PR head before final integration; account for relevant base changes and resolve conflicts. Rerun local checks whose evidence was invalidated. Unchanged evidence may be linked with its original revision and reuse rationale; do not relabel it as a new-head run. Verify that required remote CI actually ran on the final head and obey branch protection; zero checks is not green.

On revision, summarize what changed since the reviewed head and which findings it addresses. This lets reviewers focus on the new diff and outstanding decisions.

Showcase submissions should include the prompt, agent/client, model, Archify version, redacted JSON, artifact, receipts, and truthful visual-review status. Maintainers may request a smaller safe reproduction. Preserve attribution; showcase acceptance is not a controlled model-quality benchmark.

## Automated review

CodeRabbit provides advisory feedback under the repository [configuration](.coderabbit.yaml). Answer with relevant evidence or explain why a finding does not apply. Missing evidence is an unresolved claim, not proof of a code defect. Maintainers settle disputed scope; required CI and the maintainer's merge decision remain separate.

For retriggering or pausing reviews, use the official [review commands](https://docs.coderabbit.ai/reference/review-commands) and check the updated results. Bot assessments are snapshots at the stated revision; refresh stale checks after description or CI updates and read the latest evidence before repeating a request. Fork-CI approval requires a maintainer to inspect the proposed workflow/code changes; authors can link the waiting run.

## License

By contributing, you agree to the repository's [MIT License](LICENSE). Submit only work you created or have the right to contribute.
