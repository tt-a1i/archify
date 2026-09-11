import assert from 'node:assert/strict';

// Keep native input and assert the actual event target, so a later docking
// update cannot silently turn a missed click into an unrelated state timeout.
function installClickObserver() {
  const describe = el => el ? { tag: el.tagName, id: el.id, node: el.getAttribute('data-node-id') } : null;
  const state = el => {
    const r = el?.getBoundingClientRect();
    const point = r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    const hit = point && document.elementFromPoint(point.x, point.y);
    return {
      point, rect: r ? [r.x, r.y, r.width, r.height] : null,
      visible: !!el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      enabled: !!el && !el.matches(':disabled,[aria-disabled="true"]'),
      hit: describe(hit), matches: !!el && (el === hit || el.contains(hit)),
      camera: document.querySelector('.diagram-container')?.getAttribute('data-camera-transaction'),
      dock: document.getElementById('route-probe')?.getAttribute('data-route-dock'),
    };
  };
  let listener, observation;
  function arm(selector) {
    if (listener) removeEventListener('click', listener, true);
    observation = null;
    listener = event => {
      const el = document.querySelector(selector);
      observation = { trusted: event.isTrusted, matches: !!el && (el === event.target || el.contains(event.target)),
        target: describe(event.target), state: state(el), x: event.clientX, y: event.clientY };
    };
    addEventListener('click', listener, { capture: true, once: true });
  }
  window.viewerClick = {
    async ready(selector, timeout) {
      document.querySelector(selector)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      await Archify.viewerChromeLayout.whenStable();
      return new Promise((resolve, reject) => {
        const start = performance.now();
        let previous;
        function sample() {
          const current = state(document.querySelector(selector));
          const stable = current.rect && previous?.every((value, i) => Math.abs(value - current.rect[i]) < 0.1);
          if (stable && current.visible && current.enabled && current.matches && !current.camera) {
            arm(selector);
            return resolve(current.point);
          }
          if (performance.now() - start > timeout) {
            return reject(new Error('Viewer click target not ready: ' + selector + ' ' + JSON.stringify(current)));
          }
          previous = current.rect;
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    },
    finish() {
      removeEventListener('click', listener, true);
      listener = null;
      return observation;
    },
  };
}

export async function createViewerClick({ send, run, timeout }) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installClickObserver.toString()})();` });
  return async selector => {
    const point = await run(`viewerClick.ready(${JSON.stringify(selector)}, ${timeout})`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    const observation = await run('viewerClick.finish()');
    assert.ok(observation?.trusted && observation.matches,
      `Native click missed ${selector}: ${JSON.stringify({ point, observation })}`);
  };
}
