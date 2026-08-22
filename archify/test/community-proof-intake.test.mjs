import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('showcase intake requires reproducible proof, redaction, and explicit publication permission', () => {
  const template = read('.github/ISSUE_TEMPLATE/showcase.yml');

  for (const field of [
    'id: diagram_type',
    'id: archify_version',
    'id: agent',
    'id: model',
    'id: prompt',
    'id: source_json',
    'id: artifact',
    'id: validation_receipt',
    'id: visual_review',
    'id: sensitive_data',
    'id: sharing_rights',
    'id: public_permission',
  ]) {
    assert.match(template, new RegExp(field), field);
  }
  assert.match(template, /access tokens/i);
  assert.match(template, /personal or customer data/i);
  assert.match(template, /repository, documentation, gallery, and project website/i);
  assert.match(template, /required:\s*true/g);

  const submissionUrl = 'https://github.com/tt-a1i/archify/issues/new?template=showcase.yml';
  for (const readme of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    assert.match(read(readme), new RegExp(submissionUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${readme}: direct showcase link`);
  }
});

test('bug intake captures a minimal deterministic reproduction before visual diagnosis', () => {
  const template = read('.github/ISSUE_TEMPLATE/bug-report.yml');

  for (const field of [
    'id: archify_version',
    'id: install_method',
    'id: diagram_type',
    'id: command',
    'id: minimal_json',
    'id: validation_receipt',
    'id: expected',
    'id: actual',
    'id: environment',
    'id: sensitive_data',
  ]) {
    assert.match(template, new RegExp(field), field);
  }
  assert.ok(
    template.indexOf('id: validation_receipt') < template.indexOf('id: screenshot'),
    'deterministic evidence should be requested before optional visual evidence',
  );
});

test('contributor and pull-request guides keep proof changes reproducible and stability-first', () => {
  const contributing = read('CONTRIBUTING.md');
  const pullRequest = read('.github/PULL_REQUEST_TEMPLATE.md');

  for (const required of [
    '.github/ISSUE_TEMPLATE/showcase.yml',
    '.github/ISSUE_TEMPLATE/bug-report.yml',
    'npm test',
    'node scripts/build-gallery.mjs docs',
    'Do not include secrets',
    'Agent-first',
    'diagnostics[]',
    'Start from the latest `main`',
    'tracked-only, symlink-safe',
    'is **skipped**, not passed',
  ]) {
    assert.match(contributing, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required);
  }
  assert.match(
    contributing,
    /(?:^|\n)scripts\/build-zip\.sh \/tmp\/archify-contrib\.zip(?:\n|$)/,
    'the archive builder must be documented as an executable shell script',
  );
  assert.doesNotMatch(
    contributing,
    /\bnode\s+scripts\/build-zip\.sh\b/,
    'the shell archive builder must not be documented as a Node.js command',
  );
  for (const required of [
    'Stability impact',
    'Tests run',
    'Generated artifacts',
    'Visual evidence',
    'No unrelated changes',
  ]) {
    assert.match(pullRequest, new RegExp(required), required);
  }
});
