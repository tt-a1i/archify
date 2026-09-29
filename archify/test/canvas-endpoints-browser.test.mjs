import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
if (process.env.ARCHIFY_CHROME && !chrome) throw new Error('ARCHIFY_CHROME is not executable');

test('native canvas drags reach both ends of long, wide and optional local diagrams', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to check native endpoint reachability.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-canvas-ends-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_ENDPOINT_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => { if (evidence) fs.writeFileSync(path.join(evidence, 'endpoints.json'), JSON.stringify(records, null, 2) + '\n'); });
  const cases = [
    { name: 'long-300', mode: 'workflow', spec: path.resolve(root, '../benchmarks/hybrid-large-world-viewer-pilot/corpus/workflow-300.workflow.json'), axis: 'y' },
  ];
  const wide = JSON.parse(fs.readFileSync(path.join(root, 'examples/cache-miss-request.sequence.json'), 'utf8'));
  wide.meta.viewBox[0] = 24000;
  const wideSpec = path.join(scratch, 'wide.json');
  fs.writeFileSync(wideSpec, JSON.stringify(wide));
  cases.push({ name: 'wide', mode: 'sequence', spec: wideSpec, axis: 'x', minWidth: '24000px' });
  for (const fixture of cases) {
    fixture.file = path.join(scratch, fixture.name + '.html');
    execFileSync(process.execPath, [path.join(root, `renderers/${fixture.mode}/render-${fixture.mode}.mjs`), fixture.spec, fixture.file]);
  }
  if (process.env.ARCHIFY_FIXED_CANVAS_ARTIFACT) cases.push({ name: 'local-artifact', file: process.env.ARCHIFY_FIXED_CANVAS_ARTIFACT, axis: 'y' });
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  for (const fixture of cases) await t.test(fixture.name, async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(fixture.file).href + '?theme=light' });
    await loaded;
    if (fixture.minWidth) await run(`document.querySelector('.diagram-container > svg').style.minWidth=${JSON.stringify(fixture.minWidth)}`);
    await run('(async()=>{await document.fonts.ready;await Archify.readerLayout.whenStable();await Archify.viewerChromeLayout.whenStable();})()');
    // Endpoint traversal is intentionally measured at the authored 100% size.
    await run('Archify.view.reset()');await frames();
    const initial = await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');const nodes=[...svg.querySelectorAll('[data-node-id]')].map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.nodeId,x:r.left+r.width/2,y:r.top+r.height/2};}).sort((a,b)=>a.${fixture.axis}-b.${fixture.axis});return {ends:[nodes[0],nodes.at(-1)],viewBox:svg.getAttribute('viewBox'),texts:[...svg.querySelectorAll('text')].map(n=>n.textContent),state:Archify.view.state()};})()`);
    let initiallyOutside = false;
    for (const [index, end] of initial.ends.entries()) {
      async function geometry() {
        return run(`(()=>{const node=[...document.querySelectorAll('.diagram-container > svg [data-node-id]')].find(n=>n.dataset.nodeId===${JSON.stringify(end.id)}),r=node.getBoundingClientRect(),s=Archify.viewerChromeLayout.stageRect();return {node:{x:r.left+r.width/2,y:r.top+r.height/2},stage:s,state:Archify.view.state(),page:[scrollX,scrollY],range:[document.scrollingElement.scrollWidth-innerWidth,document.scrollingElement.scrollHeight-innerHeight]};})()`);
      }
      let current = await geometry();
      const visible = g => g.node.x >= g.stage.left + 8 && g.node.x <= g.stage.right - 8 && g.node.y >= g.stage.top + 8 && g.node.y <= g.stage.bottom - 8;
      if (!visible(current)) initiallyOutside = true;
      let drags = 0;
      // Use bounded, native middle-button drags. No panBy, reveal, centerAt or Fit all.
      // Repeated grabs model a user traversing a document longer than the screen.
      while (drags < 150) {
        const stage = current.stage;
        const x = (stage.left + stage.right) / 2, y = (stage.top + stage.bottom) / 2;
        const dx = x - current.node.x, dy = y - current.node.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
        const fraction = Math.min(1, (stage.right - stage.left) / 3 / Math.max(1, Math.abs(dx)), (stage.bottom - stage.top) / 3 / Math.max(1, Math.abs(dy)));
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        const hit = await run(`(()=>{const e=document.elementFromPoint(${x},${y});return {tag:e?.tagName,classes:e?.getAttribute('class'),relationship:e?.closest('[data-relationship-hit-key]')?.getAttribute('data-relationship-hit-key'),panel:e?.closest('.semantic-lens, .diagram-nav, .overview-map')?.id};})()`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'middle', buttons: 4, clickCount: 1 });
        assert.equal(await run(`document.querySelector('.diagram-container').classList.contains('is-panning')`), true,
          JSON.stringify({fixture:fixture.name,end,drags,hit,current}));
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * fraction, y: y + dy * fraction, button: 'middle', buttons: 4 });
        await frames();
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx * fraction, y: y + dy * fraction, button: 'middle', buttons: 0, clickCount: 1 });
        await frames();
        current = await geometry();
        drags++;
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      assert.ok(visible(current), JSON.stringify({ fixture: fixture.name, end, drags, current }));
      assert.equal(current.state.scale, initial.state.scale);
      assert.deepEqual(current.page, [0, 0]);
      assert.ok(current.range.every(value => value <= 1));
      assert.equal(await run(`document.querySelector('.diagram-container').classList.contains('is-panning')`), false);
      if (evidence) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(evidence, `${fixture.name}-${index}.png`), Buffer.from(shot.data, 'base64'));
      }
      records.push({ fixture: fixture.name, end, drags, current });
    }
    assert.ok(initiallyOutside, fixture.name + ': an endpoint must actually need navigation');
    assert.deepEqual(await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');return {viewBox:svg.getAttribute('viewBox'),texts:[...svg.querySelectorAll('text')].map(n=>n.textContent)};})()`), { viewBox: initial.viewBox, texts: initial.texts });
  });
});
