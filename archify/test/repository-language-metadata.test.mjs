import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function linguistGenerated(relativePath) {
  const output = execFileSync(
    'git',
    ['check-attr', 'linguist-generated', '--', relativePath],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
  return output.slice(output.lastIndexOf(':') + 1).trim();
}

test('repository language metadata separates generated artifacts from implementation source', () => {
  for (const generatedPath of [
    'archify/examples/web-app-rendered.html',
    'examples/web-app.html',
    'docs/cases/mco-runtime.architecture.html',
    'docs/gallery.html',
    'docs/gallery/artifacts/web-app.architecture.html',
    'docs/guide.html',
    'docs/start.html',
    'experiments/mco-showcase/mco-runtime.html',
    'archify/renderers/shared/generated-brand-marks.mjs',
    'archify/renderers/shared/generated-validators.mjs',
  ]) {
    assert.equal(
      linguistGenerated(generatedPath),
      'true',
      `${generatedPath} must be excluded from GitHub language statistics`,
    );
  }

  for (const sourcePath of [
    'archify/assets/template.html',
    'scripts/gallery-template.html',
    'scripts/guide-template.html',
    'scripts/start-template.html',
    'docs/index.html',
    'archify/renderers/shared/geometry.mjs',
  ]) {
    assert.equal(
      linguistGenerated(sourcePath),
      'unspecified',
      `${sourcePath} must remain visible as implementation source`,
    );
  }
});
