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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-radar-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
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

async function loadArtifact(browser, artifactPath, { width = 1440, height = 900 } = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `(function () {
    document.documentElement.setAttribute('data-motion', 'still');
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fontsReady.then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
    });
  })()`, true);
  return sessionId;
}

async function radarRects(browser, sessionId, setup) {
  return evaluate(browser, sessionId, `(function () {
    ${setup}
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var radar = document.getElementById('overview-map').getBoundingClientRect();
          var controls = document.querySelector('.diagram-nav').getBoundingClientRect();
          var passport = document.getElementById('focus-chip');
          var passportRect = passport && !passport.hidden ? passport.getBoundingClientRect() : null;
          resolve({
            radar: { left: radar.left, top: radar.top, right: radar.right, bottom: radar.bottom },
            controls: { left: controls.left, top: controls.top, right: controls.right, bottom: controls.bottom },
            passport: passportRect ? {
              left: passportRect.left,
              top: passportRect.top,
              right: passportRect.right,
              bottom: passportRect.bottom
            } : null
          });
        });
      });
    });
  })()`, true);
}

async function dragMouse(browser, sessionId, from, to) {
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  }, sessionId);
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 1,
  }, sessionId);
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  }, sessionId);
  await evaluate(browser, sessionId, `new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(resolve); });
  })`, true);
}

function overlaps(a, b, gap = 0) {
  return a.left < b.right + gap
    && a.right > b.left - gap
    && a.top < b.bottom + gap
    && a.bottom > b.top - gap;
}

test('all typed renderers inherit one viewer-only Semantic Radar', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="overview-map" hidden role="region" aria-labelledby="overview-map-title"/, mode);
    assert.match(html, /id="overview-map-surface" tabindex="0" role="group"/, mode);
    assert.match(html, /id="overview-map-expand"[^>]+aria-label="Open full semantic radar"/, mode);
    assert.match(html, /id="overview-map-feedback" role="status" aria-live="polite" hidden/, mode);
    assert.match(html, /id="btn-overview-map"[^>]+aria-label="Open semantic radar"[^>]+aria-expanded="false"[^>]+aria-controls="overview-map"/, mode);
    assert.match(html, /Archify\.radar = \(function \(\)/, mode);
    assert.match(html, /document\.createElementNS\(namespace, 'svg'\)/, mode);
    assert.match(html, /mapSvg\.setAttribute\('aria-label', viewerText\('viewer\.radar\.nodes'\)\)/, mode);
    assert.match(html, /diagram\.querySelectorAll\('\[data-node-id\]'\)/, mode);
    assert.equal((html.match(/<svg\b/g) || []).length, 1, `${mode} keeps one static canonical SVG`);
    assert.doesNotMatch(canonicalSvg(html), /overview-map|Semantic radar|data-radar-node-id/, mode);
  }
});

test('Semantic Radar derives semantic node bounds and focuses stable IDs', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /box = node\.getBBox\(\)/);
  assert.match(html, /rect\.setAttribute\('data-radar-node-id', id\)/);
  assert.match(html, /rect\.setAttribute\('data-kind', node\.getAttribute\('data-node-kind'\) \|\| 'neutral'\)/);
  assert.match(html, /rect\.setAttribute\('aria-label', viewerText\('viewer\.radar\.focus'/);
  assert.match(html, /Archify\.focus\.set\(id, \{ toggle: false \}\)/);
  assert.match(html, /Archify\.view\.reveal\(\[id\], \{ includeNeighbors: true, reason: 'radar' \}\)/);
  assert.match(html, /function bringNodeIntoWindow\(node\)/);
  assert.match(html, /window\.scrollY \+ rect\.top \+ rect\.height \/ 2 - window\.innerHeight \/ 2/);
  assert.match(html, /data-radar-active/);
});

test('Semantic Radar tracks desktop camera and mobile contained scroll', () => {
  const html = render('sequence', CASES.sequence);
  assert.match(html, /function logicalViewport\(\)/);
  assert.match(html, /x = viewBox\.x \+ container\.scrollLeft \/ metrics\.scale/);
  assert.match(html, /x = viewBox\.x \+ \(\(-state\.x \/ state\.scale\) - metrics\.offsetX\) \/ metrics\.scale/);
  assert.match(html, /viewport\.setAttribute\('width', String\(visible\.width\)\)/);
  assert.match(html, /viewerText\('viewer\.radar\.viewport\.width'/);
  assert.match(html, /function centerAt\(logicalX, logicalY, options\)/);
  assert.match(html, /minimumScale: 1\.5, instant: true/);
  assert.match(html, /container\.scrollTo\(\{ left: mobileTarget, behavior: options\.instant \? 'auto' : 'smooth' \}\)/);
  assert.match(html, /data-wide-diagram="true"\] \.overview-map/);
  assert.match(html, /function updateDocking\(\)/);
  assert.match(html, /chip\.style\.top = Math\.round\(top\) \+ 'px';[\s\S]+Archify\.radar\.sync\(\)/);
  assert.match(html, /var navigation = container\.querySelector\('\.diagram-nav'\)/);
  assert.match(html, /if \(controlRect\) bottom = Math\.min\(bottom, controlRect\.top - placementGap\)/);
  assert.match(html, /hardBlockers: \[lensRect, controlRect, legendRect\]\.filter\(Boolean\)/);
  assert.match(html, /function cornerCandidates\(context\)/);
  assert.match(html, /function nearbyCandidates\(context, reference\)/);
  assert.match(html, /nearbyCandidates\(context, reference\)\.concat\(cornerCandidates\(context\)\)/);
  assert.match(html, /var placementOptions = \{ softWeight: manualPosition \? 0 : 100 \}/);
  assert.match(html, /manualPosition && positionIsValid\(manualPosition, context\)/);
  assert.match(html, /panelHead\.addEventListener\('pointerdown', beginPanelDrag\)/);
  assert.match(html, /surface\.addEventListener\('pointerdown',[\s\S]+viewportDrag = \{ pointerId: event\.pointerId \}/);
  assert.match(html, /target\.closest\('\[data-node-id\], \[data-relationship-hit-key\], \.overview-map'\)/);
  assert.match(html, /--archify-radar-top/);
  assert.match(html, /\.overview-map\[data-docked="true"\]/);
});

test('Semantic Radar keeps redundant accessible navigation and clean exports', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /Semantic radar \(M\)/);
  assert.match(html, /e\.key === 'm' \|\| e\.key === 'M'/);
  assert.match(html, /e\.key === 'Escape' && Archify\.radar\.isOpen\(\)/);
  assert.match(html, /event\.key === 'ArrowLeft'[\s\S]+event\.key === 'ArrowRight'[\s\S]+event\.key === 'ArrowUp'[\s\S]+event\.key === 'ArrowDown'/);
  assert.match(html, /node && \(event\.key === 'Enter' \|\| event\.key === ' '\)/);
  assert.match(html, /\.overview-map-viewport \{[\s\S]*?pointer-events: none;/);
  assert.match(html, /html\[data-embed="true"\] \.overview-map/);
  assert.match(html, /class="overview-map no-print"/);
  assert.match(html, /The radar is built at runtime so the checked artifact still contains[\s\S]+one canonical SVG block/);
  assert.doesNotMatch(canonicalSvg(html), /overview-map-node|overview-map-viewport/);
});

test('Semantic Radar stays above the measured MAP control strip', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const artifact = path.join(tmp, 'radar-control-clearance.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples', CASES.architecture),
    artifact,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact, { width: 1440, height: 900 });
    const rects = await radarRects(browser, sessionId, `
      var container = document.querySelector('.diagram-container');
      window.scrollTo(0, Math.max(0, container.offsetTop + container.offsetHeight - window.innerHeight + 8));
      Archify.radar.open();
    `);
    const controlGap = rects.controls.top - rects.radar.bottom;
    assert.ok(controlGap >= 15, JSON.stringify({ ...rects, controlGap }, null, 2));
    assert.ok(
      rects.radar.left < rects.controls.left,
      `automatic placement should prefer the lower-left corner: ${JSON.stringify(rects, null, 2)}`,
    );
  } finally {
    await browser.close();
  }
});

test('Semantic Radar avoids an expanded mobile Passport without hiding a collision', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const artifact = path.join(tmp, 'radar-mobile-passport.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples', CASES.architecture),
    artifact,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact, { width: 390, height: 600 });
    const state = await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      window.scrollTo(0, Math.max(0, container.offsetTop));
      Archify.focus.set('lb', { toggle: false });
      document.getElementById('btn-focus-relations').click();
      Archify.radar.open();
      return new Promise(function (resolve) {
        setTimeout(function () {
            var radar = document.getElementById('overview-map');
            var radarRect = radar.getBoundingClientRect();
            var passportRect = document.getElementById('focus-chip').getBoundingClientRect();
            var containerRect = document.querySelector('.diagram-container').getBoundingClientRect();
            var controlsRect = document.querySelector('.diagram-nav').getBoundingClientRect();
            var legendRect = document.querySelector('[data-legend]').getBoundingClientRect();
            resolve({
              radar: { left: radarRect.left, top: radarRect.top, right: radarRect.right, bottom: radarRect.bottom },
              passport: { left: passportRect.left, top: passportRect.top, right: passportRect.right, bottom: passportRect.bottom },
              container: { left: containerRect.left, top: containerRect.top, right: containerRect.right, bottom: containerRect.bottom },
              controls: { left: controlsRect.left, top: controlsRect.top, right: controlsRect.right, bottom: controlsRect.bottom },
              legend: { left: legendRect.left, top: legendRect.top, right: legendRect.right, bottom: legendRect.bottom },
              viewport: { width: window.innerWidth, height: window.innerHeight },
              invalid: radar.getAttribute('data-placement-invalid'),
              compact: radar.getAttribute('data-compact'),
              unavailable: radar.getAttribute('data-placement-unavailable')
            });
        }, 180);
      });
    })()`, true);
    assert.equal(overlaps(state.radar, state.passport, 10), false, JSON.stringify(state, null, 2));
    assert.notEqual(state.invalid, 'true', JSON.stringify(state, null, 2));
    assert.equal(state.compact, 'true', JSON.stringify(state, null, 2));

    const expanded = await evaluate(browser, sessionId, `(function () {
      document.getElementById('overview-map-expand').click();
      return new Promise(function (resolve) {
        setTimeout(function () {
            var radar = document.getElementById('overview-map');
            var rect = radar.getBoundingClientRect();
            var passport = document.getElementById('focus-chip');
            resolve({
              compact: radar.getAttribute('data-compact'),
              height: rect.height,
              surfaceVisible: getComputedStyle(document.getElementById('overview-map-surface')).display !== 'none',
              passportYielded: passport.getAttribute('data-radar-yielded'),
              passportVisible: getComputedStyle(passport).display !== 'none'
            });
        }, 120);
      });
    })()`, true);
    assert.equal(expanded.compact, null, JSON.stringify(expanded, null, 2));
    assert.equal(expanded.surfaceVisible, true, JSON.stringify(expanded, null, 2));
    assert.equal(expanded.passportYielded, 'true', JSON.stringify(expanded, null, 2));
    assert.equal(expanded.passportVisible, false, JSON.stringify(expanded, null, 2));
    assert.ok(expanded.height > state.radar.bottom - state.radar.top, JSON.stringify({ state, expanded }, null, 2));

    const closed = await evaluate(browser, sessionId, `(function () {
      document.getElementById('overview-map-close').click();
      var passport = document.getElementById('focus-chip');
      return {
        radarHidden: document.getElementById('overview-map').hidden,
        passportYielded: passport.getAttribute('data-radar-yielded'),
        passportVisible: getComputedStyle(passport).display !== 'none'
      };
    })()`);
    assert.equal(closed.radarHidden, true, JSON.stringify(closed, null, 2));
    assert.equal(closed.passportYielded, null, JSON.stringify(closed, null, 2));
    assert.equal(closed.passportVisible, true, JSON.stringify(closed, null, 2));
  } finally {
    await browser.close();
  }
});

test('Semantic Radar reports a consistent unavailable state and recovers when space returns', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const artifact = path.join(tmp, 'radar-unavailable.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples', CASES.architecture),
    artifact,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact, { width: 390, height: 300 });
    const unavailable = await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      window.scrollTo(0, Math.max(0, container.offsetTop));
      Archify.focus.set('lb', { toggle: false });
      document.getElementById('btn-focus-relations').click();
      Archify.radar.open();
      return new Promise(function (resolve) {
        setTimeout(function () {
          var panel = document.getElementById('overview-map');
          var trigger = document.getElementById('btn-overview-map');
          var feedback = document.getElementById('overview-map-feedback');
          resolve({
            panelHidden: panel.hidden,
            expanded: trigger.getAttribute('aria-expanded'),
            limited: trigger.getAttribute('data-radar-space-limited'),
            feedbackHidden: feedback.hidden,
            feedback: feedback.textContent.trim()
          });
        }, 260);
      });
    })()`, true);
    assert.equal(unavailable.panelHidden, true, JSON.stringify(unavailable, null, 2));
    assert.equal(unavailable.expanded, 'false', JSON.stringify(unavailable, null, 2));
    assert.equal(unavailable.limited, 'true', JSON.stringify(unavailable, null, 2));
    assert.equal(unavailable.feedbackHidden, false, JSON.stringify(unavailable, null, 2));
    assert.match(unavailable.feedback, /space/i);

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const recovered = await evaluate(browser, sessionId, `new Promise(function (resolve) {
      setTimeout(function () {
        var panel = document.getElementById('overview-map');
        var trigger = document.getElementById('btn-overview-map');
        var feedback = document.getElementById('overview-map-feedback');
        resolve({
          panelHidden: panel.hidden,
          expanded: trigger.getAttribute('aria-expanded'),
          feedbackHidden: feedback.hidden
        });
      }, 260);
    })`, true);
    assert.equal(recovered.panelHidden, false, JSON.stringify(recovered, null, 2));
    assert.equal(recovered.expanded, 'true', JSON.stringify(recovered, null, 2));
    assert.equal(recovered.feedbackHidden, true, JSON.stringify(recovered, null, 2));
  } finally {
    await browser.close();
  }
});

test('Semantic Radar automatically avoids a tall Semantic Passport', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const input = path.join(tmp, 'tall-passport.architecture.json');
  const artifact = path.join(tmp, 'tall-passport.html');
  const peers = Array.from({ length: 12 }, (_, index) => ({
    id: `peer-${index + 1}`,
    type: index % 2 ? 'backend' : 'database',
    label: `Peer ${index + 1}`,
    sublabel: 'Connected system',
    pos: [80, 40 + index * 90],
    size: [130, 60],
  }));
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Tall Passport Radar Regression', output: artifact },
    components: [
      ...peers,
      { id: 'hub', type: 'security', label: 'Relationship Hub', sublabel: 'Many authored links', pos: [900, 500], size: [150, 70] },
    ],
    boundaries: [],
    connections: peers.map((peer, index) => ({
      id: `hub-to-${peer.id}`,
      from: 'hub',
      to: peer.id,
      fromSide: 'left',
      toSide: 'right',
      via: [[840, 535], [840, peer.pos[1] + 30]],
    })),
    cards: [],
  }, null, 2));
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    input,
    artifact,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact, { width: 1200, height: 700 });
    const rects = await radarRects(browser, sessionId, `
      var container = document.querySelector('.diagram-container');
      window.scrollTo(0, Math.max(0, container.offsetTop));
      Archify.focus.set('hub', { toggle: false });
      Archify.radar.open();
    `);
    assert.ok(rects.passport, JSON.stringify(rects, null, 2));
    assert.equal(overlaps(rects.radar, rects.passport, 10), false, JSON.stringify(rects, null, 2));

    const dragGeometry = await evaluate(browser, sessionId, `(function () {
      var radar = document.getElementById('overview-map').getBoundingClientRect();
      var head = document.querySelector('.overview-map-head').getBoundingClientRect();
      var passport = document.getElementById('focus-chip').getBoundingClientRect();
      var active = document.querySelector('[data-focus-selected]');
      var nearestLeft = passport.right + 16;
      active.getBoundingClientRect = function () {
        return {
          left: nearestLeft,
          top: radar.top,
          right: nearestLeft + radar.width,
          bottom: radar.top + radar.height,
          width: radar.width,
          height: radar.height
        };
      };
      return {
        radar: { left: radar.left, top: radar.top },
        head: { left: head.left, top: head.top, height: head.height },
        requested: { left: passport.right + 8, top: radar.top },
        nearest: { left: nearestLeft, top: radar.top }
      };
    })()`);
    await dragMouse(browser, sessionId, {
      x: dragGeometry.head.left + 48,
      y: dragGeometry.head.top + dragGeometry.head.height / 2,
    }, {
      x: dragGeometry.head.left + 48 + dragGeometry.requested.left - dragGeometry.radar.left,
      y: dragGeometry.head.top + dragGeometry.head.height / 2 + dragGeometry.requested.top - dragGeometry.radar.top,
    });
    const snappedRects = await radarRects(browser, sessionId, '');
    assert.equal(overlaps(snappedRects.radar, snappedRects.passport, 10), false, JSON.stringify(snappedRects, null, 2));
    assert.ok(Math.abs(snappedRects.radar.left - dragGeometry.nearest.left) <= 2, JSON.stringify({ dragGeometry, snappedRects }, null, 2));
    assert.ok(Math.abs(snappedRects.radar.top - dragGeometry.nearest.top) <= 2, JSON.stringify({ dragGeometry, snappedRects }, null, 2));
  } finally {
    await browser.close();
  }
});

test('Semantic Radar titlebar drag persists while surface drag still pans the diagram', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const artifact = path.join(tmp, 'radar-dragging.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples', CASES.architecture),
    artifact,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact, { width: 1440, height: 900 });
    const geometry = await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      window.scrollTo(0, Math.max(0, container.offsetTop + container.offsetHeight - window.innerHeight + 8));
      Archify.radar.open();
      var radar = document.getElementById('overview-map').getBoundingClientRect();
      var head = document.querySelector('.overview-map-head').getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      return {
        radar: { left: radar.left, top: radar.top, width: radar.width, height: radar.height },
        head: { left: head.left, top: head.top, width: head.width, height: head.height },
        state: Archify.view.state(),
        target: {
          left: Math.max(24, containerRect.left + 360),
          top: Math.max(24, containerRect.top + 20)
        }
      };
    })()`);
    const titleStart = {
      x: geometry.head.left + 48,
      y: geometry.head.top + geometry.head.height / 2,
    };
    const titleTarget = {
      x: titleStart.x + geometry.target.left - geometry.radar.left,
      y: titleStart.y + geometry.target.top - geometry.radar.top,
    };
    await dragMouse(browser, sessionId, titleStart, titleTarget);

    const manuallyPlaced = await evaluate(browser, sessionId, `(function () {
      Archify.radar.sync();
      var radar = document.getElementById('overview-map').getBoundingClientRect();
      return { left: radar.left, top: radar.top, state: Archify.view.state() };
    })()`);
    assert.ok(Math.abs(manuallyPlaced.left - geometry.target.left) <= 2, JSON.stringify({ geometry, manuallyPlaced }, null, 2));
    assert.ok(Math.abs(manuallyPlaced.top - geometry.target.top) <= 2, JSON.stringify({ geometry, manuallyPlaced }, null, 2));
    assert.deepEqual(manuallyPlaced.state, geometry.state);

    const surfaceState = await evaluate(browser, sessionId, `(function () {
      var radar = document.getElementById('overview-map').getBoundingClientRect();
      var surface = document.getElementById('overview-map-surface').getBoundingClientRect();
      return {
        radar: { left: radar.left, top: radar.top },
        state: Archify.view.state(),
        start: { x: surface.left + 8, y: surface.top + 8 },
        end: { x: surface.right - 8, y: surface.bottom - 8 }
      };
    })()`);
    await dragMouse(browser, sessionId, surfaceState.start, surfaceState.end);
    const afterSurfaceDrag = await evaluate(browser, sessionId, `(function () {
      var radar = document.getElementById('overview-map').getBoundingClientRect();
      return {
        radar: { left: radar.left, top: radar.top },
        state: Archify.view.state()
      };
    })()`);
    assert.deepEqual(afterSurfaceDrag.radar, surfaceState.radar);
    assert.notDeepEqual(afterSurfaceDrag.state, surfaceState.state);

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    const afterResize = await evaluate(browser, sessionId, `new Promise(function (resolve) {
      setTimeout(function () {
        var radar = document.getElementById('overview-map').getBoundingClientRect();
        var controls = document.querySelector('.diagram-nav').getBoundingClientRect();
        var container = document.querySelector('.diagram-container').getBoundingClientRect();
        resolve({
          radar: { left: radar.left, top: radar.top, right: radar.right, bottom: radar.bottom },
          controls: { left: controls.left, top: controls.top, right: controls.right, bottom: controls.bottom },
          container: { left: container.left, top: container.top, right: container.right, bottom: container.bottom },
          viewport: { width: window.innerWidth, height: window.innerHeight }
        });
      }, 120);
    })`, true);
    assert.ok(afterResize.radar.left >= Math.max(0, afterResize.container.left), JSON.stringify(afterResize, null, 2));
    assert.ok(afterResize.radar.right <= Math.min(afterResize.viewport.width, afterResize.container.right), JSON.stringify(afterResize, null, 2));
    assert.equal(overlaps(afterResize.radar, afterResize.controls, 10), false, JSON.stringify(afterResize, null, 2));
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
