import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/lifecycle-planner/band-title-overlap.lifecycle.json')));
function run(t, doc, command = 'validate') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-band-title-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.json'), output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const args = command === 'render' ? [output] : ['--quality', doc.meta.quality_profile, '--json'];
  const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), command, 'lifecycle', input, ...args], { encoding: 'utf8' });
  return { ...result, output };
}
test('automatic lifecycle labels avoid band headings on the reported fixture', t => {
  const result = run(t, fixture);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const [index, y] of [100, 252, 424].entries()) {
  test(`explicit collision with band ${index + 1} is diagnosed without changing authored coordinates`, t => {
    const doc = structuredClone(fixture);
    doc.transitions[0].labelAt = [100, y - 5];
    const result = run(t, doc);
    assert.equal(result.status, 1, result.stdout);
    const diagnostic = JSON.parse(result.stdout).diagnostics.find(d => d.code === 'composition/label-band-title-overlap');
    assert.ok(diagnostic, result.stdout);
    assert.equal(diagnostic.evidence.bandTitle.index, index);
    assert.equal(diagnostic.subject.index, 0);
    const box = diagnostic.evidence.labelRect;
    assert.equal(box.x + box.width / 2, 100);
    assert.equal(box.y + 11, y - 5);
  });
}
test('same-label collisions retain a diagnostic for each transition', t => {
  const doc = structuredClone(fixture);
  const indexes = [];
  doc.transitions.forEach((transition, index) => {
    if (transition.label !== '申请退款') return;
    indexes.push(index);
    transition.labelAt = [100 + indexes.length * 5, 95];
  });
  assert.equal(indexes.length, 2);
  const result = run(t, doc);
  assert.equal(result.status, 1, result.stdout);
  const diagnostics = JSON.parse(result.stdout).diagnostics.filter(d => d.code === 'composition/label-band-title-overlap');
  assert.deepEqual(diagnostics.map(d => d.subject.index), indexes);
  diagnostics.forEach((diagnostic, i) => {
    const transition = doc.transitions[indexes[i]];
    assert.equal(diagnostic.subject.from, transition.from);
    assert.equal(diagnostic.subject.to, transition.to);
    assert.equal(diagnostic.evidence.bandTitle.index, 0);
    const box = diagnostic.evidence.labelRect;
    assert.equal(box.x + box.width / 2, transition.labelAt[0]);
  });
});
test('standard preserves authored label placement', t => {
  const doc = structuredClone(fixture);
  doc.meta.quality_profile = 'standard';
  doc.states = doc.states.slice(0, 2);
  doc.transitions = doc.transitions.slice(0, 1);
  doc.transitions[0].labelAt = [100, 95];
  const result = run(t, doc, 'render');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(fs.readFileSync(result.output, 'utf8'), /<text x="100" y="95"/);
});
test('real browser keeps all band titles clear in both themes, including long Chinese headings', { skip: !process.env.ARCHIFY_CHROME }, async t => {
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    const session = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    for (const long of [false, true]) {
      const doc = structuredClone(fixture);
      if (long) doc.lanes[0].label = '下单与履约流程及付款状态';
      const result = run(t, doc, 'render');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      for (const theme of ['light', 'dark']) {
        const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
        await browser.cdp.send('Page.navigate', { url: `${pathToFileURL(result.output).href}?theme=${theme}` }, session);
        await loaded;
        const response = await browser.cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{await document.fonts.ready;const titles=[...document.querySelectorAll('svg text')].filter(t=>/^0[123] \\/ /.test(t.textContent));const masks=[...document.querySelectorAll('g[data-edge-from] > rect.c-mask')];const hits=[];for(const title of titles){const a=title.getBBox();for(const mask of masks){const b=mask.getBBox();if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)hits.push(title.textContent);}}return {count:titles.length,hits};})()` }, session);
        assert.equal(response.exceptionDetails, undefined);
        assert.equal(response.result.value.count, 3);
        assert.deepEqual(response.result.value.hits, [], `${theme}, long=${long}`);
      }
    }
  } finally { await browser.close(); }
});
