# Delivery contract

## Failed finalize and candidate repair

`finalize` stops at the first non-passing gate. Use compact stdout or `evidence.summaryReceipt`; read its full sidecar only when the summary lacks evidence needed for a coherent repair. A receipt with four artifact checks is basic validation, not showcase acceptance: require all nine checks, zero composition errors, and zero warnings. Fix `meta.quality_profile` and schema errors before geometry.

For a validation failure, edit the existing JSON in the connected neighborhood named by diagnostics before rerunning a command. Preserve requested semantics, meaningful labels, source evidence, and fixed or agreed topology. Several routes sharing nodes call for one placement repair; read [Architecture layout repair](architecture-layout-repair.md) for that case. Reflow a blocked main path rather than nudging unrelated labels. Keep unrelated geometry when its composition already reads clearly. Use `--layout-json` before editing only when compact evidence lacks needed measurements. Workflow v2 uses its stable compiler receipt, not solver internals, as authoring evidence.

After the edit, rerun the complete `finalize` command with `--quality showcase` and, for repository-backed work, `--repo-root <repo-root>`. If the output path already has browser evidence from another candidate, use a fresh `--out-dir <output-stem>.review-<revision>` for both the new `finalize` and any `visual-check`. Omit an earlier `--candidate-sha256` after editing because it binds the previous candidate. Compare diagnostics by code, subject, stage, and evidence, never by declining error count alone. If an issue survives two focused repairs, inspect measured geometry or the relevant contract; after one evidence-based retry, report the concrete gap.

Use standalone `validate` only for focused diagnosis, passing `--repo-root` for repository-backed work. Its passing receipt marks `candidateFrozen: true`; run `nextAction.arguments`, replacing only `<output.html>`, without editing, revalidating, or rereading the candidate. Retry later environmental or evidence failures against those frozen bytes. A measured reason to edit creates a new candidate and calls for the complete `finalize` without the old hash.

A passing `validate --json` receipt may also include `viewportProjection`. This field is informational and never changes validation success, candidate freezing, or the next action. `status: "certain-overflow"` means the static Reader contract proves that the page already exceeds the 1440x900 desktop reference viewport before card height is counted; the receipt records the viewBox, projected SVG size, fixed chrome, and lower-bound overflow. `status: "undetermined"` means static rules cannot prove either fit or overflow because adaptive Reader sizing, card wrapping, and browser layout still matter. It is not a pass claim. In both cases `browserMeasured: false` is explicit; use `finalize` and `visual-check` for delivered browser evidence.

## Validate and deliver

`render` and direct renderer entry points print classified authoring failures
to stderr as readable diagnostics and exit 1. Input read/JSON parse failures
use `input/read` or `input/json-parse`; output filesystem failures use
`output/write` and identify the output path. Schema and layout failures keep
their existing rule codes. Use the advertised `validate --json` or
`deliver --json` interface for a machine receipt; `render` has no `--json` flag.
Unexpected implementation failures retain debugging information in human
mode and remain `internal/unclassified` in machine receipts.

Each delivered output has two artifact-specific metadata paths. When an output
stem is too long for those derived filenames, Archify shortens it and appends a
stable hash:

- `<output-stem>.delivery.json` records the latest completed attempt.
- `<output-stem>.delivery-pending.json` is the recovery journal for an attempt
  in progress.

For a literal artifact stem that already matches Archify's reserved bounded-name
marker, a pre-namespace raw provenance sidecar remains a read fallback when the
encoded sidecar is absent. A pre-namespace raw pending journal is an independent
fail-closed barrier: it blocks checks and redelivery even when an encoded pending
journal also exists, and neither journal is silently replaced.

One directory-wide `.archify-delivery-lock.json` serializes every delivery that
resolves into the same physical output directory. This deliberately prevents
case, Unicode-normalization, Windows short-name, and symbolic-link aliases from
creating independent owners for one filesystem location. The tradeoff is that
deliveries to different artifact names in one directory also run serially;
provenance and pending journals remain artifact-specific.

For migration safety, Archify also detects and preserves a legacy
`<output-stem>.delivery-lock.json` beside the requested artifact. An existing
legacy entry is a fail-closed recovery barrier. While a new delivery owns the
directory mutex, it also holds temporary legacy-format fences for the requested
spelling and an existing artifact's physical target spelling. It acquires the
directory lock first, then all required compatibility fences before writing a
journal or artifact, and removes the directory lock before those fences during
release. This blocks an older Archify binary using
either known spelling from entering the delivery. A legacy fence whose raw
HEAD-era filename exceeds the host component limit is omitted because the old
binary could not create that lock or deliver that artifact on the host either.

`deliver` acquires the lock by exclusive `open(..., "wx")` before creating or
replacing the recovery journal. A successful exclusive create yields an
internal opaque ownership capability bound to that attempt. Journal creation,
failed-provenance recording, pair commit, rollback, journal finalization, and
lock release each verify the current capability inside the operation that
would mutate shared state. A rejected contender does not create a journal or
write failed provenance.

An existing directory or legacy lock is handled without automatic recovery:

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
and serial: stop all delivery attempts for that physical output directory,
confirm that no active delivery owns it and that the reported stale entry has
not been replaced, remove only the reported lock, then rerun `deliver`. Do not
remove an artifact, current provenance, or pending journal as part of
stale-lock recovery.

The lock protocol targets Node.js 18 or later on a local filesystem with
cooperating Archify processes. PID, receipt, and file-identity comparisons are
defensive checks, not an atomic compare-and-swap. Compatibility fences cover
the requested spelling and an existing physical-target spelling; they cannot
enumerate arbitrary hard-link names or previously unknown filesystem aliases,
so mixed-version delivery through such aliases remains out of scope. This
contract does not claim distributed-lock correctness on NFS, SMB, or other
network filesystems, and it cannot prevent an external process that ignores
the protocol from replacing shared paths.

Every no-clobber HTML publisher (`render`, `deliver`, `compare`, and `preview`)
captures the requested directory entry, canonical write slot, physical parent,
and existing target type, device/inode identity, and mode before staging, then
revalidates that snapshot immediately before replacement. An existing write
target must be a regular file with exactly one hard-link name. A target with
multiple hard-link names fails closed with `output/target-hardlinked`: replacing
the requested name cannot update unknown sibling names as one publication.
Hard links remain supported for read identity and input/alias collision checks;
they are unsupported only as write targets. A symbolic link to a single-link regular
file remains supported: publication preserves the symbolic-link entry and
applies the same protocol to its resolved target. Directory, FIFO, socket,
device, changing mode, new claimant, and indeterminate identity cases fail
before replacement.

Publication is no-clobber and recoverable, not crash-atomic replacement of an
existing target. To avoid overwriting a claimant that appears after the last
identity check, Archify first retains the bound old file in a private recovery
backup, removes the public name through identity-bound quarantine, and then
creates the new public name with an exclusive hard link. A caught failure rolls
back when the public slot and recovery binding still permit it. A process
interruption between those namespace operations can instead leave the public
path absent while the verified previous bytes remain in an adjacent private
recovery backup. Single-artifact publication records the original slot/alias
identity and backup inode, mode, SHA-256, and byte count in private
`.archify-remove-*/publication-recovery-v1.json`, beside `previous`. To make a
specific interrupted publication visible again, stop concurrent writers and run:

```bash
node bin/recover-output.mjs /absolute/path/to/.archify-remove-<id> --json
```

This is explicit recovery, not a directory scanner. Before linking, the helper
checks for a changed parent or alias, an altered/hardlinked record or backup,
digest or inode mismatch, and any existing public target. It restores only by
no-clobber hard link, so a new claimant is preserved rather than overwritten;
it never recursively removes unknown entries. A completed recovery is
idempotent. The record is evidence to be independently verified, not an
authority to restore arbitrary private bytes: the helper accepts it only from
the recorded generated child of the original physical target parent, with the
same directory identity. Name the exact directory reported by the interrupted
process and inspect an uncertain record manually. A non-cooperating process can
still swap pathnames after those checks and before Node.js `linkSync`; Node does
not expose a descriptor-bound link operation. Post-link identity verification
then fails closed and retains recovery evidence, rather than claiming recovery
or deleting an uncertain name. If recovery itself is interrupted after the
link, the old public bytes and private backup can both remain; a later recovery
run preserves the public target and needs explicit operator resolution. The
record is fsynced before the old public name is retired on platforms supporting
directory sync, and the tested guarantee is recovery after a killed process;
this is not a claim of power-loss, storage-controller, NFS, or SMB durability.
Paired flows retain their backup in private transaction staging. For `deliver`,
the pending journal and lock keep strict checkers fail-closed. The portable
Node.js filesystem API has no pathname
compare-and-swap that both replaces an existing name atomically and refuses to
overwrite a late claimant: `rename` would close the visibility gap only by
overwriting that claimant.

After ownership is established, `deliver` creates the journal before rendering
and keeps it through the recoverable HTML/sidecar pair commit. It removes the
journal only after that commit completes. A validation, render, or pair-commit
failure, or a process interruption, may therefore leave a journal. The journal
is a safety barrier: `check`, `browser-check`, and `visual-check` fail closed when any directory
entry exists at the journal or lock path, including an unreadable file,
symlink, or dangling symlink. Run deliveries targeting the same physical output
directory serially; one attempt must finish or be recovered before another
begins.

A successful sidecar has `schemaVersion: 1`, `status: "current"`,
`command: "deliver"`, a unique `receiptId`, the diagram `type`, an absolute
`input` path, an absolute `output` path matching the inspected
artifact, and specification/artifact SHA-256 and byte counts. Checkers treat a
missing, malformed, unsupported, or inconsistent field as invalid. They also
reject a sidecar symlink, including a dangling one. A checker binds provenance
to the artifact bytes it actually checks and verifies that binding again before
reporting success; a concurrent byte change fails. The provenance directory
entry itself must be a single-link regular file: `deliver` and strict check fail
closed with `delivery/provenance-hardlink-unsupported` when it has another hard
link, without scanning for or guessing the sibling name.

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

## Output path contracts

Archify intentionally separates durable authored paths from command-line paths:

- Required authored `meta.output` is a portable POSIX-relative path such as
  `reports/diagram.html`. It uses `/`, ends in a non-empty `.html` basename,
  and cannot contain an absolute or drive-relative prefix, URI, backslash,
  empty or dot segment, control character, unpaired UTF-16 surrogate, Windows
  alternate-data-stream separator or invalid filename character, trailing dot
  or space, DOS device name, or a component over either the 255-byte UTF-8 or
  255-code-unit UTF-16 limit. It resolves from the current working directory
  and must remain physically inside that directory, with an `.html` target,
  after symbolic links are followed. The durable output/archive profile also
  conservatively rejects a Windows 8.3 short-name shape such as `PROGRA~1`;
  descriptive repo/Git POSIX paths use a separate profile and are exempt.
- Explicit CLI output arguments use the active host's native syntax. They may
  be relative or absolute, use native separators, and resolve outside the
  current working directory. On Windows, ordinary drive-absolute, UNC, and
  relative paths (including ordinary `.` and `..` navigation) are supported.
  A system-resolved 8.3 spelling of an existing file or directory is accepted
  when Archify can prove its physical identity; this native alias support does
  not relax the durable output/archive profile's 8.3-shaped-name rejection.
  Extended-length paths are limited to raw backslash-only `\\?\C:\...` and
  `\\?\UNC\server\share\...` forms without dot segments; device namespaces,
  malformed roots, drive-relative paths such as `C:file.html`, current-drive
  roots such as `\file.html`, alternate data streams, reserved device names,
  invalid or trailing filename characters, and overlong components fail
  closed. POSIX CLI paths retain POSIX filename rules rather than inheriting
  Windows spelling restrictions. Every host rejects NUL, unpaired surrogates,
  and components that exceed its supported bound.

These contracts are not interchangeable: an explicit CLI output does not hide
an invalid durable `meta.output` (including a missing value), and `validate`
checks the authored output even when it does not publish to that path. A
workflow v1-to-v2 migration may explicitly receive a portable durable
replacement through `migrate workflow old.json new.json --to-schema 2 --output
reports/diagram.html`; that value is written only to its separate verified v2
destination. This migration-candidate exception does not repair the source or
bypass any non-output schema or compiler error. For every other repair, add a
portable POSIX-relative `.html` path to `meta.output`; no schema-version change
is otherwise required.

Run `finalize` directly on a complete first candidate and after every repair edit. Its embedded validation checks the candidate before delivery; use standalone `validate` only for focused diagnosis. After an edit, omit any earlier `--candidate-sha256`, which binds the previous candidate. CLI HTML output paths must end in
`.html`, including after symbolic-link resolution. Compare receipt paths must
end in `.json`. A type mismatch fails before writing with
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
receipt reports `visualReview: "not-requested"`; the automated gate does not create images or require a perceptual reviewer. A compact `visualReviewRecommendation` retains positive crossover and route-detour metrics from the strict check so the author can apply the review escalation below without reading the full receipt. A recommendation does not change the machine exit code or claim that review happened. Its `affectedRoutes` identifies crossing pairs and detours (up to eight of each, with a truncation flag); the full strict-check `composition.routeReview` retains all affected relationships. Use these IDs to trace the routes in the captured default viewport. Detours may include `directCorridorBlockers`, identifying nodes between aligned endpoints. These are geometric review clues, not new validation failures or inferred main-path semantics. For a blocked main path or several tangled routes, follow [Architecture layout repair](architecture-layout-repair.md) and reflow the connected scene before tuning individual sides or labels. Preserve every semantic fact; retain unrelated positions only when their surrounding composition is already accepted.

For a measured automatic Architecture with a large unused leading area, the
compact receipt may include `layoutReviewRecommendation`. Its
`composition.leadingSpace` evidence accounts for nodes, boundary titles,
routes and labels. Check whether that space is intentional; if not, reposition
the connected scene while preserving meaning and user-fixed geometry, then
finalize again. This suggestion changes no gate or exit status and requires
no screenshot. A fixed canvas or uncertain measurement receives no suggestion.

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
reported filesystem error before retrying, and use another physical output
directory if the lock path contains unrelated data.

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
2048×1320, and verifies the requested light theme at all four viewports, the dark
theme at both endpoints, and READ/Still runtime states. A requested theme that
resolves to a different theme fails with measured evidence. It creates one
`<output-stem>.browser-check.json` receipt and no screenshots or contact sheet.
Pass `--out-dir <dir>` to place the receipt in a separate evidence directory.
The receipt binds the artifact SHA-256 and byte count, identifies
`evidenceKind: "automated-browser"`, and reports
`visualReview: "not-requested"`.

Horizontal overflow always fails. Normal document-level vertical scrolling is
accepted only with a renderer-declared contract and measured readable text.
Automatic canvases declare `data-reader-fit="intrinsic-height"`; their adaptive
Reader must reach its readable width and expose `data-reader-overflow="authored"`.
Architecture with an explicit `meta.viewBox` instead declares
`data-diagram-type="architecture"` and `data-reader-fit="authored-height"`:
its SVG coordinates, aspect ratio and existing Reader width behavior stay
unchanged. Its full SVG must remain inside the diagram panel without internal
scrolling or clipping, and the document must permit vertical scrolling.
The receipt records `verticalScrollAccepted: true` and
`overflowDisposition: "readable-vertical-scroll"`. Missing or unknown declarations,
explicit viewBoxes in other modes, unreadable text, horizontal overflow,
clipping and Viewer chrome collisions remain failures. Do not add an internal
diagram scroller or hide overflow.

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

Both browser commands inspect the exact delivered HTML without modifying or rerendering it.

## Optional capture evidence

`visual-check` remains backward compatible for a requested or escalated
perceptual review:

```bash
node bin/archify.mjs visual-check <output.html> --summary --require-provenance
```

`--summary` returns compact JSON with all diagnostics and absolute paths to the complete receipt, contact sheet, and every screenshot. For a chosen visual review, inspect the relevant captures; capture success is not perceptual approval. `--json` retains the full receipt output for existing consumers. Both modes run the same checks and keep the same exit status. If cleanup fails after publication, the summary retains the final failure diagnostics and `publication` recovery details; the linked receipt records the earlier committed evidence.

It performs the same automated browser measurements, captures light/dark
screenshots at 1440×900 and 2048×1320, and writes four viewport PNG sidecars,
one relative-path HTML contact sheet, and one JSON receipt. `--out-dir <dir>` moves all of these sidecars together.
Open the HTML contact sheet in a browser or inspect the viewport PNGs with an image reader. Its receipt reports `visualReview: "pending"` because captures do not themselves
make a perceptual judgment. Capture and provenance failures follow the ownership rules below.

The receipt, contact sheet, and four PNGs form one owned evidence set. Before
capture, `visual-check` freezes every requested directory entry, its
canonical write slot and physical parent, and the target's absent/file state,
type, device/inode identity, and mode. Hard-linked evidence targets are not safe
write targets. All candidate files are created exclusively inside one random,
private staging directory beneath the physical evidence directory; the receipt
is published last. Each staged candidate must have exactly one hard-link name
before publication. The no-clobber publish link temporarily gives the staged
and final names a link count of two; unlinking the verified staged name must
leave the final entry with a link count of one. An unexpected external hard
link fails closed and its alias is never removed.

Chrome inspects one identity- and content-checked copy of the captured artifact
in a private local temporary directory, so browser file loading does not depend
on UNC or long-path support. The six publication candidates remain on the
evidence volume. Both temporary directories are cleaned without recursively
deleting unknown contents; retained entries include their recovery locations.

Immediately before committing anything, `visual-check` re-resolves and verifies
the complete six-path set. An absent-path claimant, existing-path replacement,
symbolic-link or dangling-link retarget, parent-topology change, hard link, or
indeterminate identity fails closed with `viewer/evidence-path-conflict`. The
claimant and every other final evidence path remain untouched. Cleanup removes
only this run's staged or published entries after rechecking their captured
identities; a changed or unknown entry is preserved.

An existing visual evidence set is replaceable only when a regular
`visual-check` receipt proves ownership of the same artifact and evidence
directory, and its exact sidecar manifest matches every existing contact-sheet
or PNG byte count and SHA-256 digest. A missing, malformed, unknown, mismatched,
or incomplete ownership record never authorizes deletion. Failed and skipped
runs retire prior screenshots/contact sheets only as part of the same verified
transaction when that ownership proof succeeds; otherwise they preserve all
unknown evidence and report `viewer/evidence-path-conflict`.

This rule also applies when Chrome is unavailable or provenance fails before
browser inspection: neither path may blindly delete stale-looking evidence. A
verified owned set may be recoverably retired before publishing a skipped or
failed receipt; unowned evidence remains intact. These outcomes do not invalidate an already
successful deterministic delivery and do not turn a perceptual visual review
into passed or failed. Retry an environmental failure through the supported
command in a browser-capable execution context when practical. Keep the
packaged transport unchanged unless the failure reproduces through that seam in
a capable environment.

`browser-check` applies the same private-snapshot, identity, ownership, and no-clobber rules to its single JSON receipt. Its namespace is separate from `visual-check`, so a browser-only rerun cannot remove capture evidence.

## A new candidate at an existing output path

Browser evidence belongs to exact artifact bytes. After editing a candidate whose previous HTML already has browser evidence, choose a fresh evidence directory before running the next `finalize`; this preserves the old receipts and captures without an avoidable ownership-conflict retry:

```bash
node bin/archify.mjs finalize architecture candidate.json diagram.html --quality showcase --repo-root <root> --out-dir diagram.review-2 --json
node bin/archify.mjs visual-check diagram.html --out-dir diagram.review-2 --summary --require-provenance
```

Keep the requested HTML path stable. Use a new revision directory for each changed candidate, and retain the same directory for retries of unchanged bytes. For a diagram without repository evidence, omit `--repo-root`. Let the commands create their output directory. A prior validation failure that produced no HTML or browser evidence needs no new directory. Never remove unknown evidence to make a retry pass.

## Optional opening

Add `--open` only when the user wants an immediate local preview. It runs after
the verified pair commit has completed, its recovery journal has been removed,
and the delivery lock has been released successfully. It uses one argument-array
OS opener with a five-second bound on macOS and Linux, and a fifteen-second bound
for PowerShell startup on Windows. The receipt records `open.status`; failed or
unavailable launch attempts also include normalized `open.failure` details.
Keep it off for CI, unattended agents, and non-interactive environments.
Failure or unsupported opening does not invalidate delivery; its
status proves only whether the local opener invocation succeeded.

## Last-Good Live Preview

For an active desktop authoring loop only:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Preview watches one explicit input on loopback, binds each stable digest to a private snapshot, and advances only after the existing verified delivery pipeline passes. Invalid, half-written, deleted, or superseded input leaves the previous verified revision on screen and on disk. Identical bytes do not rebuild or reload.

The preview runtime ships inside the zero-dependency Skill ZIP and must work without `node_modules`.

Never start it by default. Do not use it for CI, unattended agents, remote sharing, or mobile use. `--no-open` is only for a user who will open the printed local URL or for loop testing. Stop it with Ctrl-C before handoff. The first Ctrl-C drains the active delivery without publishing it; a second Ctrl-C forces shutdown of both delivery processes and HTTP connections, including incomplete requests. Shutdown preserves the last verified artifact and removes only staging files whose ownership can be verified. If delivery is interrupted before its receipt reaches Preview, unconfirmed files and recovery material may remain in the private staging directory; shutdown does not recursively delete unknown contents. Server state, port, source path, diagnostics, error text, and reload tokens must never enter the generated artifact or any export.

## Perceptual review

The automated path ends with the deterministic browser gate and reports
`visual_review: not_requested`. Ordinary generation does not require screenshots
or an image-reading step, including newly authored or repositioned Architecture.
Perceptual review is optional; use it for an explicit request or a concrete visual
investigation. Possible reasons include:

- the compact finalizer includes `visualReviewRecommendation` for crossings or detours (advisory, not a delivery gate);
- the user explicitly requests an aesthetic or visual review;
- a template, renderer, or Viewer change needs visual regression evidence;
- a novel layout or browser diagnostic leaves low confidence;
- the run is selected for sampled audit or dogfood.

For the default standalone desktop viewer, measure 1440×900, 1600×1000, 1920×1080, and 2048×1320. Require `document.documentElement.scrollWidth <= window.innerWidth` at every checked size. Prefer `scrollHeight <= window.innerHeight`; accept page-level vertical scrolling only through the Reader-declared readable exception defined above. At the largest checked viewport, inspect the rendered composition for a conspicuous empty lower band: the main panel and necessary conclusion cards should use the available height as a balanced whole, not collapse into a shallow strip. For unexpected overflow, repair the authored composition by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. Do not hide overflow, clip content, introduce an internal diagram scroller, or reduce node/label typography to make the measurement pass. Narrow/mobile containment may retain vertical page scrolling.

For an escalation, run `visual-check` on the current finalized artifact, inspect
its contact sheet with a capable image reader or human, and check both endpoint
themes, the default READ view, line crossings/corridors, label masks, node/card
fit, focus/search/passport closure, and export cleanliness. This review is
supplementary and never changes `browser_evidence`. An unconstrained browser
glance can support perceptual review only.

Report one truthful optional-review status:

- `visual_review: not_requested` — no review trigger applies; this is not a visual acceptance claim.
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

Finalize receipt publication uses the same identity-bound, no-clobber publisher and explicit recovery records described above. The full and summary receipts must be distinct from the candidate, artifact, delivery metadata, and browser receipt. Their targets must be absent or single-link regular files; symlink receipt entries and hardlinked targets fail closed. A later claimant or changed parent stops publication and remains untouched. Default receipt names share the physical artifact namespace and are bounded for the host filename limit. The two receipts are published individually, not as a crash-atomic pair; only a completed passing command is a successful handoff.
