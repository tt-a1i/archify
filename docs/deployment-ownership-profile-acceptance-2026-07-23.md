# Deployment Ownership Profile Acceptance

Date: 2026-07-23 (Asia/Shanghai)

Branch: `codex/deployment-ownership-profile`

Research: `docs/research-next-stability-delight-slice-2026-07-23.md`

## Outcome

- `validation`: **pass**
- `visual_review`: **pass**
- `correction_rounds`: **0** source-level visual corrections
- Product surface: optional Architecture `meta.engineering_profile: "deployment-ownership"`
- Compatibility boundary: profile-less v1 inputs keep the existing validation and rendering path
- Scope boundary: no new renderer, diagram type, visual preset, viewer panel, dependency, hosted service, telemetry, or mobile product work

## Contract proven

When explicitly selected, the profile fails closed unless:

1. every non-external component has a non-empty `tag` owner;
2. every non-external component belongs to exactly one `region` boundary;
3. at least one `region` and one `security-group` boundary exist;
4. every `database` belongs to a `security-group`;
5. every security group contains members from exactly one shared region;
6. every connection whose region/security-group membership changes has a non-empty mechanism label.

The validator reads authored IR only. A passing result is not repository, IaC, cloud-account, runtime-impact, availability, or live-deployment verification.

## Deterministic and failure evidence

- `production-deployment.architecture.json` passes nine artifact checks, `showcase`, and the engineering profile.
- `validate --json` and `deliver --json` report `engineeringProfile: "deployment-ownership"`.
- Repeated delivery of the same source produces the same HTML SHA-256.
- Profile-less Architecture output omits `data-engineering-profile`.
- Workflow, Sequence, Data Flow, and Lifecycle reject the Architecture-only field.
- The mutation matrix covers missing owner, missing/ambiguous region, missing boundary kinds, missing database private scope, cross-region private groups, and missing outside→region, region→region, public→private, and private→public labels.
- Same-membership relationships and self-loops do not acquire a false label requirement.
- A failed profile delivery preserves the previous artifact bytes.

Stable diagnostic families exercised:

- `engineering/deployment-owner-missing`
- `engineering/deployment-region-scope`
- `engineering/deployment-region-ambiguous`
- `engineering/deployment-boundary-kind`
- `engineering/deployment-private-state`
- `engineering/deployment-private-region-consistency`
- `engineering/deployment-crossing-mechanism`

## Built-in browser acceptance

Viewport used for acceptance: 1280×720 desktop. No mobile-specific product pass was performed.

Verified on the generated Production Deployment artifact:

- Gallery card presents one compact `DEPLOYMENT OWNERSHIP · PASS` strip without adding a fifth receipt cell.
- Blueprint, Classic, and Signal Flow preserve the same `data-engineering-profile` and authored topology.
- Dark and light themes keep owner tags, Region/private boundaries, databases, and `VPC route` / `cross-region WAL` labels readable.
- Presentation opens on the authored `request-boundary` chapter.
- Finder narrows `postgres` to one structured PostgreSQL result without the previous oversized search treatment.
- Focus opens the PostgreSQL Semantic Passport and exposes `data team` plus exact incoming/outgoing relationships.
- Downstream Reach reports `1 node · 1 link · max 1 hop` without claiming impact.
- Route Probe resolves PostgreSQL → DR Replica as `2 nodes · 1 directed hop · shortest authored route`.
- Guided Story enters a finite five-beat request path with Pause available.
- A fresh standalone artifact tab and a fresh direct-embed tab reported zero console warnings/errors.

The built-in browser's multi-iframe Gallery host emitted source-less observer messages from its inspection environment; isolated standalone and direct-embed artifact pages were clean, so these were not attributed to Archify source.

## Release gates

- `npm test`: **472 passed, 0 failed**
- `npm run test:webm`: Share/Route/Reach matrices and WebM readback passed; WebM contained 9/9 unique sampled frames
- Focused engineering/Gallery/README suite: **12 passed, 0 failed**
- Zero-dependency installed package smoke: passed locally on macOS
- CI package smoke now runs the same Node harness on Ubuntu, macOS, and Windows
- ZIP integrity: passed; required standalone validator and engineering-profile module are present
- Generated Gallery and Guide freshness: passed through their reproducibility tests
- README / README_EN byte mirror: passed
- GitHub Actions YAML parse: passed
- `git diff --check`: passed

## Artifact fingerprints

- `archify.zip`: `0d129612c2dfd4145f03a5f9b67730a1001dfe043c23e3287cd050663227e3cc`
- Deployment HTML: `3a8d12813da45b465f3f633a8c4341760e300d10961768274511c2203b331e0b`
- README live proof GIF: `06526e75b813681bee1a8157774f2875603f6f75e1aa9497388aa810bff4e41e`

## Next independent slice

Architecture Delta / PR Proof remains the strongest next growth candidate, but it must be designed separately around comparability, stable relationship IDs, removed-node geometry, and export semantics. It is intentionally not hidden inside this release.
