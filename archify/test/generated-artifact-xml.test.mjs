import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractInlineSvgs, parseXml } from './helpers/xml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const artifactRoots = [
  path.join(repoRoot, 'examples'),
  path.join(skillRoot, 'examples'),
  path.join(repoRoot, 'docs', 'cases'),
  path.join(repoRoot, 'docs', 'gallery', 'artifacts'),
  path.join(repoRoot, 'experiments', 'mco-showcase'),
];

function htmlArtifacts(root) {
  return fs.readdirSync(root)
    .filter((entry) => entry.endsWith('.html'))
    .sort()
    .map((entry) => path.join(root, entry));
}

test('tracked generated artifacts embed well-formed XML SVG', () => {
  const artifacts = artifactRoots.flatMap(htmlArtifacts);
  assert.ok(artifacts.length > 20, 'expected the public generated artifact inventory');

  for (const artifact of artifacts) {
    const relative = path.relative(repoRoot, artifact);
    const svgs = extractInlineSvgs(fs.readFileSync(artifact, 'utf8'));
    assert.ok(svgs.length > 0, `${relative}: expected at least one inline SVG`);
    for (const [index, svg] of svgs.entries()) {
      assert.doesNotThrow(
        () => parseXml(svg),
        `${relative}: inline SVG ${index + 1} must be well-formed XML`,
      );
    }
  }
});
