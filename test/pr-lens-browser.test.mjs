import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { cli, git, skillRoot } from './helpers/repository-evidence-fixture.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';

const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
if (process.env.ARCHIFY_CHROME && !chromePath) throw new Error('ARCHIFY_CHROME must point to an executable browser.');

test('moved offline Lens keeps diagram geometry fixed and supports the complete review interaction', {
  skip: !chromePath && 'Set ARCHIFY_CHROME to run the offline review in Chrome.',
}, async (t) => {
  const scratch = createScratchDirectory(path.join(os.tmpdir(), 'archify-lens-chrome-'));
  const example = path.join(skillRoot, 'examples', 'checkout-ledger.pr-pack.json');
  function generate(manifest, extra = []) {
    const out = fs.mkdtempSync(path.join(scratch, 'generated-'));
    execFileSync(process.execPath, [cli, 'pr', 'lens', manifest, '--out-dir', out, ...extra], { encoding: 'utf8' });
    const moved = fs.mkdtempSync(path.join(scratch, 'isolated-'));
    const artifact = path.join(moved, 'pr-lens.html');
    fs.renameSync(path.join(out, 'pr-lens.html'), artifact);
    assert.deepEqual(fs.readdirSync(moved), ['pr-lens.html']);
    return pathToFileURL(artifact).href;
  }
  const fallback = generate(example);
  git(scratch, 'init');
  git(scratch, 'config', 'user.name', 'Archify Tests');
  git(scratch, 'config', 'user.email', 'archify@example.test');
  for (const name of ['checkout.txt', 'ledger.txt']) fs.writeFileSync(path.join(scratch, name), 'return original\n');
  const oldOverview = 'old overview.txt';
  const newOverview = 'new overview.txt';
  const longLine = 'overview-line-'.repeat(90);
  const overviewLines = ['original overview', longLine, 'stable line', 'last line'];
  fs.writeFileSync(path.join(scratch, oldOverview), overviewLines.join('\n') + '\n');
  git(scratch, 'add', 'checkout.txt', 'ledger.txt', oldOverview);
  git(scratch, 'commit', '-m', 'Base');
  const baseSha = git(scratch, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(scratch, 'checkout.txt'), 'return order\n');
  fs.writeFileSync(path.join(scratch, 'ledger.txt'), 'return ledger\n');
  git(scratch, 'mv', oldOverview, newOverview);
  overviewLines[0] = 'revised overview';
  fs.writeFileSync(path.join(scratch, newOverview), overviewLines.join('\n') + '\n');
  git(scratch, 'commit', '-am', 'Head');
  const headSha = git(scratch, 'rev-parse', 'HEAD');
  const manifest = JSON.parse(fs.readFileSync(example));
  for (const view of manifest.views) fs.copyFileSync(path.join(path.dirname(example), view.input), path.join(scratch, view.input));
  const sequence = JSON.parse(fs.readFileSync(path.join(scratch, manifest.views[2].input)));
  const removedParticipant = sequence.participants.find((participant) => participant.change === 'removed');
  assert.ok(removedParticipant);
  sequence.activations = [...(sequence.activations || []), { participant: removedParticipant.id, from: 267, to: 304 }];
  fs.writeFileSync(path.join(scratch, manifest.views[2].input), JSON.stringify(sequence));
  const entities = JSON.parse(fs.readFileSync(path.join(scratch, manifest.views[0].input)));
  const column = entities.entities[0].attributes.find((attribute) => attribute.type);
  column.previousType = 'varchar';
  fs.writeFileSync(path.join(scratch, manifest.views[0].input), JSON.stringify(entities));
  function addView(type, title, diagram) {
    const input = `extra.${type}.json`;
    fs.writeFileSync(path.join(scratch, input), JSON.stringify(diagram));
    manifest.views.push({ id: type, type, title, input });
  }
  const readExample = (name) => JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name)));
  const timeline = readExample('payment-incident.timeline.json');
  timeline.events[0].change = 'removed';
  timeline.lanes.find(({ id }) => id === 'response').change = 'added';
  addView('timeline', 'Incident changes', timeline);
  const classView = readExample('payment-processors.class.json');
  classView.types.find(({ id }) => id === 'retrying_processor').attributes[1].change = 'removed';
  addView('class', 'Processor changes', classView);
  addView('lifecycle', 'Shared exits', {
    schema_version: 3, diagram_type: 'lifecycle', meta: { title: 'Shared exits', output: 'shared-exits.html' },
    mainPath: ['a', 'b', 'c'],
    states: [
      { id: 'a', type: 'start', label: 'Start' }, { id: 'b', type: 'active', label: 'Work' },
      { id: 'c', type: 'success', label: 'Finished' }, { id: 'x', type: 'failure', label: 'Blocked' },
      { id: 'y', type: 'failure', label: 'Ended', change: 'removed' },
    ],
    transitions: [
      { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
      { id: 'ax', from: 'a', to: 'x', label: 'Block', change: 'removed' },
      { id: 'cx', from: 'c', to: 'x', label: 'Block', change: 'added' },
      { id: 'ay', from: 'a', to: 'y', label: 'Stop', change: 'removed' },
      { id: 'cy', from: 'c', to: 'y', label: 'Stop', change: 'added' },
    ],
  });
  addView('tree', 'Payment platform', readExample('payment-platform.tree.json'));
  const unbrokenSummary = 'longsummary'.repeat(155);
  manifest.summary = unbrokenSummary;
  manifest.changes.push({ subject: 'Rename overview', change: 'modified', path: newOverview, basePath: oldOverview, line: 1 });
  delete manifest.baseRef;
  delete manifest.headRef;
  Object.assign(manifest, {
    baseSha, headSha,
    pullRequest: { number: 42, author: 'Review Team', facts: ['One path returns a ledger reference.'] },
    walkthrough: {
      steps: [
        { id: 'response', title: 'Checkout response carries a ledger reference', viewId: 'flow', edgeIds: ['create'],
          beforeLabel: 'Accepted order', afterLabel: 'Accepted with ledger reference', primarySliceId: 'checkout',
          relatedSliceIds: ['ledger'], payload: { before: { status: 202, record: 6, tail: true }, after: { status: 202, reference: 'L-1', record: 6, tail: true } } },
        { id: 'stored', title: 'Store the ledger reference', viewId: 'schema', payload: { before: null } },
        { id: 'calls', title: 'Change the service call', viewId: 'topology',
          payload: { before: { rows: Array(1000).fill('before value') }, after: { rows: Array(1000).fill('after value') } } },
      ],
      slices: [
        { id: 'checkout', path: 'checkout.txt', side: 'head', line: 1 },
        { id: 'ledger', path: 'ledger.txt', side: 'base', hunk: 1 },
      ],
    },
  });
  const manifestPath = path.join(scratch, 'pinned.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const pinned = generate(manifestPath, ['--repo-root', scratch]);

  const browser = new ChromeVisualBrowser(chromePath);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const requests = [];
  const failures = [];
  browser.cdp.subscribe(({ sessionId, method, params }) => {
    if (sessionId !== session) return;
    if (method === 'Network.requestWillBeSent') requests.push(params.request.url);
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) failures.push(params.entry.text);
    if (method === 'Runtime.exceptionThrown') failures.push(params.exceptionDetails.text);
  });
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.violations = [];
    document.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective + ': ' + e.blockedURI));
    window.$ = id => document.getElementById(id);
    window.scene = () => $('canvas').shadowRoot;
    window.press = (target, key) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
  ` });
  const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result.value;
  };
  async function arrowRight() {
    const key = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }
  async function assertHorizontalScroll(selector) {
    const element = `document.querySelector(${JSON.stringify(selector)})`;
    await evaluate(`${element}.scrollLeft = 0; ${element}.focus()`);
    assert.equal(await evaluate(`document.activeElement === ${element}`), true);
    await arrowRight();
    const scrolled = await evaluate(`new Promise(resolve => {
      const start = performance.now();
      const check = () => {
        if (${element}.scrollLeft > 0) resolve(true);
        else if (performance.now() - start > 750) resolve(false);
        else requestAnimationFrame(check);
      };
      check();
    })`);
    assert.equal(scrolled, true, selector);
    assert.equal(await evaluate('$("step-count").textContent'), '1 / 3');
  }
  const load = async (url, reload = false) => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    loaded.catch(() => {});
    await (reload ? send('Page.reload') : send('Page.navigate', { url }));
    await loaded;
    await evaluate('document.fonts.ready');
  };
  const geometry = () => evaluate(`(() => {
    const rect = el => el.getBoundingClientRect().toJSON();
    const svg = scene().querySelector('svg');
    return {
      canvas: rect($('canvas')), viewBox: svg.getAttribute('viewBox'),
      coords: Object.fromEntries([...svg.querySelectorAll('[data-node-id]')].map(n => [
        n.dataset.nodeId, [rect(n), n.getAttribute('transform')],
      ])),
      paths: [...svg.querySelectorAll('path[d]')].map(p => p.getAttribute('d')),
      background: getComputedStyle(svg.querySelector('.archify-bake-background')).fill,
    };
  })()`);
  const snapshot = async (name) => {
    const folder = process.env.ARCHIFY_LENS_SCREENSHOTS;
    if (!folder) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(folder, name + '.png'), Buffer.from(data, 'base64'));
  };

  await resize(1400);
  await load(fallback);
  assert.deepEqual(await evaluate('[...$("view-tabs").children].map(t => t.dataset.viewId)'), ['schema', 'topology', 'flow']);
  assert.equal(await evaluate('$("steps").children.length'), 3);
  assert.match(await evaluate('$("counts").textContent'), /14 files · Declared/);
  assert.equal(await evaluate('$("diff").textContent'), 'No source citations for this step.');
  assert.equal(await evaluate(`document.fonts.check('12px "JetBrains Mono"') && [...document.fonts].some(f => f.family.includes('JetBrains Mono') && f.status === 'loaded')`), true);
  await snapshot('fallback-desktop');
  await evaluate('$("notices-button").click()');
  assert.equal(await evaluate('$("notices").open && $("notice-text").textContent.includes("Apache")'), true);
  await evaluate('$("close-notices").click(); $("view-0").focus(); press($("view-0"), "End")');
  assert.equal(await evaluate('document.activeElement.id'), 'view-2');
  assert.equal(await evaluate('$("step-count").textContent'), '1 / 3');
  await evaluate('press(document.body, "j"); press(document.body, "ArrowRight"); $("payload-tab").click()');
  assert.equal(await evaluate('$("step-count").textContent'), '3 / 3');
  assert.ok(await evaluate('$("payloads").options.length >= 2'));
  await evaluate(`$("payloads").value = [...$("payloads").options].find(o => o.textContent.includes('append')).value; $("payloads").dispatchEvent(new Event("change"))`);
  assert.match(await evaluate('$("payload").textContent'), /Sample/);

  await load(pinned);
  await snapshot('pinned-desktop');
  assert.equal(await evaluate('$("slices").options.length'), 2);
  assert.match(await evaluate('$("diff-path").textContent'), new RegExp(baseSha + '.*' + headSha));
  assert.match(await evaluate('$("diff").textContent'), /@@ -1 \+1 @@.*return original.*return order/s);
  await evaluate('$("slices").focus(); $("slices").value = 1; $("slices").dispatchEvent(new Event("change")); press($("slices"), "ArrowLeft")');
  assert.equal(await evaluate('document.activeElement.id'), 'slices');
  assert.match(await evaluate('$("diff").textContent'), /return ledger/);
  await evaluate('$("view-1").click()');
  assert.equal(await evaluate('$("slices").value'), '1');
  assert.equal(await evaluate('scene().querySelectorAll("[data-lens-highlight]").length'), 0);
  await evaluate('$("view-2").click(); $("payload-tab").click()');
  assert.equal(await evaluate(`[...document.querySelectorAll('.payload-row')].some(row =>
    row.children[0].textContent === '' && row.children[1].textContent.includes('reference'))`), true);
  assert.equal(await evaluate(`[...document.querySelectorAll('.payload-row')].some(row =>
    row.children[0].textContent.includes('tail') && row.children[0].textContent === row.children[1].textContent)`), true);
  const point = await evaluate(`(() => {
    const node = scene().querySelector('[data-node-id]');
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  assert.equal(await evaluate(`scene().querySelector('[data-node-id]').dataset.lensHighlight`), 'focus');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  const removedPoint = await evaluate(`(() => {
    const rect = scene().querySelector('[data-node-id="${removedParticipant.id}"]').getBoundingClientRect();
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  })()`);
  const original = await geometry();
  const unchanged = (state) => {
    for (const key of ['canvas', 'viewBox', 'coords', 'paths']) assert.deepEqual(state[key], original[key], key);
  };
  const choose = (value) => evaluate(`document.querySelector('[data-mode-choice="${value}"]').click()`);
  await choose('before');
  unchanged(await geometry());
  await choose('after');
  unchanged(await geometry());
  assert.equal(await evaluate(`(() => {
    const parts = [...scene().querySelectorAll('[data-lens-participant="${removedParticipant.id}"]')];
    return parts.length === 3 && parts.every(n => n.getAttribute('aria-hidden') === 'true'
      && getComputedStyle(n).visibility === 'hidden');
  })()`), true);
  assert.equal(await evaluate(`scene().elementFromPoint(${removedPoint.join(',')})?.closest('[data-node-id]')?.dataset.nodeId !== '${removedParticipant.id}'`), true);
  assert.equal(await evaluate(`scene().querySelector('[data-node-id="${removedParticipant.id}"]').getAttribute('tabindex')`), '-1');
  await evaluate('document.querySelector("[data-theme-choice=light]").click()');
  const light = await geometry();
  unchanged(light);
  assert.notEqual(light.background, original.background);
  await choose('delta');
  assert.deepEqual((await geometry()).coords, original.coords);
  assert.equal(await evaluate(`(() => {
    const node = scene().querySelector('[data-node-id]');
    node.focus(); press(node, 'Enter');
    const pressed = node.getAttribute('aria-pressed') === 'true';
    press(node, 'Escape');
    return pressed && node.getAttribute('aria-pressed') === 'false'
      && scene().querySelector('[data-edge-id="create"]').dataset.lensHighlight === 'focus';
  })()`), true);
  await evaluate('$("next").click()');
  assert.match(await evaluate('$("payload").textContent'), /null.*No after value supplied|No after value supplied.*null/s);
  const deltaType = await evaluate('scene().querySelector("[data-lens-before]").textContent');
  await choose('before');
  assert.equal(await evaluate('scene().querySelector("[data-lens-before]").textContent'), 'varchar');
  await choose('after');
  assert.equal(await evaluate('scene().querySelector("[data-lens-before]").textContent'), column.type);
  assert.notEqual(deltaType, column.type);
  await evaluate('$("next").click()');
  assert.match(await evaluate('$("payload").textContent'), /Alignment unavailable for this payload size/);
  assert.deepEqual(await evaluate(`['before value', 'after value'].map(value =>
    [...$("payload").querySelectorAll("code")].filter(line => line.textContent.includes(value)).length)`), [1000, 1000]);

  const visibility = (selector) => evaluate(`[...scene().querySelectorAll(${JSON.stringify(selector)})].map(node => getComputedStyle(node).visibility)`);
  await evaluate('$("view-3").click()');
  await choose('before');
  assert.deepEqual(await visibility('[data-lens-lane="response"] > text'), ['hidden']);
  assert.deepEqual(await visibility('[data-lens-participant="deploy"]'), ['visible', 'visible', 'visible']);
  await choose('after');
  assert.deepEqual(await visibility('[data-lens-lane="response"] > text'), ['visible']);
  assert.deepEqual(await visibility('[data-lens-participant="deploy"]'), ['hidden', 'hidden', 'hidden']);
  assert.deepEqual(await evaluate(`(() => {
    const style = getComputedStyle(scene().querySelector('[data-timeline-lane="response"] > .tl-lane'));
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.strokeStyle = style.getPropertyValue('--backend-stroke').trim();
    const expected = canvas.strokeStyle;
    canvas.strokeStyle = style.stroke;
    return [canvas.strokeStyle === expected, style.strokeWidth];
  })()`), [true, '1.25px']);

  await evaluate('$("view-4").click()');
  const staticUnderline = () => evaluate(`getComputedStyle([...scene().querySelectorAll('[data-class-member]')]
    .find(node => node.textContent.includes('DEFAULT_TIMEOUT'))).textDecorationLine`);
  for (const version of ['before', 'after', 'delta']) {
    await choose(version);
    assert.equal(await staticUnderline(), 'underline');
  }
  assert.equal(await evaluate(`getComputedStyle(scene().querySelector('[data-class-kind="abstract"] .cl-type')).strokeDasharray`), '5px, 3px');
  assert.ok(await evaluate(`[...scene().querySelectorAll('[data-class-row][data-change="removed"] > text')]
    .some(node => getComputedStyle(node).textDecorationLine === 'line-through')`));
  await choose('before');
  assert.ok(await evaluate(`[...scene().querySelectorAll('[data-class-row][data-change="removed"] > text')]
    .every(node => getComputedStyle(node).textDecorationLine === 'none')`));

  await evaluate('$("view-5").click()');
  const shared = 'circle[data-lens-decoration]';
  assert.ok((await visibility(shared)).includes('visible'), 'a junction remains when a route survives');
  assert.ok(await evaluate(`[...scene().querySelectorAll('${shared}')].some(node => node.dataset.lensDecoration.includes(' '))`));
  for (const [version, visibleRoute, hiddenRoute] of [['before', 'ax', 'cx'], ['after', 'cx', 'ax']]) {
    await choose(version);
    assert.deepEqual(await evaluate(`(() => {
      const edge = id => scene().querySelector('path[data-edge-id="' + id + '"]');
      const visible = edge('${visibleRoute}');
      const hidden = edge('${hiddenRoute}');
      const label = [...scene().querySelectorAll('g[data-lens-decoration]')]
        .find(node => node.querySelector('text')?.lastChild.textContent.trim() === 'Block');
      const underlay = path => path.parentElement.querySelector('[data-graph-role="automatic-crossover-underlay"]');
      const visibleUnderlay = underlay(visible);
      const hiddenUnderlay = underlay(hidden);
      return [
        getComputedStyle(label).visibility,
        label.dataset.lensDecoration.split(' ').sort().join(' ') ===
          [visible.dataset.lensOwner, hidden.dataset.lensOwner].sort().join(' '),
        visible.getAttribute('role'), visible.getAttribute('tabindex'),
        visible.closest('[aria-hidden="true"]') === null,
        getComputedStyle(visibleUnderlay).visibility, visibleUnderlay.getAttribute('aria-hidden'),
        getComputedStyle(hiddenUnderlay).visibility,
      ];
    })()`), ['visible', true, 'button', '0', true, 'visible', 'true', 'hidden']);
  }
  assert.ok((await visibility(shared)).includes('visible'), 'a junction remains in After when cx survives');

  await evaluate('$("view-6").click()');
  assert.deepEqual(await evaluate(`[...scene().querySelectorAll('[data-tree-stack]')].map(node => getComputedStyle(node).display)`),
    ['none', 'none', 'none', 'none']);
  await evaluate('$("view-1").click()');
  assert.equal(await evaluate(`getComputedStyle(scene().querySelector('[data-node-id] > rect')).rx`), '10px');

  await evaluate('document.querySelector("#steps input").click()');
  assert.equal(await evaluate('$("progress").value'), 1);
  await load(pinned, true);
  assert.equal(await evaluate('$("progress").value'), 1);
  assert.equal(await evaluate('document.querySelector("#steps input").checked'), true);
  assert.deepEqual(await evaluate('violations'), []);
  await resize(390);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await snapshot('pinned-narrow');
  assert.equal(await evaluate('document.documentElement.scrollWidth === document.documentElement.clientWidth'), true);
  assert.equal(await evaluate(`(() => {
    const active = $('view-2').getBoundingClientRect();
    const list = $('view-tabs').getBoundingClientRect();
    return active.left >= list.left && active.right <= list.right + 1;
  })()`), true);
  assert.equal(await evaluate('$("canvas").scrollWidth > $("canvas").clientWidth'), true);
  assert.equal(await evaluate('$("summary").textContent'), unbrokenSummary);
  assert.ok(await evaluate('$("summary").getBoundingClientRect().height > parseFloat(getComputedStyle($("summary")).fontSize) * 2'));
  const overview = await evaluate('$("unassigned").querySelector(".filebar").textContent');
  assert.equal(overview, `Base ${oldOverview} @ ${baseSha} → Head ${newOverview} @ ${headSha} · head line 1`);
  await assertHorizontalScroll('#canvas');
  await assertHorizontalScroll('#unassigned [data-evidence-scroll]');
  await snapshot('pinned-narrow-review');

  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } });
  ` });
  await load(fallback);
  await snapshot('fallback-narrow');
  assert.equal(await evaluate('$("storage-note").hidden'), false);
  await evaluate('document.querySelector("#steps input").click()');
  assert.equal(await evaluate('$("progress").value'), 1);
  await load(fallback, true);
  assert.equal(await evaluate('$("progress").value'), 0);
  assert.deepEqual(await evaluate('violations'), []);
  assert.deepEqual(requests.filter((url) => !url.startsWith('data:') && ![fallback, pinned].includes(url)), []);
  assert.deepEqual(failures, []);
});
