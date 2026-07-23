# Cursor acceptance record

> Verified: 2026-07-23
> Scope: project-local Cursor Agent Skill discovery and one checked Architecture delivery
> This is a dated compatibility record, not a claim that every Cursor version or model produces identical output.

## Environment

- Cursor Agent CLI: `2026.07.20-8cc9c0b`
- Model selection: `auto` (Cursor CLI default)
- OS: macOS 26.5.2 (`25F84`)
- Skills CLI: `skills@1.5.20`
- Archify source: `codex/cursor-onboarding`, based on `e7e22a1`

## Installation and discovery

The acceptance workspace was a new temporary directory. Archify was installed with the reproducible project command:

```bash
npx -y skills@1.5.20 add /path/to/archify \
  --skill archify --agent cursor --copy --yes
```

`skills list --agent cursor --json` reported one project-scoped `Cursor` installation at `.agents/skills/archify`. A new Cursor Agent session then independently reported that it had discovered:

```text
.agents/skills/archify/SKILL.md
```

The session ran `archify doctor` successfully before authoring. No Cursor-specific `SKILL.md`, renderer, schema, or prompt fork was present.

## End-to-end task

Cursor was asked to use Archify to create a six-component local event-processing Architecture diagram containing:

- Webhook Client
- API Gateway
- Event Router
- Worker
- PostgreSQL
- Dead Letter Queue

The authored main path was `Webhook Client → API Gateway → Event Router → Worker → PostgreSQL`; the explicit failure route was `Worker → Dead Letter Queue` with label `on failure`.

Cursor wrote only the typed source and checked HTML in the workspace root, in addition to installer-owned files. Its delivery receipt reported:

```text
validation: passed
visual_review: skipped (image reader unavailable in Cursor session)
correction_rounds: 0
quality: showcase
compositionStatus: pass
checksPassed: 9/9
errors: 0
warnings: 0
artifact.sha256: d4d443f160fafd7615234987a5572d7169916719b9a97b9231e9f48434c79e4a
artifact.bytes: 582743
```

An independent Archify `validate --json` and `check --json` rerun matched the nine passing checks, zero composition findings, byte count, and SHA-256 receipt.

## Browser review

The generated HTML was opened in the built-in browser at a 1280×720 desktop viewport. The complete six-node main path was readable in Presentation Stage, the Worker-to-DLQ relationship remained visually distinct, and selecting the authored `Failure to DLQ` chapter framed exactly Worker and Dead Letter Queue while leaving the rest as context. The Start page's Cursor selector, English/Chinese switching, agent URL state, and exact global/project install commands were also exercised. Finally, the landing Live Proof's script-only sandbox was checked through its initial Signal Flow chapter and a deliberate Blueprint switch. All three surfaces produced zero browser warnings or errors in the final clean sessions.

Result: **Cursor project installation, native Skill discovery, execution, verified delivery, and desktop browser presentation passed for the recorded environment.**

## Boundaries retained

- `skills use ... --agent cursor` is not documented because `skills@1.5.20` rejects that launcher.
- No physical `~/.cursor/skills` path is promised; Cursor also officially scans `.agents/skills`, which the verified installer uses.
- Global installation is documented as user-wide, project installation as repository-local, and both use explicit copy mode.
- This record does not benchmark other Cursor models, claim automatic updates, or replace Archify's deterministic and perceptual delivery gates.
