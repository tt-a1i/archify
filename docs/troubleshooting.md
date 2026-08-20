# Troubleshooting Validation and Delivery

Archify reports failures in stages. Start with the command's exit code and, when diagnosing an automated run, save the JSON receipt instead of parsing human-readable stderr.

## Capture a machine-readable receipt

Run validation from the `archify/` directory:

```bash
node bin/archify.mjs validate workflow path/to/diagram.json \
  --quality showcase --json > validation.json
```

On success, the receipt has `ok: true`, `checks`, and `composition`. On failure, it has `ok: false`, a `stage`, and a `diagnostics` array. Each diagnostic contains:

- `code`: a stable rule or failure category;
- `subject`: the input, node, relationship, or output being reported;
- `evidence`: measured or system evidence for the failure;
- `supportedFixes`: repairs that the current renderer supports.

Treat a non-zero exit code as failure even when a receipt was written. Do not retry by rewriting the whole diagram: repair the named subject, then run the same command again.

## Identify the failure stage and code family

The top-level `stage` says where the pipeline stopped. It is separate from the diagnostic `code` prefix. For `validate`, the current stages are:

| `stage` | Meaning | First action |
| --- | --- | --- |
| `input` | The JSON file cannot be read or parsed | Check the path, permissions, and JSON syntax |
| `render` | The renderer rejected the source or its authored facts/layout | Read `diagnostics[]` and repair the named subject |
| `check` | The final HTML artifact or composition checks failed | Read `checker` and composition diagnostics before changing source |

`deliver` can also report `prepare`, `receipt`, and `commit` when it cannot create a candidate, read a verified receipt, or replace the target.

Architecture `compare` has its own stage list. Current values are `input`, `prepare`, `validate`, `compare`, `artifact`, `commit`, and `internal`:

| `stage` | Meaning | First action |
| --- | --- | --- |
| `input` | A base or head snapshot cannot be read or parsed | Check both JSON paths, permissions, and syntax |
| `prepare` | Compare cannot resolve output paths or create a candidate | Choose a writable HTML path with a same-directory receipt |
| `validate` | One snapshot failed renderer validation | Repair the named `subject.side` snapshot, then retry compare |
| `compare` | The two snapshots cannot be classified as a delta | Add unique stable ids and confirm they describe the same system |
| `artifact` | The generated Before/Delta/After HTML failed its own checks | Keep the receipt; do not replace the previous trusted pair |
| `commit` | Compare cannot replace the HTML and receipt together | Choose regular-file targets and retry without deleting the previous files |
| `internal` | Compare failed before commit without a classified diagnostic | Keep the complete receipt and inspect the reported evidence |

A snapshot that fails its final HTML checks during compare can also report `check`.

Diagnostic prefixes describe the rule, not the pipeline stage:

| Prefix | Usually appears in | First action |
| --- | --- | --- |
| `input/*` | `input` | Check the path, permissions, and JSON syntax |
| `schema/*`, `relationship/*`, `guided-view/*`, `clean-flow/*` | `render` | Compare the source with the schema and repair the named ID, view, or route |
| `legend/*`, `engineering/*`, `repository-evidence/*` | `render` | Add or correct the authored presentation, engineering, or revision-pinned evidence facts |
| `composition/*`, `artifact/*` | `check` | Adjust the named route or label, then rerun the final checks |
| `output/*`, `delivery/*` | `prepare`, `receipt`, or `commit` | Choose a safe writable target and preserve the previous artifact |
| `delta/*` | `input`, `prepare`, `validate`, `compare`, `artifact`, `commit`, or `internal` | Repair the named snapshot or output target; keep the previous HTML/receipt pair |
| `internal/*` | `render` or a later delivery stage | Keep the complete receipt and inspect the reported evidence before retrying |

The list is intentionally grouped by prefix; individual rules and repair controls are owned by the current renderer and may grow over time.

## Fix common input and schema errors

`input/json-parse` means the file is not valid JSON. Run a JSON parser before involving layout:

```bash
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log('valid JSON')" path/to/diagram.json
```

`schema/additionalProperties` means a field is not part of the selected schema. Archify schemas are strict at every level; spelling variants such as `colour` or renderer fields copied from another diagram type are rejected. Remove the unknown field or use the exact field in the [schema reference](../archify/schemas/README.md).

`relationship/duplicate-id` means two relationships in the same collection use the same authored ID. IDs must be unique within that collection. ID-less relationships remain valid, but adding an ID gives the relationship a stable `#relation=<id>` link.

## Fix geometry and quality failures

Use `--quality standard` while exploring a dense diagram and `--quality showcase` when the composition must pass the stronger polish gate. The CLI option takes precedence over `meta.quality_profile`.

For a composition diagnostic:

1. Read `subject` and `evidence` in the receipt.
2. Change only the named relationship, label, or layout control.
3. Prefer the exact repair listed in `supportedFixes`.
4. Re-run validation and compare the error count with the previous receipt.

Examples:

- `composition/proper-crossing`: give unrelated relationships separate corridors with a supported `via` or channel control.
- `composition/label-route-clearance`: move the label or the other relationship route; do not hide the label.
- `composition/container-border-run`: cross a structural frame through a clear opening instead of following its border.
- `clean-flow/edge-through-node`: reroute the relationship around the unrelated semantic node.

Architecture-only layout inspection can help locate the resolved geometry:

```bash
node bin/archify.mjs inspect architecture path/to/diagram.json
```

Do not keep adding manual coordinates without a diagnostic. The authoring contract limits focused repair rounds so that a diagram does not become a collection of accidental exceptions.

## When delivery fails

Use `deliver --json` when the output is a handoff or CI artifact:

```bash
node bin/archify.mjs deliver workflow path/to/diagram.json \
  workflow.html --quality showcase --json > delivery.json
```

If rendering or the final artifact check fails, `deliver` exits non-zero and preserves the previous trusted output. The failure receipt identifies whether the failure occurred during `input`, `prepare`, `render`, `check`, `receipt`, or `commit`. Fix the source or output path, then retry; do not delete the previous artifact to make the command pass.

## When Architecture compare fails

`compare` classifies two Architecture snapshots and writes HTML plus a sidecar receipt. Its failures use `delta/*` codes. Typical first actions:

- `delta/base-input` or `delta/head-input`: repair the named snapshot path or JSON syntax.
- `delta/relationship-id-required`: give every compared relationship a unique authored id.
- `delta/artifact-invalid`: keep the previous trusted HTML/receipt pair and inspect the delta checks.
- `delta/commit-target`: choose regular-file paths for both the HTML and the receipt.

Repair the named snapshot or output target, then rerun the same `compare` command. Do not delete the previous pair to make the command pass.

For an existing HTML file, separate source validation from artifact checking:

```bash
node bin/archify.mjs check workflow.html
node bin/archify.mjs visual-check workflow.html --json
```

`check` is deterministic artifact validation. `visual-check` captures browser evidence when Chrome or Chromium is available; exit code 2 means visual capture was skipped because no capable browser was found. Neither command substitutes for a human visual review.

## When repository evidence fails

Architecture source evidence is opt-in and revision-pinned. When using it, pass the local checkout explicitly:

```bash
node bin/archify.mjs validate architecture path/to/diagram.json \
  --repo-root path/to/repository --json
```

Check that the JSON repository URL matches the checkout's Git origin, the revision is a full commit SHA, each source path is relative and POSIX-style, and the requested lines exist in that revision. Do not replace a missing fact with a guessed path or commit.

## Further reading

- [Delivery contract](../archify/references/delivery-contract.md) for atomic delivery, visual review, and handoff receipts.
- [Skill contract](../archify/SKILL.md) for bounded correction behavior.
