# External diagnostics (C7)

Code Analysis can import existing ESLint JSON, Ruff JSON, SARIF 2.1.0 and saved GitHub review comments. The imported findings retain their original tool, rule, message, severity and positions, and use the existing task, evidence, baseline and comparison pipeline.

The local viewer includes a searchable findings list, source and coverage details, source evidence, AI task preview/export and baseline review decisions. The CLI and viewer read the same configured reports and use the same evidence and review lifecycle.

Import reads reports; it does not execute ESLint, Ruff, project scripts, suggested fixes or an AI reviewer. Regenerating an external report remains a separate project or CI step.

## Import existing reports

Add sources to the same analysis configuration used by `check` or `serve`:

```json
{
  "external": {
    "sources": [
      { "id": "web-eslint", "format": "eslint", "file": "reports/eslint.json" },
      { "id": "api-ruff", "format": "ruff", "file": "reports/ruff.json" }
    ]
  }
}
```

From Archify's `archify/` package directory:

```sh
node bin/archify.mjs code-analysis check /path/to/repo --language ts --config /path/to/repo/analysis.config.json --out /path/to/repo/.analysis --json
```

`--language` selects the internal source/dependency extractor. Reports from other languages can still produce external findings. Referenced repository files outside that extractor's captured files are captured as supplemental evidence; they are not added to the dependency graph or counted as newly parsed language sources.

Each source has a stable, unique `id`. Keep it unchanged when replacing that report with a later run. Use different ids for different workspaces or check configurations, even when both use ESLint. Each analysis replaces that source's findings for the run; importing the same report again does not append another copy.

Viewer source choices include this id alongside the tool/version, so reports from different workspaces or SARIF runs remain distinguishable even when their tool names agree.

| Source option | Meaning |
|---|---|
| `id` | Required stable source identity; letters, digits, underscore, dot, colon and hyphen are supported. |
| `format` | Required: `eslint`, `ruff`, `sarif` or `github-review`. |
| `file` | Required report path, resolved relative to the analyzed repository root. |
| `pathBase` | Optional base for relative paths reported by the producer, relative to the analyzed root; defaults to `.`. |
| `pathMappings` | Optional explicit producer-root mappings, such as `[{"from":"C:/agent/repo","to":"."}]`. The longest matching root wins; filenames are never matched by basename. |
| `tool` | Optional display name override. The source tool's original rule identifier is stored separately from Archify's rule code. |
| `manifest` | Optional generation-time manifest object or a JSON file path relative to the analyzed root. |
| `author` | For `github-review`, select root review comments by GitHub login. Replies by other authors remain discussion context. |

For example, `pathBase: "packages/web"` maps a native report's `src/index.ts` to `packages/web/src/index.ts`. Manifest `scope.files` and `files` keys always name repository-relative paths; `pathBase` is not applied to them. Absolute CI paths outside the local root require an explicit `pathMappings` entry. Source paths resolving outside the root, symlink escapes and non-file URLs do not supply source evidence.

Omitting `external.severity` uses the default `"warning"` policy: imported lint errors are capped at warning, warnings stay warning and info stays info. The source value remains in `external.originalSeverity`. AI review comments are always warning. A report without a source severity uses warning and records that default; the original missing value remains visible. External `confidence` is unknown (`null`), not a new Archify quality score.

Set `external.severity: "source"` explicitly to preserve the normalized source error/warning/info levels. Open source-mode errors can make a component red and fail `--fail-on error`; this mode does not establish a confirmed structural or runtime defect.

The CLI's default threshold remains `--fail-on warning`. Capping an imported error at warning therefore does not make the default check pass. An otherwise clean run containing only those imported claims can pass `--fail-on error` under the default policy; explicit `"source"` can fail that threshold. Internal findings keep their existing severity policy.

## Supported report formats

| Format | Input and preserved facts |
|---|---|
| `eslint` | The native JSON result array, or `json-with-metadata` with `results` and `metadata.rulesMeta`. Keeps plugin rule ids, messages, severity, positions, documentation links and available suggestion text. Tool/parser diagnostics mark coverage incomplete. Source-suppressed messages are counted separately. |
| `ruff` | Native JSON array, including older reports without severity and current reports with `name`/severity. Code-point columns are converted to UTF-16. Syntax errors make coverage incomplete. Notebook cell coordinates are retained as native metadata; they are not presented as line numbers in the `.ipynb` JSON file. |
| `sarif` | A SARIF 2.1.0 log validated with the bundled official schema. Each run has its own derived source identity. See the supported subset below. |
| `github-review` | A saved PR review-comments array or `{ "comments": [...], "headCommit": "...", "author": "..." }`. Root comments become source claims; discussion replies remain context. See collection and location limitations below. |

If you need to produce a report, use the project's installed and configured tool. Typical commands are:

```sh
mkdir -p reports
npx eslint . --format json --output-file reports/eslint.json
ruff check . --output-format json --output-file reports/ruff.json
ruff check . --output-format sarif --output-file reports/ruff.sarif
```

These are commands for the project or CI to run, not commands executed by Archify. Lint tools can return exit code 1 while still producing a valid report containing findings. Use a SARIF formatter compatible with the project's ESLint version when exporting ESLint as SARIF; Archify does not install an ESLint formatter into the analyzed project.

### SARIF support

The importer reads multiple runs, driver/extension rule metadata, rule ids/indexes and descriptor references, rule messages/templates, default/result levels, artifact indexes, file URI bases, line/column locations, related locations, source text/hash assertions and source fingerprints. Relative URI escapes are decoded as URI data; native JSON filenames retain their literal spelling. `columnKind` determines whether columns use Unicode code points or UTF-16 code units before normalization.

SARIF primary and related locations retain explicit roles. A related-only result can show context but does not supply a primary path/line or automatic modification target. Extension provenance stays with the rule, including component name/guid/version where supplied; identical local rule names in different extensions are not one diagnostic merely because their messages agree.

The SARIF adapter and identity revisions are 2. Partial fingerprints are combined with all named contributors and source anchors to distinguish repeated occurrences. Complete fingerprints retain the producer's identity assertion. Earlier SARIF ids/baselines are not automatically migrated: reimport and review them instead of transferring an accepted occurrence to another result. Other format revisions remain at 1.

Same-name SARIF components without GUIDs are retained as separate but ambiguous instances. They make coverage partial; their acceptance is bound to that particular report's bytes so component reordering cannot silently inherit another instance's decision. Prefer unambiguous producer component identities for comparable reports.

Accepted source suppressions and `pass`/`notApplicable` results are not open findings. Source suppression is distinct from a local user accepting a finding in the baseline. Tool execution/configuration notifications are retained; failed invocations or omitted `results` do not become a successful empty scan.

Offset-only/binary locations and external property files do not receive inferred line evidence. Unresolved paths, message templates or unsupported location data produce explicit notices and incomplete coverage. Complex code flows, graphs and automatic application of `fixes` are outside the first import view; the report hash and item JSON Pointer retain the route back to the original data.

Multiple runs with the same tool and automation identity cannot be reliably distinguished by order alone. Such ambiguity is reported as incomplete coverage; prefer separate stable configured sources or distinct producer automation identities.

## Bind a report to its actual source

Readable source captured at import time is not proof that an old report analyzed that source. A bare native JSON report generally leaves its full scan scope, effective configuration and generation-time source relationship unknown. Its findings can still be inspected and exported as tasks.

A producer can provide a versioned manifest containing the information it actually recorded while generating the report:

```json
{
  "schema_version": 1,
  "toolVersion": "<the actual tool version>",
  "configDigest": "<SHA-256 of the effective rule configuration>",
  "scope": { "files": ["src/index.ts"], "complete": true },
  "files": { "src/index.ts": "<SHA-256 of the source file's raw bytes>" },
  "command": "<the actual command that produced this report>",
  "exitCode": 1
}
```

The angle-bracket values are placeholders, not valid digest values. Supply lowercase 64-character SHA-256 strings. Tool version and configuration may instead be omitted or `null` when unknown. `scope.complete` may be true only when the producer knows its complete selected scope and that it checked it successfully. List clean files too; the set of files having findings is not a full scan scope. The configuration digest should describe the effective rules and relevant producer settings, not the report's bytes or filename. A manifest tool version that contradicts a version declared by the report is rejected.

Generate the manifest from the same frozen source/configuration as the report. Creating source hashes later from an edited working tree cannot establish the report's original inputs. A matching Git HEAD alone does not prove that the working tree was clean.

Manifest raw-byte hashes, SARIF artifact hashes and embedded source text are checked against their respective byte/text representations. This matters for Python encodings and BOMs. Retained raw-byte assertions appear as `analysis.external[].sourceHashes`; embedded text assertions appear separately as `analysis.external[].sourceTextHashes`. Task verification rechecks both across scanned files beyond the finding's own citation.

| Recorded state | Meaning |
|---|---|
| `binding: "verified"` | The available report assertions match the captured source they identify. This does not independently prove the tool's conclusion or runtime behavior. |
| `binding: "unverified"` | Required source assertions are missing or cannot be checked. Capturing today's text does not upgrade this state. |
| `binding: "changed"` | At least one report assertion differs from the captured source. Generate a fresh report before acting on the old claim. |
| `status: "partial"` | Some scan/import data is incomplete or unsupported. Available findings remain visible; absence of other findings is not evidence of a fix. |
| `coverage.complete: null` | The full successful coverage is unknown. An empty diagnostic array does not make it a proven clean scan. |

A valid empty report, a configured missing report and a partial report are different cases. Configured missing/malformed files fail with structured diagnostics and exit code 2. The importer does not silently replace them with an empty successful report.

## Read and review in the viewer

Start the local viewer with the same analysis configuration and the authored architecture input:

```sh
node bin/archify.mjs code-analysis serve /path/to/repo --language ts --ir /path/to/architecture.json --config /path/to/repo/analysis.config.json --baseline /path/to/repo/analysis.baseline.json --out /path/to/view
```

Open its local URL and click **Code Analysis**. **Browse findings** and **External diagnostics** open the findings list. Filter by source, category, severity or review status; search by rule, message or file. The unverified-report filter includes unverified and changed source bindings. **Sources & coverage** separates successful import, report binding and declared scan completeness, including valid empty reports.

Open a finding to read its original rule/message, primary and related source excerpts, position and provenance. Task preview/export uses that captured evidence; the live service checks it against current source before returning a task. Imported findings can highlight their existing file owners on the component diagram and Atlas. Supplemental evidence does not create new dependency nodes or edges.

**Accept…** requires a reason. **Revoke acceptance** removes the local baseline decision. Saving rebuilds the page from the same captured facts and scan scope; it does not rerun extraction, duplicate detection or an external tool. A stale page or changed source cannot silently accept a different claim. Accepted external findings retain their configured and original severities for inspection. Default-mapped warnings stop coloring the diagram after acceptance; explicit source-mode errors follow the existing accepted-error rule and retain their red indication. If view-file publication fails after the baseline was saved, the viewer confirms the saved decision and reports the file warning while retaining the updated live page.

After regenerating reports or changing source/configuration, use **Re-analyze** for a new analysis and comparison. A failed re-analysis keeps the last successful result. Add or change imported report sources in the configuration file above; the viewer reads those files rather than running the external tools.

A standalone `repo.analysis.html` supports reading/filtering and captured task export. Saving review decisions, checking current source and re-analysis require the local service; static reports do not contain its authorization token.

## Evidence and AI tasks

Run `task` on a completed analysis directory:

```sh
node bin/archify.mjs code-analysis task /path/to/repo/.analysis --finding CONV-012345abcdef --root /path/to/repo --format json --out /path/to/repo/task.json
```

Replace the example id with one from that run's `findings.json`. The default task format is Markdown. `--require-valid` can require successful verification before returning an actionable task.

External findings carry their tool, original rule/level, source id, report item reference, positions, original review metadata and report-to-source binding. Captured text beyond the selected language adapter lives in `findings.externalEvidence`. Task generation validates its hashes and combines it with the original source snapshot; it does not read arbitrary current files and label them as old evidence.

Related excerpts remain in the task's read scope, while automatic modification scope requires primary evidence. Live task requests also match the claim displayed by the page; a changed message/rule context on an otherwise identical source snapshot requires refreshing the page before export. Static and CLI task exports keep their captured/current-evidence distinctions.

Stable finding identity is separate from evidence freshness. Source fingerprints or a versioned source-context fallback help match a finding after line movement. Precise location hashes identify the excerpts; the finding's source-only `evidenceDigest` covers whole cited files because a lint rule can depend on other lines in the same file. A code change can therefore require review even when the highlighted line is unchanged.

Task verification preserves the captured-source result as `sourceStatus` and the report relationship as `reportBinding`. Unchanged current code cannot make an unverified report valid. A changed scanned file in retained `sourceHashes` or `sourceTextHashes` invalidates the report binding, including a scanned file beyond the cited location. Missing or ambiguous source evidence remains explicit.

Generation commands are included only when supplied through the source manifest or explicit task arguments. They are instructions to evaluate, never commands executed by import/task generation. Re-running Archify against the same saved lint report does not re-run lint; regenerate the report with the original settings and scope, then import it again.

## Accept, revoke and compare

Accept one current finding after reviewing its code and the source claim:

```sh
node bin/archify.mjs code-analysis check /path/to/repo --language ts --config /path/to/repo/analysis.config.json --baseline /path/to/repo/analysis.baseline.json --accept CONV-012345abcdef --reason "Intentional public export; retain this API."
```

Revoke one accepted id without re-running analysis:

```sh
node bin/archify.mjs code-analysis check /path/to/repo --baseline /path/to/repo/analysis.baseline.json --revoke CONV-012345abcdef
```

Both operations preserve unrelated baseline entries. Accept requires a non-empty reason. `--update-baseline --reason "..."` accepts all current findings and replaces the baseline's current set; unlike a single-item accept, it drops entries no longer present. External findings without captured source evidence or with `binding: "changed"` cannot be accepted. A user may explicitly accept a source-unverified claim after reviewing its captured current evidence, but this does not upgrade report binding or comparison coverage.

External baseline entries store both the source `sha256` and a separate `externalReviewDigest` for the tool's claim/context. A changed or missing source/claim digest reopens the item as `accepted-changed`. Existing internal baselines retain their prior compatibility behavior.

Earlier C7 builds used `"source"` when `external.severity` was omitted. To retain that behavior, now set `"source"` explicitly. Moving a lint source from the old source policy to the new warning default changes its import-settings and review digests, even when source bytes, finding ids and original severities are unchanged. Prior acceptances require re-review; comparisons across those policies are not directly comparable, and `--new-only` with such a previous run returns exit code 2. Review the current result and record a new reason instead of migrating acceptance silently. This policy change does not alter AI review's always-warning mapping.

Compare fresh runs with the same `--out` directory, or name a previous `findings.json` explicitly:

```sh
node bin/archify.mjs code-analysis check /path/to/repo --language ts --config /path/to/repo/analysis.config.json --compare /path/to/previous/findings.json --out /path/to/current --json
```

External comparison checks the source set, tool/version, rule configuration, import settings and severity policy, scope/completeness, source binding, and adapter/identity versions. A changed report hash or report filename alone does not change comparability; legitimate fixes produce different report bytes. Source-qualified reasons explain missing sources or unknown/changed measurement conditions. A disappeared result means **no longer detected**, not automatically **fixed**.

For comparable ESLint reports, Archify first pairs a unique finding at the same location with the same claim and captured line, even when its surrounding context changed the ID. This does not transfer approvals or task evidence. Both snapshots must record the line hash; older snapshots and reports without this evidence use ID matching. A move or edit that leaves no exact pair can still be reported as a possible rename.

`--new-only` gates newly identified open findings. When comparing runs that include external sources, an incomparable or unknown comparison fails with `external/comparison-unverified` and exit code 2 instead of passing because an old source disappeared. Without any previous run, every open finding is treated as new. A normal full check remains available to inspect open and evidence-changed items even when external context is incomplete.

Exit codes for `check` remain 0 for the configured gate passing, 1 for open findings reaching `--fail-on`, and 2 for usage/input/analysis errors. A passing gate is not a guarantee about unconfigured or unknown coverage.

## Read-only GitHub review collection

The optional collector saves the PR head and paginated inline review comments:

```sh
node bin/archify.mjs code-analysis import-review https://github.com/OWNER/REPO/pull/NUMBER --author 'coderabbitai[bot]' --out /path/to/repo/reports/review.json --json
```

`GH_TOKEN` or `GITHUB_TOKEN` can provide repository/PR read access; tokens are not placed in the saved report. Collection uses GitHub GET requests only and verifies that the PR head remained unchanged before publishing its output. It does not create comments, reply, dismiss a review or invoke an AI reviewer. It currently accepts `github.com` PR URLs, not GitHub Enterprise hosts. The collector is explicit; `check` and `serve` do not call it automatically.

Configure its saved output:

```json
{
  "external": {
    "sources": [
      { "id": "pr-review", "format": "github-review", "file": "reports/review.json", "tool": "CodeRabbit", "author": "coderabbitai[bot]" }
    ]
  }
}
```

Root review comments become warning-level source claims. Their stable comment ids, source URLs, commits, diff side, original/current native positions and discussion replies are preserved. A RIGHT-side position is considered current only when the exported head, analyzed base commit and comment commit agree and a current line is available. LEFT-side, old/outdated and file-only claims do not get fabricated current line evidence or an automatic modification scope. Unknown rule ids stay unknown.

The REST review-comments endpoint does not represent every PR discussion or a complete code review. The collector does not infer thread resolution; `resolved`/`outdated` information is retained only when supplied in the input. A source comment's status is not a local baseline decision. Review collection alone also does not prove source-byte binding or complete scan coverage.

## Current bounds and provenance

Reports and manifests are limited to 32 MiB each; an import is limited to 100,000 records. Supplemental source capture is limited to 2 MiB per file and 32 MiB per import. Unavailable/binary/excluded source remains unverifiable, with its source claim and notices retained. Normal code-analysis language prerequisites still apply to the selected internal extractor.

The GitHub collector has a 30-second total deadline, 100-page / 10,000-comment bound and 32 MiB response/output bound. Failure leaves the previous output in place.

Report binding verifies the supplied file-content assertions. It does not cover Unix permission metadata, environment-dependent tool behavior or the correctness of a tool's conclusion. A chmod-only change, for example, does not invalidate a byte-hash manifest even if it affects a source rule such as Ruff `EXE001`.

The bundled official SARIF schema is checked with a separate draft-04 Ajv instance. Source-context fingerprinting adapts the GitHub CodeQL Action line algorithm; it is an identity aid, not semantic proof. ESLint/Ruff detection remains the external tools' responsibility. Archify implements the format adapters, source binding and integration into its existing evidence/review/viewer pipeline; reviewdog and DefectDojo informed parser organization but are not embedded runtimes. See [vendored references and license](../import/vendor/README.md), the [reuse/adaptation boundaries in the C7 contract](../../../../docs/designDoc/code-analysis-c7-contract.md#delivered-scope-and-implementation-boundaries), and the [validation record](../../../../docs/validation/code-analysis-c7-real-repos.md) for observed results and gaps.
