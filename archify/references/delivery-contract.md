# Delivery contract

For `deliver atlas`, use the [Architecture Atlas contract](architecture-atlas.md): inputs are a manifest plus local architecture members, and final checks cover every embedded member and the bundle. The final self-contained HTML stores the unchanged logical bundle in a deterministic, digest-checked gzip envelope with an inline offline fallback. Receipt and member checks apply to restored bytes, while the bundle receipt identifies the physical compressed file. The ordinary single-diagram contract below remains unchanged.

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
is a safety barrier: `check` and `visual-check` fail closed when any directory
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
node bin/archify.mjs visual-check <output.html> --json --require-provenance
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

Use `validate` after every candidate edit. CLI HTML output paths must end in
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

### Internal-structure delivery evidence

An Architecture with `components[].internal_structure` emits exactly one inert
`archify-internal-structure-data` script outside the canonical SVG. Its body is
a JSON array of string chunks; joining the chunks yields a node-indexed payload
with `schemaVersion`, `sources`, `items`, and `relations`. An Architecture with
no structure emits neither the script nor an `internalStructure` receipt.

The checker validates the envelope, node IDs, local source references, item and
relation endpoints, repository evidence, byte limits, and 8192-byte payload
lines. A standalone receipt has this shape:

```json
{
  "schemaVersion": 1,
  "nodeCount": 2,
  "itemCount": 14,
  "relationCount": 3,
  "sourceCount": 8,
  "bytes": 4276,
  "sha256": "<64 lowercase hex characters>"
}
```

Byte count and digest describe the exact chunked script text. The receipt does
not copy structure content. Each compiled node is limited to 64 KiB, one member
payload to 256 KiB, and the sum across an Atlas to 512 KiB.

Atlas bundle metadata stores only each owning member's receipt and a compact
node/domain/item inventory. The body remains once in that member document.
Delivery and unpacking reconstruct the member and compare its actual payload,
inventory, counts, bytes, and digest. A reference occurrence cannot author or
carry another structure body. See [Canonical internal structure](architecture-atlas.md#canonical-internal-structure).

These checks prove bounded, internally consistent bytes and verified source
locations. They do not prove authored summaries, item kinds, or behavioral
relations. Apply the independent review rules in the
[authoring contract](authoring-contract.md#architecture-node-internal-structure).

Structure data stays outside canonical SVG and every graph export. The HTML is
self-contained under `file://` and local HTTP. It makes no autonomous network
request; only a user-activated source link may leave the artifact, and
`local-only` emits neither remote links nor the local repository root.

For Atlas navigation changes, static member screenshots do not establish a continuous layer switch. Record the transition in a real browser using video or consecutive frames, with commit timing, visible diagram identity and workbench-boundary measurements. Inspect representative light/dark, delayed, failed, superseded and history-restoration transitions, including resize. Bind this process evidence to the final artifact digest and report its coverage and limitations separately from `visual-check`; a ready callback or simulated DOM test is not visual evidence. Follow the execution environment's browser and URL permissions when collecting it; unavailable required evidence remains incomplete rather than passed.

For internal-structure changes, that continuous browser record must begin on the
committed graph and cover Details entry, code/state switching, item selection,
tree keyboard behavior, return, native Back/Forward, cold deep links, a node
without structure, invalid targets, reference-to-canonical navigation, resize,
reduced motion, and failed or superseded preparation. A final still cannot prove
that one usable workspace remained throughout.
Check both standalone Architecture and Atlas when their shared Viewer or the
outer shell changed. Bind the record to the delivered artifact digest, and keep
it separate from perceptual review and from the ordinary `visual-check` receipt.

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

Runtime or capture failures leave incomplete evidence and must not be normalized to `skipped`.
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

For an Atlas desktop handoff, return its HTML link and a PNG preview bound to the final artifact rather than automatically opening an HTML file panel. Honor an explicit opening request and the user's chosen surface; an unspecified opening request uses the browser. This agent handoff rule does not change the CLI's explicit `--open` option. Smaller output is a byte-size result, not proof of faster host-application rendering.

## Last-Good Live Preview

For an active desktop authoring loop only:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Preview watches one explicit input on loopback, binds each stable digest to a private snapshot, and advances only after the existing verified delivery pipeline passes. Invalid, half-written, deleted, or superseded input leaves the previous verified revision on screen and on disk. Identical bytes do not rebuild or reload.

The preview runtime ships inside the zero-dependency Skill ZIP and must work without `node_modules`.

Never start it by default. Do not use it for CI, unattended agents, remote sharing, or mobile use. `--no-open` is only for a user who will open the printed local URL or for loop testing. Stop it with Ctrl-C before handoff. The first Ctrl-C drains the active delivery without publishing it; a second Ctrl-C forces shutdown of both delivery processes and HTTP connections, including incomplete requests. Shutdown preserves the last verified artifact and removes only staging files whose ownership can be verified. If delivery is interrupted before its receipt reaches Preview, unconfirmed files and recovery material may remain in the private staging directory; shutdown does not recursively delete unknown contents. Server state, port, source path, diagnostics, error text, and reload tokens must never enter the generated artifact or any export.

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

When a standalone artifact has internal structure, also return its emitted
`internalStructure` object unchanged. For an Atlas, report the optional object
under each owning member; do not synthesize a top-level total receipt or an empty
receipt for members without structure.

Opening, preview status, Share Cards, and other viewer exports are not validation claims.
