import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanHtml } from '../archify/explainer/check.mjs';
import { unpackPageBundle } from '../archify/explainer/page-bundle.mjs';

// #1426: a repository file cited several times is embedded once in the page, and every
// citation is still verified against the bytes it names.
const cli = path.resolve('archify/bin/archify.mjs');
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
const payloadPattern = /(<script type="application\/json" id="archify-explainer-prepared">)([\s\S]*?)(<\/script>)/;
const rawPayload = file => JSON.parse(scanHtml(fs.readFileSync(file, 'utf8')).scripts.find(s => s.attrs.id === 'archify-explainer-prepared').text);
// An edited copy has no delivery sidecar, so the check judges the page content alone.
const writePayload = (file, payload) => {
  const edited = path.join(path.dirname(file), 'edited.html');
  fs.writeFileSync(edited, fs.readFileSync(file, 'utf8').replace(payloadPattern, (_, open, _text, close) => open + JSON.stringify(payload) + close));
  return edited;
};
const check = (file, ...options) => run(['check', file, '--json', ...options]);
const count = (text, needle) => text.split(needle).length - 1;

function citedTwiceAndOnce(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-explainer-page-bundle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => { const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git('init'); git('config', 'user.name', 'Explainer Test'); git('config', 'user.email', 'explainer@example.test'); git('remote', 'add', 'origin', 'https://github.com/example/explainer');
  const shared = Array.from({ length: 40 }, (_, index) => `export const step${index} = ${index} * 2;`).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'shared.js'), shared);
  fs.writeFileSync(path.join(dir, 'other.js'), 'export const other = 1;\n');
  git('add', '.'); git('commit', '-m', 'Fixture');
  const doc = { schema_version: 1, diagram_type: 'explainer', meta: { id: 'shared-citations', title: 'Where do the steps live?', locale: 'en', repository: { url: 'https://github.com/example/explainer', revision: git('rev-parse', 'HEAD') } },
    answer: { summary: 'Three excerpts cite one file and one excerpt cites another.' },
    panels: [
      { id: 'first', title: 'Which steps come first?', blocks: [{ id: 'early-code', type: 'code', source: 'early' }, { id: 'middle-code', type: 'code', source: 'middle' }] },
      { id: 'second', title: 'Which steps come last?', blocks: [{ id: 'late-code', type: 'code', source: 'late' }, { id: 'other-code', type: 'code', source: 'other' }] },
    ],
    sources: [
      { id: 'early', title: 'Early steps', path: 'shared.js', lines: [1, 3] },
      { id: 'middle', title: 'Middle steps', path: 'shared.js', lines: [18, 20] },
      { id: 'late', title: 'Late steps', path: 'shared.js', lines: [38, 40] },
      { id: 'other', title: 'Other value', path: 'other.js', lines: [1, 1] },
    ] };
  const input = path.join(dir, 'author.json'), artifact = path.join(dir, 'page.html');
  fs.writeFileSync(input, JSON.stringify(doc, null, 2) + '\n');
  const delivered = run(['deliver', 'explainer', input, artifact, '--repo-root', dir, '--json']);
  assert.equal(delivered.status, 0, delivered.stdout + delivered.stderr);
  return { dir, doc, artifact, sharedBase64: Buffer.from(shared).toString('base64'), shared };
}

test('a repository file cited three times is embedded once and every citation still verifies (#1426)', t => {
  const { artifact, sharedBase64, shared } = citedTwiceAndOnce(t);
  const html = fs.readFileSync(artifact, 'utf8');
  assert.equal(count(html, sharedBase64), 1, 'the shared file must appear once in the page');
  const raw = rawPayload(artifact);
  const repository = raw.dependencies.filter(dep => dep.kind === 'repository');
  assert.equal(repository.length, 4, 'each citation keeps its own dependency entry');
  const sharedCitations = repository.filter(dep => dep.id !== 'other');
  assert.ok(sharedCitations.every(dep => dep.contentBase64 === undefined && dep.contentRef === dep.sha256));
  assert.deepEqual(Object.keys(raw.dependencyContents), [sharedCitations[0].sha256], 'the repeated file is stored once');
  assert.equal(typeof repository.find(dep => dep.id === 'other').contentBase64, 'string', 'a file cited once stays inline');
  const unpacked = unpackPageBundle(raw);
  assert.equal(unpacked.dependencyContents, undefined);
  for (const dep of unpacked.dependencies.filter(entry => ['early', 'middle', 'late'].includes(entry.id))) assert.equal(Buffer.from(dep.contentBase64, 'base64').toString('utf8'), shared);
  const checked = check(artifact, '--require-provenance');
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test('pages that still embed each citation inline keep passing the check (#1426)', t => {
  const { artifact } = citedTwiceAndOnce(t);
  const older = unpackPageBundle(rawPayload(artifact));
  assert.ok(older.dependencies.every(dep => typeof dep.contentBase64 === 'string'));
  const checked = check(writePayload(artifact, older));
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test('a stored content that no longer matches its citations fails the dependency check (#1426)', t => {
  const { artifact } = citedTwiceAndOnce(t);
  const raw = rawPayload(artifact);
  const [sharedSha] = Object.keys(raw.dependencyContents);
  for (const tamper of [
    payload => { payload.dependencyContents[sharedSha] = Buffer.from('replaced bytes\n').toString('base64'); },
    payload => { delete payload.dependencyContents[sharedSha]; },
  ]) {
    const payload = structuredClone(raw); tamper(payload);
    const checked = check(writePayload(artifact, payload));
    assert.notEqual(checked.status, 0, 'tampered shared content must not pass');
    const receipt = JSON.parse(checked.stdout);
    for (const id of ['early', 'middle', 'late']) assert.ok(receipt.diagnostics.some(d => d.code === 'explainer/dependency-hash' && d.message.includes(`repository:${id}`)), `citation ${id} must be reported`);
    assert.ok(!receipt.diagnostics.some(d => d.code === 'explainer/dependency-hash' && d.message.includes('repository:other')), 'an untouched file must not be reported');
  }
});

test('patching a page with shared content keeps one copy and the retained citations verify (#1426)', t => {
  const { dir, doc, artifact, sharedBase64 } = citedTwiceAndOnce(t);
  const replacement = path.join(dir, 'replacement.json'), output = path.join(dir, 'patched.html');
  fs.writeFileSync(replacement, JSON.stringify({ ...doc.panels[1], title: 'Which steps finish the run?' }));
  const patched = run(['patch', 'explainer', artifact, 'second', replacement, output, '--json']);
  assert.equal(patched.status, 0, patched.stdout + patched.stderr);
  assert.equal(count(fs.readFileSync(output, 'utf8'), sharedBase64), 1);
  const checked = check(output, '--require-provenance');
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test('a page without repeated files keeps every citation inline (#1426)', t => {
  const { dir, doc } = citedTwiceAndOnce(t);
  doc.panels[0].blocks = [{ id: 'early-code', type: 'code', source: 'early' }];
  doc.panels[1].blocks = [{ id: 'other-code', type: 'code', source: 'other' }];
  doc.sources = doc.sources.filter(source => ['early', 'other'].includes(source.id));
  const input = path.join(dir, 'single.json'), artifact = path.join(dir, 'single.html');
  fs.writeFileSync(input, JSON.stringify(doc, null, 2) + '\n');
  const delivered = run(['deliver', 'explainer', input, artifact, '--repo-root', dir, '--json']);
  assert.equal(delivered.status, 0, delivered.stdout + delivered.stderr);
  const raw = rawPayload(artifact);
  assert.equal(raw.dependencyContents, undefined);
  assert.ok(raw.dependencies.every(dep => typeof dep.contentBase64 === 'string' && dep.contentRef === undefined));
});
