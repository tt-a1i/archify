import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PACKAGE_TYPES,
  REQUIRED_FIELDS,
  validatePackage,
  validateRegistry,
} from '../../scripts/check-community-packages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'community/package.schema.json'), 'utf8'));

function validPackage() {
  return {
    name: 'demo-pack',
    type: 'skill',
    summary: { en: 'A demo package summary that is long enough.', zh: '一个足够长的演示包简介。' },
    author: { name: 'demo', url: 'https://example.com/demo' },
    repository: 'https://github.com/demo/demo-pack',
    archify: '>=3.0.0 <4.0.0',
    schemaVersions: [1, 2],
  };
}

test('community registry: checked-in packages validate clean', () => {
  const { entries, failures } = validateRegistry(repoRoot);
  assert.deepEqual(failures, []);
  assert.ok(entries.length >= 2, 'registry must seed at least two real packages');
});

test('community registry: validator stays in sync with package.schema.json', () => {
  assert.deepEqual([...schema.required].sort(), [...REQUIRED_FIELDS].sort());
  assert.deepEqual([...schema.properties.type.enum].sort(), [...PACKAGE_TYPES].sort());
  assert.deepEqual(schema.additionalProperties, false);
});

test('community package: accepts a minimal valid entry', () => {
  assert.deepEqual(validatePackage(validPackage()), []);
});

test('community package: rejects malformed entries with specific failures', () => {
  const cases = [
    ['missing required field', (value) => { delete value.repository; }, /missing required field "repository"/],
    ['unknown field', (value) => { value.downloads = 10; }, /unknown field "downloads"/],
    ['bad name case', (value) => { value.name = 'Demo-Pack'; }, /name must be lowercase kebab-case/],
    ['bad type', (value) => { value.type = 'plugin'; }, /type must be one of/],
    ['short en summary', (value) => { value.summary.en = 'short'; }, /summary\.en/],
    ['missing zh summary', (value) => { delete value.summary.zh; }, /summary\.zh/],
    ['non-https repository', (value) => { value.repository = 'git@github.com:demo/x.git'; }, /repository must be an https/],
    ['bad archify range', (value) => { value.archify = 'latest'; }, /archify must be a version range/],
    ['empty schemaVersions', (value) => { value.schemaVersions = []; }, /schemaVersions must be a non-empty array/],
    ['non-integer schemaVersions', (value) => { value.schemaVersions = ['1']; }, /positive integers/],
    ['duplicate schemaVersions', (value) => { value.schemaVersions = [1, 1]; }, /unique/],
    ['bad tag', (value) => { value.tags = ['Not A Tag']; }, /tags must be/],
    ['bad evidence url', (value) => { value.evidence = [{ label: 'receipt', url: 'http://insecure.example.com' }]; }, /evidence\[0\]/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const value = validPackage();
    mutate(value);
    const failures = validatePackage(value);
    assert.ok(failures.some((failure) => pattern.test(failure)), `${label}: expected ${pattern}, got ${JSON.stringify(failures)}`);
  }
});

test('community registry: rejects duplicate names and file/name mismatches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-community-'));
  try {
    const dir = path.join(root, 'community', 'packages');
    fs.mkdirSync(dir, { recursive: true });
    const first = validPackage();
    const second = { ...validPackage() };
    fs.writeFileSync(path.join(dir, 'demo-pack.json'), JSON.stringify(first));
    fs.writeFileSync(path.join(dir, 'other-name.json'), JSON.stringify(second));
    const { failures } = validateRegistry(root);
    assert.ok(failures.some((failure) => /file name must match/.test(failure)), JSON.stringify(failures));
    assert.ok(failures.some((failure) => /duplicate package name/.test(failure)), JSON.stringify(failures));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('community package: rejects nested unknown fields and overlong author/evidence text', () => {
  for (const mutate of [
    value => { value.summary.extra = true; },
    value => { value.author.extra = true; },
    value => { value.evidence = [{ label: 'receipt', url: 'https://example.com', extra: true }]; },
    value => { value.author.name = 'x'.repeat(81); },
    value => { value.evidence = [{ label: 'x'.repeat(81), url: 'https://example.com' }]; },
  ]) {
    const value = validPackage();
    mutate(value);
    assert.ok(validatePackage(value).length, JSON.stringify(value));
  }
});

test('community package: rejects malformed HTTPS URLs in every link field', () => {
  for (const url of ['https://', 'https:///example.com', 'https://example.com:bad', 'https://example.com/a b', 'https://user:secret@example.com', 'https://example.com/\\path', 'https://example.com/\npath', 'https://example.com/\n', 'https://example.com/\u0000path']) {
    for (const mutate of [
      value => { value.repository = url; },
      value => { value.homepage = url; },
      value => { value.author.url = url; },
      value => { value.evidence = [{ label: 'receipt', url }]; },
    ]) {
      const value = validPackage();
      mutate(value);
      assert.ok(validatePackage(value).length, url);
    }
  }
});

test('community package: text lengths follow Unicode code points at schema boundaries', () => {
  const value = validPackage();
  value.author.name = '😀'.repeat(80);
  value.summary.en = '😀'.repeat(160);
  value.summary.zh = '😀'.repeat(120);
  value.evidence = [{ label: '😀'.repeat(80), url: 'https://example.com/evidence' }];
  assert.deepEqual(validatePackage(value), []);
  value.author.name += '😀';
  assert.ok(validatePackage(value).length);
});


test('community package: en/zh summaries and evidence labels enforce both length boundaries', () => {
  for (const [field, minimum, maximum] of [['en', 10, 160], ['zh', 6, 120]]) {
    for (const length of [minimum, maximum]) {
      const value = validPackage();
      value.summary[field] = '😀'.repeat(length);
      assert.deepEqual(validatePackage(value), []);
    }
    for (const length of [minimum - 1, maximum + 1]) {
      const value = validPackage();
      value.summary[field] = '😀'.repeat(length);
      assert.ok(validatePackage(value).length);
    }
  }
  for (const length of [1, 80, 81]) {
    const value = validPackage();
    value.evidence = [{ label: '😀'.repeat(length), url: 'https://example.com/receipt' }];
    assert.equal(validatePackage(value).length === 0, length <= 80);
  }
});
