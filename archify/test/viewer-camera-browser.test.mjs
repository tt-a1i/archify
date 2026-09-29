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
const cases = {
  architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

test('Camera preserves transactions, rendered state and real caller handoffs', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser camera checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-camera-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_CAMERA_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => {
    if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
  });
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    files[mode] = path.join(scratch, `${mode}.html`);
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      path.join(skillRoot, 'examples', example), files[mode]]);
  }
  files.large = path.join(scratch, 'workflow-300.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/workflow/render-workflow.mjs'),
    path.resolve(skillRoot, '..', 'benchmarks/hybrid-large-world-viewer-pilot/corpus/workflow-300.workflow.json'),
    files.large]);
  const wide = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', cases.sequence), 'utf8'));
  wide.meta.viewBox[0] = 24000;
  fs.writeFileSync(path.join(scratch, 'wide.json'), JSON.stringify(wide));
  files.wide = path.join(scratch, 'wide.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'),
    path.join(scratch, 'wide.json'), files.wide]);
  const trace = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', cases.architecture), 'utf8'));
  trace.meta.animation = 'trace';
  fs.writeFileSync(path.join(scratch, 'trace.json'), JSON.stringify(trace));
  files.trace = path.join(scratch, 'trace.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(scratch, 'trace.json'), files.trace]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  async function run(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.cameraErrors = [];
    addEventListener('error', e => cameraErrors.push(e.message));
    addEventListener('unhandledrejection', e => cameraErrors.push(String(e.reason)));
    window.cameraWait = predicate => new Promise((resolve, reject) => {
      let frames = 0;
      function sample() {
        if (predicate()) return resolve();
        if (++frames > 300) return reject(new Error('Camera observation did not settle'));
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
  ` });
  async function viewport(width = 1440, height = 900) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async function stable() {
    // Observe automatic camera/layout work without forcing sync or measurement.
    await run(`(async () => {
      await document.fonts.ready;
      let previous = '', equal = 0;
      await cameraWait(() => {
        const container = document.querySelector('.diagram-container');
        const svg = container.querySelector(':scope > svg');
        const rect = svg.getBoundingClientRect();
        const current = JSON.stringify([Archify.view.state(), getComputedStyle(svg).transform,
          svg.style.clipPath, container.scrollLeft, container.getAttribute('data-camera-transaction'),
          container.style.getPropertyValue('--archify-nav-reserve'), rect.x, rect.y, rect.width, rect.height]);
        equal = current === previous ? equal + 1 : 0;
        previous = current;
        return equal >= 8 && !container.hasAttribute('data-camera-transaction');
      });
    })()`, true);
  }
  async function load(mode = 'architecture', { width = 1440, height = 900, theme = 'dark', reduced = false, embed = false } = {}) {
    await viewport(width, height);
    await send('Emulation.setEmulatedMedia', { media: '', features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}${embed ? "&embed=1" : ""}` });
    await loaded;
    await stable();
  }
  const snapshotExpression = `(() => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const rect = e => { const r = e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; };
      return { state: Archify.view.state(), viewport: Archify.view.logicalViewport(),
        transform: getComputedStyle(svg).transform, clip: svg.style.clipPath,
        stage: rect(svg), nav: rect(c.querySelector('.diagram-nav')), scrollLeft: c.scrollLeft,
        reserve: c.style.getPropertyValue('--archify-nav-reserve'),
        transaction: c.getAttribute('data-camera-transaction'),
        mode: c.getAttribute('data-camera-mode'), detail: c.getAttribute('data-detail-level'),
        viewBox: svg.getAttribute('viewBox'), errors: cameraErrors,
        external: performance.getEntriesByType('resource').map(e => e.name).filter(n => /^https?:/.test(n)) };
    })()`;
  async function snapshot(label, captured) {
    const value = captured || await run(snapshotExpression);
    assert.deepEqual(value.errors, [], label);
    assert.deepEqual(value.external, [], label);
    records.push({ label, ...value });
    return value;
  }
  async function screenshot(name) {
    if (!evidence) return;
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, 'base64'));
  }

  await t.test('native Space-left, middle and right dragging preserve click and context-menu ownership', async () => {
    for (const button of ['left', 'middle', 'right']) {
      await load();
      const initial = await run('Archify.view.state()');
      const point = await run(`(() => {
        const c = document.querySelector('.diagram-container'); c.focus({ preventScroll: true });
        window.panContextMenus = [];
        document.addEventListener('contextmenu', event => panContextMenus.push(event.defaultPrevented));
        const n = c.querySelector('[data-node-id]'), r = n.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (button === 'left') {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        assert.equal(await run(`getComputedStyle(document.querySelector('[data-node-id]')).cursor`), 'grab');
      }
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 60, y: point.y + 40,
        button, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4 });
      await run(`cameraWait(() => Archify.view.state().x >= ${initial.x} + 59)`, true);
      assert.equal(await run(`getComputedStyle(document.querySelector('[data-node-id]')).cursor`), 'grabbing');
      if (button === 'left') {
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await run(`new Promise(resolve => setTimeout(resolve, 350))`, true);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 60, y: point.y + 40, button, clickCount: 1 });
      await stable();
      assert.equal(await run(`Boolean(Archify.focus.active())`), false, 'the drag release must not activate the moved node');
      const state = await run('Archify.view.state()');
      assert.ok(Math.abs(state.x - initial.x - 60) < 1 && Math.abs(state.y - initial.y - 40) < 1);
      assert.equal(await run(`document.querySelector('.diagram-container').matches('.is-pan-ready, .is-panning')`), false);
      if (button === 'right') {
        const menus = await run('panContextMenus');
        assert.ok(menus.length > 0, 'native right input must exercise the browser context-menu event');
        assert.ok(menus.every(Boolean), 'both press-time and release-time menus belong to the pan gesture');
      }
    }
  });

  async function fittedBounds() {
    return run(`(() => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const r = c.getBoundingClientRect(), css = getComputedStyle(c), vb = svg.viewBox.baseVal;
      const point = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; };
      return { state: Archify.view.state(), corners: [point(vb.x, vb.y), point(vb.x + vb.width, vb.y + vb.height)],
        available: [Math.max(0, r.left + c.clientLeft) + parseFloat(css.paddingLeft) + 16,
          Math.max(0, r.top + c.clientTop) + parseFloat(css.paddingTop) + 16,
          Math.min(innerWidth, r.left + c.clientLeft + c.clientWidth) - parseFloat(css.paddingRight) - 16,
          Math.min(innerHeight, r.top + c.clientTop + c.clientHeight) - parseFloat(css.paddingBottom) - 16] };
    })()`);
  }
  function assertContained(result, label) {
    const [[x1, y1], [x2, y2]] = result.corners, [l, t, r, b] = result.available;
    assert.ok(x1 >= l - 2 && y1 >= t - 2 && x2 <= r + 2 && y2 <= b + 2, label + ': full viewBox remains inside visible bounds: ' + JSON.stringify(result));
    assert.ok(Math.abs((x1 + x2) - (l + r)) <= 4 && Math.abs((y1 + y2) - (t + b)) <= 4, label + ': centered: ' + JSON.stringify(result));
  }
  await t.test('fit-all contains five modes, long and wide diagrams in both desktop sizes', async (matrix) => {
    for (const mode of [...Object.keys(cases), 'large', 'wide']) {
      for (const [width, height, theme] of [[1440, 900, 'dark'], [2048, 1320, 'light']]) {
        await matrix.test(mode + '-' + width + '-' + theme, async () => {
          await load(mode, { width, height, theme });
          if (mode === 'wide') {
            // A fixed-width SVG exercises horizontal overflow; the responsive default
            // already shrinks the entire wide viewBox into the reader at 100%.
            await run(`document.querySelector('.diagram-container > svg').style.minWidth = '24000px'`);
            await stable();
          }
          const before = await run(`document.querySelector('.diagram-container > svg').getAttribute('viewBox')`);
          await run(`Archify.view.panBy(-800, 400); document.querySelector('[data-view="fit-all"]').click()`);
          await stable();
          const fit = await fittedBounds();
          records.push({ label: 'fit-all-' + mode + '-' + width, ...fit });
          await screenshot('fit-all-' + mode + '-' + width);
          assertContained(fit, mode);
          assert.equal(fit.state.mode, 'fit');
          if (mode === 'large' || mode === 'wide') assert.ok(fit.state.scale < 0.25);
          // DOMRect and computed CSS matrices have different serialization precision.
          // Bound repeat-fit drift to 0.001 CSS px, far below A4's 2px layout tolerance.
          for (let repeat = 0; repeat < 3; repeat++) {
            await run('Archify.view.fitAll()'); await stable();
            const again = (await fittedBounds()).state;
            assert.equal(again.mode, fit.state.mode);
            assert.ok(Math.abs(again.scale - fit.state.scale) < 1e-9, 'fit scale is idempotent');
            assert.ok(Math.abs(again.x - fit.state.x) < 0.001 && Math.abs(again.y - fit.state.y) < 0.001,
              'fit position is idempotent within subpixel precision: ' + JSON.stringify({ before: fit.state, after: again }));
          }
          assert.equal(await run(`document.querySelector('.diagram-container > svg').getAttribute('viewBox')`), before);
          if (mode === 'large' || mode === 'wide') {
            const anchored = await run(`(async () => {
              const svg = document.querySelector('.diagram-container > svg'), before = Archify.view.state();
              const p = svg.createSVGPoint(); p.x = 500; p.y = 350;
              const world = p.matrixTransform(svg.getScreenCTM().inverse());
              Archify.view.zoomAt(before.scale * 1.1, p.x, p.y);
              await new Promise(resolve => setTimeout(resolve, 250));
              const after = world.matrixTransform(svg.getScreenCTM());
              return { scale: Archify.view.state().scale, expected: before.scale * 1.1,
                error: Math.hypot(after.x - p.x, after.y - p.y) };
            })()`, true);
            assert.ok(Math.abs(anchored.scale - anchored.expected) < 1e-6, 'zoom stays continuous below 25%');
            assert.ok(anchored.error <= 2, 'the pointer anchor stays within two CSS pixels');
          }
          await run(`document.querySelector('[data-view="reset"]').click()`); await stable();
          assert.deepEqual(await run('Archify.view.state()'), { scale: 1, x: 0, y: 0, mode: 'overview' });
        });
      }
    }
  });

  await t.test('fit follows resizing until manual navigation, and stays available in presentation', async () => {
    await load('large'); await run('Archify.view.fitAll()'); await stable();
    await viewport(2048, 1320); await stable(); assertContained(await fittedBounds(), 'resized');
    await run('Archify.view.panBy(50, 30)'); await stable();
    const manual = await run('({state:Archify.view.state(),world:Archify.view.worldViewport()})');
    await viewport(1440, 900); await stable();
    const resized = await run('({state:Archify.view.state(),world:Archify.view.worldViewport()})');
    assert.equal(resized.state.scale, manual.state.scale);
    assert.equal(resized.state.mode, 'manual');
    for (const [axis, size] of [['x','width'],['y','height']]) {
      assert.ok(Math.abs(manual.world[axis]+manual.world[size]/2-resized.world[axis]-resized.world[size]/2)*manual.state.scale<=2);
    }
    await load(); await run('Archify.presentation.enter()'); await stable();
    await run('Archify.view.fitAll()'); await stable();
    assertContained(await fittedBounds(), 'presentation');
    await run('Archify.presentation.exit()'); await stable();
    for (const options of [{ embed: true }, { width: 390, height: 844 }]) {
      await load('sequence', options);
      assert.equal(await run(`document.querySelector('[data-view="fit-all"]').hidden`), true);
    }
  });

  await t.test('Radar follows steady pan and zoom frames without panel or node scans and preserves navigation scale', async () => {
    await load(); await run('Archify.radar.open()'); await stable();
    const feedback = await run(`(async () => {
      const c = document.querySelector('.diagram-container'), panel = document.getElementById('overview-map');
      const marker = panel.querySelector('.overview-map-viewport');
      const pointer = (type, x) => c.dispatchEvent(new PointerEvent(type, { bubbles: true,
        pointerId: 81, pointerType: 'mouse', button: 1, clientX: x, clientY: 300 }));
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      pointer('pointerdown', 500); await frames();
      let placementWrites = 0, nodeReads = 0, stale = 0;
      const observer = new MutationObserver(items => placementWrites += items.length);
      observer.observe(panel, { attributes: true });
      const nodes = [...c.querySelectorAll('[data-node-id]')];
      const originals = nodes.map(node => node.hasAttribute);
      nodes.forEach((node, i) => node.hasAttribute = function (name) {
        if (name === 'data-focus-selected') nodeReads++;
        return originals[i].call(this, name);
      });
      try {
        for (let i = 1; i <= 60; i++) {
          pointer('pointermove', 500 - i); await frames();
          const visible = Archify.view.logicalViewport();
          if (Math.abs(Number(marker.getAttribute('x')) - visible.x) > 0.01) stale++;
        }
      } finally { observer.disconnect(); nodes.forEach((node, i) => node.hasAttribute = originals[i]); }
      pointer('pointerup', 440); await frames();
      let wrongPercent = 0;
      for (let i = 0; i < 60; i++) {
        c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          deltaY: -1, clientX: 500, clientY: 300 })); await frames();
        if (c.querySelector('[data-view-percent]').textContent !== Math.round(Archify.view.state().scale * 100) + '%') wrongPercent++;
      }
      await cameraWait(() => !c.classList.contains('is-wheel-moving'));
      return { placementWrites, nodeReads, stale, wrongPercent };
    })()`, true);
    assert.deepEqual(feedback, { placementWrites: 0, nodeReads: 0, stale: 0, wrongPercent: 0 });
    for (const requested of [0.5, 1, 2, 'fit']) {
      if (requested === 'fit') {
        await load('large');
        await run('Archify.view.fitAll(); Archify.radar.open()');
      } else await run(`Archify.view.zoomAt(${requested}, 500, 300)`);
      await stable();
      const scale = await run('Archify.view.state().scale');
      if (requested === 'fit') assert.ok(scale < 0.25);
      const result = await run(`(async () => {
        const surface = document.getElementById('overview-map-surface'), r = surface.getBoundingClientRect();
        const pointer = (type, x) => surface.dispatchEvent(new PointerEvent(type, { bubbles: true,
          button: 0, pointerId: 82, clientX: x, clientY: r.top + r.height / 2 }));
        const scales = [];
        pointer('pointerdown', r.left + 20); scales.push(Archify.view.state().scale);
        pointer('pointermove', r.left + 40); scales.push(Archify.view.state().scale);
        pointer('pointerup', r.left + 40); scales.push(Archify.view.state().scale);
        surface.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
        scales.push(Archify.view.state().scale);
        return scales;
      })()`, true);
      for (const actual of result) assert.ok(Math.abs(actual - scale) <= 1e-6);
    }
  });

  await t.test('new camera commands take over pending wheel, keyboard and pointer gestures', async () => {
    for (const gesture of ['wheel', 'keyboard', 'pointer']) {
      for (const command of ['reset', 'automatic-reset', 'fit-all', 'reveal', 'center']) {
        await load();
        const result = await run(`(async () => {
          const c = document.querySelector('.diagram-container');
          c.focus();
          const pointer = (type, x) => c.dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerId: 71, pointerType: 'mouse', button: 2, buttons: 2,
            clientX: x, clientY: 300
          }));
          if (${JSON.stringify(gesture)} === 'wheel') {
            c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 600 }));
          } else if (${JSON.stringify(gesture)} === 'keyboard') {
            c.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
          } else {
            pointer('pointerdown', 500); pointer('pointermove', 400);
          }
          await cameraWait(() => Math.abs(Archify.view.state().x) + Math.abs(Archify.view.state().y) > 1);
          if (${JSON.stringify(command)} === 'reset') c.querySelector('[data-view="reset"]').click();
          else if (${JSON.stringify(command)} === 'automatic-reset') Archify.view.reset({ automatic: true });
          else if (${JSON.stringify(command)} === 'fit-all') Archify.view.fitAll();
          else if (${JSON.stringify(command)} === 'reveal') await Archify.view.reveal(['api'], { instant: true }).finished;
          else Archify.view.centerAt(200, 200, { instant: true });
          const takenOver = Archify.view.state();
          pointer('pointermove', 100);
          await new Promise(resolve => setTimeout(resolve, 700));
          return { takenOver, after: Archify.view.state(), moving:
            c.matches('.is-wheel-moving, .is-keyboard-panning, .is-panning') };
        })()`, true);
        assert.deepEqual(result.after, result.takenOver, `${gesture} must not overwrite ${command}`);
        assert.equal(result.moving, false, `${gesture} must release its gesture state`);
      }
    }
  });

  await t.test('zoomed drag updates fixed-canvas clipping until the final position settles', async () => {
    await load();
    await run(`Archify.view.zoomAt(2, 700, 400)`);
    await stable();
    const result = await run(`(async () => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const initialClip = svg.style.clipPath;
      const pointer = (type, x) => c.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 72, pointerType: 'mouse', button: 2, buttons: 2,
        clientX: x, clientY: 300
      }));
      pointer('pointerdown', 500); pointer('pointermove', 700);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const duringClip = svg.style.clipPath;
      window.finishClipDrag = () => pointer('pointerup', 700);
      return { initialClip, duringClip, overflow: getComputedStyle(c).overflow };
    })()`, true);
    await screenshot('zoomed-drag-during');
    await run('finishClipDrag()');
    await stable();
    await screenshot('zoomed-drag-settled');
    assert.ok(result.initialClip.startsWith('inset('));
    assert.ok(result.duringClip.startsWith('inset('));
    assert.notEqual(result.duringClip, result.initialClip, 'drag must update the clip as nodes move into view');
    assert.equal(result.overflow, 'hidden');
    const finalClip = await run(`document.querySelector('.diagram-container > svg').style.clipPath`);
    assert.ok(finalClip.startsWith('inset('));
    assert.notEqual(finalClip, result.initialClip);
  });

  await t.test('embedded diagrams leave native gestures available when navigation is hidden', async () => {
    await load('architecture', { embed: true });
    const result = await run(`(async () => {
      const c = document.querySelector('.diagram-container');
      const initial = Archify.view.state();
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 600 });
      c.dispatchEvent(wheel);
      const zoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -200, ctrlKey: true });
      c.dispatchEvent(zoom);
      const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true,
        pointerId: 73, pointerType: 'touch', button: 0, clientX: 400, clientY: 300 });
      c.dispatchEvent(down);
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 73, clientX: 600, clientY: 500 }));
      await new Promise(resolve => setTimeout(resolve, 700));
      return { initial, after: Archify.view.state(), prevented: [wheel.defaultPrevented, zoom.defaultPrevented, down.defaultPrevented],
        tabIndex: c.tabIndex, nav: getComputedStyle(c.querySelector('.diagram-nav')).display };
    })()`, true);
    assert.equal(result.nav, 'none');
    assert.deepEqual(result.prevented, [false, false, false]);
    assert.deepEqual(result.after, result.initial);
    assert.equal(result.tabIndex, -1);
  });

  await t.test('Tab reaches the named canvas and leaving focus stops held arrow navigation', async () => {
    await load();
    let reached = false;
    for (let i = 0; i < 80; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      reached = await run(`document.activeElement === document.querySelector('.diagram-container')`);
      if (reached) break;
    }
    assert.equal(reached, true, 'keyboard users must be able to enter the canvas without a mouse');
    const accessible = await run(`(() => {
      const c = document.querySelector('.diagram-container');
      return { role: c.getAttribute('role'), label: c.getAttribute('aria-label'), outline: getComputedStyle(c).outlineStyle };
    })()`);
    assert.equal(accessible.role, 'region');
    assert.ok(accessible.label);
    assert.notEqual(accessible.outline, 'none');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await run(`cameraWait(() => Archify.view.state().x < -1)`, true);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const stopped = await run(`Archify.view.state()`);
    await run(`new Promise(resolve => setTimeout(resolve, 150))`, true);
    assert.deepEqual(await run('Archify.view.state()'), stopped);
    assert.equal(await run(`document.querySelector('.diagram-container').classList.contains('is-keyboard-panning')`), false);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  });

  await t.test('wheel input beyond camera bounds settles and releases the animation', async () => {
    await load();
    const result = await run(`(async () => {
      const c = document.querySelector('.diagram-container');
      c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -1e9, deltaY: 1e9 }));
      await new Promise(resolve => setTimeout(resolve, 1500));
      const atLimit = Archify.view.state();
      const moving = c.classList.contains('is-wheel-moving');
      c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 100, deltaY: -100 }));
      await new Promise(resolve => setTimeout(resolve, 700));
      return { atLimit, moving, returned: Archify.view.state() };
    })()`, true);
    assert.equal(result.moving, false, 'unreachable wheel targets must not keep scheduling frames');
    assert.equal(result.atLimit.x, 1e6);
    assert.equal(result.atLimit.y, -1e6);
    assert.equal(result.returned.x, 1e6 - 100);
    assert.equal(result.returned.y, -1e6 + 100);
  });

  await t.test('five modes keep initial state, zoom limits and canonical geometry', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode);
      const initial = await snapshot(`${mode}-initial`);
      assert.equal(initial.state.mode, 'fit');
      assertContained(await fittedBounds(), mode+' initial');
      assert.ok(initial.state.scale <= 1);
      const limits = await run(`(() => {
        const before = Archify.view.state().scale;
        const copy = Archify.view.state(); copy.scale = 99;
        const independent = Archify.view.state().scale === before;
        Archify.view.zoomAt(99, 0, 0, { manual: false });
        const max = Archify.view.state().scale;
        Archify.view.zoomAt(0.01, 0, 0, { manual: false });
        return { independent, max, min: Archify.view.state().scale };
      })()`);
      assert.deepEqual(limits, { independent: true, max: 4, min: 0.25 });
      await stable();
      assert.equal((await snapshot(`${mode}-limits`)).viewBox, initial.viewBox);
    }
  });

  await t.test('right-button mouse and primary direct pointers pan while left mouse and controls remain unchanged', async () => {
    await load();
    const result = await run(`(() => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const geometry = () => [...svg.querySelectorAll('[data-node-id], [data-edge-id]')].map(n =>
        ['data-node-id','data-edge-id','transform','d','x','y','width','height'].map(a => n.getAttribute(a)));
      const beforeGeometry = JSON.stringify(geometry());
      const pointer = (type, x, y, button, pointerType = 'mouse', pointerId = 31) => new PointerEvent(type, {
        bubbles: true, pointerId, pointerType, button,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : (button === 2 ? 2 : 1), clientX: x, clientY: y
      });
      const before = Archify.view.state();
      c.querySelector('.diagram-nav').dispatchEvent(pointer('pointerdown', 500, 400, 2));
      c.dispatchEvent(pointer('pointermove', 450, 350, 2));
      const controlExcluded = JSON.stringify(before) === JSON.stringify(Archify.view.state());
      c.dispatchEvent(pointer('pointerdown', 500, 400, 0));
      c.dispatchEvent(pointer('pointermove', 450, 350, 0));
      const leftExcluded = JSON.stringify(before) === JSON.stringify(Archify.view.state()) && !c.classList.contains('is-panning');
      svg.querySelector('[data-node-id]').dispatchEvent(pointer('pointerdown', 500, 400, 2));
      c.dispatchEvent(pointer('pointermove', 450, 350, 2));
      const dragged = c.classList.contains('is-panning');
      c.dispatchEvent(pointer('pointercancel', 450, 350, 2));
      const cancelled = !c.classList.contains('is-panning');
      const ended = Archify.view.state();
      c.dispatchEvent(pointer('pointermove', 100, 100, 2));
      c.dispatchEvent(pointer('pointerdown', 300, 300, 0, 'touch', 32));
      c.dispatchEvent(pointer('pointermove', 330, 320, 0, 'touch', 32));
      c.dispatchEvent(pointer('pointerup', 330, 320, 0, 'touch', 32));
      const touched = Archify.view.state();
      c.dispatchEvent(pointer('pointerdown', 300, 300, 0, 'pen', 33));
      const penStarted = c.classList.contains('is-panning');
      c.dispatchEvent(pointer('pointercancel', 300, 300, 0, 'pen', 33));
      const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      c.dispatchEvent(contextMenu);
      return { step: before.scale, controlExcluded, leftExcluded, dragged, cancelled,
        moved: Math.abs(ended.x - before.x + 50) < 1 && Math.abs(ended.y - before.y + 50) < 1, contextSuppressed: contextMenu.defaultPrevented,
        touched: touched.x === ended.x + 30 && touched.y === ended.y + 20, penStarted,
        unchanged: JSON.stringify(touched) === JSON.stringify(Archify.view.state()),
        geometryUnchanged: beforeGeometry === JSON.stringify(geometry()) };
    })()`);
    assert.deepEqual(result, { step: 1, controlExcluded: true, leftExcluded: true, dragged: true, cancelled: true,
      moved: true, contextSuppressed: true, touched: true, penStarted: true,
      unchanged: true, geometryUnchanged: true });
    await stable();
    await snapshot('pointer-cancel');
  });

  await t.test('wheel pans, modified wheel zooms at the pointer, arrow keys pan, and Radar marks an off-canvas viewport', async () => {
    await load();
    const result = await run(`(async () => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const grid = c.querySelector(':scope > .infinite-canvas-grid');
      const svgGrid = svg.querySelector('pattern#grid');
      const root = document.documentElement;
      const previousPreset = root.getAttribute('data-preset');
      root.setAttribute('data-preset', 'blueprint');
      const blueprintBackground = getComputedStyle(document.body).backgroundImage;
      if (previousPreset) root.setAttribute('data-preset', previousPreset);
      else root.removeAttribute('data-preset');
      const rect = c.getBoundingClientRect();
      const offsetLeft = svg.offsetLeft || 0, offsetTop = svg.offsetTop || 0;
      const clientX = Math.round(rect.left + offsetLeft + 310);
      const clientY = Math.round(rect.top + offsetTop + 220);
      const localX = clientX - rect.left - offsetLeft;
      const localY = clientY - rect.top - offsetTop;
      const before = Archify.view.state();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      const outsideArrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(outsideArrow);
      const outsideNative = !outsideArrow.defaultPrevented && JSON.stringify(before) === JSON.stringify(Archify.view.state());
      outside.remove();
      c.querySelector('[data-view="reset"]').focus();
      const controlArrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(controlArrow);
      const controlNative = !controlArrow.defaultPrevented && JSON.stringify(before) === JSON.stringify(Archify.view.state());
      c.focus({ preventScroll: true });
      // The preset mutations above schedule a Reader/Chrome reprobe. Establish a
      // stable viewport before counting steady gesture work, as required by A10.
      await Archify.readerLayout.whenStable();
      await Archify.viewerChromeLayout.whenStable();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const beforeWheel = Archify.view.state();
      let radarSyncs = 0, layoutSyncs = 0;
      const radarSync = Archify.radar.sync, layoutSchedule = Archify.viewerChromeLayout.schedule;
      Archify.radar.sync = function () { radarSyncs += 1; return radarSync.apply(this, arguments); };
      Archify.viewerChromeLayout.schedule = function () { layoutSyncs += 1; return layoutSchedule.apply(this, arguments); };
      const panWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true,
        deltaX: 40, deltaY: 55, clientX, clientY });
      c.dispatchEvent(panWheel);
      const afterWheelDispatch = Archify.view.state();
      const wheelDeferred = afterWheelDispatch.scale === beforeWheel.scale &&
        afterWheelDispatch.x === beforeWheel.x && afterWheelDispatch.y === beforeWheel.y;
      radarSyncs = 0;
      layoutSyncs = 0;
      await cameraWait(() => Archify.view.state().y < 0 && Archify.view.state().y > -55);
      const interpolatedPan = Archify.view.state();
      const deferredAuxiliarySync = radarSyncs === 0 && layoutSyncs === 0;
      const interpolatedGrid = {
        x: parseFloat(c.style.getPropertyValue('--archify-grid-x')),
        y: parseFloat(c.style.getPropertyValue('--archify-grid-y')),
        background: getComputedStyle(grid).backgroundImage
      };
      await cameraWait(() => !c.classList.contains('is-wheel-moving'));
      const settledAuxiliarySync = radarSyncs > 0 && layoutSyncs > 0;
      Archify.radar.sync = radarSync;
      Archify.viewerChromeLayout.schedule = layoutSchedule;
      const panned = Archify.view.state();
      const zoomPoint = svg.createSVGPoint(); zoomPoint.x = clientX; zoomPoint.y = clientY;
      const beforeAnchor = zoomPoint.matrixTransform(svg.getScreenCTM().inverse());
      const zoomWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
        deltaY: -120, clientX, clientY });
      c.dispatchEvent(zoomWheel);
      const zoomed = Archify.view.state();
      const afterAnchor = zoomPoint.matrixTransform(svg.getScreenCTM().inverse());
      const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(arrow);
      await cameraWait(() => Archify.view.state().y < zoomed.y - 1);
      const keyed = Archify.view.state();
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
      await cameraWait(() => !c.classList.contains('is-keyboard-panning'));
      Archify.view.fit();
      const fitted = Archify.view.state();
      Archify.view.panBy(180, 140, { manual: false });
      const positive = Archify.view.state();
      Archify.view.panBy(-100000, -100000);
      const logical = Archify.view.logicalViewport();
      const world = Archify.view.worldViewport();
      Archify.radar.open();
      await cameraWait(() => document.querySelector('.overview-map-viewport')?.hasAttribute('data-outside'));
      const marker = document.querySelector('.overview-map-viewport');
      return {
        api: ['zoomAt','panBy','fit','worldViewport'].every(name => typeof Archify.view[name] === 'function'),
        grid: Boolean(grid) && getComputedStyle(grid).pointerEvents === 'none',
        pointerAnchor: Math.abs(beforeAnchor.x - afterAnchor.x) < 0.01 && Math.abs(beforeAnchor.y - afterAnchor.y) < 0.01,
        wheelPan: panWheel.defaultPrevented && panned.scale === before.scale &&
          Math.abs(panned.x - (before.x - 40)) < 0.01 && Math.abs(panned.y - (before.y - 55)) < 0.01,
        wheelInterpolated: interpolatedPan.y < before.y && interpolatedPan.y > panned.y,
        wheelDeferred, deferredAuxiliarySync, settledAuxiliarySync,
        dottedGrid: interpolatedGrid.background.includes('radial-gradient') &&
          !interpolatedGrid.background.includes('linear-gradient') &&
          Math.abs(interpolatedGrid.x - (interpolatedPan.x + (svg.offsetLeft || 0))) < 0.01 &&
          Math.abs(interpolatedGrid.y - (interpolatedPan.y + (svg.offsetTop || 0))) < 0.01,
        dottedSurfaces: blueprintBackground.includes('radial-gradient') &&
          !blueprintBackground.includes('linear-gradient') &&
          Boolean(svgGrid && svgGrid.querySelector('circle.c-grid')) &&
          !Boolean(svgGrid && svgGrid.querySelector('path')),
        wheelZoom: zoomWheel.defaultPrevented && zoomed.scale > panned.scale,
        keyboardPan: outsideNative && controlNative && arrow.defaultPrevented &&
          Math.abs(keyed.x - zoomed.x) < 0.01 && keyed.y < zoomed.y - 1,
        fitted, positive, outside: logical.outside, worldOutside: world.x > Number(svg.viewBox.baseVal.x + svg.viewBox.baseVal.width),
        radarOutside: marker.hasAttribute('data-outside') && Number(marker.getAttribute('width')) > 0,
        gridPosition: c.style.getPropertyValue('--archify-grid-x')
      };
    })()`, true);
    assert.equal(result.api, true);
    assert.equal(result.grid, true);
    assert.equal(result.pointerAnchor, true, JSON.stringify(result));
    assert.equal(result.wheelPan, true, JSON.stringify(result));
    assert.equal(result.wheelInterpolated, true, JSON.stringify(result));
    assert.equal(result.wheelDeferred, true, JSON.stringify(result));
    assert.equal(result.deferredAuxiliarySync, true, JSON.stringify(result));
    assert.equal(result.settledAuxiliarySync, true, JSON.stringify(result));
    assert.equal(result.dottedGrid, true, JSON.stringify(result));
    assert.equal(result.dottedSurfaces, true, JSON.stringify(result));
    assert.equal(result.wheelZoom, true, JSON.stringify(result));
    assert.equal(result.keyboardPan, true, JSON.stringify(result));
    assert.deepEqual(result.fitted, { scale: 1, x: 0, y: 0, mode: 'overview' });
    assert.deepEqual(result.positive, { scale: 1, x: 180, y: 140, mode: 'manual' });
    assert.equal(result.outside, true);
    assert.equal(result.worldOutside, true);
    assert.equal(result.radarOutside, true);
    assert.match(result.gridPosition, /px$/);
    await stable();
    await snapshot('infinite-canvas');
    await screenshot('infinite-canvas');
  });

  await t.test('a large diagram keeps navigation visible while wheel pan and Reset leave page scroll unchanged', async () => {
    for (const fixed of [true, false]) {
    await load('large', { height: fixed ? 900 : 599 });
    const result = await run(`(async () => {
      const c = document.querySelector('.diagram-container');
      const svg = c.querySelector(':scope > svg');
      const nav = c.querySelector('.diagram-nav');
      const visible = () => {
        const rect = nav.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
      };
      const navRect = () => { const rect = nav.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; };
      const initial = { visible: visible(), docked: nav.hasAttribute('data-viewport-docked'), position: getComputedStyle(nav).position,
        scrollY, nav: navRect(), viewport: [innerWidth, innerHeight], state: Archify.view.state() };
      // Only document-flow fallback permits an authored taller panel.
      if (!document.documentElement.hasAttribute('data-fixed-canvas')) c.style.height = Math.round(innerHeight * 1.2) + 'px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const mediumHeight = { visible: visible(), docked: nav.hasAttribute('data-viewport-docked') };
      const rect = c.getBoundingClientRect();
      c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 900,
        clientX: rect.left + 300, clientY: Math.max(rect.top + 100, 300) }));
      await cameraWait(() => !c.classList.contains('is-wheel-moving'));
      const afterWheel = { visible: visible(), scrollY, state: Archify.view.state(), transform: svg.style.transform };
      c.querySelector('[data-view="reset"]').click();
      return { initial, mediumHeight, afterWheel, afterReset: { visible: visible(), scrollY, state: Archify.view.state() } };
    })()`, true);
    assert.equal(result.initial.visible, true, JSON.stringify(result));
    assert.equal(result.initial.docked, !fixed, JSON.stringify(result));
    assert.equal(result.initial.scrollY, 0, JSON.stringify(result));
    assert.deepEqual(result.mediumHeight, { visible: true, docked: !fixed });
    assert.equal(result.afterWheel.visible, true, JSON.stringify(result));
    assert.equal(result.afterWheel.scrollY, 0);
    assert.ok(Math.abs(result.afterWheel.state.scale / result.initial.state.scale - 1) < .00001,
      'wheel pan preserves scale within CSS matrix serialization precision');
    assert.ok(Math.abs(result.afterWheel.state.y-result.initial.state.y+900)<1);
    assert.ok(Math.abs(result.afterWheel.state.x-result.initial.state.x)<1);
    assert.deepEqual(result.afterReset, {
      visible: true, scrollY: 0, state: { scale: 1, x: 0, y: 0, mode: 'overview' },
    });
    await stable();
    await snapshot('large-navigation');
    await screenshot('large-navigation-' + (fixed ? 'fixed' : 'fallback'));
    }
  });

  await t.test('target selection, failure branches and instant options preserve their side effects', async () => {
    await load();
    const value = await run(`(async () => {
      const v = Archify.view, node = document.querySelector('[data-node-id="api"]');
      const original = node.getBBox;
      const empty = v.reveal([], { instant: true });
      const unknown = v.reveal(['missing'], { instant: true });
      node.getBBox = () => { throw new Error('test geometry'); };
      const failedBox = v.reveal(['api'], { instant: true });
      node.getBBox = original;
      const mixed = v.reveal(['missing', 'api'], { instant: true, maxScale: 1.5, padding: 64 });
      const mixedResult = await mixed.finished;
      const multi = v.reveal(['api', 'db'], { instant: true, includeNeighbors: true });
      await multi.finished;
      return { empty, unknown, failedBox, mixed: mixedResult.state, scale: mixed.target.scale,
        multi: multi.settled, badCenter: v.centerAt('invalid', 10) };
    })()`, true);
    assert.deepEqual(value, { empty: false, unknown: false, failedBox: false, mixed: 'complete', scale: 1.5, multi: true, badCenter: false });
    await stable();
    await snapshot('targets');
  });

  await t.test('running transactions complete, replace, cancel and yield to manual navigation', async () => {
    for (const theme of ['dark', 'light']) {
      await load('architecture', { theme });
      // Start and observe in one page evaluation: CDP round trips may outlast
      // the animation, so the middle snapshot must be captured in its frame.
      const animation = await run(`(async () => {
        const camera = Archify.view.reveal(['api'], { duration: 520 });
        const samples = [];
        let middle = null;
        function sampleCamera() {
          const svg = document.querySelector('.diagram-container > svg');
          const state = Archify.view.state();
          samples.push({ state, transform: getComputedStyle(svg).transform, clip: svg.style.clipPath, settled: camera.settled });
          if (!middle && !camera.settled && state.scale > 1.15) middle = ${snapshotExpression};
          if (!camera.settled) requestAnimationFrame(sampleCamera);
        }
        requestAnimationFrame(sampleCamera);
        const outcome = await camera.finished;
        return { middle, samples, outcome };
      })()`, true);
      assert.ok(animation.middle, 'the running animation must yield a middle snapshot');
      const middle = await snapshot(`animation-middle-${theme}`, animation.middle);
      assert.ok(middle.state.scale > 1 && middle.state.scale < 2.15);
      assert.equal(animation.outcome.state, 'complete');
      assert.ok(animation.samples.filter(s => !s.settled && s.clip).length > 1);
      if (evidence) fs.writeFileSync(path.join(evidence, `animation-${theme}.json`), JSON.stringify(animation.samples, null, 2));
      await stable();
      await snapshot(`animation-final-${theme}`);
      await screenshot(`animation-final-${theme}`);
    }
    const results = await run(`(async () => {
      const v = Archify.view, results = [];
      for (const action of ['replace', 'cancel', 'commit', 'manual', 'reset']) {
        v.reset({ automatic: true });
        const first = v.reveal(['api'], { duration: 520 });
        await cameraWait(() => !first.settled && v.state().scale > 1.05);
        const before = v.state();
        let second;
        if (action === 'replace') second = v.reveal(['db'], { instant: true });
        else if (action === 'cancel' || action === 'commit') first.cancel('test-stop', action === 'commit');
        else if (action === 'manual') v.zoomOut();
        else v.reset({ automatic: true });
        const outcome = await first.finished;
        const repeated = first.cancel('again', true);
        const ended = v.state();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        results.push({ action, outcome: outcome.state, repeated, settled: first.settled,
          before, ended, target: first.target,
          unchanged: JSON.stringify(ended) === JSON.stringify(v.state()),
          next: second ? (await second.finished).state : null });
      }
      return results;
    })()`, true);
    assert.deepEqual(results.map(r => r.outcome), ['replaced', 'test-stop', 'test-stop', 'manual', 'reset']);
    for (const r of results) {
      assert.equal(r.repeated, false); assert.equal(r.settled, true); assert.equal(r.unchanged, true);
      if (r.action === 'cancel' || r.action === 'commit') {
        assert.notDeepEqual(r.before, r.target, 'cancellation must occur before reaching the target');
        assert.deepEqual(r.ended, r.action === 'commit' ? r.target : r.before, r.action);
      }
    }
    records.push({ label: 'transaction-results', results });
    await stable();
  });

  await t.test('mobile branches, automatic scroll guard and scrollTo fallback stay distinct', async () => {
    for (const width of [719, 720, 721]) {
      await load('architecture', { width });
      const result = await run(`(async () => {
        const receipt = Archify.view.reveal(['db'], { instant: true });
        return { outcome: (await receipt.finished).state, scrollTarget: 'scrollLeft' in receipt.target };
      })()`, true);
      assert.equal(result.scrollTarget, width <= 720);
      await stable();
      await snapshot(`width-${width}`);
    }
    await load('architecture', { width: 720 });
    const value = await run(`(async () => {
      const c = document.querySelector('.diagram-container'), v = Archify.view;
      const empty = v.reveal([]);
      const emptyMode = v.state().mode;
      c.removeAttribute('data-wide-diagram');
      const contained = v.reveal([]);
      const containedOutcome = (await contained.finished).state;
      c.setAttribute('data-wide-diagram', 'true');
      const original = c.scrollTo;
      c.scrollTo = () => { throw new Error('test scroll fallback'); };
      const fallback = v.reveal(['db'], { instant: true });
      await fallback.finished;
      // Even the assignment fallback participates in the container's existing
      // smooth-scroll CSS. Receipt completion alone is not scroll convergence.
      await cameraWait(() => Math.abs(c.scrollLeft - fallback.target.scrollLeft) < 1);
      const reached = Math.abs(c.scrollLeft - fallback.target.scrollLeft) < 1;
      c.scrollTo = original;
      v.reset({ automatic: true });
      const started = Date.now(), moving = v.reveal(['users']);
      c.dispatchEvent(new Event('scroll'));
      const protectedMode = v.state().mode;
      const outcome = await moving.finished;
      await cameraWait(() => Date.now() - started > 500);
      c.dispatchEvent(new Event('scroll'));
      return { empty, emptyMode, containedOutcome, reached, protectedMode, outcome: outcome.state, manualMode: v.state().mode };
    })()`, true);
    assert.deepEqual(value, { empty: false, emptyMode: 'semantic', containedOutcome: 'complete', reached: true,
      protectedMode: 'semantic', outcome: 'complete', manualMode: 'manual' });
    await stable();
    await snapshot('mobile-scroll');
  });

  await t.test('reduced motion and call-time hidden state keep immediate completion semantics', async () => {
    await load('architecture', { theme: 'light', reduced: true });
    assert.equal(await run(`Archify.view.reveal(['api']).finished.then(r => r.state)`, true), 'reduced-motion');
    await stable();
    await snapshot('reduced-motion');
    await load();
    // A local capability fixture exercises the call-time branch. It does not
    // claim to emulate background-tab frame throttling or visibility events.
    const hidden = await run(`(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      try { return (await Archify.view.reveal(['api']).finished).state; }
      finally { delete document.hidden; }
    })()`, true);
    assert.equal(hidden, 'hidden');
    await stable();
    await snapshot('hidden-call-fixture');
  });

  await t.test('actual Route, Finder and Radar callers retain camera ownership', async () => {
    await load('trace');
    const route = await run(`(() => {
      Archify.motionGovernor.resume();
      Archify.routeProbe.begin({ source: 'users' });
      Archify.routeProbe.choose('db');
      const played = Archify.routeProbe.playJourney();
      const before = Archify.routeProbe.result();
      Archify.view.zoomIn();
      const after = Archify.routeProbe.result();
      return { played, before, after };
    })()`);
    assert.equal(route.played, true); assert.equal(route.before.playing, true); assert.equal(route.after.playing, false);
    assert.deepEqual(route.after.nodes, route.before.nodes);
    assert.equal(route.after.journey, route.before.journey);
    await stable();
    await snapshot('route-takeover');
    await load('architecture', { height: 600 });
    await run(`Archify.finder.select('api')`);
    await stable();
    assert.equal(await run(`Archify.focus.active()`), 'api');
    await snapshot('finder-low-height');
    await run(`window.scrollTo(0, 160); Archify.radar.open(); Archify.radar.focus('db')`);
    await stable();
    assert.equal(await run(`Archify.focus.active()`), 'db');
    await snapshot('radar-focus');
    await viewport(1280, 720);
    await stable();
    await snapshot('automatic-resize');
    await run(`location.hash = 'focus=api'`);
    await run(`cameraWait(() => Archify.focus.active() === 'api')`, true);
    await stable();
    await snapshot('automatic-hashchange');
  });

  await t.test('export removes camera transforms without mutating the live camera', async () => {
    for (const mode of ['semantic', 'fit']) {
      await load(mode === 'fit' ? 'large' : 'architecture');
      await run(mode === 'fit' ? 'Archify.view.fitAll()' : `Archify.view.reveal(['api'], { instant: true })`);
      await stable();
      const exported = await run(`(async () => {
        const svg = document.querySelector('.diagram-container > svg'), before = svg.outerHTML;
        const state = JSON.stringify(Archify.view.state()), original = URL.createObjectURL;
        let blob;
        URL.createObjectURL = value => { if (value.type.startsWith('image/svg+xml')) blob = value; return original.call(URL, value); };
        let after;
        try { const pending = Archify.exportMenu.run('svg'); after = svg.outerHTML; await pending; }
        finally { URL.createObjectURL = original; }
        const text = await blob.text();
        const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
        return { text, unchanged: before === after && state === JSON.stringify(Archify.view.state()),
          clean: !root.hasAttribute('data-view-scale') && !root.style.transform && !root.style.clipPath,
          geometry: root.getAttribute('viewBox') === svg.getAttribute('viewBox'),
          ids: [...root.querySelectorAll('[data-node-id]')].map(n => n.getAttribute('data-node-id')).join() === [...svg.querySelectorAll('[data-node-id]')].map(n => n.getAttribute('data-node-id')).join() };
      })()`, true);
      assert.equal(exported.unchanged, true); assert.equal(exported.clean, true); assert.equal(exported.geometry, true); assert.equal(exported.ids, true);
      if (evidence) fs.writeFileSync(path.join(evidence, 'camera-export-' + mode + '.svg'), exported.text);
      await snapshot('export-' + mode);
    }
  });
});
