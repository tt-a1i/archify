# Atomic output — design and protocol

`renderers/shared/atomic-output.mjs` is the durability layer that every
`finalize`, `deliver`, `compare`, and `migrate` operation depends on. It
provides the shared publication and quarantine primitives those workflows
use. Other CLI and tooling code (`bin/archify.mjs`, `bin/preview.mjs`,
`bin/visual-check.mjs`, `bin/recover-output.mjs`, `scripts/copy-site-assets.mjs`,
`scripts/write-deterministic-zip.mjs`, examples and golden tests) also calls
`fs.linkSync` and `fs.renameSync` for recovery paths, atomic writes, and
probes; the difference is that `atomic-output.mjs` is the layer that pins
the contract those callers depend on.

## Why this exists

Callers need to distinguish their prepared candidate from a path that another
writer has replaced, including when publication or cleanup fails. A candidate
is written separately before publication so the caller can inspect its complete
bytes before exposing the destination.

The publication flow uses an open file binding to verify identity, content,
mode and link count during the active operation:

> A candidate is published by hard-linking it into the destination. While the
> caller retains the binding, explicit verification checks can establish that
> the destination still names the captured candidate and content. Publication
> performs these checks around its mutations and cleanup.

The caller owns binding lifetime and any required writer coordination. This
protocol does not serialize callers, automatically verify future reads, or
provide a transaction across multiple files.

## The contract

The `captureRegularFileBinding` function returns a snapshot with:

- `status: 'captured'` on success.
- `binding` — an opaque token that must be passed back to
  `verifyRegularFileBinding`, `releaseRegularFileBinding`,
  `quarantineRemoveRegularFileBinding`, or `backupPublicRegularFileBinding`
  to scope cleanup to the captured descriptor.
- `identity` — `{ device, inode, mode, links }` where `device` and `inode`
  are `BigInt` (so Windows identity fits), `mode` is a `Number`
  containing permission bits (`mode & 0o777`), and `links` is the current
  hard-link count.
- `content.sha256` — the lowercase hex digest of the file body, always
  returned when status is `captured`.
- `content.bytes` — the current byte length, always returned when status
  is `captured`.
- `content.buffer` — the file bytes as a `Buffer`, only present when
  `includeContent: true` was passed.
- `mode` — `Number`, duplicated from `identity.mode` for callers that
  don't unpack the identity object.

The `verifyRegularFileBinding` function re-derives the same identity at
any later moment and returns one of:

- `status: 'match'` — every check still passes; the captured entry still
  satisfies the requested binding.
- `status: 'different'` — at least one check fails (link count, identity,
  mode, content); the entry at that path is no longer the one we captured.
- `status: 'unknown'` — the verifier could not determine the answer
  (descriptor unavailable, link-count not surfaced by the filesystem,
  size unavailable on the captured handle, etc.). The caller must treat
  this as a failed verification, not as a pass.
- `status: 'unsupported'` — the entry type is wrong for the operation
  (a hardlinked target, a non-regular entry, etc.). The caller must
  treat this as a failed verification, not as a pass.

A failure status is not a silent pass. The caller fails the operation,
never silently proceeds.

The `quarantineRemoveRegularFileBinding` function moves an owned file
into a private directory (`.archify-remove-*`) before deleting it. Failed
cleanup can retain a recovery path for the caller to report. The return
status covers the full outcome space:

- `status: 'removed'` — the entry was successfully moved into quarantine
  and unlinked.
- `status: 'preserved'` — the quarantine step discovered that the entry
  at the target path had been replaced by another claimant; the displaced
  copy was restored to the original path, leaving the replacement intact.
  Callers may accept this and report `committed-with-warning`.
- `status: 'recovery-required'` — quarantine setup, move, or unlink
  failed; the entry is left in the recovery directory. Callers must
  surface the recovery path and abort any unrelated mutation.
- `status: 'different'` — the entry's identity changed after capture
  (or after the restore step). Callers must abort.
- `status: 'unknown'` — the verifier could not establish the answer.
  Callers must abort.
- `status: 'unsupported'` — the entry type is wrong for removal.
  Callers must abort.

## Why hard link, not rename

`fs.renameSync` swaps the destination's directory entry to point at the
candidate. After the rename, the destination's inode is the candidate's
inode — so the verify-after-commit check works the same way.

The publication path uses `fs.linkSync` + `quarantineRemoveRegularFileBinding`
instead because:

- `linkSync` is atomic on POSIX for hard-link creation. The destination
  becomes a hard link to the candidate in one operation.
- The candidate is then removed from its staging directory via
  `quarantineRemoveRegularFileBinding`, which preserves the destination's
  sole hard link while making the deletion recoverable.
- The active publication call verifies `expectedLinks: 1` after it
  quarantines the staging candidate (see `publishRegularFileBinding`).
  If the process stops after `linkSync` and before the active publication
  call completes, that check does not run. A later `finalize` does not
  scan old staging directories or remove the candidate; restart recovery
  is the explicit `bin/recover-output.mjs` consumer, which operates on a
  named private recovery directory. Operators must inspect retained
  staging and recovery paths before retrying.

`fs.renameSync` does not provide the two-link observation that this
in-process publication protocol depends on. This is a publication-design
trade-off, not a guarantee that a later `finalize` can infer or repair
an interrupted rename.

## Why `fs.constants.O_NOFOLLOW` (sometimes)

On POSIX, opening a path with `O_NOFOLLOW` rejects symlinks — opening a
symlink to a regular file would race a TOCTOU attacker who swaps the
target between our lstat and our open. On Windows, `O_NOFOLLOW` is
ignored at the syscall level, so we set `0` and rely on the handle-based
fstat to detect the swap: if the inode on the open handle does not match
the inode from the path-stat, the capture returns
`status: 'unknown', reason: 'target-changed-during-inspection'`.

## Why the quarantine for removal

The removal path moves the captured entry into a private directory, verifies
its binding there, and then unlinks it. If the moved entry belongs to another
claimant, the code restores that entry instead of deleting it. A failed move,
restore, or unlink is reported to the caller, including retained recovery
paths when cleanup cannot finish.

The empty-directory cleanup has a separate bounded retry for `ENOTEMPTY`:
SMB can acknowledge unlink before a following directory removal sees the
entry disappear. That retry never recursively removes a nonempty directory.
This is failure reporting and claimant preservation, not a guarantee of
recovering arbitrary interrupted removals after a crash. The protocol is:

```text
captureRegularFileBinding(path)
        ↓
  bind → { identity, content, mode, sha256, bytes }
        ↓
quarantineRemoveRegularFileBinding(bind, path)
        ↓
  rename into .archify-remove-<rand>/
        ↓
  fs.unlinkSync from .archify-remove-<rand>/
        ↓
  status: 'removed' | 'preserved' | 'recovery-required' | 'different' | 'unknown' | 'unsupported'
```

`recovery-required` returns the quarantine file path so the caller can
leave it in place and surface it to the operator.

## What fails closed

The atomic-output layer fails closed by default:

- A default target binding expects one link and rejects `nlink > 1`
  (`hardlinked`). Controlled publication/backup steps explicitly request
  `expectedLinks: 2` while verifying their temporary aliases, then verify the
  intended one-link state after cleanup.
- A target whose identity is `0n` (e.g. on a Windows FAT filesystem that
  does not surface inodes) is rejected (`identity-unavailable`).
- A target that changes inode, device, mode, size, or content between
  capture and verify is rejected (`different` with a specific reason).
- A target whose handle cannot be opened without following a symlink is
  rejected (`target-handle-inspection-failed`).

Every rejection returns a `{ status, reason }` shape the caller maps to a
diagnostic. No caller path is allowed to treat a rejection as success.

## What this is NOT

- This is **not** a transactional database. It does not roll back partial
  side effects on remote systems or make a multi-file operation transactional.
  It verifies individual file bindings and reports retained recovery paths.
- This is **not** a concurrency lock. The delivery/finalize paths in
  `bin/archify.mjs` use their delivery lock (`deliveryLockPath`). Other
  consumers call the shared publication primitives directly. The primitives
  verify path identity and content without acquiring that lock; each caller
  owns the concurrency coordination and binding lifetime its workflow needs.
- This is **not** idempotent across destination paths. Two `finalize`
  calls on two different destinations produce two independent artifacts;
  the layer does not deduplicate by content.
- This is **not** a directory scanner. It does not look for orphan
  staging entries; recovery for those is the responsibility of
  `bin/recover-output.mjs`.

## Where to look in the source

| Function | Purpose |
|---|---|
| `captureAtomicOutput` | One-shot snapshot of a target's full identity, content, mode |
| `captureRegularFileBinding` | Reusable version; same guarantees, callable any number of times |
| `verifyAtomicOutput` | Re-derive identity for an already-captured target |
| `verifyRegularFileBinding` | Reusable version |
| `quarantineRemoveRegularFileBinding` | Move into private quarantine, then unlink; handles the `preserved` path |
| `backupPublicRegularFileBinding` | Hard-link a verified backup, then quarantine-remove the public name and verify the remaining link |
| `publishRegularFileBinding` | The publication protocol itself: hard-link the candidate in, quarantine the candidate out, fail closed |
| `removeEmptyDirectoryWithRetry` | Bounded retry on SMB "ENOTEMPTY" races |

The tests under `test/atomic-output*.test.mjs`, `test/portable-delivery*.test.mjs`,
and `test/delivery-lock*.test.mjs` cover the failure-mode matrix: hardlink
detection, mode mismatches, content hash mismatches, racing claimants, and
post-commit recovery.
