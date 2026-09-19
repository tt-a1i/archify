import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('shared large-world Viewer provides a fixed readable stage for Workflow and Architecture', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run the required large-world browser contract.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-large-world-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  function artifact(type, example, suffix, worldWidth, worldHeight) {
    const output = path.join(scratch, `${type}-${suffix}.html`);
    execFileSync(process.execPath, [
      path.join(skillRoot, `renderers/${type}/render-${type}.mjs`),
      path.join(skillRoot, 'examples', example),
      output,
    ]);
    if (worldWidth) {
      const source = fs.readFileSync(output, 'utf8').replace(
        /(<svg\b[^>]*\bviewBox=")[^"]+("[^>]*>)/,
        (_, before, after) => `${before}0 0 ${worldWidth} ${worldHeight}${after}`,
      );
      fs.writeFileSync(output, source);
    }
    return output;
  }

  const fixtures = {
    architecture: {
      small: artifact('architecture', 'web-app.architecture.json', 'small'),
      large100: artifact('architecture', 'web-app.architecture.json', '100', 6000, 3000),
      large300: artifact('architecture', 'web-app.architecture.json', '300', 12000, 6000),
    },
    workflow: {
      small: artifact('workflow', 'agent-tool-call.workflow.json', 'small'),
      large100: artifact('workflow', 'agent-tool-call.workflow.json', '100', 6000, 3000),
      large300: artifact('workflow', 'agent-tool-call.workflow.json', '300', 12000, 6000),
    },
  };

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  let loadSequence = 0;
  async function load(file, hash = '') {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    const result = await send('Page.navigate', {
      url: pathToFileURL(file).href + '?theme=light&load=' + (++loadSequence) + hash,
    });
    assert.equal(result.errorText, undefined);
    await loaded;
    await evaluate(`(async()=>{
      await document.fonts.ready;
      await Archify.readerLayout.whenStable();
      await Archify.viewerChromeLayout.whenStable();
      for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
    })()`);
  }
  async function snapshot() {
    return evaluate(`(()=>{
      const html=document.documentElement,diagram=document.querySelector('.diagram-container'),svg=diagram.querySelector(':scope > svg');
      const receipt=Archify.readerLayout.receipt(),state=Archify.view.state(),vb=svg.viewBox.baseVal;
      const entry=(diagram.getAttribute('data-automatic-entry')||'').split(/\\s+/).filter(Boolean);
      const labels=entry.map(id=>{const node=[...svg.querySelectorAll('[data-node-id]')].find(n=>n.getAttribute('data-node-id')===id);return node&&(node.querySelector('text[data-node-label]')||node.querySelector('text'));}).filter(Boolean);
      const sourceFont=labels.length?Math.min(...labels.map(label=>parseFloat(getComputedStyle(label).fontSize))):0;
      const fit=Math.min(svg.clientWidth/vb.width,svg.clientHeight/vb.height);
      const rect=diagram.getBoundingClientRect(),cards=document.querySelector('.cards')?.getBoundingClientRect();
      return {receipt,state,viewBox:[vb.x,vb.y,vb.width,vb.height],entry,projectedEntryPx:sourceFont*fit*state.scale,
        client:[diagram.clientWidth,diagram.clientHeight],rect:{top:rect.top,bottom:rect.bottom},cards:cards&&{top:cards.top,bottom:cards.bottom},
        scroll:[html.scrollWidth,html.scrollHeight,innerWidth,innerHeight],diagnostic:diagram.getAttribute('data-camera-diagnostic')};
    })()`);
  }

  for (const [type, set] of Object.entries(fixtures)) {
    await load(set.small);
    assert.equal((await snapshot()).receipt.worldProfile, 'small', `${type} control`);

    const stages = [];
    for (const key of ['large100', 'large300']) {
      await load(set[key]);
      const current = await snapshot();
      assert.equal(current.receipt.worldProfile, 'large', `${type} ${key}`);
      assert.ok(current.state.scale > 3, `${type} ${key} dynamic scale: ${JSON.stringify(current)}`);
      assert.ok(current.projectedEntryPx >= 6, `${type} ${key} readable entry: ${JSON.stringify(current)}`);
      assert.ok(current.entry.length > 0, `${type} ${key} deterministic entry`);
      assert.equal(current.diagnostic, null);
      assert.ok(current.scroll[0] <= current.scroll[2] && current.scroll[1] <= current.scroll[3], `${type} ${key} containment`);
      assert.ok(current.rect.bottom <= current.scroll[3] + 1);
      assert.ok(!current.cards || current.cards.bottom <= current.scroll[3] + 1);
      assert.ok(Math.abs(current.client[1] - current.receipt.stageHeight) <= 2);
      stages.push(current.client);
      const canonical = current.viewBox;
      await evaluate('Archify.view.reset()');
      const reset = await snapshot();
      assert.equal(reset.state.scale, 1);
      assert.deepEqual(reset.viewBox, canonical);
    }
    assert.ok(Math.abs(stages[0][0] - stages[1][0]) <= 1, `${type} fixed width`);
    assert.ok(Math.abs(stages[0][1] - stages[1][1]) <= 1, `${type} fixed height`);
  }

  await load(fixtures.architecture.large300, '#focus=api');
  const deepLink = await snapshot();
  assert.equal(deepLink.entry.length, 0, 'explicit deep link suppresses automatic entry');
  assert.equal(await evaluate('Archify.focus.active()'), 'api');

  await load(fixtures.architecture.large300, '#focus=missing-node');
  const invalidDeepLink = await snapshot();
  assert.equal(invalidDeepLink.entry.length, 0, 'an invalid explicit deep link does not select another semantic target');
  assert.equal(invalidDeepLink.state.scale, 1, 'an invalid explicit deep link falls back to the complete world');
  assert.equal(invalidDeepLink.diagnostic, 'viewer/semantic-id-invalid');
  assert.equal(await evaluate('Archify.focus.active()'), null);

  await load(fixtures.architecture.small);
  const validAudit = await browser.auditCanonicalWorld();
  assert.equal(validAudit.worldReachability.status, 'pass', JSON.stringify(validAudit));
  await evaluate(`(()=>{
    const svg=document.querySelector('.diagram-container > svg');
    const node=svg.querySelector('[data-node-id]');
    svg.appendChild(node.cloneNode(true));
  })()`);
  const duplicateAudit = await browser.auditCanonicalWorld();
  assert.equal(duplicateAudit.worldReachability.status, 'fail');
  assert.ok(duplicateAudit.diagnostics.some((entry) => entry.code === 'viewer/semantic-id-invalid'));

  await load(fixtures.architecture.small);
  await evaluate(`(()=>{
    const svg=document.querySelector('.diagram-container > svg');
    const edge=svg.querySelector('path[data-edge-key]');
    edge.removeAttribute('data-edge-to');
  })()`);
  const endpointAudit = await browser.auditCanonicalWorld();
  assert.equal(endpointAudit.worldReachability.status, 'fail');
  assert.ok(endpointAudit.diagnostics.some((entry) => entry.code === 'viewer/semantic-endpoint-invalid'));
});
