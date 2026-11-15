# Explainer: a concise visual answer

## Product contract

An Agent's long answer is tiring to read and its main point is hard to find. Explainer puts the conclusion first, explains the reasons with structure and useful diagrams, and leaves room for visual refinement. This is a reading surface. The implementation uses Archify's own author format, renderer and native diagram runtime.

## Content model

`diagram_type: "explainer"` uses schema version 1. The document contains `meta`, `answer`, `panels` and `sources`.

- `answer.summary`: required direct conclusion.
- `answer.reasons`: optional flat list, at most four items.
- `answer.scope`: optional applicability and qualifications.
- Panels contain prose, list, checklist, comparison, callout, facts, metric, steps, chart, snippet, code, diff, image or native diagram blocks. Each panel and block has a stable ID.
- Charts compile a Mermaid chart fence, or read a CSV or JSON file next to the draft (`@chart type=bar|line|pie data=… x=… y=…`); the file is read inside the input directory and frozen at delivery.
- A native diagram node row may name `source:<id>`, tying the node to a repository source.
- `meta.style` picks one of four page styles (`clean`, `editorial`, `product`, `swiss`), each with light and dark palettes; readers may switch, and print uses the light palette.
- Sources contain a title and optional safe URL or repository position (`path`, `lines`, `revision`). Sources are a numbered footer list. Code blocks load committed Git bytes from their source location.
- Internal revisions support patch and delivery identity. They are not displayed.

A restricted Markdown draft compiles to the same JSON model. The first paragraph after `# title` is the summary; an immediately following flat bullet list supplies reasons; `@answer scope="..."` supplies the applicability line. Detailed grammar and examples live in [the authoring guide](../../archify/references/explainer-authoring.md).

## Board layout

The conclusion is the first item inside `.board`, with `id="answer"` and classes `panel answer-panel spanN`. There is no separate conclusion banner.

| Content | Preferred columns | Minimum |
| --- | ---: | ---: |
| Conclusion | 5 | 4 |
| Comparison | 7; 8 if more than three total columns | 6; 7 |
| Diagram | 8; 12 if its viewBox exceeds 1000 units | same |
| Code or diff | 8 | 7 |
| Snippet | 5, 6 or 8 by longest line | 4, 6 or 7 |
| Steps, list, short prose | 4 | 4 |

The static board packs in document order and lets panels shrink toward their minimum to finish a row. Spare columns go to the flexible panel with the most content. Authored spans are preserved exactly; when every panel in a partial row has a fixed span, an inert spacer completes it.

On desktop widths the reader script re-plans the board from measured heights. Each panel is measured at every allowed span. A row is a set of columns totalling 12; a column holds one panel or two consecutive panels stacked. The plan minimises page height plus unused cell area, penalises text set wider than a comfortable measure, rejects spans that clip tables or code, and derives each diagram's minimum span from its smallest label and the reading floor. Source order and the top-left conclusion are kept. Without JavaScript, below 1100 px, and in print, the static spans apply.

A panel whose steps point into its one diagram reads them side by side: steps on the left, the diagram on the right, sized so its smallest label stays at the reading floor and kept in view while the steps scroll. Without room for 320 px of steps beside it, the diagram wraps above them. A diagram that cannot reach the floor at the page width shows a notice, and the board is planned again so the notice does not clip its panel.

## Reading

- A node label named in a panel's text links both ways with the node: hovering either lights the other. Hovering anywhere in a linked step lights its part of the diagram.
- Step lists that point into a diagram, sequence diagrams and otherwise unwalked workflows can be walked one step, message or node at a time; the walk bar replaces its start button.
- Clicking a preview node, or the diagram's "open interactive view" control, opens the native Viewer focused on that node. The Viewer follows the page theme, and editorial pages open it in its editorial preset.
- Hovering a citation, or a node tied to a source, shows a source card: the kind of source, its location, the pinned excerpt or note, the commit and the link.
- Each panel, and any selected text, can produce a follow-up question that names the page, panel and ID, for the agent to revise only that panel.
- Export saves the page as a 2× PNG, WebP or JPG long image, or prints it to PDF; controls, dialogs and walk bars are left out.

## References

`[text](source:id)` becomes normal text plus `<sup class="cite"><a href="#source-id">n</a></sup>`. Empty labels are allowed. Number sources by their first appearance in reading order, then append unused sources in declaration order. Repeated references keep their number. Source items contain only title, link or repository location.

Native diagram links retain real node, route and edge checks. Linked steps open the full Viewer already focused on the intended targets. Static SVG remains available for reading and printing. The page carries each Viewer compressed and inflates it on first open.

## Runtime and cost

`finalize explainer` runs validate, atomic deliver and check. Explainer delivery and acceptance require these three static gates; browser acceptance is outside this workflow. Compact and full receipts record the browser gate as not requested and not run. Native diagram types retain their prior behavior.

Code excerpts still read a pinned commit and actual file lines. Contained images and native HTML are frozen into the delivery. Check validates source/asset hashes, document references and native geometry; this protects the artifact contract rather than rating its conclusions.

Writing checks advise “把限定条件写进 scope 或来源” for qualifier wording in summary, reasons and body. Scope and sources are excluded. Unsupported author syntax fails with a line, component, reason and repair example.

## Examples and acceptance

- [Comparison](explainer/examples/comparison.md): modular monolith or microservices.
- [Mechanism](explainer/examples/mechanism.md): cache miss without a diagram.
- [Diagram](explainer/examples/diagram.md): cache miss with a native sequence and linked steps.

Build with `node docs/specs/explainer/prototypes/build.mjs /tmp/explainer-board`. No installation is required.

Required regression coverage: summary/reasons/scope parsing and bounds; first-panel placement; 12-column row sums and fixed spans; first-use citations and empty labels; qualifier exclusions; fast finalize receipts; unchanged native finalize; Git excerpt safety; data-chart reading and diagnostics; patch, packaged runtime, no-JavaScript, print and native target navigation; side-by-side steps and their wrap; walk-throughs, text-to-node links, follow-up questions, style menu and long-image export.

Run `node --test test/explainer-*.test.mjs` and `npm test`; browser coverage runs with `ARCHIFY_EXPLAINER_BROWSER_TESTS=1 node --test test/explainer-browser.test.mjs`. Measure all three fast finalizations. Tests confirm behavior; visual tuning remains a separate task.
