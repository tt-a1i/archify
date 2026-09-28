// Cross-platform PID liveness check used by the delivery-lock protocol.
//
// `process.kill(pid, 0)` is a permission probe, not a liveness probe. The
// delivery contract requires the lock to be treated as live whenever the
// owner's death cannot be positively established. That gives three
// terminal outcomes:
//
//   * the call succeeds               -> the PID exists; report "running"
//                                        so the caller emits
//                                        `delivery/concurrent-attempt`
//   * the call throws `ESRCH`          -> no such process; report "not
//                                        running" so the caller emits
//                                        `delivery/lock-stale`
//   * the call throws anything else    -> typically `EPERM` because the
//                                        PID is owned by another user or
//                                        a system process. The PID may
//                                        still be alive; report "running"
//                                        so the caller emits
//                                        `delivery/concurrent-attempt` and
//                                        does not delete a lock whose
//                                        owner is still active
//
// Earlier drafts of this function returned `false` for every non-success
// path. That treated `EPERM` as "not running", which mapped to
// `delivery/lock-stale` and authorised stale-lock recovery to remove the
// lock file. When the original owner is still active (e.g. another Archify
// invocation that we cannot signal because of a container boundary), that
// recovery opens the door to two concurrent `deliver` runs. The delivery
// contract is explicit:
//
//   "Valid schema-v1 lock whose PID is running, OR whose death cannot be
//    established | Exit 1 with `delivery/concurrent-attempt`; preserve
//    every shared path."
//
// So `EPERM` is "death cannot be established" and must map to
// `delivery/concurrent-attempt`.
//
// This is the corrected contract for audit finding S3.

export function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}