import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = Object.hasOwn(process.env, 'ARCHIFY_CHROME') ? findChrome() : null;

test('non-architecture sources reach real Viewer beacons, Focus and Finder', {
  skip: !chrome,
  timeout: 60000,
}, async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typed-evidence-browser-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.writeFileSync(path.join(repo, 'source.js'), 'export function source() {\n  return true;\n}\n');
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('add', 'source.js');
  git('commit', '-m', 'source fixture');
  git('remote', 'add', 'origin', 'https://github.com/example/evidence-repo');
  const revision = git('rev-parse', 'HEAD');
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const cases = [
    ['workflow', 'nodes', 'agent-tool-call.workflow.json', false, 'light'],
    ['sequence', 'participants', 'cache-miss-request.sequence.json', false, 'dark'],
    ['dataflow', 'nodes', 'product-analytics.dataflow.json', true, 'light'],
    ['lifecycle', 'states', 'agent-run.lifecycle.json', true, 'dark'],
  ];
  for (const [type, collection, example, local, theme] of cases) {
    const url = local ? 'http://git.internal/Team/repo' : 'https://github.com/example/evidence-repo';
    git('remote', 'set-url', 'origin', url);
    const diagram = JSON.parse(fs.readFileSync(path.join(root, 'examples', example), 'utf8'));
    const node = diagram[collection][0];
    node.sources = [{ path: 'source.js', line: 1, end_line: 3 }];
    diagram.meta.repository = { url, revision, ...(local ? { link_mode: 'local-only' } : {}) };
    const input = path.join(repo, `${type}.json`), artifactPath = path.join(repo, `${type}.html`);
    fs.writeFileSync(input, JSON.stringify(diagram));
    execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', type, input, artifactPath, '--repo-root', repo, '--json'], { encoding: 'utf8' });
    await browser.inspect({ artifactPath, width: 1440, height: 900, theme });
    const session = await browser.sessionPromise;
    const response = await browser.cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const node = [...document.querySelectorAll('[data-node-id]')].find(n => n.dataset.nodeId === ${JSON.stringify(node.id)});
        node.dispatchEvent(new MouseEvent('click', {bubbles:true}));
        const panel = document.getElementById('focus-evidence');
        const rows = [...panel.querySelectorAll('.semantic-passport-source')];
        const finder = document.getElementById('node-finder-input');
        finder.value = 'source.js';
        finder.dispatchEvent(new Event('input', {bubbles:true}));
        return { visible: !panel.hidden, beacon: !!node.querySelector('[data-source-evidence-beacon]'),
          paths: rows.map(r => r.querySelector('small').textContent),
          links: rows.filter(r => r.tagName === 'A').map(r => r.getAttribute('href')),
          search: document.getElementById('node-finder-results').textContent };
      })()`, returnByValue: true,
    }, session);
    assert.equal(response.exceptionDetails, undefined, type);
    const result = response.result.value;
    assert.equal(result.visible, true, type);
    assert.equal(result.beacon, true, type);
    assert.deepEqual(result.paths, ['source.js'], type);
    assert.deepEqual(result.links, local ? [] : [`${url}/blob/${revision}/source.js#L1-L3`], type);
    assert.ok(result.search.includes(node.label), `${type}: Finder must match the source-backed node`);
  }
});
