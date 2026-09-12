# Mermaid sequenceDiagram import

`archify import sequence` turns an existing Mermaid `sequenceDiagram` source
into typed Archify Sequence IR. The importer reads Mermaid as an interaction
trace — participants, ordered messages, direction, request/return distinction,
activation, and notes — and never copies Mermaid layout, theming, or styling.
The emitted JSON is an ordinary Sequence document: it continues through
`validate`, `render`, `preview`, and `deliver` unchanged.

```bash
archify import sequence checkout.mmd checkout.sequence.json
archify validate sequence checkout.sequence.json
archify deliver sequence checkout.sequence.json checkout.html
```

Without an output path the IR goes to stdout. With `--json` the command prints a
machine-readable receipt instead, and writes the IR only to the output file:

```bash
archify import sequence checkout.mmd checkout.sequence.json --json
```

```json
{
  "schemaVersion": 1,
  "command": "import",
  "source": "mermaid-sequence",
  "ok": true,
  "participants": 4,
  "messages": 5,
  "activations": 1,
  "notes": 1,
  "input": "/abs/path/checkout.mmd",
  "output": "/abs/path/checkout.sequence.json"
}
```

A failing import exits non-zero and returns the same receipt shape with
`"ok": false` and a populated `diagnostics[]`. Without `--json` the diagnostics
are printed to stderr in the usual `[code] message Fix: ...` form. The importer
never writes a partial artifact: a source is either fully imported or fully
rejected.

## Runnable example

`archify/test/fixtures/sequence-import/valid-checkout.mmd` exercises every
supported construct at once:

```text
%% Checkout interaction exported from an existing Mermaid trace.
sequenceDiagram
    autonumber
    actor shopper as Shopper
    participant web as Storefront
    participant api as Orders API
    participant queue as Job Queue
    shopper->>web: open checkout
    web->>+api: POST /orders
    Note right of api: idempotency key required
    api-)queue: enqueue fulfilment
    api-->>-web: 202 accepted
    web-->>shopper: show confirmation
```

```bash
cd archify
node bin/archify.mjs import sequence \
  test/fixtures/sequence-import/valid-checkout.mmd /tmp/checkout.sequence.json
node bin/archify.mjs validate sequence /tmp/checkout.sequence.json
```

Other fixtures in the same directory are runnable in the same way:
`valid-basic`, `valid-arrow-variants`, `valid-explicit-activation`,
`valid-implicit-participants`, `valid-hyphenated-ids`,
`valid-frontmatter-title`, and `valid-autonumber-start-step`.

## Supported subset

| Mermaid | Archify Sequence IR |
|---|---|
| `sequenceDiagram` | required first statement |
| `---` front matter with `title:` | `meta.title` |
| `title: Some title` / `title Some title` | `meta.title` |
| `%% comment` | ignored |
| `participant id` | participant, `type: "backend"`, `label` from the name |
| `participant id as Label` | participant, `label` from the alias |
| `actor id` / `actor id as Label` | participant, `type: "external"` |
| a name used only in a message | participant created at first mention, `type: "backend"` |
| `A->>B: text` and the other arrows below | `messages[]` entry in source order |
| `A->>+B: text` | opens an `activations[]` span on the recipient |
| `A-->>-B: text` | closes the open `activations[]` span on the sender |
| `activate A` / `deactivate A` | opens / closes an `activations[]` span |
| `Note left of A:` / `Note right of A:` / `Note over A,B:` | `messages[].note` on the preceding message |
| `autonumber` / `autonumber 10` / `autonumber 10 5` / `autonumber off` | numeric prefix on each message label |

Everything else is rejected. See [Rejected constructs](#rejected-constructs).

### Arrow mapping

Mermaid's only per-message signal is line style plus arrow head. Solid means a
forward call, dotted means a reply, and the open or cross head means the sender
does not wait for a result. Those three facts map onto the Sequence schema's
visual kinds:

| Mermaid arrow | Mermaid meaning | Archify `variant` |
|---|---|---|
| `->` | solid line, no arrowhead | `default` |
| `->>` | solid line with arrowhead | `default` |
| `-->` | dotted line, no arrowhead | `return` |
| `-->>` | dotted line with arrowhead | `return` |
| `-)` | solid line, open arrowhead | `dashed` |
| `--)` | dotted line, open arrowhead | `dashed` |
| `-x` | solid line, cross head | `dashed` |
| `--x` | dotted line, cross head | `dashed` |

The importer never emits `emphasis` or `security`. Those two kinds say "this is
the main path" and "this is an authorization step" — judgements Mermaid does not
encode anywhere in its syntax. Inferring them from label prose would invent a
fact the source never stated. Add them by editing the imported JSON.

### Participant types

Mermaid distinguishes only `actor` from `participant`, so the importer maps
`actor` to `external` and `participant` to `backend` and stops there. It does
not guess `database`, `cloud`, `security`, or `messagebus` from a participant's
name. Change `participants[].type` in the imported JSON when you want the
component sigils to carry more meaning.

### Identifiers

Mermaid names are free text; Archify ids must match
`^[a-zA-Z][a-zA-Z0-9_-]*$`. The importer derives an id from the Mermaid name and
keeps the original name visible as the participant `label`, so no meaning is
lost. Characters outside the id pattern become `-`, a name that cannot yield a
leading letter becomes `p<n>`, and two different names that would derive the
same id get a `-2`, `-3` suffix rather than collapsing into one participant.

### Layout

Mermaid layout is not imported. The importer generates the coordinates the
Sequence renderer validates: participants in declaration or first-mention order,
messages 42px apart starting at `y: 180`, and a `meta.viewBox` sized to fit both
the participant columns and the timeline. When a participant label does not fit
the fixed 86px box, the importer sets `meta.column_fit: "spread"` and widens the
viewBox instead of shortening the label.

## Rejected constructs

Mermaid can express control flow, grouping, and styling that the Sequence schema
has no typed home for. Dropping those statements would silently change what the
diagram claims, so every one of them fails with a stable `code`, the offending
line and column, the source text as evidence, and executable `supportedFixes`.

| Construct | Diagnostic code |
|---|---|
| `loop` | `import/unsupported-keyword-loop` |
| `alt` / `else` | `import/unsupported-keyword-alt` / `-else` |
| `opt` | `import/unsupported-keyword-opt` |
| `par` / `and` | `import/unsupported-keyword-par` / `-and` |
| `critical` / `option` | `import/unsupported-keyword-critical` / `-option` |
| `break` | `import/unsupported-keyword-break` |
| `rect` | `import/unsupported-keyword-rect` |
| `box` | `import/unsupported-keyword-box` |
| `create` / `destroy` | `import/unsupported-keyword-create` / `-destroy` |
| `link` / `links` / `properties` / `details` | `import/unsupported-keyword-link` and friends |
| `accTitle` / `accDescr` | `import/unsupported-keyword-acctitle` / `-accdescr` |
| `%%{init: ...}%%` and other directives | `import/unsupported-directive` |
| `<<->>` / `<<-->>` bidirectional arrows | `import/sequence-unsupported-arrow` |
| `A->>A: text` self-messages | `import/sequence-self-message` |
| front matter keys other than `title` | `import/sequence-unsupported-frontmatter` |

Because every block opener is rejected, a bare `end` is reported as
`import/sequence-unexpected-end` rather than being ignored.

Malformed sources are reported the same way and never as a stack trace:

| Problem | Diagnostic code |
|---|---|
| no `sequenceDiagram` line | `import/sequence-missing-declaration` |
| unclosed front matter | `import/sequence-unclosed-frontmatter` |
| message with no `:` separator | `import/sequence-missing-message-separator` |
| message with an empty label | `import/sequence-empty-message-label` |
| message missing a source or target | `import/sequence-missing-message-endpoint` |
| participant declared with an empty name | `import/sequence-empty-participant-name` |
| participant alias that resolves to an empty label | `import/sequence-empty-participant-label` |
| statement that is neither a message nor a supported keyword | `import/sequence-unknown-statement` |
| `activate` / `deactivate` / note naming an unknown participant | `import/sequence-unknown-participant` |
| `deactivate` with no open activation | `import/sequence-unbalanced-deactivate` |
| `activate` with no following message | `import/sequence-dangling-activate` |
| `activate` / `deactivate` with no message between them | `import/sequence-empty-activation` |
| the same participant declared twice | `import/sequence-duplicate-participant` |
| a note before the first message | `import/sequence-unattached-note` |
| a note with no text | `import/sequence-empty-note` |
| `autonumber` with non-numeric arguments | `import/sequence-invalid-autonumber` |
| no messages at all | `import/sequence-no-messages` |
| fewer than two participants | `import/sequence-too-few-participants` |
| a participant label too wide for the widest supported box | `import/sequence-participant-label-too-long` |
| a label containing a control character or unpaired surrogate | `import/sequence-unsafe-label` |

## Untrusted input

Mermaid source is treated as untrusted text.

- Labels keep their original characters as literal text. `<script>`, quotes,
  brackets, and HTML entities are never interpreted; they are escaped when the
  renderer writes the artifact and they cannot alter the emitted JSON structure.
- Identifiers are re-derived rather than passed through, so a crafted Mermaid
  name cannot produce an id the schema would reject or one that silently
  overwrites another participant.
- Control characters and unpaired surrogates are rejected instead of being
  repaired silently, because they would otherwise travel into the SVG/XML
  artifact.
- Diagnostics echo source text with control characters replaced and the excerpt
  truncated, so a hostile source cannot corrupt a terminal or a receipt reader.

## Notes on fidelity

- Notes annotate a message. A `Note` before the first message has no message to
  attach to and is rejected rather than dropped; several notes on the same
  message are joined with ` / `.
- `autonumber` has no typed home in the Sequence schema, so the numbers are
  written into the message labels (`1. open checkout`). `autonumber off` stops
  the numbering from that line onward.
- An activation left open at the end of the source runs to the end of the
  timeline, matching how Mermaid draws it.
- A participant name containing a hyphen can look like an arrow. The importer
  prefers the split whose endpoints are already declared participants, so
  declaring `participant web-x-app as Web App` before using it keeps the name
  intact.
