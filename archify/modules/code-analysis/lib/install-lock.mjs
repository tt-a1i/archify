import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Atomic directory creation coordinates separate Node processes. Never steal a
// timed-out lock: its owner may still be installing into the shared directory.
export async function withInstallLock(root, operation, timeout = 120000) {
  const lock = path.join(fs.realpathSync(root), '.code-analysis-install.lock');
  const deadline = Date.now() + timeout;
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Code Analysis dependency installation. If no installer is running, remove ${lock} and retry.`);
      await delay(100);
    }
  }
  try { return await operation(); }
  finally { fs.rmdirSync(lock); }
}
