import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-subarchitecture-browser-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

function renderFixture({ withSubarchitecture = true } = {}) {
  const fixture = path.join(skillRoot, 'test', 'fixtures', 'transformer-subarchitecture.architecture.json');
  let input = fixture;
  if (!withSubarchitecture) {
    const parentOnly = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    delete parentOnly.components.find((component) => component.id === 'transformer').subarchitecture;
    input = path.join(scratch, 'transformer-parent-only.architecture.json');
    fs.writeFileSync(input, `${JSON.stringify(parentOnly, null, 2)}\n`);
  }
  const output = path.join(scratch, withSubarchitecture ? 'transformer.html' : 'transformer-parent-only.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'architecture',
    input,
    output,
  ]);
  return output;
}

async function evaluate(browser, sessionId, expression) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function load(browser, artifactPath, {
  width = 1440,
  height = 900,
  reducedMotion = false,
} = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  await browser.cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{
      name: 'prefers-reduced-motion',
      value: reducedMotion ? 'reduce' : 'no-preference',
    }],
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `(async function () {
    document.documentElement.setAttribute('data-motion', 'still');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    return true;
  })()`);
  return sessionId;
}

test('one-level internals support pointer, keyboard, exact deep links, Escape, and narrow layout', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 720, height: 900 });
    const opened = await evaluate(browser, sessionId, `(function () {
      var parent = document.querySelector('.diagram-container > svg [data-node-id="transformer"]');
      parent.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      var trigger = document.getElementById('btn-focus-internals');
      var triggerReady = !trigger.hidden && !trigger.disabled;
      var afterParentSelection = {
        parent: Archify.focus.active(),
        open: Archify.subarchitecture.active(),
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden
      };
      trigger.click();
      var child = document.querySelector('#subarchitecture-mount [data-node-id="attention"]');
      child.focus();
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      var columns = getComputedStyle(document.querySelector('.subarchitecture-drawer-content')).gridTemplateColumns;
      return {
        triggerReady: triggerReady,
        afterParentSelection: afterParentSelection,
        parent: Archify.focus.active(),
        open: Archify.subarchitecture.active(),
        child: Archify.subarchitecture.child(),
        hash: location.hash,
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
        mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
        columnTrackCount: columns.trim().split(/\\s+/).length
      };
    })()`);

    assert.deepEqual(opened, {
      triggerReady: true,
      afterParentSelection: { parent: 'transformer', open: null, drawerHidden: true },
      parent: 'transformer',
      open: 'transformer',
      child: 'attention',
      hash: '#subgraph=transformer&subfocus=attention',
      drawerHidden: false,
      mountedSvgCount: 1,
      columnTrackCount: 1,
    });

    const escaped = await evaluate(browser, sessionId, `(function () {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var afterChild = {
        open: Archify.subarchitecture.active(),
        child: Archify.subarchitecture.child(),
        hash: location.hash
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        afterChild: afterChild,
        open: Archify.subarchitecture.active(),
        hash: location.hash,
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
        restoredFocus: document.activeElement && document.activeElement.id
      };
    })()`);

    assert.deepEqual(escaped, {
      afterChild: { open: 'transformer', child: null, hash: '#subgraph=transformer' },
      open: null,
      hash: '#focus=transformer',
      drawerHidden: true,
      restoredFocus: 'btn-focus-internals',
    });
  } finally {
    await browser.close();
  }
});

test('a closed subarchitecture is layout-transparent to the complete parent Viewer', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  async function receipt(artifactPath) {
    const sessionId = await load(browser, artifactPath, { width: 1440, height: 900 });
    return evaluate(browser, sessionId, `(async function () {
      if (Archify.readerLayout && Archify.readerLayout.measure) Archify.readerLayout.measure();
      if (Archify.viewerChromeLayout && Archify.viewerChromeLayout.measure) Archify.viewerChromeLayout.measure();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      var diagram = document.querySelector('.diagram-container');
      var svg = document.querySelector('.diagram-container > svg');
      var cards = document.querySelector('.cards');
      var diagramRect = diagram.getBoundingClientRect();
      var cardsRect = cards.getBoundingClientRect();
      return {
        parentSvg: svg.outerHTML,
        readerWidth: getComputedStyle(document.documentElement).getPropertyValue('--archify-reader-width'),
        diagram: [diagramRect.left, diagramRect.top, diagramRect.width, diagramRect.height],
        cardsTop: cardsRect.top,
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
        disclosureCount: document.querySelectorAll('[data-subarchitecture-disclosure]').length
      };
    })()`);
  }

  try {
    const parentOnly = await receipt(renderFixture({ withSubarchitecture: false }));
    const additive = await receipt(renderFixture({ withSubarchitecture: true }));
    assert.deepEqual(additive, parentOnly);
    assert.equal(additive.drawerHidden, true);
    assert.equal(additive.disclosureCount, 0);
  } finally {
    await browser.close();
  }
});

test('local Semantic Passport reuses parent relationship colors and row styling', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(function () {
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var child = document.querySelector('#subarchitecture-mount [data-node-id="attention"]');
      child.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

      function relationshipReceipt(root, direction) {
        var row = root.querySelector('.relationship-lens-row[data-direction="' + direction + '"]');
        var glyph = row && row.querySelector('.relationship-lens-direction');
        var rowStyle = row && getComputedStyle(row);
        return {
          exists: Boolean(row && glyph),
          glyphColor: glyph ? getComputedStyle(glyph).color : '',
          border: rowStyle ? rowStyle.borderTopWidth + ' ' + rowStyle.borderTopStyle : '',
          radius: rowStyle ? rowStyle.borderRadius : '',
          background: rowStyle ? rowStyle.backgroundColor : '',
          font: rowStyle ? rowStyle.fontFamily : '',
          ariaHidden: glyph ? glyph.getAttribute('aria-hidden') : null,
          hasAriaLabel: Boolean(row && row.getAttribute('aria-label'))
        };
      }

      var parent = document.getElementById('focus-chip');
      var local = document.getElementById('subarchitecture-passport');
      return {
        parentOut: relationshipReceipt(parent, 'out'),
        localOut: relationshipReceipt(local, 'out'),
        parentIn: relationshipReceipt(parent, 'in'),
        localIn: relationshipReceipt(local, 'in'),
        parentBorder: getComputedStyle(parent).borderTopColor,
        localBorder: getComputedStyle(local).borderTopColor
      };
    })()`);

    assert.equal(receipt.parentOut.exists, true);
    assert.equal(receipt.parentIn.exists, true);
    assert.deepEqual(receipt.localOut, receipt.parentOut);
    assert.deepEqual(receipt.localIn, receipt.parentIn);
    assert.notEqual(receipt.localOut.glyphColor, receipt.localIn.glyphColor);
    assert.equal(receipt.localBorder, receipt.parentBorder);
    assert.equal(receipt.localOut.ariaHidden, 'true');
    assert.equal(receipt.localOut.hasAriaLabel, true);
  } finally {
    await browser.close();
  }
});

test('local hover reuses the parent Intent Trace animation, colors, and one-hop directions', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      document.documentElement.removeAttribute('data-motion');

      function flowReceipt(svg, direction) {
        var flow = svg.querySelector('.intent-trace-flow[data-direction="' + direction + '"]');
        var style = flow && getComputedStyle(flow);
        return {
          exists: Boolean(flow),
          stroke: style ? style.stroke : '',
          strokeWidth: style ? style.strokeWidth : '',
          linecap: style ? style.strokeLinecap : '',
          dasharray: style ? style.strokeDasharray : '',
          animationName: style ? style.animationName : '',
          animationDuration: style ? style.animationDuration : '',
          animationTiming: style ? style.animationTimingFunction : '',
          animationDirection: style ? style.animationDirection : '',
          pathLength: flow ? flow.getAttribute('pathLength') : null
        };
      }

      var parentSvg = document.querySelector('.diagram-container > svg');
      Archify.intentTrace.show('transformer');
      var parent = {
        out: flowReceipt(parentSvg, 'out'),
        in: flowReceipt(parentSvg, 'in')
      };
      Archify.intentTrace.clear({ announce: false });

      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var localSvg = document.querySelector('#subarchitecture-mount > svg');
      var child = localSvg.querySelector('[data-node-id="attention"]');
      child.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse'
      }));
      await new Promise(function (resolve) { setTimeout(resolve, 130); });

      var local = {
        active: localSvg.getAttribute('data-intent-trace-active'),
        overlays: localSvg.querySelectorAll('[data-intent-trace-overlay]').length,
        flows: localSvg.querySelectorAll('.intent-trace-flow').length,
        matchedEdges: localSvg.querySelectorAll('[data-edge-from][data-intent-trace-match]').length,
        matchedNodes: localSvg.querySelectorAll('[data-node-id][data-intent-trace-match]').length,
        selected: localSvg.querySelector('[data-intent-trace-selected]').getAttribute('data-node-id'),
        directions: Array.from(localSvg.querySelectorAll('.intent-trace-flow')).map(function (flow) {
          return flow.getAttribute('data-direction');
        }).sort(),
        out: flowReceipt(localSvg, 'out'),
        in: flowReceipt(localSvg, 'in')
      };

      child.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      local.afterClick = {
        intent: localSvg.getAttribute('data-intent-trace-active'),
        overlays: localSvg.querySelectorAll('[data-intent-trace-overlay]').length,
        focus: localSvg.getAttribute('data-focus-active')
      };
      return { parent: parent, local: local };
    })()`);

    assert.deepEqual(receipt.local.out, receipt.parent.out);
    assert.deepEqual(receipt.local.in, receipt.parent.in);
    assert.equal(receipt.local.active, 'attention');
    assert.equal(receipt.local.overlays, 1);
    assert.equal(receipt.local.flows, 2);
    assert.equal(receipt.local.matchedEdges, 2);
    assert.equal(receipt.local.matchedNodes, 3);
    assert.equal(receipt.local.selected, 'attention');
    assert.deepEqual(receipt.local.directions, ['in', 'out']);
    assert.equal(receipt.local.out.animationName, 'archify-intent-trace-flow');
    assert.equal(receipt.local.out.animationDuration, '1.15s');
    assert.deepEqual(receipt.local.afterClick, {
      intent: null,
      overlays: 0,
      focus: 'attention',
    });
  } finally {
    await browser.close();
  }
});

test('export target downloads only the open subarchitecture and strips local viewer state', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      var blobs = [];
      var filenames = [];
      var alerts = [];
      var originalCreateObjectUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (blob) {
        blobs.push(blob);
        return originalCreateObjectUrl(blob);
      };
      HTMLAnchorElement.prototype.click = function () { filenames.push(this.download); };
      window.alert = function (message) { alerts.push(String(message)); };

      var selector = document.getElementById('export-target-selector');
      var mainTarget = selector.querySelector('[data-export-target="main"]');
      var localTarget = selector.querySelector('[data-export-target="subarchitecture"]');
      var beforeOpen = {
        selectorHidden: selector.hidden,
        target: Archify.exportMenu.target()
      };

      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      Archify.subarchitecture.focus('attention', { updateUrl: false });
      Archify.exportMenu.open();
      var afterOpen = {
        selectorHidden: selector.hidden,
        target: Archify.exportMenu.target(),
        mainChecked: mainTarget.getAttribute('aria-checked'),
        localChecked: localTarget.getAttribute('aria-checked'),
        webmDisabled: document.querySelector('#export-menu [data-format="webm"]').disabled
      };
      var selected = Archify.exportMenu.selectTarget('subarchitecture');
      var selectedState = {
        target: Archify.exportMenu.target(),
        mainChecked: mainTarget.getAttribute('aria-checked'),
        localChecked: localTarget.getAttribute('aria-checked')
      };
      var localSvg = document.querySelector('#subarchitecture-mount > svg');
      var localViewBox = localSvg.viewBox.baseVal;
      var expectedPng = { width: localViewBox.width * 4, height: localViewBox.height * 4 };

      await Archify.exportMenu.run('svg');
      var svgBlob = blobs.filter(function (blob) { return blob.type.indexOf('image/svg+xml') === 0; }).slice(-1)[0];
      var exportedText = svgBlob ? await svgBlob.text() : '';
      var exportedSvg = new DOMParser().parseFromString(exportedText, 'image/svg+xml').documentElement;
      var svgState = {
        filename: filenames.slice(-1)[0] || '',
        type: svgBlob ? svgBlob.type : '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        canonical: document.documentElement.getAttribute('data-last-export-canonical'),
        format: document.documentElement.getAttribute('data-last-export-format'),
        childIds: Array.from(exportedSvg.querySelectorAll('[data-node-id]')).map(function (node) {
          return node.getAttribute('data-node-id');
        }).sort(),
        hasParentTransformer: Boolean(exportedSvg.querySelector('[data-node-id="transformer"]')),
        focusResidue: exportedSvg.querySelectorAll('[data-focus-match], [data-focus-selected]').length,
        intentResidue: exportedSvg.querySelectorAll('[data-intent-trace-overlay], [data-intent-trace-match], [data-intent-trace-selected]').length,
        focusActive: exportedSvg.hasAttribute('data-focus-active'),
        pressedTrue: exportedSvg.querySelectorAll('[aria-pressed="true"]').length
      };

      blobs.length = 0;
      await Archify.exportMenu.run('png');
      var pngBlob = blobs.filter(function (blob) { return blob.type === 'image/png'; }).slice(-1)[0];
      var pngSize = await new Promise(function (resolve, reject) {
        var image = new Image();
        var url = originalCreateObjectUrl(pngBlob);
        image.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = reject;
        image.src = url;
      });
      var pngState = {
        filename: filenames.slice(-1)[0] || '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        canonical: document.documentElement.getAttribute('data-last-export-canonical'),
        format: document.documentElement.getAttribute('data-last-export-format'),
        size: pngSize,
        expectedSize: expectedPng
      };

      blobs.length = 0;
      await Archify.exportMenu.run('share-card');
      var shareBlob = blobs.filter(function (blob) { return blob.type === 'image/png'; }).slice(-1)[0];
      var shareSize = await new Promise(function (resolve, reject) {
        var image = new Image();
        var url = originalCreateObjectUrl(shareBlob);
        image.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = reject;
        image.src = url;
      });
      var shareState = {
        filename: filenames.slice(-1)[0] || '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        canonical: document.documentElement.getAttribute('data-last-export-canonical'),
        format: document.documentElement.getAttribute('data-last-export-format'),
        size: shareSize
      };

      Archify.subarchitecture.close({ updateUrl: false, restoreFocus: false });
      var afterClose = {
        selectorHidden: selector.hidden,
        target: Archify.exportMenu.target(),
        localHidden: localTarget.hidden
      };
      return {
        beforeOpen: beforeOpen,
        afterOpen: afterOpen,
        selected: selected,
        selectedState: selectedState,
        svg: svgState,
        png: pngState,
        share: shareState,
        afterClose: afterClose,
        alerts: alerts
      };
    })()`);

    assert.deepEqual(receipt.beforeOpen, { selectorHidden: true, target: 'main' });
    assert.deepEqual(receipt.afterOpen, {
      selectorHidden: false,
      target: 'main',
      mainChecked: 'true',
      localChecked: 'false',
      webmDisabled: true,
    });
    assert.equal(receipt.selected, true);
    assert.deepEqual(receipt.selectedState, {
      target: 'subarchitecture',
      mainChecked: 'false',
      localChecked: 'true',
    });
    assert.match(receipt.svg.filename, /transformer-internals\.svg$/);
    assert.match(receipt.svg.type, /^image\/svg\+xml/);
    assert.equal(receipt.svg.target, 'subarchitecture');
    assert.equal(receipt.svg.canonical, 'true');
    assert.equal(receipt.svg.format, 'svg');
    assert.ok(receipt.svg.childIds.includes('attention'));
    assert.ok(receipt.svg.childIds.includes('layer_input'));
    assert.equal(receipt.svg.hasParentTransformer, false);
    assert.equal(receipt.svg.focusResidue, 0);
    assert.equal(receipt.svg.intentResidue, 0);
    assert.equal(receipt.svg.focusActive, false);
    assert.equal(receipt.svg.pressedTrue, 0);
    assert.match(receipt.png.filename, /transformer-internals\.png$/);
    assert.equal(receipt.png.target, 'subarchitecture');
    assert.equal(receipt.png.canonical, 'true');
    assert.equal(receipt.png.format, 'png');
    assert.deepEqual(receipt.png.size, receipt.png.expectedSize);
    assert.match(receipt.share.filename, /transformer-internals-share-card\.png$/);
    assert.equal(receipt.share.target, 'subarchitecture');
    assert.equal(receipt.share.canonical, 'true');
    assert.equal(receipt.share.format, 'share-card');
    assert.deepEqual(receipt.share.size, { width: 1200, height: 630 });
    assert.deepEqual(receipt.afterClose, {
      selectorHidden: true,
      target: 'main',
      localHidden: true,
    });
    assert.deepEqual(receipt.alerts, []);
  } finally {
    await browser.close();
  }
});

test('subarchitecture export fails closed when the mounted export root is no longer unique', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      var alerts = [];
      var downloads = 0;
      window.alert = function (message) { alerts.push(String(message)); };
      HTMLAnchorElement.prototype.click = function () { downloads += 1; };
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var selected = Archify.exportMenu.selectTarget('subarchitecture');
      var mount = document.getElementById('subarchitecture-mount');
      mount.appendChild(mount.querySelector(':scope > svg').cloneNode(true));
      await Archify.exportMenu.run('svg');
      return {
        selected: selected,
        downloads: downloads,
        alerts: alerts,
        errorFormat: document.documentElement.getAttribute('data-last-export-error-format'),
        error: document.documentElement.getAttribute('data-last-export-error'),
        receiptTarget: document.documentElement.getAttribute('data-last-export-target')
      };
    })()`);

    assert.equal(receipt.selected, true);
    assert.equal(receipt.downloads, 0);
    assert.equal(receipt.alerts.length, 1);
    assert.match(receipt.alerts[0], /Export failed/);
    assert.equal(receipt.errorFormat, 'svg');
    assert.match(receipt.error, /selected subarchitecture is no longer available/i);
    assert.equal(receipt.receiptTarget, null);
  } finally {
    await browser.close();
  }
});

test('desktop internals inherit every preset and theme without changing the parent camera', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), {
      width: 1440,
      height: 900,
      reducedMotion: true,
    });
    const receipt = await evaluate(browser, sessionId, `(function () {
      var parentSvg = document.querySelector('.diagram-container > svg');
      var viewBoxBefore = parentSvg.getAttribute('viewBox');
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var states = [];
      ['classic', 'signal-flow', 'blueprint', 'editorial'].forEach(function (preset) {
        Archify.preset.apply(preset);
        ['dark', 'light'].forEach(function (theme) {
          if (document.documentElement.getAttribute('data-theme') !== theme) Archify.theme.toggle();
          var localSvg = document.querySelector('#subarchitecture-mount > svg');
          states.push({
            preset: preset,
            theme: theme,
            htmlPreset: document.documentElement.getAttribute('data-preset'),
            parentPreset: parentSvg.getAttribute('data-preset'),
            localPreset: localSvg.getAttribute('data-preset'),
            htmlTheme: document.documentElement.getAttribute('data-theme'),
            parentTheme: parentSvg.getAttribute('data-theme'),
            localTheme: localSvg.getAttribute('data-theme')
          });
        });
      });
      var columns = getComputedStyle(document.querySelector('.subarchitecture-drawer-content')).gridTemplateColumns;
      return {
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        motionState: document.documentElement.getAttribute('data-motion'),
        columnTrackCount: columns.trim().split(/\\s+/).length,
        parentFocus: Archify.focus.active(),
        localFocus: Archify.subarchitecture.active(),
        parentViewBoxStable: parentSvg.getAttribute('viewBox') === viewBoxBefore,
        states: states
      };
    })()`);

    assert.equal(receipt.reducedMotion, true);
    assert.equal(receipt.motionState, 'still');
    assert.equal(receipt.columnTrackCount, 2);
    assert.equal(receipt.parentFocus, 'transformer');
    assert.equal(receipt.localFocus, 'transformer');
    assert.equal(receipt.parentViewBoxStable, true);
    assert.equal(receipt.states.length, 8);
    assert.ok(receipt.states.every((state) => (
      state.htmlPreset === state.preset
      && state.parentPreset === state.preset
      && state.localPreset === state.preset
      && state.htmlTheme === state.theme
      && state.parentTheme === state.theme
      && state.localTheme === state.theme
    )), JSON.stringify(receipt.states));
  } finally {
    await browser.close();
  }
});

test('runtime template tampering fails closed and leaves the parent graph usable', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const artifact = renderFixture();
  const mutations = [
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     template.after(template.cloneNode(true));`,
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     template.content.querySelector('[data-edge-from][data-edge-to]').setAttribute('data-edge-to', 'missing-child');`,
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     template.content.appendChild(document.createElement('div'));`,
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     var nodes = template.content.querySelectorAll('[data-node-id]');
     nodes[1].setAttribute('data-node-id', nodes[0].getAttribute('data-node-id'));`,
  ];

  try {
    for (const mutation of mutations) {
      const sessionId = await load(browser, artifact);
      const receipt = await evaluate(browser, sessionId, `(function () {
        ${mutation}
        Archify.focus.set('transformer', { toggle: false, updateUrl: false });
        var opened = Archify.subarchitecture.open('transformer');
        var parentSvg = document.querySelector('.diagram-container > svg');
        var parentNode = parentSvg.querySelector('[data-node-id="transformer"]');
        return {
          opened: opened,
          active: Archify.subarchitecture.active(),
          drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
          mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
          parentConnected: parentSvg.isConnected && parentNode.isConnected,
          parentFocus: Archify.focus.active(),
          triggerHidden: document.getElementById('btn-focus-internals').hidden,
          triggerDisabled: document.getElementById('btn-focus-internals').disabled
        };
      })()`);
      assert.deepEqual(receipt, {
        opened: false,
        active: null,
        drawerHidden: true,
        mountedSvgCount: 0,
        parentConnected: true,
        parentFocus: 'transformer',
        triggerHidden: true,
        triggerDisabled: true,
      });
    }

    const sessionId = await load(browser, artifact);
    const destroyed = await evaluate(browser, sessionId, `(function () {
      Archify.subarchitecture.destroy();
      return {
        reopened: Archify.subarchitecture.open('transformer'),
        mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
        disclosures: document.querySelectorAll('[data-subarchitecture-disclosure]').length
      };
    })()`);
    assert.deepEqual(destroyed, { reopened: false, mountedSvgCount: 0, disclosures: 0 });
  } finally {
    await browser.close();
  }
});

test('duplicate, conflicting, and unknown subarchitecture deep links fail closed', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const artifact = renderFixture();
  const invalidHashes = [
    '#subgraph=transformer&subgraph=transformer',
    '#subgraph=transformer&subfocus=attention&subfocus=ffn',
    '#focus=transformer&subgraph=transformer',
    '#subgraph=transformer&subfocus=missing-child',
    '#subfocus=attention',
  ];
  try {
    for (const hash of invalidHashes) {
      const sessionId = await load(browser, artifact);
      const receipt = await evaluate(browser, sessionId, `(async function () {
        await new Promise(function (resolve) {
          window.addEventListener('hashchange', resolve, { once: true });
          location.hash = ${JSON.stringify(hash)};
        });
        await new Promise(function (resolve) { requestAnimationFrame(resolve); });
        return {
          active: Archify.subarchitecture.active(),
          child: Archify.subarchitecture.child(),
          drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
          mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
          parentConnected: document.querySelector('.diagram-container > svg').isConnected
        };
      })()`);
      assert.deepEqual(receipt, {
        active: null,
        child: null,
        drawerHidden: true,
        mountedSvgCount: 0,
        parentConnected: true,
      }, hash);
    }
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
