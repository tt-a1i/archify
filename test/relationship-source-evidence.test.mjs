import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { evidencePayload, fixture, run } from './helpers/repository-evidence-fixture.mjs';

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('Architecture connection evidence is verified and published separately without changing SVG geometry', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const connection = data.diagram.connections[0];
  assert.ok(connection.id, 'fixture connection needs a stable relationship id');
  connection.sources = [{ path: 'src/router.js', line: 1, end_line: 3, label: 'Request handoff' }];

  const plainInput = path.join(data.root, 'plain.architecture.json');
  const plainOutput = path.join(data.root, 'plain.html');
  const evidenceOutput = path.join(data.root, 'evidence.html');
  const plain = structuredClone(data.diagram);
  delete plain.connections[0].sources;
  fs.writeFileSync(plainInput, JSON.stringify(plain));
  assert.equal(run(['deliver', 'architecture', plainInput, plainOutput, '--repo-root', data.root, '--json']).status, 0);

  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const delivered = run(['deliver', 'architecture', data.input, evidenceOutput, '--repo-root', data.root, '--json']);
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  const evidence = evidencePayload(fs.readFileSync(evidenceOutput, 'utf8'));
  assert.deepEqual(evidence.relationships[connection.id], [{
    path: 'src/router.js',
    line: 1,
    endLine: 3,
    label: 'Request handoff',
    href: `https://github.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-L3`,
  }]);
  assert.equal(evidence.referenceCount, 3);
  assert.equal(canonicalSvg(fs.readFileSync(evidenceOutput, 'utf8')), canonicalSvg(fs.readFileSync(plainOutput, 'utf8')));
});

test('Architecture connection evidence rejects missing relationship identity and unsafe source paths', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const connection = data.diagram.connections[0];
  connection.sources = [{ path: '../escape.js' }];
  delete connection.id;
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));

  const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.diagnostics.map(({ code, subject }) => [code, subject.path]), [
    ['repository-evidence/relationship-id-required', '/connections/0/id'],
  ]);

  connection.id = 'users-to-cdn';
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const unsafe = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(unsafe.status, 1);
  assert.deepEqual(JSON.parse(unsafe.stdout).diagnostics.map(({ code, subject }) => [code, subject.path]), [
    ['repository-evidence/path-escape', '/connections/0/sources/0/path'],
  ]);
});
