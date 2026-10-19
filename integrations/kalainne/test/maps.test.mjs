import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const manifest = JSON.parse(read('integrations/kalainne/manifest.json'));

test('manifest lists three showcase maps with existing files', () => {
  assert.equal(manifest.quality_profile, 'showcase');
  assert.equal(manifest.maps.length, 3);
  for (const map of manifest.maps) {
    assert.equal(fs.existsSync(path.join(repoRoot, map.source)), true, map.source);
    assert.equal(fs.existsSync(path.join(repoRoot, map.artifact)), true, map.artifact);
  }
});

test('routing workflow keeps the Kalainne proof gates', () => {
  const workflow = JSON.parse(read('integrations/kalainne/sources/roteamento.workflow.json'));
  assert.equal(workflow.schema_version, 2);
  assert.deepEqual(workflow.semanticChecks.allowedRoots, ['pedido']);
  assert.deepEqual(workflow.semanticChecks.allowedTerminals, ['registro', 'rascunho']);
  const edges = workflow.semanticChecks.requiredEdges.map((edge) => `${edge.from}->${edge.to}`);
  assert.deepEqual(edges, ['leitura->mapa', 'mapa->entrega', 'entrega->guardian']);
});

test('architecture keeps Hermes out of the operational path', () => {
  const architecture = JSON.parse(read('integrations/kalainne/sources/ecossistema.architecture.json'));
  const hermes = architecture.components.find((component) => component.id === 'hermes');
  assert.equal(hermes.tag, 'modo spec');
  assert.equal(architecture.connections.some((connection) => connection.from === 'hermes' || connection.to === 'hermes'), false);
});

test('delivered HTML contains the authored titles', () => {
  const expected = [
    ['integrations/kalainne/artifacts/ecossistema.architecture.html', 'Ecossistema Kalainne'],
    ['integrations/kalainne/artifacts/roteamento.workflow.html', 'Roteamento Kalainne'],
    ['integrations/kalainne/artifacts/conhecimento.dataflow.html', 'Conhecimento Kalainne'],
  ];
  for (const [relativePath, title] of expected) {
    assert.match(read(relativePath), new RegExp(`<h1>${title}</h1>`));
  }
});

test('showcase validation accepts every Kalainne map', () => {
  for (const map of manifest.maps) {
    const result = spawnSync(process.execPath, [
      'archify/bin/archify.mjs',
      'validate',
      map.type,
      map.source,
      '--quality',
      'showcase',
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.checks.length, 9);
    assert.equal(receipt.composition.summary.errors, 0);
    assert.equal(receipt.composition.summary.warnings, 0);
  }
});
