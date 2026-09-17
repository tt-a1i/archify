# fireworks-tech-graph research note

Research date: 2026-07-19 (Asia/Shanghai)

Primary repository: <https://github.com/yizhiyanhua-ai/fireworks-tech-graph>

## Executive summary

`fireworks-tech-graph` is an Agent Skill for Codex and Claude Code that turns a
natural-language diagram request into a semantic JSON representation and then a
validated SVG. It can also export PNG, a single-file interactive HTML viewer,
and a tightly constrained class of animated GIFs.

Its strongest product move is not a novel graph model. It packages diagram
authoring as a complete, highly visible workflow: named visual styles, scenario
recipes, domain-specific semantics, deterministic geometry checks, polished
showcase assets, installation paths, and a validation loop.

The project is a useful Archify competitor reference, but its highest-value
lessons are presentation and domain recipes. Archify should not copy its broad
style/UML/GIF surface or its duplicated distribution tree.

## Current snapshot

- GitHub repository created 2026-04-10.
- 8,863 stars, 761 forks, 0 open issues, 68 commits at the research snapshot.
- MIT licensed; GitHub classifies the primary language as Python.
- Latest stable release: v1.2.0, published 2026-07-17.
- Public contributors are real but concentrated: the top contributor has 24
  commits and the next has 8; most others have one or two.
- The repository has accepted outside fixes for installation, routing,
  rendering, CJK fonts, SVG transforms, and Codex discovery.

Sources:

- <https://api.github.com/repos/yizhiyanhua-ai/fireworks-tech-graph>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/releases/tag/v1.2.0>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/commits/main/>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/pulls?q=is%3Apr+is%3Amerged>

## Product and runtime model

The end-to-end path is:

```text
Natural-language request
  -> Agent reads SKILL.md and style/domain references
  -> Agent creates diagram JSON / semantic IR
  -> Python generator normalizes and validates the IR
  -> deterministic route planning and SVG generation
  -> structural and composition checks
  -> optional PNG render and visual readback
  -> optional single-file HTML wrapper
  -> optional contract-specific SVG-to-GIF renderer
```

The repository therefore has two layers:

1. An agent authoring layer: `SKILL.md`, prompt recipes, visual references,
   shape vocabulary, and domain/layout rules.
2. A deterministic toolchain: JSON normalization, semantic contracts, SVG
   generation, routing, validation, interactive export, motion export, tests,
   and distribution checks.

SVG is the canonical artifact. The offline HTML viewer wraps one sanitized SVG
and adds pan/zoom, themes, copy, and SVG/PNG/JPEG/WebP export. This differs from
Archify, where the interactive self-contained HTML is the primary deliverable.

Primary sources:

- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/README.md>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/SKILL.md>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/docs/CAPABILITIES.md>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/fireworks.py>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/scripts/generate-from-template.py>

## What is genuinely implemented

- Versioned JSON IR with duplicate-ID, dangling-reference, finite-number, and
  waypoint checks.
- Eleven generator-backed visual styles plus one AI-authored/static style.
- Deterministic orthogonal routing, ports, reserved regions, crossing bridges,
  label/canvas checks, and layout reports.
- Executable semantic contracts for C4 review, cloud deployment, event streams,
  and reliability/observability diagrams.
- Unified commands for `doctor`, `validate`, `render`, `check`, `inspect`,
  `export-html`, `animate`, and `examples`.
- SVG sanitization before interactive HTML export.
- CI matrices for Python 3.9/3.12, render regression, motion smoke, package
  consistency, and installed-skill canaries.

The repository's “14 UML types” language needs qualification. Its own coverage
map says that component, deployment, package, composite structure, and object
diagrams are adaptations of generic architecture/class modes; communication is
approximated with sequence, timing is adapted to timeline, and interaction
overview is adapted to flowchart. The code has one generic node/edge generator,
four JSON schema files, and ten SVG starter templates, not fourteen independent
UML renderers.

Primary sources:

- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/style-diagram-matrix.md>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/main/schemas>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/tree/main/templates>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/.github/workflows/ci.yml>

## Local verification

Checks were run from a clean temporary clone of current `main`:

- `python3 -m unittest discover -s tests -v`: 132 passed, 3 skipped.
- `npm run check`: project consistency passed; nested skill mirror matched the
  npm payload.
- `fireworks.py validate`, `render`, `check`, and `export-html` succeeded on the
  Style 7 API fixture.
- `fireworks.py doctor` reported the core Python/Node environment, but failed
  the complete ready check because neither CairoSVG nor `rsvg-convert` was
  installed, and the optional motion renderer lacked Puppeteer.

This confirms that JSON -> SVG -> validation -> offline HTML works without
installing new dependencies on the research machine. PNG requires CairoSVG or
`rsvg-convert`. GIF requires Node, FFmpeg/FFprobe, Chrome/Chromium, and
Puppeteer/Puppeteer Core.

## Why it likely attracted stars quickly

This is an inference from the repository's product surface, not a claim about
individual stargazers.

- The README leads with a 12-style animated proof grid, not implementation
  detail. The value is understandable in seconds.
- The request surface is natural language, bilingual, and tailored to common
  AI/Agent diagrams such as RAG, memory, tool calls, and multi-agent flows.
- Named styles make the result easy to request and share: Dark Terminal,
  Blueprint, Notion Clean, Claude, OpenAI, and others.
- It has a one-command Skill installation story for two popular agent runtimes.
- It positions itself directly against the friction of Mermaid syntax and
  draw.io clicking, while still returning editable SVG.
- The author treats the repository as a product/portfolio surface, with a
  polished site, release assets, case study, and consulting links.

## Strengths

- Excellent proof-first presentation and prompt examples.
- Clear semantic vocabulary for technical diagrams.
- Strong deterministic validation for a young visual project.
- Domain-specific contracts are more valuable than adding generic skins.
- Real CI and regression fixtures; local non-render tests passed.
- Useful separation between structural validation and perceptual visual review.
- Fail-closed behavior is explicit when image reading or a semantic motion
  contract is unavailable.

## Limits and risks

- The first-run path is not truly zero-install for PNG/GIF output.
- GIF animation is not arbitrary SVG animation. It only accepts generated SVGs
  matching one of twelve approved role/stage/order/topology contracts.
- “Full UML support” is broader than the independent renderer surface.
- Manual fine-tuning and stable incremental edits are not a first-class loop;
  SVG is editable externally, but the project is optimized for regenerate and
  validate.
- The repository contains a complete physical mirror under
  `skills/fireworks-tech-graph/`. Consistency tooling guards it, but it duplicates
  roughly 8.6 MB and increases review/release noise.
- The latest engineering expansion is very large and recent: v1.1.0 added the
  IR, CLI, HTML exporter, semantic contracts, distribution mirror, and most
  geometry machinery; v1.2.0 immediately added a large, scene-specific motion
  stack. The breadth has not had much time to mature.
- The roadmap itself identifies scaling beyond 100 edges, browser-based text
  metrics, interactive inspection, and cross-platform visual diffs as future
  work.

Primary sources:

- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/docs/ROADMAP.md>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/blob/main/references/motion-effects.md>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/issues/13>
- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph/issues/28>

## Archify comparison

| Axis | fireworks-tech-graph | Archify |
|---|---|---|
| Canonical artifact | Semantic SVG | Self-contained interactive HTML |
| Strongest appeal | Many polished styles and AI/Agent recipes | One portable artifact with themes, clipboard, and multi-format export |
| Input/runtime | Agent Skill plus Python generator | Agent Skill plus Node renderers |
| Determinism | Generic IR, routing, semantic/style contracts | Typed per-diagram IR/renderers and artifact checks |
| Diagram breadth | Broad advertised UML/domain surface | Five explicit renderer-backed modes |
| Motion | Strict scene-contract GIF pipeline | Optional trace animation inside the artifact |
| Editing | Regenerate or edit SVG externally | JSON IR refinement; local-edit stability remains an active direction |
| Distribution | GitHub/npx/npm plus committed nested mirror | Zero-install package/ZIP with doctor and demo paths |

## Borrow / skip judgment for Archify

Worth borrowing:

1. A proof-first README showcase that lets users judge output quality before
   reading installation details.
2. A stronger scenario/prompt gallery with exact input and exact output.
3. Named domain recipes such as C4 review, deployment ownership, event flow,
   and reliability view, implemented as semantic constraints rather than skins.
4. A style/diagram suitability guide that helps users choose the right view.
5. Visible capability status: explicitly report when structural validation
   passed and when visual review ran or was skipped.

Do not borrow:

1. Twelve-style and fourteen-UML breadth as a roadmap goal.
2. A large hard-coded GIF scene-contract system.
3. The physical root/nested distribution duplication.
4. SVG as the primary artifact at the expense of Archify's stronger HTML
   interaction and export experience.
5. Claims broader than the actual renderer boundary.

The sharp strategic conclusion is: `fireworks-tech-graph` wins attention with
style breadth and a spectacular proof surface; Archify should answer with a
better proof surface and stronger scenario recipes, while keeping its narrower,
more coherent technical-diagram-compiler boundary.
