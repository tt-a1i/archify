# Archify GitHub Action

Run Archify in CI: deliver diagrams on every push, review architecture changes on pull requests, or draft a diagram from repository code. The action is a composite action defined in the repository-root [`action.yml`](../../action.yml); this folder holds its runtime ([`action.mjs`](action.mjs)). It is not part of the packaged Skill.

Pin the action to a full commit SHA. Replace `<commit>` below with the Archify commit you have reviewed.

## Modes

| Mode | What it does | Typical trigger |
|---|---|---|
| `deliver` (default) | Validates and delivers every matching typed JSON source to standalone HTML with receipts | `push` |
| `compare` | Compares each matching **architecture** source with the pull request base using `archify compare`, writes Architecture Delta HTML, and summarizes authored changes | `pull_request` |
| `scan` | Drafts an architecture source from Python or JavaScript/TypeScript imports with `archify scan`, then delivers it | `push`, `workflow_dispatch` |

Every mode writes `summary.md`, HTML artifacts, and JSON receipts to `output-dir`, appends the summary to the job summary, and sets step outputs.

## Deliver diagrams on push

```yaml
name: Diagrams
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  diagrams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: casareborgia/archify@<commit>
        with:
          files: docs/**/*.json
          quality: showcase
      - uses: actions/upload-artifact@v4
        with:
          name: diagrams
          path: archify-artifacts/
```

Each source's type comes from its `diagram_type`. Architecture sources that declare `meta.repository` are verified against the checkout automatically.

## Review architecture changes on pull requests

```yaml
name: Architecture review
on: pull_request
permissions:
  contents: read
  pull-requests: write # only needed for comment: true
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the base commit must be available
      - uses: casareborgia/archify@<commit>
        with:
          mode: compare
          files: docs/**/*.architecture.json
          comment: true
      - uses: actions/upload-artifact@v4
        with:
          name: architecture-delta
          path: archify-artifacts/
```

The comment is created once and updated on later pushes. It lists added, removed, and changed components and connections, plus new and removed diagrams. Position-only edits are omitted from the list; the Delta HTML and receipt still contain them. The review compares authored JSON only and infers no runtime impact, risk, or merge safety.

On pull requests from forks, `GITHUB_TOKEN` is read-only; the summary and artifacts still work, and the comment step fails. Leave `comment: false` there.

## Draft a diagram from code

```yaml
      - uses: actions/checkout@v4
      - uses: casareborgia/archify@<commit>
        with:
          mode: scan
          scan-path: services/api
          scan-title: API architecture draft
```

The draft is written to `archify-artifacts/scan/<folder>.architecture.json` and delivered next to it. It is a starting point for an author: see [`archify scan`](../../archify/references/authoring-contract.md#repository-scan-drafts) for what it detects and what it does not.

## Inputs

| Input | Default | Description |
|---|---|---|
| `mode` | `deliver` | `deliver`, `compare`, or `scan` |
| `files` | — (`compare`: `**/*.architecture.json`) | Newline- or comma-separated globs relative to the workspace; `**`, `*`, and `?` are supported |
| `type` | — | Force one diagram type instead of reading `diagram_type` |
| `quality` | `standard` | `standard` or `showcase` |
| `output-dir` | `archify-artifacts` | Where HTML, receipts, and `summary.md` go |
| `repo-root` | — | Repository root for source evidence; defaults to the workspace when a source declares `meta.repository` |
| `base-ref` | pull request base | `compare`: revision to compare against |
| `comment` | `false` | `compare`: create or update one pull request comment |
| `github-token` | `github.token` | `compare`: token used for the comment |
| `scan-path` | — | `scan`: folder to analyze |
| `scan-title` | — | `scan`: diagram title |
| `fail-on-error` | `true` | Fail the step when any source fails |
| `setup-node` | `true` | Install Node.js 22 first; set `false` if the job already has Node 18+ |

## Outputs

| Output | Modes | Description |
|---|---|---|
| `ok` | all | `true` when every source passed |
| `delivered`, `failed` | `deliver`, `scan` | Counts of delivered and failed sources |
| `changes` | `compare` | Number of authored changes plus new and removed diagrams |
| `comment` | `compare` | `created`, `updated`, or `skipped` |
| `summary-path` | all | Path of `summary.md` |
| `output-dir` | all | Absolute output directory |

## Security

Archify commands run without a shell, so repository file names are passed only as arguments. The token is sent only to `GITHUB_API_URL` for the pull request comment and is never logged. The action makes no other network requests.

## Development

Tests live in [`archify/test/github-action.test.mjs`](../../archify/test/github-action.test.mjs) and run with the main suite:

```sh
cd archify
node --test test/github-action.test.mjs
```
