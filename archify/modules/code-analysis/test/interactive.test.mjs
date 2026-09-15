// serve: the one path. Archify delivers first; nothing is analyzed until an
// authorized click; a finished analysis is reused; failures are structured.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ARCHIFY_AVAILABLE, BAUIFY_ROOT } from './helpers.mjs';
import { startAnalysisView, parseArgs } from '../bin/serve.mjs';

test('serve: delivers, waits for an authorized click, reuses the completed analysis', { skip: ARCHIFY_AVAILABLE ? false : 'needs an Archify checkout' }, async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-click-analysis-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const fixture = path.join(BAUIFY_ROOT, 'test/fixtures/ts-basic');
  const ir = path.join(out, 'fixture.architecture.json');
  fs.writeFileSync(ir, JSON.stringify({
    schema_version: 1, diagram_type: 'architecture', meta: { title: 'ts-basic', quality_profile: 'standard' },
    components: [
      { id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64]},
      { id: 'lib', type: 'backend', label: 'Lib', pos: [300, 40], size: [170, 64] },
    ],
    connections: [{ from: 'app', to: 'lib', label: 'uses' }],
  }));
  const map = path.join(out, 'map.json'); fs.writeFileSync(map, JSON.stringify({ app: ['src'], lib: ['src-lib'] }));
  const config = path.join(out, 'config.json');
  const view = await startAnalysisView([fixture, '--ir', ir, '--out', path.join(out, 'view'), '--language', 'ts', '--map', map, '--config', config]);
  t.after(() => new Promise((resolve) => { view.server.close(resolve); view.server.closeAllConnections(); }));
  assert.ok(fs.existsSync(view.delivered), 'Archify delivered the diagram before anything else');
  const facts = path.join(out, 'view/analysis/raw-facts.json');
  const page = await (await fetch(view.url)).text();
  assert.match(page, /code-analysis-start/, 'the page carries the Code Analysis button script');
  assert.doesNotMatch(page, /id="bauify-analysis"/, 'no analysis in the page before the click');
  assert.equal(fs.existsSync(facts), false, 'nothing ran before the click');
  assert.equal((await fetch(view.url + '/analyze', { method: 'POST' })).status, 403);
  const headers = { Origin: view.url, 'X-Analysis-Token': view.token };
  assert.equal((await fetch(view.url + '/analyze', { method: 'POST', headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal(fs.existsSync(facts), false);
  // A missing --config file is a structured failure the page can show and retry.
  const failure = await fetch(view.url + '/analyze', { method: 'POST', headers });
  assert.equal(failure.status, 500);
  const body = await failure.json();
  assert.equal(body.diagnostics[0].code, 'cli/config-missing');
  fs.writeFileSync(config, '{}');
  const responses = await Promise.all([1, 2].map(() => fetch(view.url + '/analyze', { method: 'POST', headers })));
  for (const response of responses) { assert.equal(response.status, 200); assert.match(await response.text(), /id="bauify-analysis"/); }
  assert.equal(fs.existsSync(facts), true);
  const written = fs.statSync(facts).mtimeMs;
  assert.equal((await fetch(view.url + '/analyze', { method: 'POST', headers })).status, 200);
  assert.equal(fs.statSync(facts).mtimeMs, written, 'a second click reuses the result');
  assert.equal(fs.readFileSync(view.delivered, 'utf8').includes('bauify-analysis'), false, 'the delivered artifact stays untouched');
});

test('serve: arguments are validated up front', () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['repo', '--ir', 'x.json']), /--out/);
  assert.throws(() => parseArgs(['repo', '--ir', 'x.json', '--out', 'o', '--bogus', '1']), /Invalid option/);
  assert.deepEqual(parseArgs(['repo', '--ir', 'x.json', '--out', 'o', '--language', 'py']).options, { '--ir': 'x.json', '--out': 'o', '--language': 'py' });
});
