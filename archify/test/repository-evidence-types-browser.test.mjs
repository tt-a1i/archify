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
    ['lifecycle', 'states', 'deployment-release.lifecycle.json', false, 'light', { brand: 'github' }],
    ['lifecycle', 'states', 'agent-run.lifecycle.json', false, 'light', {
      label: 'API', sublabel: 'source data', tag: undefined, step: undefined,
      width: 92, height: 52, brand: 'github',
    }],
    ['lifecycle', 'states', 'agent-run.lifecycle.json', false, 'dark', {
      label: 'Awaiting', sublabel: 'source data', tag: 'waiting', step: undefined,
      width: 126, height: 58, brand: 'github',
    }, 'approval'],
    ['lifecycle', 'states', 'deployment-release.lifecycle.json', false, 'dark', {
      label: 'Offline mode', sublabel: 'source data', tag: 'waiting', step: undefined, brand: 'github',
    }],
    ['lifecycle', 'states', 'deployment-release.lifecycle.json', false, 'light', {
      label: '等待人工审批确认', sublabel: '来源已核验', tag: '等待中', step: '02',
    }],
  ];
  for (const [type, collection, example, local, theme, extra = {}, nodeId] of cases) {
    const url = local ? 'http://git.internal/Team/repo' : 'https://github.com/example/evidence-repo';
    git('remote', 'set-url', 'origin', url);
    const diagram = JSON.parse(fs.readFileSync(path.join(root, 'examples', example), 'utf8'));
    const node = Object.assign(nodeId ? diagram[collection].find(node => node.id === nodeId) : diagram[collection][0], extra);
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
        const box = el => el && el.getBoundingClientRect();
        const beaconBox = box(node.querySelector('[data-source-evidence-beacon]'));
        const collisions = [['sigil', '[data-semantic-sigil]'], ['brand', '.brand-mark'], ['label', '[data-node-label]']]
          .filter(([, selector]) => {
            const other = box(node.querySelector(selector));
            return other && beaconBox && beaconBox.left < other.right && other.left < beaconBox.right
              && beaconBox.top < other.bottom && other.top < beaconBox.bottom;
          }).map(([name]) => name);
        const texts = [...node.querySelectorAll('text:not(.source-evidence-beacon text)')];
        // Fine-detail tags/steps must also fit when zoom reveals them.
        texts.forEach(text => {
          text.style.setProperty('display', 'inline', 'important');
          text.style.setProperty('opacity', '1', 'important');
        });
        const textCollisions = texts.flatMap((text, index) => texts.slice(index + 1).flatMap(other => {
          const a = box(text), b = box(other);
          return a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
            ? [[text.textContent, other.textContent]] : [];
        }));
        const shape = box(node.querySelector('rect'));
        const overflowingText = texts.filter(text => {
          const b = box(text);
          return b.width && (b.top < shape.top || b.bottom > shape.bottom || b.left < shape.left || b.right > shape.right);
        }).map(text => text.textContent);
        node.dispatchEvent(new MouseEvent('click', {bubbles:true}));
        const panel = document.getElementById('focus-evidence');
        const rows = [...panel.querySelectorAll('.semantic-passport-source')];
        const finder = document.getElementById('node-finder-input');
        finder.value = 'source.js';
        finder.dispatchEvent(new Event('input', {bubbles:true}));
        return { visible: !panel.hidden, beacon: !!node.querySelector('[data-source-evidence-beacon]'), collisions, textCollisions, overflowingText,
          nodeSize: ['width', 'height'].map(key => Number(node.querySelector('rect').getAttribute(key))),
          labelFont: Number(node.querySelector('text[data-node-label]').getAttribute('font-size')),
          hasBrand: !!node.querySelector('.brand-mark'),
          paths: rows.map(r => r.querySelector('small').textContent),
          links: rows.filter(r => r.tagName === 'A').map(r => r.getAttribute('href')),
          search: document.getElementById('node-finder-results').textContent };
      })()`, returnByValue: true,
    }, session);
    assert.equal(response.exceptionDetails, undefined, type);
    const result = response.result.value;
    assert.equal(result.visible, true, type);
    assert.equal(result.beacon, true, type);
    assert.deepEqual(result.collisions, [], `${type} ${example}: the source badge must not cover the node's sigil, brand, or label`);
    if (Object.keys(extra).length > 1) {
      assert.deepEqual(result.textCollisions, [], `${type} ${node.label}: compact rows must remain separate`);
      assert.deepEqual(result.overflowingText, [], `${type} ${node.label}: compact rows must remain inside the authored box`);
      assert.deepEqual(result.nodeSize, [extra.width || 140, extra.height || 64], 'retain authored/default box dimensions');
      assert.equal(result.labelFont, diagram.schema_version === 2 ? 11 : 10, 'retain the label font size');
    }
    assert.equal(result.hasBrand, Boolean(extra.brand), `${type} ${example}: brand fixture`);
    assert.deepEqual(result.paths, ['source.js'], type);
    assert.deepEqual(result.links, local ? [] : [`${url}/blob/${revision}/source.js#L1-L3`], type);
    assert.ok(result.search.includes(node.label), `${type}: Finder must match the source-backed node`);
  }
});
