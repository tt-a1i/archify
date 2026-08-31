import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import {
  evaluate,
  load,
  physicalClick,
  pressKey,
  waitForLayout,
} from './helpers/chrome-viewer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-explorer-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const browserTest = { skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.' };

function renderFixture(locale = 'en') {
  const chinese = locale === 'zh-CN';
  const source = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: chinese ? '关系探索回归' : 'Relationship explorer regression',
      locale,
      quality_profile: 'standard',
      viewBox: [960, 520],
    },
    components: [
      { id: 'incoming', type: 'external', label: chinese ? '入口' : 'Incoming', pos: [30, 226], size: [150, 68] },
      {
        id: 'hub',
        type: 'backend',
        label: chinese ? '运行核心' : 'Runtime core',
        pos: [405, 226],
        size: [150, 68],
      },
      { id: 'outgoing', type: 'cloud', label: chinese ? '模型服务' : 'Outgoing', pos: [780, 226], size: [150, 68] },
    ],
    boundaries: [],
    connections: [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `incoming-hub-${index + 1}`,
        from: 'incoming',
        to: 'hub',
        label: chinese ? `请求 ${index + 1}` : `request ${index + 1}`,
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `hub-outgoing-${index + 1}`,
        from: 'hub',
        to: 'outgoing',
        label: chinese ? `流式响应 ${index + 1}` : `stream ${index + 1}`,
      })),
    ],
    cards: [],
  };
  const input = path.join(tmp, `relationship-${locale}.json`);
  const output = path.join(tmp, `relationship-${locale}.html`);
  fs.writeFileSync(input, `${JSON.stringify(source, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'architecture',
    input,
    output,
  ]);
  return output;
}

async function focusHub(browser, sessionId, label = '') {
  await evaluate(browser, sessionId, `(function () {
    var container = document.querySelector('.diagram-container');
    window.scrollTo(0, Math.max(0, container.offsetTop));
    var label = ${JSON.stringify(label)};
    if (label) document.querySelector('[data-node-id="hub"]').setAttribute('data-node-label', label);
    Archify.focus.set('hub', { toggle: false, updateUrl: false });
  })()`);
  await waitForLayout(browser, sessionId);
}

test('short reflow viewports retain a touch-sized Details route to a scrollable Passport', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture('zh-CN'), { width: 320, height: 300 });
    await focusHub(browser, sessionId);
    await physicalClick(browser, sessionId, '#btn-focus-relations');
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 120,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(browser, sessionId, `window.dispatchEvent(new Event('resize'))`);
    await waitForLayout(browser, sessionId);
    const collapsed = await evaluate(browser, sessionId, `(function () {
      var passport = document.getElementById('focus-chip');
      var details = document.getElementById('btn-focus-details');
      return {
        viewportCompact: passport.getAttribute('data-viewport-compact'),
        detailsVisible: details.offsetParent !== null,
        detailsHeight: details.getBoundingClientRect().height,
        detailsLabel: details.getAttribute('aria-label'),
        bodyDisplay: getComputedStyle(document.getElementById('relationship-lens-body')).display
      };
    })()`);
    assert.equal(collapsed.viewportCompact, 'true', JSON.stringify(collapsed));
    assert.equal(collapsed.detailsVisible, true, JSON.stringify(collapsed));
    assert.ok(collapsed.detailsHeight >= 40, JSON.stringify(collapsed));
    assert.equal(collapsed.detailsLabel, '展开完整语义护照', JSON.stringify(collapsed));

    await physicalClick(browser, sessionId, '#btn-focus-details');
    await waitForLayout(browser, sessionId);
    const expanded = await evaluate(browser, sessionId, `(function () {
      var passport = document.getElementById('focus-chip');
      var body = document.getElementById('relationship-lens-body');
      return {
        expanded: passport.getAttribute('data-exploration-expanded'),
        bodyDisplay: getComputedStyle(body).display,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        passportBottom: passport.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight
      };
    })()`);
    assert.equal(expanded.expanded, 'true', JSON.stringify(expanded));
    assert.notEqual(expanded.bodyDisplay, 'none', JSON.stringify(expanded));
    assert.equal(expanded.bodyOverflowY, 'auto', JSON.stringify(expanded));
    assert.ok(expanded.bodyClientHeight > 0, JSON.stringify(expanded));
    assert.ok(expanded.passportBottom <= expanded.viewportHeight + 0.5, JSON.stringify(expanded));
  } finally {
    await browser.close();
  }
});

test('short wide viewports keep Details disclosure state truthful', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    await focusHub(browser, sessionId);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 120,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(browser, sessionId, `window.dispatchEvent(new Event('resize'))`);
    await waitForLayout(browser, sessionId);
    const collapsed = await evaluate(browser, sessionId, `(function () {
      var passport = document.getElementById('focus-chip');
      var details = document.getElementById('btn-focus-details');
      return {
        drawer: passport.getAttribute('data-responsive-drawer'),
        viewportCompact: passport.getAttribute('data-viewport-compact'),
        visible: details.offsetParent !== null,
        expanded: details.getAttribute('aria-expanded')
      };
    })()`);
    assert.equal(collapsed.drawer, null, JSON.stringify(collapsed));
    assert.equal(collapsed.viewportCompact, 'true', JSON.stringify(collapsed));
    assert.equal(collapsed.visible, true, JSON.stringify(collapsed));
    assert.equal(collapsed.expanded, 'false', JSON.stringify(collapsed));

    await physicalClick(browser, sessionId, '#btn-focus-details');
    await waitForLayout(browser, sessionId);
    const expanded = await evaluate(browser, sessionId, `(function () {
      var passport = document.getElementById('focus-chip');
      var details = document.getElementById('btn-focus-details');
      return {
        passportExpanded: passport.getAttribute('data-exploration-expanded'),
        buttonExpanded: details.getAttribute('aria-expanded'),
        panelHidden: document.getElementById('relationship-lens-details-panel').hidden
      };
    })()`);
    assert.equal(expanded.passportExpanded, 'true', JSON.stringify(expanded));
    assert.equal(expanded.buttonExpanded, 'true', JSON.stringify(expanded));
    assert.equal(expanded.panelHidden, false, JSON.stringify(expanded));
  } finally {
    await browser.close();
  }
});

test('compact Passport visual action order matches keyboard order', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1281, height: 900 });
    await focusHub(browser, sessionId);
    await physicalClick(browser, sessionId, '#btn-reach-downstream');
    await waitForLayout(browser, sessionId);
    const order = await evaluate(browser, sessionId, `(function () {
      var visible = Array.from(document.querySelectorAll('.relationship-lens-actions button')).filter(function (button) {
        return button.offsetParent !== null;
      });
      return {
        dom: visible.map(function (button) { return button.id; }),
        visual: visible.slice().sort(function (a, b) {
          return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
        }).map(function (button) { return button.id; })
      };
    })()`);
    assert.deepEqual(order.dom, order.visual, JSON.stringify(order));
    assert.deepEqual(order.visual, ['btn-focus-details', 'btn-focus-clear'], JSON.stringify(order));
    await evaluate(browser, sessionId, `document.getElementById('btn-focus-details').focus()`);
    await pressKey(browser, sessionId, 'Tab');
    assert.equal(await evaluate(browser, sessionId, `document.activeElement.id`), 'btn-focus-clear');
  } finally {
    await browser.close();
  }
});

test('expanded Passport exposes the complete long English and Chinese title', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const locale of ['en', 'zh-CN']) {
      const sessionId = await load(browser, renderFixture(locale), { width: 1281, height: 900 });
      const longLabel = locale === 'zh-CN'
        ? '负责会话事件编排与工具调度的核心运行模块，展开详情后必须完整可读'
        : 'Core runtime responsible for session event orchestration and tool scheduling that must remain fully readable after expansion';
      await focusHub(browser, sessionId, longLabel);
      await physicalClick(browser, sessionId, '#btn-reach-downstream');
      await physicalClick(browser, sessionId, '#btn-focus-details');
      await waitForLayout(browser, sessionId);
      const title = await evaluate(browser, sessionId, `(function () {
        var title = document.getElementById('relationship-lens-title');
        return {
          whiteSpace: getComputedStyle(title).whiteSpace,
          overflowWrap: getComputedStyle(title).overflowWrap,
          clientWidth: title.clientWidth,
          scrollWidth: title.scrollWidth,
          clientHeight: title.clientHeight,
          scrollHeight: title.scrollHeight,
          text: title.textContent.trim()
        };
      })()`);
      assert.ok(title.text.length > 30, JSON.stringify({ locale, title }));
      assert.equal(title.whiteSpace, 'normal', JSON.stringify({ locale, title }));
      assert.equal(title.overflowWrap, 'anywhere', JSON.stringify({ locale, title }));
      assert.ok(title.scrollWidth <= title.clientWidth + 1, JSON.stringify({ locale, title }));
      assert.ok(title.scrollHeight <= title.clientHeight + 1, JSON.stringify({ locale, title }));
    }
  } finally {
    await browser.close();
  }
});

test('wide coarse-pointer viewports retain non-empty 40px relationship actions', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), {
      width: 1366,
      height: 900,
      mediaFeatures: [
        { name: 'pointer', value: 'coarse' },
        { name: 'any-pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
      touch: true,
    });
    await focusHub(browser, sessionId);
    await physicalClick(browser, sessionId, '#btn-reach-downstream');
    await waitForLayout(browser, sessionId);
    const actions = await evaluate(browser, sessionId, `(function () {
      return {
        coarse: matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches,
        controls: Array.from(document.querySelectorAll(
        '.relationship-lens-actions button, .semantic-passport-reach-actions button'
      )).filter(function (button) {
        return button.offsetParent !== null;
      }).map(function (button) {
        return { id: button.id, height: button.getBoundingClientRect().height };
        })
      };
    })()`);
    assert.equal(actions.coarse, true, JSON.stringify(actions));
    assert.deepEqual(actions.controls.map((action) => action.id).sort(), [
      'btn-focus-clear',
      'btn-focus-details',
      'btn-reach-downstream',
      'btn-reach-upstream',
    ], JSON.stringify(actions));
    assert.ok(actions.controls.every((action) => action.height >= 40), JSON.stringify(actions));
  } finally {
    await browser.close();
  }
});

test('English and zh-CN expose translated relationship controls and accessible names', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const expectedByLocale = {
      en: {
        details: 'Details',
        detailsLabel: 'Return to compact relationship exploration',
        upstream: 'Upstream',
        downstream: 'Downstream',
        outgoing: 'Outgoing',
        incoming: 'Incoming',
        outDirection: 'OUT →',
        inDirection: '← IN',
      },
      'zh-CN': {
        details: '详情',
        detailsLabel: '返回紧凑关系探索',
        upstream: '上游',
        downstream: '下游',
        outgoing: '出向',
        incoming: '入向',
        outDirection: '出 →',
        inDirection: '← 入',
      },
    };
    for (const locale of Object.keys(expectedByLocale)) {
      const sessionId = await load(browser, renderFixture(locale), { width: 1280, height: 900 });
      await focusHub(browser, sessionId);
      await physicalClick(browser, sessionId, '#btn-focus-relations');
      await waitForLayout(browser, sessionId);
      const receipt = await evaluate(browser, sessionId, `(function () {
        var outToggle = document.querySelector('[data-relationship-group-toggle="out"]');
        var inToggle = document.querySelector('[data-relationship-group-toggle="in"]');
        var inRow = document.querySelector('.relationship-lens-row[data-direction="in"]');
        return {
          details: document.getElementById('btn-focus-details').textContent.trim(),
          detailsLabel: document.getElementById('btn-focus-details').getAttribute('aria-label'),
          upstream: document.querySelector('#btn-reach-upstream span').textContent.trim(),
          downstream: document.querySelector('#btn-reach-downstream span').textContent.trim(),
          outgoing: outToggle.firstElementChild.textContent.split('·')[0].trim(),
          incoming: inToggle.firstElementChild.textContent.split('·')[0].trim(),
          outDirection: document.querySelector('.relationship-lens-row[data-direction="out"] .relationship-lens-direction').textContent.trim(),
          inDirection: inRow.querySelector('.relationship-lens-direction').textContent.trim(),
          outAria: document.querySelector('.relationship-lens-row[data-direction="out"]').getAttribute('aria-label'),
          inAria: inRow.getAttribute('aria-label')
        };
      })()`);
      const expected = expectedByLocale[locale];
      assert.deepEqual({
        details: receipt.details,
        detailsLabel: receipt.detailsLabel,
        upstream: receipt.upstream,
        downstream: receipt.downstream,
        outgoing: receipt.outgoing,
        incoming: receipt.incoming,
        outDirection: receipt.outDirection,
        inDirection: receipt.inDirection,
      }, expected, JSON.stringify({ locale, receipt }));
      assert.match(receipt.outAria, new RegExp(expected.outgoing), JSON.stringify({ locale, receipt }));
      assert.match(receipt.inAria, new RegExp(expected.incoming), JSON.stringify({ locale, receipt }));
    }
  } finally {
    await browser.close();
  }
});

test('physical pointer activation covers upstream, downstream, outgoing, and incoming exploration', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const artifact = renderFixture();
  try {
    for (const direction of ['upstream', 'downstream']) {
      const sessionId = await load(browser, artifact, { width: 1440, height: 900 });
      await focusHub(browser, sessionId);
      await physicalClick(browser, sessionId, `#btn-reach-${direction}`);
      await waitForLayout(browser, sessionId);
      assert.equal(await evaluate(
        browser,
        sessionId,
        `document.querySelector('.diagram-container > svg').getAttribute('data-reach-active')`,
      ), direction);
    }

    for (const direction of ['out', 'in']) {
      const sessionId = await load(browser, artifact, { width: 1280, height: 900 });
      await focusHub(browser, sessionId);
      await physicalClick(browser, sessionId, '#btn-focus-relations');
      await waitForLayout(browser, sessionId);
      if (direction === 'in') {
        await physicalClick(browser, sessionId, '[data-relationship-group-toggle="in"]');
      }
      const selector = `.relationship-lens-row[data-direction="${direction}"]`;
      const expectedTarget = await evaluate(browser, sessionId, `(function () {
        var row = document.querySelector(${JSON.stringify(selector)});
        return row && row.getAttribute('data-relationship-target');
      })()`);
      assert.ok(expectedTarget, `Expected a ${direction} relationship row`);
      await physicalClick(browser, sessionId, selector);
      await waitForLayout(browser, sessionId);
      const located = await evaluate(browser, sessionId, `(function () {
        return {
          focused: document.querySelector('.diagram-container > svg').getAttribute('data-focus-active'),
          hash: location.hash,
          cameraMoving: document.querySelector('.diagram-container').hasAttribute('data-camera-transaction')
        };
      })()`);
      assert.equal(located.focused, expectedTarget, JSON.stringify(located));
      assert.equal(located.hash, `#focus=${encodeURIComponent(expectedTarget)}`, JSON.stringify(located));
      assert.equal(located.cameraMoving, false, JSON.stringify(located));
    }
  } finally {
    await browser.close();
  }
});

test('relationship hash synchronization calls reveal once with the exact endpoints and reason', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    await evaluate(browser, sessionId, `(function () {
      var originalReveal = Archify.view.reveal;
      window.__relationshipRevealProbe = { calls: [], originalReveal: originalReveal };
      Archify.view.reveal = function (ids, options) {
        window.__relationshipRevealProbe.calls.push({ ids: ids.slice(), reason: options && options.reason });
        return originalReveal.apply(Archify.view, arguments);
      };
      location.hash = 'relation=hub-outgoing-1';
    })()`);
    await waitForLayout(browser, sessionId);
    const receipt = await evaluate(browser, sessionId, `(function () {
      var probe = window.__relationshipRevealProbe;
      Archify.view.reveal = probe.originalReveal;
      return {
        calls: probe.calls,
        relation: document.querySelector('[data-relationship-hit-key][aria-pressed="true"]').getAttribute('data-relationship-id'),
        hash: location.hash
      };
    })()`);
    assert.deepEqual(receipt.calls, [{ ids: ['hub', 'outgoing'], reason: 'relationship-sync' }], JSON.stringify(receipt));
    assert.equal(receipt.relation, 'hub-outgoing-1', JSON.stringify(receipt));
    assert.equal(receipt.hash, '#relation=hub-outgoing-1', JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('a newer relationship hash cancels an already-running reveal and settles only the latest request', browserTest, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), {
      width: 1440,
      height: 900,
      motion: 'full',
    });
    await evaluate(browser, sessionId, `(function () {
      var originalReveal = Archify.view.reveal;
      window.__relationshipRevealRaceProbe = { calls: [], originalReveal: originalReveal };
      Archify.view.reveal = function (ids, options) {
        var call = { ids: ids.slice(), reason: options && options.reason, outcome: null };
        window.__relationshipRevealRaceProbe.calls.push(call);
        var receipt = originalReveal.apply(Archify.view, arguments);
        if (receipt && receipt.finished) receipt.finished.then(function (result) { call.outcome = result.state; });
        return receipt;
      };
      location.hash = 'relation=incoming-hub-1';
    })()`);
    const first = await evaluate(browser, sessionId, `(function () {
      return new Promise(function (resolve, reject) {
        var frames = 0;
        function sample() {
          frames += 1;
          var probe = window.__relationshipRevealRaceProbe;
          var transaction = document.querySelector('.diagram-container').getAttribute('data-camera-transaction');
          if (probe.calls.length === 1 && transaction) return resolve({ transaction: transaction });
          if (frames > 180) return reject(new Error('First relationship reveal did not begin.'));
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    })()`, true);
    assert.ok(first.transaction, JSON.stringify(first));
    await evaluate(browser, sessionId, `location.hash = 'relation=hub-outgoing-1'`);
    await evaluate(browser, sessionId, `new Promise(function (resolve) { setTimeout(resolve, 700); })`, true);
    await waitForLayout(browser, sessionId);
    const settled = await evaluate(browser, sessionId, `(function () {
      var probe = window.__relationshipRevealRaceProbe;
      Archify.view.reveal = probe.originalReveal;
      var pressed = document.querySelector('[data-relationship-hit-key][aria-pressed="true"]');
      return {
        calls: probe.calls,
        relation: pressed && pressed.getAttribute('data-relationship-id'),
        moving: document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'),
        hash: location.hash
      };
    })()`);
    assert.deepEqual(settled.calls, [
      { ids: ['incoming', 'hub'], reason: 'relationship-sync', outcome: 'replaced' },
      { ids: ['hub', 'outgoing'], reason: 'relationship-sync', outcome: 'complete' },
    ], JSON.stringify(settled));
    assert.equal(settled.relation, 'hub-outgoing-1', JSON.stringify(settled));
    assert.equal(settled.moving, false, JSON.stringify(settled));
    assert.equal(settled.hash, '#relation=hub-outgoing-1', JSON.stringify(settled));
  } finally {
    await browser.close();
  }
});
