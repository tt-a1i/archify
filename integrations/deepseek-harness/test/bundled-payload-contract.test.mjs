import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const sourceRoot = path.join(repoRoot, 'archify');
const payloadRoot = path.join(integrationRoot, '.dsh-bundled-skills', 'archify');
const MAX_STATIC_PAYLOAD_BYTES = 2 * 1024 * 1024;

function excluded(relative) {
  const parts = relative.split(path.sep);
  return parts.includes('node_modules')
    || parts.includes('test')
    || parts.includes('.DS_Store')
    || parts.includes('.hive')
    || parts.includes('.workbuddy')
    || parts.some((part) => part.startsWith('.validator-check-'))
    || relative === 'package-lock.json'
    || (parts[0] === 'examples' && parts.at(-1).endsWith('.html'))
    || relative === path.join('scripts', 'generate-brand-marks.mjs')
    || relative === path.join('scripts', 'generate-validators.mjs');
}

function listFiles(root, current = root) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) return listFiles(root, absolute);
    return [path.relative(root, absolute)];
  }).sort();
}

function bytes(root) {
  return listFiles(root).reduce((total, relative) => total + fs.statSync(path.join(root, relative)).size, 0);
}

test('checked-in bundled payload is a bounded, static projection of Archify source', () => {
  assert.equal(fs.existsSync(payloadRoot), true);
  const expected = listFiles(sourceRoot).filter((relative) => !excluded(relative));
  const actual = listFiles(payloadRoot);
  assert.deepEqual(actual, expected);
  assert.ok(bytes(payloadRoot) <= MAX_STATIC_PAYLOAD_BYTES, 'payload exceeds the Store static-source bound');
});

test('checked-in payload has no lifecycle scripts, development dependencies, or test surface', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(payloadRoot, 'package.json'), 'utf8'));
  const sourcePkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  delete sourcePkg.scripts;
  delete sourcePkg.devDependencies;
  assert.deepEqual(pkg, sourcePkg);
  assert.equal(pkg.scripts, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(fs.existsSync(path.join(payloadRoot, 'package-lock.json')), false);
  assert.equal(fs.existsSync(path.join(payloadRoot, 'test')), false);
  assert.equal(fs.existsSync(path.join(payloadRoot, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(payloadRoot, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(payloadRoot, 'bin', 'archify.mjs')), true);
});
