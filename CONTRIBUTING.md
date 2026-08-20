# Contributing to Archify

Thank you for helping Archify make engineering diagrams more trustworthy and useful. Stability comes before feature count: small reproductions, explicit contracts, and evidence-backed changes are easier to review and safer to ship.

## Choose the right path

- Found a renderer, validator, package, or viewer problem? Use [the bug report form](.github/ISSUE_TEMPLATE/bug-report.yml).
- Made a useful real-world diagram? Use [the showcase form](.github/ISSUE_TEMPLATE/showcase.yml).
- Want to change behavior? Open or link an issue before a broad refactor so the contract and non-goals are clear.
- Found a security vulnerability? Do not open a public reproduction containing exploit details or secrets; use GitHub's private security reporting for this repository.

Do not include secrets, access tokens, credentials, private repository content, personal data, or customer data in prompts, JSON fixtures, logs, screenshots, or generated artifacts.

## Local setup

The renderer package lives in `archify/` and supports Node.js 18 and later; CI covers Node.js 18, 20, 22, and 24.

```bash
cd archify
npm ci
npm test
```

During development, run the narrowest relevant test first, then the full suite before opening a pull request. Behavioral fixes should include a failing regression test that demonstrates the problem before the implementation changes. Cross-renderer contracts belong in one public CLI seam (`archify render`/`validate` against final SVG/HTML), not tests of private resolver helpers.

## Bug fixes

A useful bug report contains:

1. The exact Archify version or commit, installation method, command, and environment.
2. The smallest redacted typed JSON that still reproduces the failure.
3. The complete machine-readable validation receipt or exact error.
4. Expected versus actual behavior.
5. A final-artifact screenshot only when the problem is visual.

Do not replace deterministic evidence with a screenshot. For visual defects, keep both the validator result and the final rendered evidence.

When a local validation or delivery run fails, see the [validation and delivery troubleshooting guide](docs/troubleshooting.md) before opening an issue. It explains the JSON receipt stages, diagnostic prefixes, and the difference between deterministic artifact checks and visual review.

## Community showcase submissions

Showcase cases should be reproducible proof, not promotional screenshots. Submit the original prompt, agent/client, exact model, Archify version, redacted typed JSON, artifact, validation receipt, and truthful visual-review status through `.github/ISSUE_TEMPLATE/showcase.yml`.

Maintainers may ask for a smaller source file, rerun validation, or decline a case that cannot be safely published. A submission is not guaranteed inclusion. Accepted cases should preserve author attribution and must not be presented as proof of model quality without a controlled benchmark protocol.

## Pull requests

Keep a pull request focused on one behavior or one tightly related delivery slice. Describe its non-goals, compatibility risk, failure behavior, tests, and rollback path. Preserve unrelated worktree changes and generated files.

From the repository root, regenerate only the artifacts whose sources changed:

```bash
node scripts/build-gallery.mjs docs
node scripts/build-guide.mjs docs/guide.html
node scripts/build-start.mjs docs/start.html
node scripts/build-readme-showcase.mjs
node scripts/build-zip.sh /tmp/archify-contrib.zip
```

Bundled example or viewer changes normally require the Gallery rebuild. Skill runtime, schema, renderer, or published `SKILL.md` changes require checking `archify.zip` freshness and committing a rebuilt archive when the checked-in package contents differ. Do not regenerate unrelated artifacts simply to produce a large diff.

Before submitting:

```bash
cd archify
npm test
```

Fill in `.github/PULL_REQUEST_TEMPLATE.md` with exact commands and results. Visible changes need before/after final-artifact evidence and a truthful `passed`, `failed`, or `skipped` visual-review status.

## License

By contributing, you agree that your contribution is provided under the repository's [MIT License](LICENSE). Only submit work you created or have the right to contribute.
