import fs from 'node:fs';
import path from 'node:path';

const originalRmSync = fs.rmSync.bind(fs);
let injectedFailure = false;

fs.rmSync = function failMigrationCleanupOnce(target, options) {
  const isMigrationStagingDirectory = path.basename(String(target)).startsWith('.archify-migration-');
  if (!injectedFailure && isMigrationStagingDirectory) {
    injectedFailure = true;
    originalRmSync(target, options);
    const error = new Error('simulated migration cleanup failure');
    error.code = 'EPERM';
    throw error;
  }
  return originalRmSync(target, options);
};
