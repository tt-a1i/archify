import test from 'node:test';
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
const tab = name => `[data-atlas-tab="${name}"]`;
const graphGeometry = `(() => {
  const graph = document.querySelector('.diagram-container');
  const rect = graph.getBoundingClientRect();
  const svg = graph.querySelector(':scope > svg').getBoundingClientRect();
  return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height,
    svgWidth: svg.width, svgHeight: svg.height };
})()`;
const overviewCardsVisible = `(() => {
  const cards = document.querySelector('.atlas-overview .cards');
  if (!cards || !cards.getBoundingClientRect().width || !cards.getBoundingClientRect().height) return false;
  for (let element = cards; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  return true;
})()`;

// Real committed local-only sources give the Sources panel enough content to
// scroll. Extra declared members exercise a directory longer than one viewport.
function fixture(directory) {
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sources = Array.from({ length: 3 }, (_, index) => {
    const sourcePath = `src/architecture-evidence/complete-path-must-remain-readable/ownership-contracts-and-implementation-context/runtime-host-orchestration-and-session-lifecycle/verified-source-file-with-full-directory-context-${index + 1}.mjs`;
    fs.mkdirSync(path.dirname(path.join(directory, sourcePath)), { recursive: true });
    fs.writeFileSync(path.join(directory, sourcePath), `export const moduleId = ${index + 1};\nexport const owner = 'workbench fixture';\n`);
    return { path: sourcePath, line: 1, end_line: 2, label: `Verified module ${index + 1}` };
  });
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'git@github.com:example/workbench-evidence.git');
  git('add', 'src');
  git('commit', '-m', 'workbench evidence fixture');
  const revision = git('rev-parse', 'HEAD');
  const repository = { url: 'https://github.com/example/workbench-evidence', revision, link_mode: 'local-only' };
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas/project.atlas.json'), 'utf8'));
  for (const member of Object.values(manifest.diagrams)) {
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'examples/atlas', member.source), 'utf8'));
    spec.meta.repository = repository;
    for (const component of spec.components) {
      if (['controller', 'redis'].includes(component.id)) component.sources = sources;
    }
    fs.writeFileSync(path.join(directory, member.source), JSON.stringify(spec));
  }
  const parents = ['system', 'payment', 'worker', 'orders'];
  const availableNodes = ['users', 'auth', 'cdn', 'lb', 'db', 's3', 'worker'];
  for (let index = 0; index < 26; index++) {
    const id = `appendix-${index + 1}`;
    manifest.diagrams[id] = { source: 'worker.architecture.json' };
    manifest.details.push({ from: { diagram: parents[Math.floor(index / availableNodes.length)], node: availableNodes[index % availableNodes.length] }, to: id });
  }
  const input = path.join(directory, 'project.atlas.json');
  const output = path.join(directory, 'atlas.html');
  fs.writeFileSync(input, JSON.stringify(manifest));
  const receipt = JSON.parse(execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', input, output, '--repo-root', directory, '--json'], { encoding: 'utf8' }));
  assert.equal(receipt.ok, true);
  return { output, revision, sources, standaloneInput: path.join(directory, 'system.architecture.json') };
}

function near(actual, expected, message, tolerance = 1) {
  for (const key of Object.keys(expected)) {
    assert.ok(Number.isFinite(actual[key]) && Math.abs(actual[key] - expected[key]) <= tolerance,
      `${message}: ${key}: ${JSON.stringify({ expected, actual })}`);
  }
}

test('Atlas workbench preserves complete inspection and stable reading visits', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for actual browser workbench acceptance.',
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workbench-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = fixture(directory);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression, outer = false) {
    const result = await send('Runtime.evaluate', {
      expression: outer ? expression : `document.querySelector('iframe[data-atlas-state=active]').contentWindow.eval(${JSON.stringify(expression)})`,
      returnByValue: true, awaitPromise: true,
    });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const runWorkbench = expression => run(expression, true);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.workbenchErrors = [];
    addEventListener('error', event => workbenchErrors.push(event.message));
    addEventListener('unhandledrejection', event => workbenchErrors.push(String(event.reason)));
    window.workbenchCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async value => { workbenchCopies.push(value); } } });
  ` });
  async function stable() {
    await run(`Promise.all([Archify.readerLayout.whenStable(), Archify.viewerChromeLayout.whenStable()])`);
    await run(`new Promise((resolve, reject) => {
      let previous = '', equal = 0, count = 0;
      const timer = setInterval(() => {
        const current = JSON.stringify(Archify.view.snapshot());
        equal = current === previous && !document.querySelector('.is-camera-moving') ? equal + 1 : 0;
        previous = current;
        if (equal >= 5) { clearInterval(timer); resolve(); }
        else if (++count > 200) { clearInterval(timer); reject(new Error('Workbench camera did not settle')); }
      }, 30);
    })`);
  }
  async function ready(diagram = 'system') {
    await run(`new Promise((resolve, reject) => {
      let count = 0;
      const timer = setInterval(() => {
        const member = document.querySelector('iframe[data-atlas-state=active]')?.contentWindow;
        if (member?.Archify && member.ArchifyAddress.active && !member.ArchifyAddress.restoring && member.ArchifyAddress.context.diagram === ${JSON.stringify(diagram)}) {
          clearInterval(timer); resolve();
        } else if (++count > 200) { clearInterval(timer); reject(new Error('Atlas initialization failed: ' + document.getElementById('atlas-error').textContent)); }
      }, 30);
    })`, true);
    await stable();
    assert.deepEqual(await run(`[...workbenchErrors, ...document.querySelector('iframe[data-atlas-state=active]').contentWindow.workbenchErrors]`, true), []);
  }
  async function open({ width = 1440, height = 900, diagram = 'system', theme = 'light' } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // A full navigation gives every case an independent visit and workbench state.
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: `${pathToFileURL(data.output).href}?theme=${theme}#diagram=${diagram}` });
    await ready(diagram);
  }
  async function click(selector, outer = false) {
    const point = await run(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing click target: ' + ${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.top < 0 || rect.bottom > innerHeight) throw new Error('Click target is not visible: ' + ${JSON.stringify(selector)});
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`, outer);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await stable();
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    await stable();
  }
  async function selectedTab() {
    return run(`document.querySelector('[data-atlas-tab][aria-selected="true"]')?.dataset.atlasTab`);
  }

  await t.test('desktop selection, tabs and on-demand directory leave graph and camera unchanged', async () => {
    for (const [width, height, theme] of [[1440, 900, 'light'], [1600, 1000, 'dark'], [1920, 1080, 'light'], [2048, 1320, 'dark']]) {
      await open({ width, height, theme });
      assert.equal(await runWorkbench(`document.getElementById('atlas-directory').hidden`), true);
      assert.equal(await runWorkbench(`document.getElementById('atlas-directory-toggle').getAttribute('aria-expanded')`), 'false');
      assert.match(await run(`document.querySelector('.atlas-overview').textContent`), /业务入口.*业务模块.*共享缓存/s,
        'Unselected workbench retains original authored conclusions');
      assert.equal(await run(`getComputedStyle(document.getElementById('focus-chip')).display`), 'none',
        'An unselected workbench must not render an empty focus inspector through a CSS override');
      assert.equal(await run(overviewCardsVisible), true, 'Authored conclusions are visibly rendered before selection');
      const geometry = await run(graphGeometry);
      const camera = await run('Archify.view.snapshot()');
      await click('[data-node-id="controller"]');
      assert.equal(await run('ArchifyAddress.context.diagram'), 'system');
      assert.equal(await run('Archify.focus.active()'), 'controller');
      near(await run(graphGeometry), geometry, `${width}: selecting a node preserves graph geometry`);
      near(await run('Archify.view.snapshot()'), camera, `${width}: selecting an on-screen node preserves the camera`, .001);
      assert.equal(await run(`document.querySelector('.diagram-container').contains(document.getElementById('focus-chip'))`), false);
      for (const name of ['details', 'relationships', 'sources']) {
        await click(tab(name));
        assert.equal(await selectedTab(), name);
        assert.equal(await run(`document.getElementById('atlas-panel-${name}').hidden`), false);
        near(await run(graphGeometry), geometry, `${width}: changing ${name} preserves graph geometry`);
        near(await run('Archify.view.snapshot()'), camera, `${width}: changing ${name} preserves camera`, .001);
      }
      await click('#atlas-directory-toggle', true);
      assert.equal(await runWorkbench(`document.getElementById('atlas-directory').hidden`), false);
      assert.equal(await run(`document.querySelector('.atlas-inspector').hidden`), true, 'Directory replaces inspection instead of stacking above it');
      near(await run(graphGeometry), geometry, `${width}: directory does not resize graph`);
      near(await run('Archify.view.snapshot()'), camera, `${width}: directory does not move camera`, .001);
      await key('Escape', 'Escape', 27);
      assert.equal(await runWorkbench('document.activeElement.id'), 'atlas-directory-toggle');
      assert.equal(await runWorkbench(`document.getElementById('atlas-directory').hidden`), true);
      assert.equal(await selectedTab(), 'sources');
      assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
      await click('#btn-focus-clear');
      assert.equal(await run('Archify.focus.active()'), null);
      assert.equal(await run(`getComputedStyle(document.getElementById('focus-chip')).display`), 'none',
        'Returning to the chapter overview hides the inspector in the actual rendered style');
      assert.equal(await run(overviewCardsVisible), true, 'Clearing selection visibly restores every authored chapter conclusion');
      near(await run(graphGeometry), geometry, `${width}: clearing selection preserves graph geometry`);
      near(await run('Archify.view.snapshot()'), camera, `${width}: clearing selection preserves camera`, .001);
    }
  });

  await t.test('selecting a graph node replaces an open directory with its inspector', async () => {
    await open();
    await click('[data-node-id="redis"]');
    await click(tab('sources'));
    assert.equal(await selectedTab(), 'sources');
    await click('#atlas-directory-toggle', true);
    assert.equal(await runWorkbench(`document.getElementById('atlas-directory').hidden`), false);
    await click('[data-node-id="controller"]');
    assert.equal(await run('Archify.focus.active()'), 'controller');
    assert.equal(await runWorkbench(`document.getElementById('atlas-directory').hidden`), true,
      'Selecting a graph node must close the directory that occupies the shared rail');
    assert.equal(await run(`document.querySelector('.atlas-inspector').hidden`), false,
      'The selected node inspector replaces the directory immediately');
    assert.equal(await selectedTab(), 'details',
      'A fresh graph selection starts at node details instead of retaining the previous node tab');
  });

  await t.test('complete local-only evidence, relationships, reach and original copy actions stay usable', async () => {
    await open();
    await click('[data-node-id="controller"]');
    await click(tab('details'));
    assert.match(await run(`document.getElementById('focus-detail').textContent`), /支付与清算/);
    assert.equal(await run(`document.getElementById('focus-id').textContent`), 'controller');
    assert.ok(await run(`document.getElementById('focus-kind').textContent.length > 0`));
    await click(tab('sources'));
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('#focus-evidence-links .semantic-passport-source small'), item => item.textContent)`), data.sources.map(source => source.path));
    assert.match(await run(`document.getElementById('focus-evidence-links').textContent`), /L1[–-]2/);
    assert.match(await run(`document.getElementById('focus-repository').textContent`), new RegExp(data.revision.slice(0, 7)));
    assert.equal(await run(`document.querySelectorAll('#focus-evidence a[href],#focus-repository[href]').length`), 0,
      'Local-only source evidence must not grow public source or repository URLs');
    await click('#btn-focus-copy');
    const nodeAddress = new URLSearchParams(new URL(await run('workbenchCopies.at(-1)')).hash.slice(1));
    assert.equal(nodeAddress.get('diagram'), 'system');
    assert.equal(nodeAddress.get('focus'), 'controller');
    await click(tab('relationships'));
    assert.equal(await run(`document.querySelectorAll('#relationship-lens-list [data-relationship-key]').length`), 5);
    assert.match(await run(`document.getElementById('relationship-lens-list').textContent`), /SQL/);
    await click('#btn-reach-downstream');
    assert.equal(await run('Archify.focus.reachability().direction'), 'downstream');
    assert.ok((await run('Archify.focus.reachability().nodeIds')).includes('worker'));
    await click('#btn-reach-downstream');
    assert.equal(await run('Archify.focus.reachability()'), null);
    await run(`document.querySelector('#relationship-lens-list [data-relationship-id="api-sql"]').focus({preventScroll:true})`);
    await stable();
    assert.equal(await run(`document.getElementById('focus-chip').getAttribute('data-relationship-previewing')`), 'true');
    // Direct graph-edge inspection is available from the overview; a selected
    // node intentionally keeps graph hit targets out of that interaction mode.
    await click('#btn-focus-clear');
    assert.equal(await run('Archify.focus.active()'), null);
    await run(`document.querySelector('[data-relationship-hit-key][data-relationship-id="api-sql"]').focus({preventScroll:true})`);
    await key('Enter', 'Enter', 13);
    assert.equal(await run('Archify.focus.relationship().id'), 'api-sql', 'The graph relationship remains pinnable');
    await click('#btn-focus-copy');
    const relationAddress = new URLSearchParams(new URL(await run('workbenchCopies.at(-1)')).hash.slice(1));
    assert.equal(relationAddress.get('diagram'), 'system');
    assert.equal(relationAddress.get('relation'), 'api-sql');
    await run(`Archify.focus.set('controller',{toggle:false})`);
    await stable();
    await click(tab('relationships'));
    const relationshipCamera = await run('Archify.view.snapshot()');
    const relationshipGeometry = await run(graphGeometry);
    await click('#relationship-lens-list [data-relationship-target="redis"]');
    assert.equal(await run('Archify.focus.active()'), 'redis');
    assert.equal(await selectedTab(), 'relationships', 'Following a neighbor keeps the current inspection category');
    near(await run('Archify.view.snapshot()'), relationshipCamera, 'Following a relationship preserves the camera', .001);
    near(await run(graphGeometry), relationshipGeometry, 'Following a relationship preserves graph geometry');
    assert.equal(await run(`Boolean(document.activeElement.closest('#atlas-panel-relationships'))`), true,
      'Following a relationship leaves keyboard focus in the inspection context');
    await click(tab('sources'));
    await click('[data-node-id="controller"]');
    assert.equal(await selectedTab(), 'sources', 'Selecting another node does not reset source reading');
    await run(`document.querySelector(${JSON.stringify(tab('sources'))}).focus({preventScroll:true})`);
    await key('ArrowLeft', 'ArrowLeft', 37);
    assert.equal(await selectedTab(), 'relationships');
    assert.equal(await run('document.activeElement.dataset.atlasTab'), 'relationships');
    await key('Home', 'Home', 36);
    assert.equal(await selectedTab(), 'details');
    await key('End', 'End', 35);
    assert.equal(await selectedTab(), 'sources');
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('[data-atlas-tab]'), item => ({selected:item.getAttribute('aria-selected'),tabIndex:item.tabIndex,controls:document.getElementById(item.getAttribute('aria-controls'))?.getAttribute('role')}))`),
      [{ selected: 'false', tabIndex: -1, controls: 'tabpanel' }, { selected: 'false', tabIndex: -1, controls: 'tabpanel' }, { selected: 'true', tabIndex: 0, controls: 'tabpanel' }]);
  });

  await t.test('actual print media keeps every authored conclusion visible outside the workbench rail', async () => {
    await open();
    const original = await run(`(() => {
      window.workbenchCardsNode = document.querySelector('.cards');
      return Array.from(workbenchCardsNode.querySelectorAll('.card'), card => card.textContent);
    })()`);
    assert.ok(original.length > 0, 'The fixture must contain authored chapter conclusions');
    assert.equal(await run(`document.querySelector('.atlas-overview').contains(workbenchCardsNode)`), true);
    try {
      await send('Emulation.setEmulatedMedia', { media: 'print' });
      await stable();
      const printed = await run(`(() => {
        const cards = document.querySelector('.cards');
        let visible = cards.getBoundingClientRect().height > 0;
        for (let parent = cards; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (parent.hidden || style.display === 'none' || style.visibility === 'hidden') visible = false;
        }
        return { print: matchMedia('print').matches, count: document.querySelectorAll('.cards').length,
          original: cards === workbenchCardsNode, inDocument: document.querySelector('.container').contains(cards),
          noPrintAncestor: Boolean(cards.closest('.no-print')), visible,
          content: Array.from(cards.querySelectorAll('.card'), card => card.textContent) };
      })()`);
      assert.deepEqual(printed, { print: true, count: 1, original: true, inDocument: true,
        noPrintAncestor: false, visible: true, content: original },
      'Printing an Atlas member must restore the original visible cards to document flow');
    } finally {
      await send('Emulation.setEmulatedMedia', { media: 'screen' });
      await stable();
    }
    assert.equal(await run(`document.querySelector('.atlas-overview').contains(workbenchCardsNode)`), true,
      'Leaving print media returns the same conclusions to the workbench');
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('.cards .card'), card => card.textContent)`), original);
  });

  await t.test('selection stops an in-flight camera at its rendered position', async () => {
    await open();
    const stopped = await run(`(async () => {
      Archify.view.centerAt(580,270,{scale:1.35});
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const before=Archify.view.snapshot();
      document.querySelector('[data-node-id="controller"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      return before;
    })()`);
    await stable();
    assert.equal(await run('Archify.focus.active()'), 'controller');
    near(await run('Archify.view.snapshot()'), stopped, 'Selection holds the rendered camera instead of continuing the old transition', .001);
  });

  await t.test('directory and Sources keep independent scroll positions and return keyboard focus', async () => {
    await open({ height: 600 });
    await click('[data-node-id="controller"]');
    await click(tab('sources'));
    const geometry = await run(graphGeometry);
    const camera = await run('Archify.view.snapshot()');
    const sourceScroll = await run(`(() => { const panel=document.getElementById('atlas-panel-sources'); panel.scrollTop=240; return panel.scrollTop; })()`);
    assert.ok(sourceScroll > 20, 'Evidence fixture must exercise actual panel scrolling');
    await click('#atlas-directory-toggle', true);
    assert.equal(await runWorkbench(`document.querySelectorAll('[data-atlas-diagram]').length`), 30);
    const directoryScroll = await runWorkbench(`(() => { const directory=document.getElementById('atlas-directory'); directory.scrollTop=300; return directory.scrollTop; })()`);
    assert.ok(directoryScroll >= 100, 'Directory fixture must exercise actual independent scrolling');
    await key('Escape', 'Escape', 27);
    assert.equal(await runWorkbench('document.activeElement.id'), 'atlas-directory-toggle');
    assert.equal(await run(`document.getElementById('atlas-panel-sources').scrollTop`), sourceScroll);
    await click('#atlas-directory-toggle', true);
    assert.equal(await runWorkbench(`document.getElementById('atlas-directory').scrollTop`), directoryScroll);
    await run(`document.querySelector('[data-atlas-detail="controller"]').click()`);
    await ready('payment');
    assert.equal(await runWorkbench(`document.getElementById('atlas-directory').scrollTop`), directoryScroll);
    await run('history.back()', true); await ready('system');
    assert.equal(await runWorkbench(`document.getElementById('atlas-directory').scrollTop`), directoryScroll);
    assert.equal(await runWorkbench(`history.state.snapshot.navigation.scroll.sources`), sourceScroll,
      'An inspector hidden by the shared directory retains its saved reading position');
    await run('history.forward()', true); await ready('payment');
    assert.equal(await runWorkbench(`document.getElementById('atlas-directory').scrollTop`), directoryScroll);
    await run('history.back()', true); await ready('system');
    await click('#atlas-directory-toggle', true);
    assert.equal(await run(`document.getElementById('atlas-panel-sources').scrollTop`), sourceScroll);
    near(await run(graphGeometry), geometry, 'Independent sidebar scrolling preserves graph geometry');
    near(await run('Archify.view.snapshot()'), camera, 'Independent sidebar scrolling preserves the camera', .001);
    await run(`document.querySelector(${JSON.stringify(tab('sources'))}).focus({preventScroll:true})`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 600, deviceScaleFactor: 1, mobile: false });
    await stable();
    assert.equal(await run('document.documentElement.dataset.atlasLayout'), 'stacked');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false });
    await stable();
    assert.equal(await run('document.documentElement.dataset.atlasLayout'), 'rail');
    assert.equal(await selectedTab(), 'sources');
    assert.equal(await run(`document.getElementById('atlas-panel-sources').scrollTop`), sourceScroll,
      'A compact layout with no panel overflow must not erase the docked Sources reading position');
    assert.equal(await run('document.activeElement.dataset.atlasTab'), 'sources');
  });

  await t.test('cold programmatic focus and immediate drill Back restore the complete departure visit', async () => {
    await open({ diagram: 'payment', height: 600 });
    // This deliberately avoids view.reveal/centerAt. Previously a cold API
    // selection had no snapshot and Back silently fitted a different camera.
    const coldCamera = await run('Archify.view.snapshot()');
    await run(`(async () => {
      Archify.focus.set('controller',{toggle:false});
      await Promise.resolve();
      document.querySelector('[data-atlas-detail="controller"]').click();
    })()`);
    await ready('worker');
    await run('history.back()', true);
    await ready('payment');
    assert.equal(await run('Archify.focus.active()'), 'controller');
    near(await run('Archify.view.snapshot()'), coldCamera, 'Immediate programmatic drill preserves the cold camera', .001);

    await open({ diagram: 'payment', height: 600 });
    const initialCamera = await run('Archify.view.snapshot()');
    await run(`Archify.focus.set('controller',{toggle:false})`);
    await run(`new Promise(resolve=>setTimeout(resolve,0))`);
    await click(tab('sources'));
    const sourceScroll = await run(`(() => { const panel=document.getElementById('atlas-panel-sources'); panel.scrollTop=200; return panel.scrollTop; })()`);
    assert.ok(sourceScroll > 0);
    await run(`document.querySelector('[data-atlas-detail="controller"]').focus({preventScroll:true});document.querySelector('[data-atlas-detail="controller"]').click()`);
    await ready('worker');
    await run('history.back()', true);
    await ready('payment');
    assert.equal(await run('Archify.focus.active()'), 'controller');
    near(await run('Archify.view.snapshot()'), initialCamera, 'Cold focus API visit retains its exact departure camera', .001);
    assert.equal(await selectedTab(), 'sources');
    assert.equal(await run(`document.getElementById('atlas-panel-sources').scrollTop`), sourceScroll);
    assert.equal(await run('document.activeElement.dataset.atlasDetail'), 'controller', 'Back restores the explicit drill trigger focus');
    await run(`Archify.focus.set('redis',{toggle:false})`);
    await run(`new Promise(resolve=>setTimeout(resolve,0))`);
    await run(`document.querySelector('[data-atlas-reference="redis"]').focus({preventScroll:true});document.querySelector('[data-atlas-reference="redis"]').click()`);
    await ready('system');
    assert.equal(await run('Archify.focus.active()'), 'redis');
    await run('history.back()', true);
    await ready('payment');
    assert.equal(await run('Archify.focus.active()'), 'redis');
    assert.equal(await selectedTab(), 'sources');
    assert.equal(await run('document.activeElement.dataset.atlasReference'), 'redis');
  });

  await t.test('Back restores a focused relationship row to its inspector rather than the SVG hit target', async () => {
    await open();
    await click('[data-node-id="controller"]');
    await click(tab('relationships'));
    const departure = await run(`(() => {
      const row=document.querySelector('#relationship-lens-list [data-relationship-id="api-sql"]');
      row.focus({preventScroll:true});
      return { key:row.dataset.relationshipKey, camera:Archify.view.snapshot() };
    })()`);
    // Programmatic activation deliberately preserves the relationship row as
    // the departure focus, unlike a mouse click that focuses the drill button.
    await run(`document.querySelector('[data-atlas-detail="controller"]').click()`);
    await ready('payment');
    await run('history.back()', true);
    await ready('system');
    assert.equal(await selectedTab(), 'relationships');
    assert.equal(await run('document.activeElement.dataset.relationshipKey'), departure.key);
    assert.equal(await run(`document.getElementById('relationship-lens-list').contains(document.activeElement)`), true,
      'The same relationship key exists on the SVG and the row; restore the original interaction surface');
    near(await run('Archify.view.snapshot()'), departure.camera, 'Restoring relationship-row focus preserves the camera', .001);
  });

  await t.test('compact inspection follows the graph without shrinking it; standalone keeps its original passport', async () => {
    for (const width of [1000, 720, 390]) {
      await open({ width });
      const geometry = await run(graphGeometry);
      await run(`Archify.focus.set('controller',{toggle:false})`);
      await stable();
      near(await run(graphGeometry), geometry, `${width}: compact selection preserves graph geometry`);
      assert.equal(await run(`document.querySelector('.atlas-inspection-slot').contains(document.getElementById('focus-chip'))`), true);
      assert.equal(await run(`document.getElementById('focus-chip').getBoundingClientRect().top >= document.querySelector('.diagram-container').getBoundingClientRect().bottom`), true);
      assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
      await click('#atlas-inspect-selection');
      assert.equal(await run('Archify.focus.active()'), 'controller', 'The compact inspection jump must retain the selected node');
      assert.equal(await run('document.activeElement.id'), 'relationship-lens-title');
      assert.equal(await run(`(() => {
        const chip=document.getElementById('focus-chip'), title=document.getElementById('relationship-lens-title');
        const rect=title.getBoundingClientRect();
        return !chip.hidden && !document.getElementById('atlas-panel-details').hidden && rect.width>0 && rect.top>=0 && rect.bottom<=innerHeight;
      })()`), true, 'The compact jump reveals the selected details and places focus on their title');
      near(await run(graphGeometry), geometry, `${width}: jumping to details preserves the document position and dimensions of the graph`);
      await run(`document.querySelector(${JSON.stringify(tab('sources'))}).click()`);
      await stable();
      near(await run(graphGeometry), geometry, `${width}: compact category changes preserve graph geometry`);
      await run('Archify.focus.clear()');
      await stable();
      near(await run(graphGeometry), geometry, `${width}: returning to overview preserves graph geometry`);
    }
    const output = path.join(directory, 'standalone.html');
    execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'architecture', data.standaloneInput, output, '--repo-root', directory, '--json']);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(output).href });
    await run(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(window.Archify?.focus){clearInterval(timer);resolve();}else if(++n>200){clearInterval(timer);reject(new Error('Standalone did not initialize'));}},30)})`, true);
    await run(`Archify.focus.set('controller',{toggle:false});Archify.readerLayout.whenStable()`, true);
    assert.equal(await run(`document.querySelector('[data-atlas-tab]')`, true), null);
    assert.equal(await run(`document.querySelector('.diagram-container').contains(document.getElementById('focus-chip'))`, true), true);
    assert.equal(await run(`document.getElementById('focus-chip').hidden`, true), false);
    assert.equal(await run(`document.getElementById('focus-evidence').hidden`, true), false);
    assert.equal(await run(`document.querySelectorAll('#relationship-lens-list [data-relationship-key]').length`, true), 5);
    assert.equal(await run(`getComputedStyle(document.getElementById('btn-focus-copy')).display !== 'none'`, true), true);
    assert.deepEqual(await run('workbenchErrors', true), []);
  });
});
