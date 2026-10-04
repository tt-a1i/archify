import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function architecture(title, ids, viewBox, views) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title, viewBox, output: 'level.html', ...(views ? { views } : {}) },
    components: ids.map((id, index) => ({
      id,
      type: index % 2 === 0 ? 'backend' : 'database',
      label: id,
      sublabel: id + ' detail',
      pos: [80 + index * 320, 180],
      size: [220, 64],
    })),
    connections: ids.length > 1 ? [{ from: ids[0], to: ids[1], label: 'writes' }] : [],
    cards: [{ dot: 'cyan', title: title + ' card', items: [title + ' item'] }],
  };
}

test('Levels drill-down switches the stage, rail, and every stage-bound module', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser levels checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-levels-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  const write = (name, value) => {
    fs.writeFileSync(path.join(scratch, name), JSON.stringify(value, null, 2));
  };
  // Distinct node counts and viewBoxes per level so a stale binding is
  // observable rather than coincidentally correct.
  write('root.architecture.json', architecture('Root', ['alpha', 'beta'], [900, 500],
    [{ id: 'rootstory', label: 'Root story', focus: ['alpha'] }]));
  write('mid.architecture.json', architecture('Mid', ['one', 'two', 'three'], [1100, 520],
    [{ id: 'midone', label: 'Mid one', focus: ['one', 'two'] },
     { id: 'midtwo', label: 'Mid two', focus: ['three'] }]));
  write('leaf.architecture.json', architecture('Leaf', ['solo'], [800, 460]));
  write('doc.levels.json', {
    schema_version: 1,
    diagram_type: 'levels',
    meta: { title: 'Levels browser fixture', output: 'levels.html' },
    levels: [
      { id: 'root', label: 'Root', source: 'root.architecture.json' },
      { id: 'mid', label: 'Mid', source: 'mid.architecture.json', parent: { level: 'root', node: 'beta' } },
      { id: 'leaf', label: 'Leaf', source: 'leaf.architecture.json', parent: { level: 'mid', node: 'three' } },
    ],
  });

  const artifact = path.join(scratch, 'doc.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/levels/render-levels.mjs'),
    path.join(scratch, 'doc.levels.json'),
    artifact,
  ]);
  const plain = path.join(scratch, 'plain.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(scratch, 'root.architecture.json'),
    plain,
  ]);

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  let navigation = 0;
  async function load(file, suffix = '') {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    // A hash-only change to the same file is a same-document navigation and
    // never fires load, so every navigation carries a unique query.
    navigation += 1;
    await send('Page.navigate', { url: `${pathToFileURL(file).href}?nav=${navigation}${suffix}` });
    await loaded;
    await checkPointer();
    await run('document.fonts.ready');
    await run('Archify.viewerChromeLayout.whenStable()');
  }
  const snapshot = () => run(`(function(){
    var stage = Archify.stage.svg();
    return {
      active: Archify.levels.active(),
      path: Archify.levels.path(),
      crumbs: Array.prototype.map.call(document.querySelectorAll('.level-crumb'), function (b) { return b.textContent; }),
      stageLevel: stage ? stage.getAttribute('data-level') : null,
      stageViewBox: stage ? stage.getAttribute('viewBox') : null,
      visibleSvgs: Array.prototype.map.call(document.querySelectorAll('.diagram-container > svg:not([hidden])'), function (s) { return s.getAttribute('data-level'); }),
      visibleCards: Array.prototype.map.call(document.querySelectorAll('.cards:not([hidden])'), function (c) { return c.getAttribute('data-level'); }),
      radarCount: Archify.radar.count(),
      guidedViews: typeof Archify.guidedViews !== 'undefined' || Boolean(document.getElementById('guided-views')),
      finderCount: Archify.finder.count,
      railHidden: document.getElementById('level-rail').hidden,
      hash: location.hash
    };
  })()`);

  await load(artifact);

  const initial = await snapshot();
  assert.equal(initial.active, 'root');
  assert.equal(initial.stageLevel, 'root');
  assert.deepEqual(initial.visibleSvgs, ['root']);
  assert.deepEqual(initial.visibleCards, ['root']);
  assert.deepEqual(initial.crumbs, ['Root']);
  assert.equal(initial.railHidden, false);
  assert.equal(initial.radarCount, 2, 'radar must describe the root level');
  assert.equal(initial.guidedViews, false, 'guided views stay retired, even when sources author meta.views');
  assert.equal(initial.finderCount, 2, 'finder must describe the root level');

  // Every level's drill relationship is marked once, so switching cannot
  // leave a stale affordance behind on the level it left.
  const marks = await run(`Array.prototype.map.call(document.querySelectorAll('[data-drill-to]'), function (n) {
    return n.getAttribute('data-node-id') + '->' + n.getAttribute('data-drill-to');
  }).sort().join(',')`);
  assert.equal(marks, 'beta->mid,three->leaf');

  // A double-click on a drillable node opens its level: a single click is
  // already focus, so drilling must not take that gesture.
  await run(`(function(){
    var node = Archify.stage.svg().querySelector('[data-drill-to="mid"]');
    node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  })()`);
  const afterDrill = await snapshot();
  assert.equal(afterDrill.active, 'mid');
  assert.equal(afterDrill.stageLevel, 'mid');
  assert.equal(afterDrill.stageViewBox, '0 0 1100 520');
  assert.deepEqual(afterDrill.visibleSvgs, ['mid']);
  assert.deepEqual(afterDrill.visibleCards, ['mid'], 'cards follow the active level');
  assert.deepEqual(afterDrill.crumbs, ['Root', 'Mid']);
  assert.equal(afterDrill.hash, '#level=mid');
  assert.equal(afterDrill.radarCount, 3, 'radar rebuilds against the new level');
  assert.equal(afterDrill.finderCount, 3, 'finder re-points at the new level');
  assert.equal(afterDrill.guidedViews, false);

  // Export must serialize the level on stage, not the first one in the file.
  const exported = await run(`(function(){
    var svg = Archify.stage.svg();
    return { level: svg.getAttribute('data-level'), viewBox: svg.getAttribute('viewBox') };
  })()`);
  assert.equal(exported.level, 'mid');
  assert.equal(exported.viewBox, '0 0 1100 520');

  const deeper = await run(`(function(){ Archify.levels.show('leaf'); return Archify.levels.path().join('/'); })()`);
  assert.equal(deeper, 'root/mid/leaf');
  const atLeaf = await snapshot();
  assert.equal(atLeaf.radarCount, 1);
  assert.deepEqual(atLeaf.crumbs, ['Root', 'Mid', 'Leaf']);

  // Escape walks back up one level.
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert.equal((await snapshot()).active, 'mid');

  // A crumb returns directly to an ancestor and clears the deep link.
  await run(`document.querySelector('.level-crumb[data-level-target="root"]').click()`);
  const backHome = await snapshot();
  assert.equal(backHome.active, 'root');
  assert.equal(backHome.radarCount, 2);
  assert.equal(backHome.hash, '');
  // A deep link opens directly on the named level.
  await load(artifact, '#level=leaf');
  const deepLinked = await snapshot();
  assert.equal(deepLinked.active, 'leaf');
  assert.equal(deepLinked.stageLevel, 'leaf');
  assert.deepEqual(deepLinked.visibleCards, ['leaf']);
  assert.equal(deepLinked.radarCount, 1, 'modules bind to the deep-linked level, not the first one');

  // Interaction state in the same link restores against the named level, and
  // Escape dismisses each temporary layer before it climbs a level.
  await load(artifact, '#level=mid&focus=one');
  const focusedDeepLink = await run(`(function(){
    return {
      active: Archify.levels.active(),
      focus: Archify.focus.active(),
      focusOnStage: Archify.stage.svg().hasAttribute('data-focus-active')
    };
  })()`);
  assert.deepEqual(focusedDeepLink, { active: 'mid', focus: 'one', focusOnStage: true });
  const escape = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;
  await run(escape);
  assert.equal(await run('Archify.focus.active()'), null, 'the first Escape clears focus');
  assert.equal((await snapshot()).active, 'mid', 'and leaves the level on stage');
  await run('Archify.radar.open()');
  await run(escape);
  assert.equal(await run('Archify.radar.isOpen()'), false, 'Escape closes an open overlay');
  assert.equal((await snapshot()).active, 'mid', 'without also climbing a level');
  await run(escape);
  assert.equal((await snapshot()).active, 'root', 'with nothing left to dismiss, Escape climbs');
  // An ordinary single-diagram artifact keeps the rail out of the document
  // flow entirely; a hidden-but-laid-out rail would cost invisible height and
  // stall the adaptive reader.
  await load(plain);
  const plainState = await run(`(function(){
    var rail = document.querySelector('.level-rail');
    return {
      levels: Archify.levels.count,
      railHidden: rail ? rail.hidden : null,
      railHeight: rail ? rail.getBoundingClientRect().height : null,
      stageIsOnlySvg: document.querySelectorAll('.diagram-container > svg').length === 1,
      readerActive: Archify.readerLayout.active(),
      pageHeight: document.documentElement.scrollHeight,
      pageHeightWithoutRail: (function () {
        if (!rail) return document.documentElement.scrollHeight;
        var parent = rail.parentNode;
        var next = rail.nextSibling;
        parent.removeChild(rail);
        var height = document.documentElement.scrollHeight;
        parent.insertBefore(rail, next);
        return height;
      })()
    };
  })()`);
  assert.equal(plainState.levels, 0);
  assert.equal(plainState.railHidden, true);
  assert.equal(plainState.railHeight, 0, 'a hidden rail must take no layout height');
  assert.equal(plainState.stageIsOnlySvg, true);
  assert.equal(plainState.pageHeight, plainState.pageHeightWithoutRail, 'the hidden rail must not change page height');
});
