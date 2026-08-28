# Contributing to Archify

Thank you for helping Archify make engineering diagrams more trustworthy and useful. Archify is Agent-first: people describe the system they want to explain, while the Skill, typed JSON contract, renderers, validators, and delivery receipts make the result reproducible.

Stability comes before feature count. A small change with a real reproduction, an explicit contract, and evidence from the final artifact is easier to review and safer to ship than a broad rewrite.

## Choose the right path

- Found a renderer, validator, package, or viewer problem? Use [the bug report form](.github/ISSUE_TEMPLATE/bug-report.yml).
- Made a useful real-world diagram? Use [the showcase form](.github/ISSUE_TEMPLATE/showcase.yml).
- Want to change a schema, renderer contract, validation rule, installation path, export, or other product behavior? Open or link an issue before implementing it. Agree on the user value, compatibility boundary, and non-goals first.
- Found a security vulnerability? Do not publish exploit details or secrets. Use GitHub's private security reporting for this repository.

Small documentation corrections and narrowly scoped test fixes do not require a planning issue. Large documentation surfaces do: prefer improving the canonical Skill, contract, diagnostic, or existing guide over creating a second explanation of the same behavior.

Do not include secrets, access tokens, credentials, private repository content, personal data, or customer data in prompts, JSON fixtures, logs, screenshots, generated artifacts, or package tests.

## Before writing code

Start from the latest `main`. Recheck it before final review: a concurrent change may already solve the problem or alter the relevant contract. A test result from an old base is not integration evidence.

Keep one pull request focused on one behavior or one tightly related delivery slice. The PR should state:

- the user problem and linked issue, when one exists;
- what changes and what deliberately does not;
- compatibility and migration impact;
- failure behavior and rollback path;
- exact tests and final-artifact evidence.

Draft PRs are welcome for early technical feedback. Mark the PR ready only when its scope is stable, it is current with `main`, its generated artifacts are intentional, and the stated checks have actually run.

## Product and compatibility contracts

Archify's public behavior is larger than a renderer function. Treat these as contracts:

- Existing schema-v1 typed JSON remains valid unless a reviewed change explicitly introduces a breaking rule and migration path.
- Explicit authored geometry such as `via`, named routes, channels, sides, and label placement remains authoritative unless the contract says otherwise. Do not silently rewrite topology or authored intent.
- `standard` preserves broad compatibility. A new `showcase` failure must identify a real, repairable defect, avoid rejecting necessary routing, and return a stable machine-readable diagnostic.
- Agent-facing failures belong in `diagnostics[]`: use a stable `code`, precise `subject`, concrete `evidence`, and executable `supportedFixes`. Do not require ordinary users or Agents to scrape prose from logs.
- Agent-first does not mean documentation-free. It means one canonical contract per behavior. Link to that source instead of copying evolving CLI stages, receipt fields, or error-code tables into parallel manuals.
- A valid SVG is not automatically a good diagram. Geometry, projected text, z-order, masks, interaction, export, and real browser layout can fail independently.

If a validation rule expresses taste rather than correctness, begin with evidence or a warning. Before making it a hard error, test legitimate exceptions such as obstacles, shared ports, explicit routing, nested boundaries, and existing checked-in examples.

## Local setup

The renderer package lives in `archify/` and supports Node.js 18 and later. CI covers Node.js 18, 20, 22, and 24.

```bash
cd archify
npm ci
npm test
```

During development, run the narrowest relevant test first, then the full suite before requesting final review. Behavioral fixes should include a failing regression test that demonstrates the problem before the implementation changes.

Test public behavior through a supported seam whenever possible: `archify render`, `validate`, `deliver`, `visual-check`, or the final SVG/HTML. Private helper tests are useful for edge cases, but they do not replace a CLI or artifact-level regression.

## Evidence by change type

### Renderer, layout, and validation

Include the smallest redacted typed JSON that reproduces the behavior. Verify both the intended fix and plausible exceptions. At minimum:

1. Run the focused regression tests.
2. Run the candidate against relevant checked-in examples and frozen compatibility fixtures.
3. Run `npm test` from `archify/`.
4. For visible changes, render the final HTML and run `visual-check`.
5. Inspect the generated screenshots or HTML in a capable visual surface.

Static SVG/XML checks cannot prove desktop readability, stacking order, font settling, or interaction. When the adaptive reader or viewer layout changes, run the real browser test with Chrome available:

```bash
cd archify
ARCHIFY_CHROME="/path/to/chrome" node --test test/desktop-reader-browser.test.mjs
```

A browser test that was skipped because Chrome was unavailable is **skipped**, not passed. Report that status exactly.

### CLI, receipts, and delivery

Preserve non-zero exit behavior and machine-readable receipts. A successful `validate` does not prove atomic delivery, and a successful `deliver` does not prove perceptual quality. Follow [the delivery contract](archify/references/delivery-contract.md) and test the failure stage you changed.

### Packages, plugins, and releases

Published artifacts must be reproducible from tracked repository content.

- Never recursively package the live working tree with an unrestricted `cp`, `rsync`, or equivalent operation.
- Use a tracked-only, symlink-safe staging path or an explicit allowlist.
- Add a negative test proving that an untracked file and an external symlink cannot enter the archive.
- Test the extracted package outside the repository and, when applicable, on every advertised host or operating-system shape.
- Treat a published version as immutable. If host-visible plugin or Skill bytes change, use the agreed next release identity and keep every relevant manifest synchronized. Do not reuse a tag or version for different content.

Do not change release versions, tags, or distribution identities in an ordinary feature PR unless the issue or a maintainer explicitly includes release work in scope.

## Generated artifacts

Review source and tests before flooding a PR with generated output. Regenerate only artifacts whose authoritative inputs changed, ideally once after the implementation is accepted.

From the repository root, the main builders are:

```bash
node scripts/build-gallery.mjs docs
node scripts/build-guide.mjs docs/guide.html
node scripts/build-start.mjs docs/start.html
node scripts/build-readme-showcase.mjs
scripts/build-zip.sh /tmp/archify-contrib.zip
```

The runtime follows the Node range in `archify/package.json`, but canonical
`archify.zip` container bytes are built only with Node 22. The builder rejects
other Node majors so a different bundled zlib cannot publish a second byte
representation of the same package contents.

Bundled example or viewer changes normally require the Gallery rebuild. Skill runtime, schema, renderer, or published `SKILL.md` changes require checking `archify.zip` freshness and committing a rebuilt archive when the checked-in package contents differ.

List every regenerated file in the PR description. Do not regenerate unrelated HTML, GIFs, screenshots, manifests, or archives merely to make the branch look current. Generated artifacts are evidence and delivery payloads, not a substitute for reviewing the source change.

## Bug fixes

A useful bug report or fix contains:

1. The exact Archify version or commit, installation method, command, and environment.
2. The smallest redacted typed JSON that still reproduces the failure.
3. The complete machine-readable validation receipt or exact error.
4. Expected versus actual behavior.
5. A final-artifact screenshot only when the problem is visual.

Do not replace deterministic evidence with a screenshot. For visual defects, keep both the validator result and final rendered evidence.

## Community showcase submissions

Showcase cases should be reproducible proof, not promotional screenshots. Submit the original prompt, agent/client, exact model, Archify version, redacted typed JSON, artifact, validation receipt, and truthful visual-review status through `.github/ISSUE_TEMPLATE/showcase.yml`.

Maintainers may ask for a smaller source file, rerun validation, or decline a case that cannot be safely published. Inclusion is not guaranteed. Accepted cases should preserve author attribution and must not be presented as proof of model quality without a controlled benchmark protocol.

## Before requesting review

- Rebase or merge the latest `main`, resolve generated-artifact conflicts by rebuilding from the final source, and rerun affected checks.
- Complete `.github/PULL_REQUEST_TEMPLATE.md` with exact commands and numeric results; do not write only “tests pass.”
- Add or update a regression test for behavioral changes.
- Confirm existing public examples and compatibility fixtures still behave as intended.
- State `visual review: passed`, `failed`, or `skipped` truthfully for visible changes.
- Confirm remote CI actually ran on the current head. Local green checks do not mean GitHub CI passed, and zero checks is not green.
- Remove unrelated files, debug output, local paths, generated noise, and sensitive data from the diff.

Maintainers may ask for a large PR to be split or rebuilt from current `main` when generated artifacts, stale history, or overlapping implementations make the behavior difficult to review safely.

## License

By contributing, you agree that your contribution is provided under the repository's [MIT License](LICENSE). Only submit work you created or have the right to contribute.
