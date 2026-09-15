import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const cases = {
  architecture: ['web-app.architecture.json', 'components', 'connections'],
  workflow: ['agent-tool-call.workflow.json', 'nodes', 'edges'],
  sequence: ['cache-miss-request.sequence.json', 'participants', 'messages'],
  dataflow: ['product-analytics.dataflow.json', 'nodes', 'flows'],
  lifecycle: ['agent-run.lifecycle.json', 'states', 'transitions'],
};

test('valid identifiers preserve Viewer selection, chapters, routes and relationship links', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser identifier checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-viewer-ids-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.identifierErrors=[];
      addEventListener('error',event=>identifierErrors.push(event.message));
      addEventListener('unhandledrejection',event=>identifierErrors.push(String(event.reason)));`,
  });
  let navigation = 0;
  async function load(file, hash = '') {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href + `?case=${++navigation}` + hash });
    await loaded;
    await run('document.fonts.ready');
    await run('Archify.viewerChromeLayout.whenStable()');
  }

  for (const [type, [example, nodeCollection, edgeCollection]] of Object.entries(cases)) {
    await t.test(type, async (t) => {
      t.afterEach(async () => assert.deepEqual(await run('identifierErrors'), []));
      const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
      const first = diagram[edgeCollection][0];
      const ids = new Map([[first.from, 'constructor'], [first.to, 'hasOwnProperty']]);
      const rename = id => ids.get(id) ?? id;
      diagram[nodeCollection].forEach(node => { node.id = rename(node.id); });
      diagram[edgeCollection].forEach(edge => { edge.from = rename(edge.from); edge.to = rename(edge.to); });
      (diagram.boundaries || []).forEach(boundary => { boundary.wraps = boundary.wraps.map(rename); });
      (diagram.activations || []).forEach(activation => { activation.participant = rename(activation.participant); });
      if (diagram.mainPath) diagram.mainPath = diagram.mainPath.map(rename);
      first.id = 'toString';
      diagram.meta.views = [
        { id: 'request', label: 'Request', focus: ['constructor', 'hasOwnProperty'] },
        { id: 'destination', label: 'Destination', focus: ['hasOwnProperty'] },
      ];
      const input = path.join(scratch, `${type}.json`);
      const output = path.join(scratch, `${type}.html`);
      fs.writeFileSync(input, JSON.stringify(diagram));
      // Use the public CLI and final artifact: these IDs already satisfy the
      // schema and must retain the same meaning in every shared Viewer.
      const receipt = JSON.parse(execFileSync(process.execPath, [
        path.join(skillRoot, 'bin/archify.mjs'), 'deliver', type, input, output, '--json',
      ], { encoding: 'utf8' }));
      assert.equal(receipt.ok, true);
      const ordinary = diagram[nodeCollection].find(node => !['constructor', 'hasOwnProperty'].includes(node.id)).id;
      const neighborhood = new Set([ordinary]);
      diagram[edgeCollection].forEach(edge => {
        if (edge.from === ordinary) neighborhood.add(edge.to);
        if (edge.to === ordinary) neighborhood.add(edge.from);
      });

      await t.test('focus excludes unselected identifiers', async () => {
        await load(output);
        await run(`Archify.focus.set(${JSON.stringify(ordinary)}, {toggle:false})`);
        assert.deepEqual(await run(`[...document.querySelectorAll('[data-node-id][data-focus-selected]')].map(node=>node.dataset.nodeId)`), [ordinary]);
        assert.deepEqual((await run(`[...document.querySelectorAll('[data-node-id][data-focus-match]')].map(node=>node.dataset.nodeId)`)).sort(), [...neighborhood].sort());
        assert.equal(await run(`Archify.focus.set('valueOf', {toggle:false})`), false, 'an inherited name is not a node unless authored');
      });
      await t.test('Intent Trace includes only the authored neighborhood', async () => {
        await load(output);
        assert.equal(await run(`Archify.intentTrace.show(${JSON.stringify(ordinary)})`), true);
        assert.deepEqual((await run(`[...document.querySelectorAll('[data-node-id][data-intent-trace-match]')].map(node=>node.dataset.nodeId)`)).sort(), [...neighborhood].sort());
      });
      await t.test('Camera does not infer a target from an empty selection', async () => {
        await load(output);
        const before = await run('Archify.view.state()');
        assert.equal(await run('Archify.view.reveal([], {instant:true})'), false);
        assert.deepEqual(await run('Archify.view.state()'), before);
      });
      await t.test('chapters retain every authored stop and exact deltas', async () => {
        await load(output);
        await run(`Archify.guidedViews.activate('request')`);
        assert.deepEqual(await run('Archify.guidedViews.focus()'), ['constructor', 'hasOwnProperty']);
        assert.deepEqual(await run(`Archify.guidedViews.delta('destination')`), {
          stay: ['hasOwnProperty'], enter: [], leave: ['constructor'],
        });
        assert.deepEqual(await run(`[...document.querySelectorAll('[data-story-node]')].map(node=>node.dataset.storyNode)`), ['constructor', 'hasOwnProperty']);
        await run(`Archify.guidedViews.activate('destination')`);
        assert.equal(await run('Archify.focus.active()'), 'hasOwnProperty');
        assert.deepEqual(await run(`Archify.guidedViews.delta('request')`), {
          stay: ['hasOwnProperty'], enter: ['constructor'], leave: [],
        });
      });
      await t.test('Route Probe follows the authored edge and exposes the target', async () => {
        await load(output);
        await run(`Archify.routeProbe.begin({source:'constructor'})`);
        assert.ok((await run('Archify.routeProbe.finderContext().allowedIds')).includes('hasOwnProperty'));
        assert.equal(await run(`Archify.routeProbe.choose('hasOwnProperty')`), true);
        assert.deepEqual((await run('Archify.routeProbe.result()')).nodes, ['constructor', 'hasOwnProperty']);
      });
      await t.test('a unique relationship ID restores from a share link', async () => {
        await load(output, '#relation=toString');
        assert.equal((await run('Archify.focus.relationship()'))?.id, 'toString');
      });
      await t.test('Semantic Lens includes the authored node and its relationships', async () => {
        await load(output);
        const kind = await run(`document.querySelector('[data-node-id="constructor"]').dataset.nodeKind`);
        await run(`Archify.semanticLens.select(${JSON.stringify(kind)})`);
        assert.equal(await run(`document.querySelector('[data-node-id="constructor"]').hasAttribute('data-lens-selected')`), true);
        assert.equal(await run(`document.querySelector('[data-edge-id="toString"]').hasAttribute('data-lens-match')`), true);
      });
    });
  }
});
