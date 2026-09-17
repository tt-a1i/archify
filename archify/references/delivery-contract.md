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
is a safety barrier: `check` and `visual-check` fail closed when any directory
entry exists at the journal or lock path, including an unreadable file,
symlink, or dangling symlink. Run deliveries targeting the same output path
serially; one attempt must finish or be recovered before another begins.

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
node bin/archify.mjs visual-check <output.html> --json --require-provenance
```

Use `validate` after every candidate edit. CLI HTML output paths must end in `.html`, including after symbolic-link resolution.
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

Run strict `check` after `deliver` exits zero. Run `visual-check` only after that
strict check exits zero. A failed marker, recovery journal, or delivery lock
makes both commands fail before accepting the preserved HTML; report the
diagnostics and complete a successful recovery delivery before collecting new
visual evidence.

The delivery interface exposes three separate claims:

1. `deliver` proves deterministic artifact checks and byte identity.
2. `visual-check` collects automated browser evidence from the exact artifact.
3. Perceptual visual review records a human or image-capable reviewer's judgment.

Passing one claim never implies either of the others. Never claim that the deterministic receipt includes visual review. It does not include browser evidence either.

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

After delivery, inspect the exact trusted HTML without rerendering or modifying
it:

```bash
node bin/archify.mjs visual-check <output.html> --json --require-provenance
```

The zero-dependency command uses Chrome/Chromium through the DevTools pipe. It
measures light-theme containment at 1440×900, 1600×1000, 1920×1080, and
2048×1320, then captures light/dark screenshots at 1440×900 and 2048×1320. It
writes four PNG sidecars, one relative-path HTML contact sheet, and one JSON
receipt beside the artifact by default — pass `--out-dir <dir>` to write all of
them into a separate directory instead (created if missing) when a project
keeps its testing/evidence artifacts apart from the delivered `.json`/`.html`
result pair. When that directory differs from the artifact directory, the
receipt records its absolute path as `sidecars.directory`; sidecar filenames
resolve there, otherwise beside `artifact.path`. The contact sheet keeps its
image links relative for portability. The receipt binds the source artifact SHA-256 and
byte count, identifies `evidenceKind: "automated-browser"`, records READ plus
Still runtime state, and always reports `visualReview: "pending"`; automated
browser evidence cannot claim perceptual review.

`browser_evidence` in the handoff records only the outcome of this automated command:

- `passed` maps from exit 0 and receipt `status: "pass"` only after every required measurement and capture completes and passes.
- `failed` maps from exit 1 and receipt `status: "fail"` when the inspection finds a defect, the command fails, or a runtime/capture error leaves the evidence incomplete.
- `skipped` maps only from exit 2 and receipt `status: "skipped"` when Chrome/Chromium is unavailable and the inspection does not run.

Runtime or capture failures leave incomplete evidence and must not be normalized to `skipped`. Failed or skipped capture runs remove stale
image/contact-sheet sidecars rather than presenting prior evidence as current.
They do not invalidate an already successful deterministic delivery, and they
do not turn a perceptual visual review into passed or failed. Retry an
environmental failure through the supported command in a browser-capable
execution context when practical. Keep the packaged transport unchanged unless
the failure reproduces through that seam in a capable environment.

A provenance failure exits before browser inspection. That early exit removes
stale screenshots and the contact sheet, then persists a failed visual-check
receipt bound to the attempted artifact. If any stale-evidence cleanup or
failure-receipt write cannot complete, the diagnostic names that incomplete
cleanup; do not present remaining sidecars as current evidence.

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

## Perceptual delivery gate

Automated validation and browser evidence cannot prove visual polish. After deterministic delivery, inspect the actual HTML in a capable browser or render the evidence screenshots with an image reader. Check both themes when changed, the default READ view, line crossings/corridors, label masks, node/card fit, focus/search/passport closure, and export cleanliness.

For the default standalone desktop viewer, measure 1440×900, 1600×1000, and 1920×1080. When the artifact is intended for a large desktop display, also measure 2048×1320. A first-screen pass requires `document.documentElement.scrollWidth <= window.innerWidth` and `scrollHeight <= window.innerHeight` at every checked size. At the largest checked viewport, inspect the rendered composition for a conspicuous empty lower band: the main panel and necessary conclusion cards should use the available height as a balanced whole, not collapse into a shallow strip. If a desktop viewport overflows, repair the authored composition by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. Do not hide overflow, clip content, introduce an internal diagram scroller, or reduce node/label typography to make the measurement pass. Narrow/mobile containment may retain vertical page scrolling.

A manual browser record is supplementary to the automated status. Reproducing the same coverage requires all four exact viewport measurements, both endpoint themes, and an artifact-bound record of the inspected SHA-256 and byte count. It never changes `browser_evidence`: when Chrome/Chromium is unavailable, that status remains `skipped` even when the manual browser record is complete and `visual_review: passed`; an automated `failed` result likewise remains `failed`. An unconstrained browser glance can support perceptual review only.

Report exactly one truthful status:

- `visual_review: passed` — only after inspecting the rendered artifact.
- `visual_review: skipped (image reader unavailable)` — when no capable visual surface exists.
- `visual_review: failed` — with the concrete visible defect.

Use `correction_rounds: 0`, `correction_rounds: 1`, or `correction_rounds: 2`; never exceed a maximum of two focused correction rounds. Never report `visual_review: passed` without inspecting the artifact.

If visual review changes the candidate, validation and delivery must run again because the prior frozen specification receipt is no longer current.

## Handoff receipt

Return:

```text
diagram_type: architecture|workflow|sequence|dataflow|lifecycle
output: /absolute/path/to/file.html
specification_sha256: <receipt value>
artifact_sha256: <receipt value>
validation: 9/9 showcase, 0 errors, 0 warnings
browser_evidence: passed|failed|skipped
visual_review: passed|skipped (image reader unavailable)|failed
correction_rounds: 0|1|2
```

Derive `browser_evidence` only from the latest artifact-bound `visual-check` receipt. Record any manual browser work separately with its artifact binding, viewport/theme scope, and observations; never use it or `visual_review` to overwrite the automated status.

Opening, preview status, Share Cards, and other viewer exports are not validation claims.
