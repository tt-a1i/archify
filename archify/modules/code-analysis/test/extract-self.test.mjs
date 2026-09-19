// Self-bootstrap: extract the archify/ renderer package itself. These checks are
// the first half of the M1 acceptance gate (the second half is the module graph).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ARCHIFY_AVAILABLE, ARCHIFY_PACKAGE, runExtract } from './helpers.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const ARCHIFY = ARCHIFY_PACKAGE;
const SKIP = ARCHIFY_AVAILABLE ? false : 'set BAUIFY_ARCHIFY_ROOT to a tt-a1i/archify checkout';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bauify-self-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, 'config.json');
  const selfConfig = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url)));
  // Local test workspaces and analysis outputs are not part of the self fixture.
  selfConfig.exclude.push('modules/code-analysis/test/fixtures/**', '.validator-check-*/**', 'out/**');
  fs.writeFileSync(config, JSON.stringify(selfConfig));
  return { config, output: (name) => path.join(root, name) };
}

function edges(facts, from) {
  return facts.imports.filter((i) => i.from === from && i.resolved).map((i) => i.to).sort();
}

test('extract: archify/ self-bootstrap passes schema and is byte-for-byte deterministic', { skip: SKIP }, (t) => {
  const { config, output } = workspace(t);
  const OUT_A = output('facts-a.json');
  const OUT_B = output('facts-b.json');
  assert.equal(runExtract([ARCHIFY, '--language', 'ts', '--config', config, '--out', OUT_A]).status, 0);
  assert.equal(runExtract([ARCHIFY, '--language', 'ts', '--config', config, '--out', OUT_B]).status, 0);
  assert.equal(fs.readFileSync(OUT_A, 'utf8'), fs.readFileSync(OUT_B, 'utf8'));
  const facts = JSON.parse(fs.readFileSync(OUT_A, 'utf8'));
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  assert.equal(facts.unresolved.unknown, 0, 'every path-like import inside archify/ must resolve');
  assert.equal(facts.repository.sourceKind, 'working-tree');
  assert.equal(facts.repository.revision, null);
  assert.match(facts.repository.baseRevision, /^[a-f0-9]{40}$/);
});

test('extract: hand-verified import lists for two archify files', { skip: SKIP }, (t) => {
  // Independent of test ordering: this test produces its own extraction.
  const { config, output } = workspace(t);
  const OUT_C = output('facts.json');
  assert.equal(runExtract([ARCHIFY, '--language', 'ts', '--config', config, '--out', OUT_C]).status, 0);
  const facts = JSON.parse(fs.readFileSync(OUT_C, 'utf8'));
  // renderers/shared/validator.mjs — verified by hand against its two import lines.
  assert.deepEqual(edges(facts, 'renderers/shared/validator.mjs'), [
    'renderers/shared/diagnostics.mjs',
    'renderers/shared/generated-validators.mjs',
  ]);
  // bin/archify.mjs reaches renderers only through dynamic imports (lazy loading).
  const binImports = facts.imports.filter((i) => i.from === 'bin/archify.mjs' && i.resolved);
  assert.ok(binImports.length > 0);
  assert.ok(binImports.some((i) => i.kind === 'dynamic' && i.to.startsWith('renderers/')));
  // roles: test wins over generated (test/generated-artifact-xml.test.mjs is a test),
  // and the two real generated files carry the generated role.
  for (const f of facts.files) if (f.path.startsWith('test/')) assert.equal(f.role, 'test', f.path);
  assert.deepEqual(facts.files.filter((f) => f.role === 'generated').map((f) => f.path), [
    'renderers/shared/generated-brand-marks.mjs',
    'renderers/shared/generated-validators.mjs',
  ]);
});
