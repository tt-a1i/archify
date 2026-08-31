import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

export async function waitForLayout(browser, sessionId) {
  return evaluate(browser, sessionId, `(function () {
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fontsReady.then(function () {
      return new Promise(function (resolve, reject) {
        var previous = '';
        var stableFrames = 0;
        var sampledFrames = 0;
        function rect(element) {
          if (!element) return 'missing';
          var value = element.getBoundingClientRect();
          return [value.left, value.top, value.right, value.bottom].map(function (entry) {
            return Math.round(entry * 100) / 100;
          }).join(',');
        }
        function sample() {
          sampledFrames += 1;
          var container = document.querySelector('.diagram-container');
          var current = [
            rect(container),
            rect(container && container.querySelector(':scope > svg')),
            rect(document.querySelector('.diagram-nav')),
            rect(document.querySelector('[data-legend]')),
            rect(document.getElementById('focus-chip')),
            container ? container.getAttribute('data-camera-transaction') || 'settled' : ''
          ].join('|');
          if (current === previous) stableFrames += 1;
          else {
            previous = current;
            stableFrames = 0;
          }
          if (stableFrames >= 8) return resolve({ stable: true, sampledFrames: sampledFrames });
          if (sampledFrames >= 240) return reject(new Error('Final Viewer geometry did not stabilize.'));
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    });
  })()`, true);
}

export async function load(browser, artifactPath, {
  width = 1440,
  height = 900,
  query = '',
  mediaFeatures = [],
  touch = false,
  motion = 'still',
} = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  if (mediaFeatures.length) {
    await browser.cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: mediaFeatures,
    }, sessionId);
  }
  if (touch) {
    await browser.cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    }, sessionId);
  }
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(path.resolve(artifactPath)).href + query,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `document.documentElement.setAttribute('data-motion', ${JSON.stringify(motion)})`);
  await waitForLayout(browser, sessionId);
  return sessionId;
}

export async function physicalClick(browser, sessionId, selector) {
  await evaluate(browser, sessionId, `(function () {
    var control = document.querySelector(${JSON.stringify(selector)});
    if (!control) return false;
    var scroller = control.closest('.relationship-lens-body');
    if (scroller) {
      var controlRect = control.getBoundingClientRect();
      var scrollerRect = scroller.getBoundingClientRect();
      if (controlRect.top < scrollerRect.top || controlRect.bottom > scrollerRect.bottom) {
        scroller.scrollTop += controlRect.top - scrollerRect.top -
          Math.max(0, (scrollerRect.height - controlRect.height) / 2);
      }
    } else if (control.getBoundingClientRect().top < 0 ||
        control.getBoundingClientRect().bottom > window.innerHeight) {
      control.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { resolve(true); });
      });
    });
  })()`, true);
  const point = await evaluate(browser, sessionId, `(function () {
    var selector = ${JSON.stringify(selector)};
    var control = document.querySelector(selector);
    if (!control || control.offsetParent === null) return null;
    var rect = control.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var candidates = [rect.top + 6, rect.top + rect.height / 2, rect.bottom - 6].map(function (y) {
      var hit = document.elementFromPoint(x, y);
      return {
        x: x,
        y: y,
        ownsControl: !!(hit && (hit === control || hit.closest(selector) === control)),
        hit: hit ? (hit.id || hit.className || hit.tagName) : null
      };
    });
    var owned = candidates.find(function (candidate) { return candidate.ownsControl; });
    if (owned) return owned;
    var scroller = control.closest('.relationship-lens-body');
    var passport = document.getElementById('focus-chip');
    function simpleRect(element) {
      if (!element) return null;
      var value = element.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, height: value.height };
    }
    return {
      candidates: candidates,
      windowScrollY: window.scrollY,
      passport: simpleRect(passport),
      scroller: simpleRect(scroller),
      scrollerScrollTop: scroller ? scroller.scrollTop : null,
      scrollerScrollHeight: scroller ? scroller.scrollHeight : null
    };
  })()`);
  assert.ok(point, `Expected a visible physical click target: ${selector}`);
  assert.equal(point.ownsControl, true, `Expected ${selector} to expose a physical hit point: ${JSON.stringify(point)}`);
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0,
  }, sessionId);
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y,
    button: 'left', buttons: 1, clickCount: 1,
  }, sessionId);
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y,
    button: 'left', buttons: 0, clickCount: 1,
  }, sessionId);
}

export async function pressKey(browser, sessionId, key) {
  const code = key === ' ' ? 'Space' : key;
  const windowsVirtualKeyCode = key === 'Tab' ? 9 : (key === 'Enter' ? 13 : (key === ' ' ? 32 : 0));
  await browser.cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, code, windowsVirtualKeyCode,
  }, sessionId);
  await browser.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode,
  }, sessionId);
}
