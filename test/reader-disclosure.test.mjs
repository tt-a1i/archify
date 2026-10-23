import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReaderUpdateDisclosure } from '../archify/renderers/shared/reader-disclosure.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('reader update disclosure contains only a local build identity and the fixed update manifest', () => {
  const disclosure = createReaderUpdateDisclosure({ artifactType: 'architecture', content: '<svg>private title</svg>' });
  assert.equal(disclosure.schemaVersion, 1);
  assert.equal(disclosure.artifact.type, 'architecture');
  assert.match(disclosure.artifact.contentSha256, /^[a-f0-9]{64}$/);
  assert.match(disclosure.artifact.generatorVersion, /^\d+\.\d+\.\d+/);
  assert.deepEqual(disclosure.update, {
    manifestUrl: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
    channel: 'stable',
  });
  assert.equal(JSON.stringify(disclosure).includes('private title'), false);
  assert.equal(Object.hasOwn(disclosure, 'feedback'), false);
});

test('native render emits update-only disclosure data before its interaction runtime', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'diagram.html');
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'architecture', path.join(root, 'archify/examples/web-app.architecture.json'), output]);
  const html = fs.readFileSync(output, 'utf8');
  const match = html.match(/<script id="archify-reader-update-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'native artifact includes reader update data');
  const payload = JSON.parse(match[1]);
  assert.equal(payload.artifact.type, 'architecture');
  assert.equal(Object.hasOwn(payload, 'feedback'), false);
  assert.ok(html.indexOf(match[0]) < html.indexOf('var Archify = {}'), 'reader payload loads before its runtime');
  assert.match(html, /id="btn-reader-update"/);
  assert.doesNotMatch(html, /artifact-feedback\.yml|Share feedback|Copy diagnostic context|meta\.feedback/);
});
