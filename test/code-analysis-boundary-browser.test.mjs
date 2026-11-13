import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('Code Analysis shows configured architecture boundaries in the overview, problem page and component panel', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  for (const dir of ['src/domain', 'src/ui', 'src/shared']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/domain/order.ts'), "import { Button } from '../ui/button.js';\nimport { money } from '../shared/money.js';\nexport const order = () => Button(money(3));\n");
  fs.writeFileSync(path.join(root, 'src/domain/price.ts'), "import type { Fmt } from '../ui/format.js';\nexport const price: Fmt | null = null;\n");
  fs.writeFileSync(path.join(root, 'src/ui/button.ts'), 'export const Button = (x: string) => x;\n');
  fs.writeFileSync(path.join(root, 'src/ui/format.ts'), 'export type Fmt = (n: number) => string;\n');
  fs.writeFileSync(path.join(root, 'src/shared/money.ts'), "export const money = (n: number) => '$' + n;\n");
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Boundary browser regression', output: 'architecture.html' },
    components: [
      { id: 'core', type: 'backend', label: 'Domain', pos: [40, 60], size: [180, 64] },
      { id: 'web', type: 'frontend', label: 'UI', pos: [340, 60], size: [180, 64] },
      { id: 'lib', type: 'backend', label: 'Shared', pos: [190, 220], size: [180, 64] },
    ], connections: [{ from: 'web', to: 'core', label: 'calls' }, { from: 'core', to: 'lib', label: 'uses' }] }));
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ core: ['src-domain'], web: ['src-ui'], lib: ['src-shared'] }));
  const config = path.join(scratch, 'analysis.config.json');
  fs.writeFileSync(config, JSON.stringify({ boundaries: {
    layers: { domain: ['src/domain/**'], ui: ['src/ui/**'], shared: ['src/shared/**'], legacy: ['old/**'] },
    rules: [{ from: 'domain', disallow: ['ui'], reason: 'domain logic stays UI-free' }],
  } }));
  const view = await startAnalysisView([root, '--ir', ir, '--map', map, '--config', config, '--out', path.join(scratch, 'view'), '--language', 'ts']);
  const sockets = new Set();
  view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  // Poll from Node in short evaluations so a slow analysis never trips the per-command DevTools timeout.
  const wait = async expression => {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      if (await run(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url });
  await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");

  const overview = await run("document.getElementById('bauify-overview').innerText");
  assert.match(overview, /domain depends on ui/);
  assert.match(overview, /2 imports in 2 files · rule: domain logic stays UI-free/);
  const lead = await run("document.querySelector('.priority-card [data-finding]').textContent");
  assert.match(lead, /domain depends on ui/);
  assert.doesNotMatch(lead, /cycle|initialization/i, 'a layer violation is not presented as a cycle');
  const coverage = await run("document.querySelector('#bauify-overview .cov') ? document.querySelector('#bauify-overview .cov').textContent : document.getElementById('bauify-overview').textContent");
  assert.match(coverage, /Boundaries: 4 layers, 1 rule/);
  assert.match(coverage, /Layer "legacy" matches no analyzed file/);

  await run("[...document.querySelectorAll('#bauify-overview .bauify-item')].find(b => /depends on/.test(b.textContent)).click()");
  await wait("!document.getElementById('bauify-detail').hidden");
  await run("document.querySelector('#bauify-detail .more-evidence').open = true");
  const problem = await run("document.getElementById('bauify-detail').innerText");
  assert.match(problem, /The rule comes from the config, not from the diagram/);
  assert.match(problem, /order\.ts \(line 1\) → ui\/button\.ts · module-scope import/);
  assert.match(problem, /price\.ts \(line 1\) → ui\/format\.ts · type-only import/);
  assert.equal(await run("document.querySelectorAll('#bauify-detail svg.diagram rect.node').length"), 2, 'one layer pair, two layer boxes');
  assert.equal(await run("document.querySelector('g[data-node-id=core]').classList.contains('bauify-focus') && document.querySelector('g[data-node-id=web]').classList.contains('bauify-focus') && !document.querySelector('g[data-node-id=lib]').classList.contains('bauify-focus')"), true, 'both ends lit, the uninvolved component dimmed');

  await run("document.querySelector('#bauify-detail [data-file=\"src/domain/order.ts\"]').click()");
  await wait("!document.getElementById('bauify-code').hidden");
  assert.match(await run("document.getElementById('bauify-code').textContent"), /import \{ Button \} from '\.\.\/ui\/button\.js'/);

  await run("document.querySelector('g[data-node-id=core]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await wait("!document.getElementById('bauify-panel').hidden");
  assert.match(await run("document.getElementById('bauify-panel').innerText"), /Architecture boundary/);
  await run("document.querySelector('#bauify-panel .ind.link[data-ind=boundary]').click()");
  await wait("!document.getElementById('bauify-detail').hidden");
  assert.match(await run("document.getElementById('bauify-detail').innerText"), /domain → ui \(2 imports\) cross a configured boundary/);

  await run("document.querySelector('g[data-node-id=lib]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await wait("!document.getElementById('bauify-panel').hidden");
  assert.doesNotMatch(await run("document.getElementById('bauify-panel').innerText"), /Architecture boundary/, 'no boundary claim where nothing crosses');
});
