# Contributing to Archify

Archify is Agent-first: people describe systems, and the Skill, typed JSON, renderers, validators, and delivery receipts produce reproducible diagrams. Keep each contribution focused on one user-visible behavior or one tightly related delivery slice. Maintainers and Agents reviewing a PR or a revised head follow [Reviewing](REVIEWING.md).

## Choose the right path

- Renderer, validator, package, or Viewer defect: use the [bug report form](.github/ISSUE_TEMPLATE/bug-report.yml).
- Reproducible real-world diagram: use the [showcase form](.github/ISSUE_TEMPLATE/showcase.yml).
- New schema fields, defaults, acceptance rules, installation/export contracts, or broad product behavior: agree on value, compatibility, and non-goals before substantial implementation. Link the issue or recorded maintainer decision; reuse an existing agreed scope.
- Narrow fixes and small documentation or test corrections can proceed with a concrete reproduction or rationale; a separate planning issue is unnecessary.
- Security vulnerabilities: follow [SECURITY.md](SECURITY.md).

Do not include secrets, access tokens, credentials, private repository content, personal data, or customer data in fixtures, logs, screenshots, artifacts, or package tests.

## Prepare a reviewable change

Start from the latest `main`. Check whether its existing controls already solve the reported case. Record the comparison base and candidate head.

Use Draft for unresolved scope or early implementation feedback. At this stage, provide the smallest reproduction and relevant checks. Prepare broad integration evidence and generated artifacts once the approach is settled.

Before requesting final review, explain:

- The current-main trigger, intended outcome, and why the approach is worth maintaining.
- The changed behavior and shared callers, existing behavior that must remain stable, and any intended compatibility changes.
- The applicable checks, actual results, and reproducible evidence links.

Use [the PR template](.github/PULL_REQUEST_TEMPLATE.md); link existing receipts or CI output instead of transcribing long logs. Classify impact by behavior and callers, not file extension or diff size.

## Choose evidence by impact

| Impact | Typical change | Evidence to prepare |
| --- | --- | --- |
| Text or review policy | Explanatory prose, links, contributor/reviewer procedure | Content, links, affected documentation checks; exercise changed procedure branches. No local renderer suite for repository-only prose. |
| Local behavior | One CLI path, focused test correction | Reproduction or rationale, affected tests, and relevant failure/compatibility cases. |
| Shared behavior | Geometry, text measurement, shared Viewer, evidence or delivery helpers | Trace callers; identify affected modes and contracts; compare fixed representative inputs on base and candidate, including relevant historical failures. |
| Contract change | Schema, defaults, validation acceptance, Skill or authoring instructions | Agreed scope and explicit allowed/preserved behavior, plus local/shared evidence appropriate to the implementation. |

Skill instructions, authored examples, build inputs, and generated-site sources are behavioral inputs even when they look like documentation. Policy changes need process review; runtime evidence depends on whether they affect runtime inputs.

During iteration, run the narrowest relevant checks. Before final review, run `npm test` from `archify/` for changes to runtime, schemas, packaged Skill/authoring behavior, generated content, or shared test infrastructure. Repository-only documentation and focused test-only changes may use targeted checks with an explanation. These local choices do not waive remote CI or branch-protection requirements.

## Product and compatibility contracts

- Existing schema-v1 typed JSON remains valid unless a reviewed change explicitly introduces a breaking rule and migration path.
- Explicit authored geometry such as `via`, named routes, channels, sides, and label placement remains authoritative unless the contract says otherwise. Preserve authored topology and intent.
- `standard` preserves broad compatibility. A new `showcase` failure must identify a real, repairable defect and avoid rejecting necessary routing.
- Agent-facing failures belong in `diagnostics[]`: use a stable `code`, precise `subject`, concrete `evidence`, and executable `supportedFixes`. Preserve non-zero CLI exits and machine-readable receipts for failed stages.
- A validation rule expressing taste should begin with evidence or a warning. Before making it a hard error, check legitimate obstacles, shared ports, explicit routes, nested boundaries, and existing examples.
- Keep one canonical contract per behavior. Link the existing source instead of copying CLI stages, receipt fields, or error tables.

## Local setup and verification

The renderer package is in `archify/`; its Node range and commands are defined in `archify/package.json`.

```sh
cd archify
npm ci
npm test
```

Test through public behavior such as `render`, `validate`, `deliver`, `visual-check`, or final SVG/HTML. Behavioral fixes should include a regression that demonstrates the original failure. Private helper checks can supplement that evidence.

For geometry and layout changes, use the smallest redacted JSON reproduction, relevant checked-in examples, and frozen compatibility fixtures. Compare base and candidate with the same input and browser conditions. Identify intended changes and investigate unexpected ones; updating golden files alone does not establish visual or compatibility acceptance.

A visual PR must provide enough evidence to evaluate whether the intended user value was achieved, using screenshots, recordings, or reproducible steps. Keep viewport, theme, preset, diagram mode, zoom, and page state comparable. Report automated or browser evidence separately from perceptual review. A non-visual pull request must write `Not applicable` in its Visual evidence section and explain why.

Static SVG/XML checks cannot establish browser layout, font settling, or interaction behavior. When the adaptive reader or Viewer layout changes, run the real browser test with Chrome available:

```sh
cd archify
ARCHIFY_CHROME="/path/to/chrome" node --test test/desktop-reader-browser.test.mjs
```

A browser test skipped because Chrome was unavailable is **skipped**, not passed. Follow [the delivery contract](archify/references/delivery-contract.md) for visual evidence, receipts, and failure stages. Successful validation, atomic delivery, browser checks, and perceptual review establish different claims.

## Packages and generated artifacts

Published artifacts must be reproducible from tracked content. Use a tracked-only, symlink-safe staging path or explicit allowlist, with negative coverage for untracked files and external symlinks. Test the extracted package outside the repository on the affected advertised hosts.

Review source and focused tests before regenerating artifacts. Regenerate only outputs whose authoritative inputs changed, from the final combined source:

```sh
node scripts/build-gallery.mjs docs
node scripts/build-guide.mjs docs/guide.html
node scripts/build-start.mjs docs/start.html
node scripts/build-readme-showcase.mjs
scripts/build-zip.sh /tmp/archify-contrib.zip
```

Canonical ZIP bytes require Node 22; the builder rejects other majors to avoid different zlib representations. Skill runtime, schema, renderer, and published Skill-instruction changes require checking ZIP freshness. Bundled example or Viewer changes normally require a Gallery rebuild.

List regenerated files and explain why unchanged outputs remain fresh. Resolve generated conflicts by rebuilding from combined source. Keep unrelated generated output out of the diff.

Treat published versions as immutable. Ordinary feature PRs do not change versions, tags, or distribution identities unless release work is explicitly in scope.

## Final integration and follow-up

Refresh `main` and the PR head before final integration; account for relevant base changes and resolve conflicts. Rerun local checks whose evidence was invalidated. Unchanged evidence may be linked with its original revision and reuse rationale; do not relabel it as a new-head run. Verify that required remote CI actually ran on the final head and obey branch protection; zero checks is not green.

On revision, summarize what changed since the reviewed head and which findings it addresses. This lets reviewers focus on the new diff and outstanding decisions.

Showcase submissions should include the prompt, agent/client, model, Archify version, redacted JSON, artifact, receipts, and truthful visual-review status. Maintainers may request a smaller safe reproduction. Preserve attribution; showcase acceptance is not a controlled model-quality benchmark.

## Automated review pilot

The CodeRabbit GitHub App is enabled for this repository. The root
[configuration](.coderabbit.yaml) requests automatic reviews of ready PRs and
subsequent pushes. It uses this guide, REVIEWING.md, and the PR template for advisory scope and
validation-evidence checks. Drafts are excluded. Missing evidence is a request
for clarification, not proof of a code defect; explain a false positive in the PR.

CodeRabbit does not replace required CI, browser/perceptual acceptance, or a
maintainer's merge decision. Two warning checks cover contribution scope and
validation evidence; overlapping built-in issue assessment is disabled. Authors
can answer with evidence or explain why a request does not apply; maintainers
settle disputed scope and acceptance requirements.

Use these [review commands](https://docs.coderabbit.ai/reference/review-commands)
instead of pushing an empty commit to retrigger the bot:

| Situation | PR comment |
| --- | --- |
| Review new commits when automatic review did not run | `@coderabbitai review` |
| Updated only the PR description, evidence links, or completed CI | `@coderabbitai run pre-merge checks` |
| A fresh review of the entire PR is needed | `@coderabbitai full review` |
| Several rapid revisions are in progress | `@coderabbitai pause`, then `@coderabbitai resume` when ready |

Check the updated summary for results; a command acknowledgment is not completion.
If fork CI needs approval, a maintainer must inspect the proposed workflow/code
and handle the GitHub approval. Authors should link the waiting run and continue
checks available to them; they are not expected to grant themselves CI access.

Maintainers should assess the first
5–10 reviewed PRs for useful findings, false positives, review time, and repeated
evidence requests before expanding the pilot. Pause automatic reviews by setting
`reviews.auto_review.enabled: false`; this does not change CI or branch protection.

## License

By contributing, you agree to the repository's [MIT License](LICENSE). Submit only work you created or have the right to contribute.
