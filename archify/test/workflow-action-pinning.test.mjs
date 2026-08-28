import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const remoteRefPattern = /^[0-9a-fA-F]{40}$/;

function yamlFilesUnder(relativeRoot) {
  const root = path.join(repoRoot, relativeRoot);
  if (!fs.existsSync(root)) return [];
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name)) files.push(absolute);
    }
  }
  visit(root);
  return files.sort();
}

function leadingSpaces(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function usesReferences(source) {
  const references = [];
  const lines = source.split(/\r?\n/);
  let blockScalarIndent = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (blockScalarIndent !== null) {
      if (line.trim() === '') continue;
      if (leadingSpaces(line) > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (/^\s*#/.test(line)) continue;
    const matches = line.matchAll(
      /(?:^\s*(?:-\s*)?|[,{]\s*)(?:"uses"|'uses'|uses)\s*:\s*(?:"([^"]+)"|'([^']+)'|([^#,\s}]+))/g,
    );
    for (const match of matches) {
      references.push({ line: index + 1, value: match[1] ?? match[2] ?? match[3] });
    }
    if (
      /^\s*(?:-\s*)?(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*:\s*[>|][0-9+-]*\s*(?:#.*)?$/.test(line)
    ) {
      blockScalarIndent = leadingSpaces(line);
    }
  }
  return references;
}

function mutableRemoteReferences() {
  const files = [...yamlFilesUnder('.github/workflows'), ...yamlFilesUnder('.github/actions')];
  const failures = [];
  for (const absolute of files) {
    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
    const source = fs.readFileSync(absolute, 'utf8');
    for (const reference of usesReferences(source)) {
      const value = reference.value;
      if (value.startsWith('./')) continue;
      if (value.startsWith('docker://')) continue;
      const separator = value.lastIndexOf('@');
      const ref = separator === -1 ? '' : value.slice(separator + 1);
      if (!remoteRefPattern.test(ref)) {
        failures.push(`${relative}:${reference.line}: ${value}`);
      }
    }
  }
  return failures;
}

test('remote GitHub Actions and reusable workflows use immutable commit SHAs', () => {
  const failures = mutableRemoteReferences();
  assert.deepEqual(failures, [], [
    'Remote GitHub Actions and reusable workflows must use full 40-character commit SHAs.',
    ...failures,
  ].join('\n'));
});

test('workflow action pinning scanner ignores local and Docker Actions', () => {
  const source = [
    'steps:',
    '  - uses: ./local-action',
    '  - uses: docker://alpine:3.20',
    '  - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567',
    '  - run: |',
    '      echo "uses: actions/checkout@v4"',
  ].join('\n');
  assert.deepEqual(
    usesReferences(source).map(({ value }) => value),
    ['./local-action', 'docker://alpine:3.20', 'actions/checkout@0123456789abcdef0123456789abcdef01234567'],
  );
});
