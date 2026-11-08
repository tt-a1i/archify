# Security model

This document describes what Archify protects, who it protects it from, and which parts of the repository matter for security. It guides security reviews and automated scans. To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## Maintainer decisions
- **Attackers:** every attacker profile below is in scope. None is accepted as risk.
- **Out of scope:** `experiments/`, `benchmarks/` and `journal/`.
- **Low priority:** the website (`website/`) and the docs gallery and static artifacts (`docs/`).
- **Infrastructure:** no separate infrastructure repository. The GitHub workflows in `.github/workflows/` (Cloudflare Pages deploy, release) cover all deployment.

## System overview
Archify is a Node.js (>=18) CLI and AI-agent Skill (`archify/SKILL.md`). It compiles schema-validated JSON IR (`archify/schemas/`) into self-contained HTML/SVG diagrams and explainers. It runs on the user's machine, usually driven by an AI coding agent. There is no hosted backend. The project is distributed as a release ZIP / Skills CLI package, and a static Astro website is deployed to Cloudflare Pages from CI.

Trust boundaries:
1. Agent/user-authored JSON spec, explainer source and repository evidence -> CLI. The input may come from a hostile repository through prompt injection.
2. Generated HTML artifact -> the reader's browser (file:// or the preview server), possibly shared with other people.
3. CLI -> internet: brand-mark capture (`archify/renderers/shared/brand-marks.mjs`) and the update-manifest check (`archify/scripts/check-update.mjs`, fixed `DEFAULT_MANIFEST_URL`).
4. CLI -> local filesystem and OS: output writes, locks, recovery journal, sidecars, `git` subprocesses, and the platform opener.
5. GitHub (PRs from outside contributors) -> privileged CI workflows that hold `contents: write`, `id-token: write` and `CLOUDFLARE_API_TOKEN`.

## Components
- **CLI** (`archify/bin/archify.mjs`, `archify/bin/visual-check.mjs`, `archify/renderers/` except the shared files listed below, `archify/schemas/`, `archify/explainer/` except `reader.js`/`sources.mjs`, `archify/delta`, `archify/migrations`, `archify/recipes`, `archify/locales`): parsing, validation and rendering.
- **Output** (`archify/bin/finalize.mjs`, `recover-output.mjs`, `delivery-update.mjs`, `open-artifact.mjs`, `archify/scripts/delivery-update-child.mjs`, atomic write/lock/journal/sidecar code in `archify/renderers/shared/`): filesystem writes and opening artifacts.
- **Viewer** (`viewer/`, `archify/assets/`, `archify/explainer/reader.js`, generated viewer templates): JS and CSS embedded in every artifact.
- **Preview** (`archify/bin/preview.mjs`): loopback HTTP + SSE server with a Host-header check and CSP.
- **Network** (`archify/renderers/shared/brand-marks.mjs` capture, `archify/scripts/check-update.mjs`, `archify/scripts/update-contract.mjs`): outbound fetches, SSRF and private-address guards, update cache.
- **Evidence** (`archify/renderers/shared/repository-evidence.mjs`, `archify/explainer/sources.mjs`): local `git` reads of user repositories.
- **Integrations** (`integrations/deepseek-harness`, `integrations/hermes-agent`): agent host adapters.
- **Website/CI** (`website/`, `docs/`, `.github/workflows/`, `scripts/`, `tools/contributor-cards/`): site, release packaging and automation. Within this component, `website/` and `docs/` are low priority. CI workflows, `scripts/` (release packaging such as `build-zip.sh` and `write-deterministic-zip.mjs`) and `tools/contributor-cards/` are not.

## Entry points and who can reach them
- CLI commands (`render`, `validate`, `finalize`, `preview`, explainer) take JSON/markdown and paths from the agent. Anyone who can influence the agent's context can reach them, for example a malicious repo, issue or web page.
- The generated HTML is opened by the user and by anyone it is shared with.
- The preview server is reachable from local processes and, through DNS rebinding or cross-origin requests, from web pages in the user's browser. Mitigations: bound to the loopback host, exact Host-header match, GET/HEAD only.
- Brand URLs in a spec trigger fetches (HTTP(S) only, private addresses rejected, timeouts, sha256 pin).
- The update manifest is fetched from a fixed URL. A compromised manifest or cache could mislead the user.
- GitHub workflows: `contributor-cards.yml` `pull_request_target` checks out the default branch only; `release.yml` has `contents: write`; `ci.yml` deploys with the Cloudflare token and `id-token: write`.
- Website: client JS uses `innerHTML` with translation strings, and Navigation fetches the GitHub API.

## Assets
- The user's machine and filesystem outside the requested output directory, plus local secrets that the agent environment can reach.
- Integrity of generated artifacts (evidence must not be forgeable) and the safety of their readers.
- Private repository content that the evidence/explainer flows read. It must not leak into artifacts beyond what was authored.
- Release ZIP / Skill package integrity, the update channel, `CLOUDFLARE_API_TOKEN`, the GitHub token with write scope, and the archify website domain.

## Attacker profiles (all in scope)
1. A hostile repository or document whose content an agent turns into specs: XSS in artifacts, path traversal or arbitrary writes, argument injection into `git` or the opener, SSRF via brand URLs, resource exhaustion.
2. A recipient-targeting attacker who shares a crafted artifact.
3. A malicious web page in the user's browser attacking the preview server.
4. An outside contributor or PR author targeting CI secrets or release integrity.
5. A network attacker or compromised upstream on the update or brand fetch.

## Existing controls (observed)
- AJV JSON Schema validation with generated validators. Escaping helpers in the renderers and in `explainer/reader.js` (`escapeText`).
- Preview: loopback-only bind, Host check, CSP on `/`, method allowlist.
- Brand capture: protocol/port allowlist, private-address rejection, byte limits, timeouts, digest pinning.
- Update check: fixed manifest URL, a validator for cache entries, a deadline.
- `git` runs with `--no-replace-objects`, `GIT_NO_LAZY_FETCH=1` and `GIT_ALLOW_PROTOCOL=''`.
- The Windows opener passes the target through an environment variable, never interpolated.
- Workflows: actions pinned to SHAs, `persist-credentials: false`, and the privileged `pull_request_target` job checks out only the default branch.

## Out of scope / accepted risk
- `experiments/`, `benchmarks/`, `journal/`: out of scope.
- `website/`, `docs/`: in scope, low priority.

## Maintaining this document
Update the components, entry points and controls when a change adds a network fetch, a subprocess, a filesystem write outside the output directory, a new viewer capability, or a privileged workflow.
