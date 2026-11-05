import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

test('decision conditions survive native focus, collapsed mobile relations, Still and SVG export', async (t) => {
  if (!process.env.ARCHIFY_CHROME) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-decision-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.json');
  const artifact = path.join(dir, 'workflow.html');
  const document = JSON.parse(fs.readFileSync(path.join(root, 'archify/examples/agent-tool-call.workflow.json')));
  document.edges.find(edge => edge.id === 'approved-tool').label = 'run tool';
  fs.writeFileSync(input, JSON.stringify(document));
  execFileSync(process.execPath, [path.join(root, 'archify/renderers/workflow/render-workflow.mjs'), input, artifact]);
  const browser = new ChromeVisualBrowser(findChrome());
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.exportBlobs=new Map();window.downloads=[];window.pageErrors=[];
    addEventListener('error',e=>pageErrors.push(e.message));
    addEventListener('unhandledrejection',e=>pageErrors.push(String(e.reason)));
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{const url=create(b);exportBlobs.set(url,b);return url;};
    const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){downloads.push(exportBlobs.get(this.href));return;}return click.call(this);};
  ` });
  for (const [width, theme, reduced] of [[1440, 'light', false], [1440, 'dark', true], [390, 'light', true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(artifact).href + '?theme=' + theme });
    await loaded;
    await run('document.fonts.ready');
    if (!reduced) await run("Archify.motionGovernor.setMode('still')");
    await run('Archify.layoutStability.whenStable()');
    const labels = await run(`(()=>{
      return [...document.querySelectorAll('g[data-edge-id="approved-tool"],g[data-edge-id="approval-denied"]')].map(g=>{
        const text=g.querySelector('text'),r=text.getBBox(),mask=g.querySelector('rect').getBBox();
        let visible=true;for(let p=text;p;p=p.parentElement){const s=getComputedStyle(p);visible&&=s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;}
        return {text:text.textContent,visible,fits:r.x>=mask.x-1&&r.x+r.width<=mask.x+mask.width+1};
      });
    })()`);
    assert.deepEqual(labels.map(l=>l.text).sort(), ['approved · run tool', 'denied']);
    assert.ok(labels.every(l=>l.visible&&l.fits));
    assert.equal(await run('document.documentElement.dataset.motion'), 'still');
    // Use native keyboard activation, then the existing mobile disclosure.
    await run("document.querySelector('[data-node-id=approval]').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await run('Archify.layoutStability.whenStable()');
    assert.equal(await run("document.getElementById('focus-chip').hidden"), false);
    if (width < 600) {
      assert.equal(await run("document.getElementById('btn-focus-relations').getAttribute('aria-expanded')"), 'false');
      await run("document.getElementById('btn-focus-relations').click()");
    }
    const passport = await run("document.getElementById('focus-chip').innerText");
    assert.match(passport, /SECURITY/);
    assert.match(passport, /Decision/);
    assert.match(passport, /approved · run tool/);
    assert.match(passport, /denied/);
    await run('Archify.focus.clear(); Archify.exportMenu.run("svg")');
    const exported = await run('downloads.at(-1).text()');
    assert.match(exported, />approved · run tool<\/text>/);
    assert.match(exported, />denied<\/text>/);
    assert.match(exported, /data-semantic-sigil="decision"/);
    assert.deepEqual(await run('pageErrors'), []);
  }
});
