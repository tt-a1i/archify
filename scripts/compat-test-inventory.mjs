import fs from 'node:fs';
import path from 'node:path';

// The complete regression suite runs on canonical Node 22. Other maintained
// Node lanes repeat goldens and these process, filesystem, schema and CLI
// contracts; do not infer compatibility coverage from changed source paths.
export const compatibilityTestFiles = Object.freeze([
  'test/artifact-receipt-flush.test.mjs',
  'test/atomic-output-recovery.test.mjs',
  'test/base-input-compatibility.test.mjs',
  'test/brand-content-encoding.test.mjs',
  'test/brand-marks.test.mjs',
  'test/chrome-pipe-transport.test.mjs',
  'test/cli-output-types.test.mjs',
  'test/cli.test.mjs',
  'test/compatibility-gate.test.mjs',
  'test/delivery-contract.test.mjs',
  'test/delivery-sidecar-path.test.mjs',
  'test/delivery-update.test.mjs',
  'test/finalize-browser-lifecycle.test.mjs',
  'test/finalize-paths.test.mjs',
  'test/finalize.test.mjs',
  'test/generate-validators.test.mjs',
  'test/meta-output-contract.test.mjs',
  'test/native-output-path.test.mjs',
  'test/open-artifact.test.mjs',
  'test/output-path.test.mjs',
  'test/path-boundary-contract.test.mjs',
  'test/path-semantics.test.mjs',
  'test/portable-path.test.mjs',
  'test/preview-contract.test.mjs',
  'test/preview-force-stop.test.mjs',
  'test/preview.test.mjs',
  'test/release-package-gates.test.mjs',
  'test/render-failure-diagnostics.test.mjs',
  'test/render-output-checks.test.mjs',
  'test/renderer-atomic-write.test.mjs',
  'test/renderer-diagnostic-boundary.test.mjs',
  'test/renderer-import-isolation.test.mjs',
  'test/repair-receipt.test.mjs',
  'test/repair-rounds.test.mjs',
  'test/repository-evidence-replacement.test.mjs',
  'test/repository-evidence-types.test.mjs',
  'test/repository-evidence.test.mjs',
  'test/repository-test-runner.test.mjs',
  'test/sidecar-path-length.test.mjs',
  'test/temp-cleanup.test.mjs',
  'test/update-contract.test.mjs',
  'test/update-notifier.test.mjs',
  'test/v1-compatibility.test.mjs',
  'test/validate-next-action.test.mjs',
  'test/visual-check.test.mjs',
  'test/workflow-migration.test.mjs',
]);

export function validateCompatibilityInventory(repoRoot, files = compatibilityTestFiles) {
  if (files.length === 0) throw new Error('Compatibility inventory must not be empty');
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || !/^test\/[a-z0-9-]+\.test\.mjs$/.test(file)) {
      throw new Error(`Invalid compatibility test file: ${file}`);
    }
    if (seen.has(file)) throw new Error(`Duplicate compatibility test file: ${file}`);
    seen.add(file);
    if (!fs.existsSync(path.join(repoRoot, file)) || !fs.statSync(path.join(repoRoot, file)).isFile()) {
      throw new Error(`Missing compatibility test file: ${file}`);
    }
  }
  return files;
}
