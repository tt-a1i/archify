# DSH adapter changelog

For current publication status, see the [repository integration README](https://github.com/tt-a1i/archify/tree/main/integrations/deepseek-harness).

## 1.1.0 — pending publication

- Prepares the independent DSH sync requested in [#1153](https://github.com/tt-a1i/archify/issues/1153): Archify 3.2.0 pinned to `edf158c4e7a1d18d20cc329840f864289634c090`, including the post-tag Apache-2.0 and third-party notice fixes. Adapter MIT licensing remains distinct from the bundled Skill's licensing.
- Includes the unreleased `includeDefaultRoots: true` fix for [#906](https://github.com/tt-a1i/archify/issues/906), preserving personal/project Skills when this is the only live filesystem provider.
- Targets exact npm CLI host `@deepseek-ai/dsh@0.2.1-rc.2` for candidate acceptance. No blanket 0.2.x or Desktop/Electron support claim; historical 1.0.0 evidence does not certify this candidate.
- Extends acceptance to same-profile upgrades from both 0.1.0 and 1.0.0 and checks older same-name personal/project `archify` copies against the effective loaded body/path. Plugin upgrade does not override higher-precedence Skill copies.
- Publication, final-head three-platform acceptance and live installation updates are separate steps. Public install instructions remain on verified 1.0.0 until publication is authorized and verified.

## 1.0.0

- First stable adapter contract for the exact tested host `@deepseek-ai/dsh@0.1.2-rc.1`; the host remains a developer preview. Other host versions are not covered by this release claim.
- Bundles Archify 3.0.1 from stable commit `7158026e852f3aa6578c741e673b46d7878c92c1`, including the installation fix after the Archify v3.0.1 tag. Archify and adapter versions are independent.
- Preserves the Skill-only activation contract: one `archify-plugin` provider, no native tools, dependencies, install hooks, telemetry, or automatic updates.
- The release gate covers clean installation and published plugin 0.1.0 → 1.0.0 upgrade, discovery/loading, workspace rendering, and uninstall on Linux, macOS, and Windows. Full example-rewriting smoke runs outside the pnpm store.
- Archify 3.x changes the Viewer and authoring/delivery flow; existing schema-v1 input remains supported. See [Archify 3.0 upgrade notes](https://github.com/tt-a1i/archify/blob/v3.0.1/CHANGELOG.md#upgrading-from-2x). Existing HTML keeps its embedded Viewer.
- The prepared 0.2.0 adapter was never published; 1.0.0 supersedes that candidate.

## 0.1.0 — 2026-08-14

Initial experimental community bundle: Archify 2.14.0 with `@deepseek-ai/dsh@0.1.0-rc.6`. The published version and its `archify-dsh-v0.1.0` tag remain immutable.
