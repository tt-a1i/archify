# Visual Evolution Round 9 — Proof before promises

Date: 2026-07-19

## Question

Archify already has motion, three visual presets, guided views, semantic focus, presentation mode, Node Finder, and a generated Proof Lab. Why does the project landing page still feel less alive than fast-growing peers?

## Evidence

- `fireworks-tech-graph` puts a verified animated 12-style overview directly in its README and landing-page style section. Motion is not described first; it is shown first.
- LikeC4 places a real preview beside its source example and leads users from “Write” to “See” to “Ship”. The artifact is part of the explanation, not a distant gallery link.
- React Flow makes the interactive canvas itself the primary product demonstration, then supports it with capability and community proof.
- Archify's own landing page still used one static screenshot even though the generated Proof Lab already contained 11 live artifacts and 44 passing checks.

Primary references:

- <https://github.com/yizhiyanhua-ai/fireworks-tech-graph>
- <https://raw.githubusercontent.com/yizhiyanhua-ai/fireworks-tech-graph/main/README.md>
- <https://likec4.dev/>
- <https://reactflow.dev/>

## Decision

Replace the static hero screenshot with a Live Proof Stage backed by checked-in generated artifacts:

1. Signal Flow — Agent Tool Call workflow.
2. Blueprint — Production Deployment architecture.
3. Classic — Cache Miss sequence.

The stage uses the exact HTML artifacts and receipts already published by Proof Lab. It does not create a second renderer, a hand-authored mockup, or a runtime dependency. Each option links to its named guided view in the full artifact.

## Product boundary

- Keep the landing page static-host friendly.
- Do not make a new GIF pipeline; the live HTML already preserves motion, semantic focus, and reduced-motion behavior.
- Do not auto-rotate scenarios. Motion inside the artifact is enough, and manual selection avoids stealing control or repeatedly reloading iframes.
- Preserve a useful mobile layout and keyboard-operable tab semantics.
- Fail tests if any advertised proof disappears, loses its trace contract, drifts from its node/edge receipt, or is no longer fully validated.

## Success criteria

- A first-time visitor sees a moving real diagram without leaving the landing page.
- Signal Flow, Blueprint, and Classic are visible as materially different identities.
- The user can switch all three examples with mouse or keyboard.
- The embedded diagram remains clickable rather than becoming decorative video.
- Desktop and mobile layouts have no page overflow or control collision.
