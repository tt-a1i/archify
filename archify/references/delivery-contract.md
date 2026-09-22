# Delivery contract

## Validate and deliver

`render` and direct renderer entry points print classified authoring failures
to stderr as readable diagnostics and exit 1. Input read/JSON parse failures
use `input/read` or `input/json-parse`; output filesystem failures use
`output/write` and identify the output path. Schema and layout failures keep
their existing rule codes. Use the advertised `validate --json` or
`deliver --json` interface for a machine receipt; `render` has no `--json` flag.
Unexpected implementation failures retain debugging information in human
mode and remain `internal/unclassified` in machine receipts.

Each output has three independent delivery metadata paths:

- `<output-stem>.delivery.json` records the latest completed attempt.
- `<output-stem>.delivery-pending.json` is the recovery journal for an attempt
  in progress.
- `<output-stem>.delivery-lock.json` serializes attempts targeting the same
  output.

`deliver` acquires the lock by exclusive `open(..., "wx")` before creating or
replacing the recovery journal. A successful exclusive create yields an
internal opaque ownership capability bound to that attempt. Journal creation,
failed-provenance recording, pair commit, rollback, journal finalization, and
lock release each verify the current capability inside the operation that
would mutate shared state. A rejected contender does not create a journal or
write failed provenance.

An existing lock is handled without automatic recovery:

| Observed lock state | Required `deliver` result |
| --- | --- |
| No directory entry | Attempt exclusive creation; only its success grants ownership. |
| Valid schema-v1 lock whose PID is running, or whose death cannot be established | Exit 1 with `delivery/concurrent-attempt`; preserve every shared path. |
| Valid schema-v1 lock whose PID is known to have exited | Exit 1 with `delivery/lock-stale`; preserve the lock, artifact, journal, and current provenance exactly. |
| Unreadable, malformed, symlink, dangling symlink, directory, or other non-regular lock entry | Exit 1 with `delivery/lock-invalid`; preserve the entry and every other shared path. |
| An acquired capability no longer matches the current lock or journal | Exit 1 with `delivery/ownership-lost`; stop all shared-path mutation. |
| The matching owner cannot remove its lock | Exit 1 with `delivery/lock-release`; preserve the lock. |

A `delivery/lock-stale` diagnostic identifies the absolute output and lock
paths plus the original PID and receipt ID. Recovery is deliberately explicit
and serial: stop all delivery attempts for that output, confirm that no active
delivery owns it and that the reported stale entry has not been replaced,
remove only the reported lock, then rerun `deliver`. Do not remove the artifact,
current provenance, or pending journal as part of stale-lock recovery.

The lock protocol targets Node.js 18 or later on a local filesystem with
cooperating Archify processes. PID, receipt, and file-identity comparisons are
defensive checks, not an atomic compare-and-swap. This contract does not claim
distributed-lock correctness on NFS, SMB, or other network filesystems, and it
cannot prevent an external process that ignores the protocol from replacing
shared paths.

After ownership is established, `deliver` creates the journal before rendering
and keeps it through the recoverable HTML/sidecar pair commit. It removes the
journal only after that commit completes. A validation, render, or pair-commit
failure, or a process interruption, may therefore leave a journal. The journal
is a safety barrier: `check`, `browser-check`, and `visual-check` fail closed
when any directory entry exists at the journal or lock path, including an
unreadable file, symlink, or dangling symlink. Run deliveries targeting the
same output path serially; one attempt must finish or be recovered before
another begins.

A successful sidecar has `schemaVersion: 1`, `status: "current"`,
`command: "deliver"`, a unique `receiptId`, the diagram `type`, an absolute
`input` path, an absolute `output` path matching the inspected
artifact, and specification/artifact SHA-256 and byte counts. Checkers treat a
missing, malformed, unsupported, or inconsistent field as invalid. They also
reject a sidecar symlink, including a dangling one. A checker binds provenance
to the artifact bytes it actually checks and verifies that binding again before
reporting success; a concurrent byte change fails.

If a currently verified owner fails after an older HTML exists, Archify writes
a new `status: "failed"` sidecar and leaves the journal until recovery is
complete. An unreadable old HTML does not prevent that marker; its artifact hash
and byte count may be absent. If the sidecar is locked or otherwise unwritable,
Archify keeps the prior sidecar rather than deleting evidence, and the journal
prevents checkers from trusting it. A rejected concurrent, stale, or invalid
lock attempt does not write failed provenance. If ownership is lost, Archify
reports `delivery/ownership-lost`, does not overwrite or remove the successor's
artifact, provenance, journal, or lock, and does not claim recorded failed
provenance; a failure receipt may report `provenance: "unrecorded"`. If every
metadata path is unavailable, the same unrecorded status applies; no tool can
preserve that fact across processes. Restore metadata-path access and complete
a successful `deliver` before trusting the output.

Artifacts with no sidecar, journal, or lock remain supported for backward
compatibility and for the lower-level `render` command. Their checker receipts
report `provenance: "unknown"`; use `--require-provenance` to turn that state
into a non-zero failure when the workflow requires a successfully delivered
artifact:

```bash
node bin/archify.mjs check <output.html> --require-provenance
node bin/archify.mjs browser-check <output.html> --json --require-provenance
```

Run `finalize` directly on a complete first candidate; its first gate validates that source before delivery. After a repair edit, rerun `finalize` with the same type, input/output paths, quality and repository-root arguments, omitting any earlier `--candidate-sha256` because the candidate changed. Its embedded validation checks the repaired candidate; use standalone `validate` only for focused diagnosis or an explicitly separate execution. CLI HTML output paths must end in `.html`, including after symbolic-link resolution.
Compare receipt paths must end in `.json`. Explicit CLI paths may be absolute or
outside the current working directory; authored `meta.output` remains confined
to that directory. A type mismatch fails before writing with
`output/cli-extension` or `output/cli-resolved-extension`. These checks prevent
accidental file-type overwrites; they do not sandbox explicit CLI directories
or prevent replacement of an existing artifact of the expected type.

Use final verified delivery only after the candidate is frozen:

```bash
node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json
```

Deliver reads the specification once, writes those exact bytes to a private same-directory candidate snapshot, renders that snapshot, runs the complete artifact checker, and only replaces the target after all artifact checks pass. The JSON receipt includes SHA-256 and byte counts for both `specification` and `artifact`.

For the ordinary agent handoff path, prefer the finalizer:

```bash
node bin/archify.mjs finalize <type> <candidate.json> <output.html> --quality showcase --json
```

`finalize` invokes verified `deliver` once, reuses its embedded showcase
validation result, then runs strict `check --require-provenance` and
`browser-check --require-provenance`. It stops at the first failed or skipped stage
and preserves that stage's full receipt. Its stdout is one compact JSON
object with gate statuses, bounded actionable diagnostics, artifact identity,
and evidence paths. The same compact object is written atomically to
`<output-stem>.finalize-summary.json`; use that file for normal failure repair.
Complete stage receipts and timings remain available for auditing in
`<output-stem>.finalize.json`. With `--out-dir`, both files are written there;
`--receipt <path.json>` overrides the full receipt path and derives a distinct
`<path>-summary.json`. Read the full receipt only when the compact summary is
truncated and its shown subjects and evidence cannot identify a coherent local
repair, or when complete audit evidence was explicitly requested. The compact
receipt reports `visualReview: "not-requested"`; ordinary acceptance does not create images or require a perceptual reviewer.

A passing finalizer receipt is sufficient evidence for all four gates. Merely
naming the gates or requiring each one to pass does not require replaying their
standalone commands. Replay an individual command only when the request
explicitly requires separate executions or focused failure diagnosis needs it.

The individual commands remain authoritative and backward compatible. Use
them directly for focused diagnosis, recovery, or when only one gate is
required. A finalize failure does not relax any gate and does not turn a
preserved older artifact into a current successful delivery.

`finalize` overlaps private Chrome startup with delivery and strict checking.
It loads the artifact only after those gates pass and current provenance is
verified. The browser gate retains every viewport, theme, and stability check;
the browser closes at completion or an earlier failure. Its full stage receipt
records `execution: "in-process"` and the equivalent standalone `command` for
replay. Use total finalize duration to compare performance because Chrome
startup overlaps the earlier stages.

The pair commit is recoverable, not a claim that two filesystem paths change
atomically or are durable across power loss. Journal finalization is part of
that commit: a caught failure while verifying or removing the journal rolls
back the replaced files when possible and while ownership remains current. If
ownership is lost, the old attempt immediately stops renaming, rolling back,
finalizing the journal, recording failure provenance, or cleaning up shared
paths. Any private staging or recoverable backups remain available and are
identified by the failure diagnostic. If restoration fails for another reason,
the failure receipt likewise identifies retained backups for recovery. A
process interruption can leave the journal, backups, or private staging behind;
checkers then fail closed. Follow the reported recovery evidence before rerunning
`deliver` serially on the same output. A failed attempt exits non-zero and never invokes an opener; it never
authorizes visual evidence collection.

If exclusive creation succeeds but lock initialization fails, Archify may
record failed provenance and remove the incomplete lock only while its
capability still identifies that exact entry. A replacement is preserved.
Filesystem and cleanup errors are reported separately from an active concurrent
delivery. An active, stale, unrecognized, or otherwise preserved lock
independently prevents checkers from accepting the prior artifact. Fix the
reported filesystem error before retrying, and use another output path if the
lock path contains unrelated data.

Lock release is part of delivery completion. If the artifact/provenance pair
has committed and the journal has finalized but the matching lock cannot be
removed, `deliver` exits 1 with `delivery/lock-release`, preserves the lock,
does not print a success receipt, and does not invoke an opener. The preserved
lock keeps strict checkers fail-closed. Only after pair commit, journal
finalization, and lock release all succeed may `deliver` exit zero, print its
success receipt, or run `--open`.

Run strict `check` after `deliver` exits zero. Run `browser-check` or optional
`visual-check` only after that strict check exits zero. A failed marker,
recovery journal, or delivery lock makes every checker fail before accepting
the preserved HTML; report the diagnostics and complete a successful recovery
delivery before collecting new browser evidence.

The delivery interface exposes four separate claims:

1. `deliver` proves deterministic artifact checks and byte identity.
2. `browser-check` collects required automated browser evidence from the exact artifact without capturing images.
3. `visual-check` optionally adds artifact-bound screenshots and a contact sheet.
4. Perceptual visual review records a human or image-capable reviewer's judgment.

Passing one claim never implies the others. Never claim that the deterministic receipt includes browser or perceptual review evidence.

## Recovering a failed comparison

`compare` commits an HTML artifact and its JSON receipt as a pair. If that commit
fails, it attempts to restore the previous files. A complete rollback removes
the temporary directory as usual.

If a previous file cannot be restored, compare exits non-zero with
`delta/commit-rollback-failed` and retains the recovery directory. In the JSON
failure receipt, `diagnostics[].evidence.recoveryDirectory` identifies that
directory and `recoveryFiles` lists `{ backup, target }` paths for the files whose
restoration failed. Human-readable diagnostics also print the recovery paths.

Resolve the filesystem error, inspect the current targets, and restore each
listed backup to its corresponding target before retrying. Keep the recovery
directory until both previous files have been recovered and verified; it can
also contain rejected candidate files, which must not be mistaken for backups.
Successful comparisons and failures before commit retain their normal cleanup.

## Automated browser evidence

`finalize` runs the required browser gate against the exact trusted HTML without
rerendering or modifying it. For focused diagnosis, the equivalent standalone
command is:

```bash
node bin/archify.mjs browser-check <output.html> --json --require-provenance
```

The zero-dependency command uses Chrome/Chromium through the DevTools pipe. It
measures light-theme containment at 1440×900, 1600×1000, 1920×1080, and
2048×1320, and verifies the endpoint light/dark theme plus READ/Still runtime
states. A requested theme that resolves to a different theme fails with measured
evidence. It creates one
`<output-stem>.browser-check.json` receipt and no screenshots or contact sheet.
Pass `--out-dir <dir>` to place the receipt in a separate evidence directory.
The receipt binds the artifact SHA-256 and byte count, identifies
`evidenceKind: "automated-browser"`, and reports
`visualReview: "not-requested"`.

Horizontal overflow always fails. Vertical overflow normally fails as well. One
bounded exception preserves readability for compiler-measured intrinsic-height
diagrams: after the adaptive Reader reaches its projected text floor and exposes
`data-reader-layout="adaptive"` with `data-reader-overflow="authored"`, normal
page-level vertical scrolling may pass. The SVG must also expose
`data-reader-fit="intrinsic-height"`, projected text must still pass, and the
receipt records `verticalScrollAccepted: true` with
`overflowDisposition: "readable-vertical-scroll"`. Missing declarations,
explicit authored viewBoxes, horizontal overflow, unreadable text, clipping, and
Viewer chrome collisions remain failures. Do not add an internal diagram
scroller or hide overflow.

`browser_evidence` in the handoff records only the outcome of this automated
command:

- `passed` maps from exit 0 and receipt `status: "pass"` after every required measurement completes and passes.
- `failed` maps from exit 1 and receipt `status: "fail"` when the inspection finds a defect, the command fails, or a runtime error leaves the evidence incomplete.
- `skipped` maps only from exit 2 and receipt `status: "skipped"` when Chrome/Chromium is unavailable and the inspection does not run.

Runtime failures leave incomplete evidence and must not be normalized to
`skipped`. They do not invalidate an already successful deterministic delivery.
Retry an environmental failure in a browser-capable execution context when
practical. Keep the packaged transport unchanged unless the failure reproduces
through that seam in a capable environment.

A provenance failure exits before browser inspection and persists a failed
browser-check receipt bound to the attempted artifact. If the failure receipt
cannot be written, the diagnostic names that incomplete evidence.

## Optional capture evidence

`visual-check` remains backward compatible for a requested or escalated
perceptual review:

```bash
node bin/archify.mjs visual-check <output.html> --json --require-provenance
```

It performs the same automated browser measurements, captures light/dark
screenshots at 1440×900 and 2048×1320, and writes four viewport PNG sidecars,
one relative-path HTML contact sheet, one PNG rendering of that contact sheet,
and one JSON receipt. `--out-dir <dir>` moves all of these sidecars together.
The single `.visual-check.contact.png` is the image-reader entry point; inspect
an individual viewport PNG only when the overview exposes a possible defect.
Its receipt reports `visualReview: "pending"` because captures do not themselves
make a perceptual judgment. Capture or provenance failure removes stale image
sidecars before recording failure so prior evidence cannot appear current.

## Optional opening

Add `--open` only when the user wants an immediate local preview. It runs after
the verified pair commit has completed, its recovery journal has been removed,
and the delivery lock has been released successfully. It uses one argument-array
OS opener with a five-second bound and records `open.status`. Keep it off for CI, unattended agents, and non-interactive
environments. Failure or unsupported opening does not invalidate delivery; its
status proves only whether the local opener invocation succeeded.

## Last-Good Live Preview

For an active desktop authoring loop only:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Preview watches one explicit input on loopback, binds each stable digest to a private snapshot, and advances only after the existing verified delivery pipeline passes. Invalid, half-written, deleted, or superseded input leaves the previous verified revision on screen and on disk. Identical bytes do not rebuild or reload.

The preview runtime ships inside the zero-dependency Skill ZIP and must work without `node_modules`.

Never start it by default. Do not use it for CI, unattended agents, remote sharing, or mobile use. `--no-open` is only for a user who will open the printed local URL or for loop testing. Stop it with Ctrl-C before handoff. Server state, port, source path, diagnostics, error text, and reload tokens must never enter the generated artifact or any export.

## Optional perceptual review

The ordinary path ends with the deterministic browser gate and reports
`visual_review: not_requested`. Escalate to perceptual review when any of these
conditions applies:

- the user explicitly requests an aesthetic or visual review;
- a template, renderer, or Viewer change needs visual regression evidence;
- a novel layout or browser diagnostic leaves low confidence;
- the run is selected for sampled audit or dogfood.

For an escalation, run `visual-check` on the current finalized artifact, inspect
its contact sheet with a capable image reader or human, and check both endpoint
themes, the default READ view, line crossings/corridors, label masks, node/card
fit, focus/search/passport closure, and export cleanliness. This review is
supplementary and never changes `browser_evidence`. An unconstrained browser
glance can support perceptual review only.

Report one truthful optional-review status:

- `visual_review: not_requested` — the default successful handoff.
- `visual_review: passed` — only after inspecting the rendered artifact.
- `visual_review: skipped (image reader unavailable)` — a requested or triggered review could not run.
- `visual_review: failed` — with the concrete visible defect.

For an escalated review, use `correction_rounds: 0`, `correction_rounds: 1`, or
`correction_rounds: 2`; never exceed two focused correction rounds. When review
is not requested, use `correction_rounds: 0`. Never report
`visual_review: passed` without inspecting the artifact. If perceptual review
changes the candidate, rerun `finalize` because the previous specification and
artifact receipts are no longer current.

## Handoff receipt

Return:

```text
diagram_type: architecture|workflow|sequence|dataflow|lifecycle
output: /absolute/path/to/file.html
specification_sha256: <receipt value>
artifact_sha256: <receipt value>
validation: 9/9 showcase, 0 errors, 0 warnings
browser_evidence: passed|failed|skipped
visual_review: not_requested|passed|skipped (image reader unavailable)|failed
correction_rounds: 0|1|2
```

Derive `browser_evidence` only from the latest artifact-bound `browser-check`
receipt, normally the stage embedded by `finalize`. Record optional capture or
manual browser work separately with its artifact binding, viewport/theme scope,
and observations; never use it or `visual_review` to overwrite the automated
status.

Opening, preview status, Share Cards, and other viewer exports are not validation claims.
