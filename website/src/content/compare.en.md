# Archify vs Mermaid, Excalidraw, and PlantUML

**Short answer:** use Mermaid when a small diagram must live inside a Markdown code block, Excalidraw when several people need to sketch together in real time, and PlantUML or D2 when diagrams are text files in a classic CI pipeline. Choose Archify when a coding agent should read a description, an existing Mermaid draft, or a real repository and produce a layout-checked, interactive standalone HTML diagram — or a conclusion-first one-page answer with cited panels. These tools overlap less than their marketing suggests.

<span id="answer" class="section-anchor" aria-hidden="true"></span>

## The division of labor

Archify is an open-source Agent Skill (Apache-2.0) at [archify.si](https://archify.si), maintained at [github.com/tt-a1i/archify](https://github.com/tt-a1i/archify). Your agent writes typed JSON for a diagram, or an `.archify.md` draft for a one-page answer. Archify then checks the schema, lays out and routes the geometry, runs a real-browser inspection, and writes one HTML file that needs no build step or network connection.

That makes Archify a different category from a diagram renderer. The hard part it targets is not typing diagram syntax; it is reading evidence, choosing a readable structure, avoiding overlapping connectors, and giving readers a way to inspect the result. If your problem is “render this text to an image in a README”, Archify is more machinery than you need.

<span id="matrix" class="section-anchor" aria-hidden="true"></span>

## Comparison at a glance

| Dimension | Archify | Mermaid | Excalidraw | PlantUML / D2 |
| --- | --- | --- | --- | --- |
| Primary authoring | Coding agent writes typed JSON or a Markdown draft | You write text syntax | You draw by hand on a canvas | You write text syntax |
| Inputs | Natural language, a plan, existing Mermaid text, or repository evidence at a pinned commit | Diagram text | Pointer or touch strokes | Diagram text |
| Output | One self-contained interactive HTML artifact plus its source | Rendered SVG/PNG inside Markdown or a host page | Canvas scene, usually an image or share link | Rendered image |
| Complex-graph readability | Schema, geometry, routing, and browser checks; focus and path highlighting | Depends on the renderer and the author's layout | Depends on the drawing | Layout is mostly explicit or automatic, without an interaction layer |
| Interactive exploration | Focus, upstream/downstream reach, path highlight, source cards | Usually static | Static image after export | Usually static |
| One-page answer | Panels with prose, tables, steps, charts, code, and validated diagrams | No | No | No |
| Runtime requirements | Agent with file access and Node.js to author; any browser to read | Renderer in the host | Browser or app | Renderer or server |
| Best fit | Agent-generated, evidence-aware diagrams and technical one-page answers | Small diagrams in Markdown | Real-time visual thinking | Text-authored diagrams in version control |

The table describes default strengths, not absolute limits. A skilled author can make Mermaid look excellent, and a hand-drawn Excalidraw sketch often communicates faster than any formal diagram. The point is to match the tool to the work, not to declare a winner.

<span id="boundaries" class="section-anchor" aria-hidden="true"></span>

## When another tool fits better

- **Use Mermaid** when the diagram is small, must render directly inside GitHub or a docs site, and should stay editable as a few lines of text. This is still the least-friction choice for most README diagrams.
- **Use Excalidraw** when the value is the shared sketching session, the informal style, or rapid whiteboarding with people who will not write diagram syntax.
- **Use PlantUML or D2** when your team already treats diagrams as text, wants deterministic diffs in review, and runs rendering in CI. PlantUML coverage of UML notation is broader than Archify's class and sequence modes.
- **Use a BI or observability tool** when the question is a live metric, a dashboard, or a trace explorer. Archify produces an authored artifact, not a live monitor.
- **Use a hosted collaboration service** when several people must edit the same diagram at once or manage permissions. Archify is not a hosted editor.

Archify also does not promise to parse every Mermaid construct, to discover a system automatically, or to prove that a diagram matches production behavior. A passing check validates the authored artifact, not the truth of every claim.

<span id="workflows" class="section-anchor" aria-hidden="true"></span>

## Three common workflows

### 1. A Mermaid draft has become too tangled

Paste the Mermaid source into your configured agent and ask it to re-author the relationships as an Archify workflow or architecture diagram. The [Mermaid input guide](agent-diagrams.html#mermaid-input) shows a four-step example, the exact prompt, and what to verify before accepting the result. Then open [Start with a workflow description](start.html?type=workflow&input=description) to copy a bounded prompt of your own.

This is not a lossless converter. The agent reads the relationships and writes fresh JSON; styling, layout directives, and callbacks should not be assumed to carry over.

### 2. Nobody wants to draw boxes from a real repository

Ask the agent to map one request or job through a specific repository, name the revision it inspected, and distinguish runtime components from build tooling. The [MCO runtime case](cases/mco-runtime.html) walks through a pinned-commit example, and the [MCO architecture artifact](cases/mco-runtime.architecture.html) shows the resulting diagram. The [repository evidence checklist](agent-diagrams.html#repository-evidence) lists the questions to ask before accepting a source-backed diagram.

### 3. One diagram is not enough

For an incident review or a protocol walkthrough, a single picture often hides the argument. A one-page explainer leads with the conclusion and reasons, then answers one sub-question per panel with prose, tables, steps, charts, code, and validated diagrams. See the [P99 tail-latency explainer](cases/explainer/p99-tail-latency.html) and the [first TLS visit explainer](cases/explainer/tls-first-visit.html). These artifacts are recorded examples, not generated on demand.

<span id="limits" class="section-anchor" aria-hidden="true"></span>

## What to check before choosing Archify

- Do you have an agent environment with file access and Node.js?
- Is the input more than diagram syntax — a description, a draft, or repository evidence?
- Do readers need interaction, source links, or a conclusion-first written answer?
- Can you accept an authored HTML artifact instead of a Markdown-renderable code block?

If the answer to the first three is no, start with Mermaid. If the last one is a hard requirement, Mermaid is the correct tool. Archify's advantage appears when the diagram must be generated, checked, explained, and inspected as a deliverable.

Continue with the [scenario guide](guide.html) to pick a diagram type, the [agent diagramming guide](agent-diagrams.html) to learn the review workflow, or [Start](start.html) to install the Skill for your agent.
