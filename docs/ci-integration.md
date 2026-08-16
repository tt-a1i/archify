# CI and Pull Request Integration

Archify exposes two useful automation boundaries:

- `validate` checks a typed JSON source and a temporary rendered artifact without replacing a user file.
- `deliver` freezes the source, performs the same final checks, and atomically commits a verified HTML artifact with hashes.

Both commands return a non-zero exit code on failure. Add `--json` when a CI job or pull-request bot needs structured evidence.

## Run the repository test suite

The renderer package is under `archify/`. The repository's baseline CI setup is:

```bash
cd archify
npm ci
npm test
```

`npm test` checks generated validator freshness, release identity, golden files, and the repository-level test suite. Run it for renderer, schema, package, or generated-artifact changes.

## Validate a diagram in GitHub Actions

The following job stores the complete receipt even when validation fails. The command's exit status still fails the job, so a green workflow cannot hide an invalid source:

```yaml
name: Validate Archify diagram

on:
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install renderer dependencies
        run: npm ci
        working-directory: archify
      - name: Validate source
        run: |
          node bin/archify.mjs validate workflow ../examples/agent-tool-call.workflow.json \
            --quality showcase --json > validation.json
        working-directory: archify
      - name: Upload validation receipt
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: archify-validation-receipt
          path: archify/validation.json
```

Use the diagram type that matches the input file. For a repository-evidence Architecture source, add `--repo-root` and ensure the checkout contains the pinned commit before validation.

## Make a trusted artifact in CI

Use `deliver` when CI must produce the exact HTML that a release, documentation site, or downstream job will consume:

```bash
node bin/archify.mjs deliver workflow ../examples/agent-tool-call.workflow.json \
  workflow.html --quality showcase --json > delivery.json
```

The success receipt records the source and artifact SHA-256 values, byte counts, artifact checks, composition status, and optional repository-evidence details. Upload both `workflow.html` and `delivery.json` as artifacts when reviewers need reproducible evidence.

Do not treat `deliver` as a visual-review claim. It proves deterministic rendering and artifact checks. A human or capable image reader must inspect the final artifact before reporting `visual_review: passed`.

## Compare Architecture snapshots

Architecture Delta can be used as a read-only pull-request artifact:

```bash
node bin/archify.mjs compare architecture base.json head.json \
  architecture-delta.html --quality showcase --json
```

The command commits the HTML and a sidecar `architecture-delta.receipt.json` together. Keep both files from the same run; the receipt binds the compared source hashes and the generated artifact.

## Consume receipts safely

Treat the receipt as data, not as a success message:

1. Check the process exit code.
2. Parse JSON only when the command was run with `--json`.
3. Require `ok: true` before publishing an artifact.
4. On failure, preserve `stage`, `diagnostics[]`, and `checker` details in the CI log or uploaded artifact.
5. Never replace a previous trusted output after a failed `deliver` run.

For a successful `validate`, the important fields are `checks` and `composition`. For a successful `deliver`, also record `specification.sha256`, `artifact.sha256`, and the `validation` object. A `visual-check` receipt is additional browser evidence, not a replacement for deterministic validation.

## Package freshness

Docs-only changes do not require rebuilding `archify.zip`. If a change touches `archify/` runtime files, schemas, renderer behavior, or the published `SKILL.md`, rebuild and compare the checked-in archive:

```bash
scripts/build-zip.sh /tmp/archify-fresh.zip
```

The CI `zip-freshness` job is the final authority. Do not commit an archive that differs from the current package contents.

See [Contributing](../CONTRIBUTING.md) for the full pull-request checklist and [Troubleshooting](troubleshooting.md) for diagnostic prefixes and repair behavior.

