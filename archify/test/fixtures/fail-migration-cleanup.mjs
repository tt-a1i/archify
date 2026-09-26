import fs from 'node:fs';
import path from 'node:path';

const originalRmdirSync = fs.rmdirSync.bind(fs);
let injectedFailure = false;

fs.rmdirSync = function failMigrationCleanupOnce(target, options) {
  const isMigrationStagingDirectory = path.basename(String(target)).startsWith('.archify-migration-');
  if (!injectedFailure && isMigrationStagingDirectory) {
    injectedFailure = true;
    originalRmdirSync(target, options);
    const error = new Error('simulated migration cleanup failure');
    error.code = 'EPERM';
    throw error;
  }
  return originalRmdirSync(target, options);
};
