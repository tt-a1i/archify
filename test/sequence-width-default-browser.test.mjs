import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

const contains = (outer, inner) => inner.left >= outer.left - 0.1 && inner.right <= outer.right + 0.1
  && inner.top >= outer.top - 0.1 && inner.bottom <= outer.bottom + 0.1;
const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.1
  && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.1;

async function observeSequence(browser, session) {
  const evaluated = await browser.cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const svg = document.querySelector('.diagram-container > svg');
      const box = el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const visible = el => {
        const style = getComputedStyle(el), r = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && r.width > 0 && r.height > 0;
      };
      return {
        theme: document.documentElement.dataset.theme,
        viewBox: svg.getAttribute('viewBox'), canvas: box(svg),
        nodes: [...svg.querySelectorAll('g[data-node-id]')].map(node => {
          const rect = node.querySelector('rect'), label = node.querySelector('text[data-node-label]');
          return { label: label.textContent, box: box(rect), text: box(label), sigil: box(node.querySelector('[data-semantic-sigil]')),
            visible: visible(label), font: parseFloat(getComputedStyle(label).fontSize) * svg.getScreenCTM().a,
            geometry: [Number(rect.getAttribute('x')), Number(rect.getAttribute('width'))],
            sublabel: (() => {
              const el = node.querySelector('text[data-detail="context"]');
              return el && { value: el.textContent, box: box(el), visible: visible(el), font: parseFloat(getComputedStyle(el).fontSize) * svg.getScreenCTM().a };
            })() };
        }),
        messageMasks: [...svg.querySelectorAll('g[data-detail="context"]')].filter(el => el.querySelector('rect.c-mask')).map(el => ({ box: box(el.querySelector('rect.c-mask')), text: box(el.querySelector('text')) })),
        text: [...svg.querySelectorAll('text')].filter(visible).map(el => ({ value: el.textContent, box: box(el) })),
      };
    })()`,
  }, session);
  assert.equal(evaluated.exceptionDetails, undefined);
  return evaluated.result.value;
}

test('authored sequence canvases default to spread and keep real browser labels inside their columns', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome, 'The configured browser regression requires Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-width-default-'));
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const session = await browser.sessionPromise;
    // The narrow canvases exercise both the old 108px minimum gap and
    // capacity formerly available with fixed columns. Keep labels public and
    // short so this tests column capacity rather than label authoring.
    for (const [canvasWidth, count] of [[1320, 5], [820, 7], [480, 4], [794, 7]]) {
      const spec = {
        schema_version: 1, diagram_type: 'sequence',
        meta: { title: 'Request path', viewBox: [canvasWidth, 620], quality_profile: 'standard', output: 'diagram.html' },
        participants: ['Client', 'Gateway', 'Auth', 'API', 'Cache', 'Store', 'Worker'].slice(0, count)
          .map((label, i) => ({ id: `p${i}`, type: 'backend', label })),
        messages: Array.from({ length: count - 1 }, (_, i) => ({
          from: `p${i}`, to: `p${i + 1}`, y: 200 + i * 40, label: 'go',
        })),
      };
      const positions = {};
      for (const fit of ['omitted', 'spread', 'fixed']) {
        const doc = structuredClone(spec);
        if (fit !== 'omitted') doc.meta.column_fit = fit;
        const input = path.join(dir, `${canvasWidth}-${fit}.json`);
        const output = path.join(dir, `${canvasWidth}-${fit}.html`);
        fs.writeFileSync(input, JSON.stringify(doc));
        execFileSync(process.execPath, [cli, 'render', 'sequence', input, output], { stdio: ['ignore', 'pipe', 'pipe'] });
        for (const theme of ['light', 'dark']) {
          await browser.inspect({ artifactPath: output, width: 1440, height: 900, theme });
          const observed = await observeSequence(browser, session);
          const where = `${canvasWidth}px/${fit}/${theme}`;
          assert.equal(observed.theme, theme, where);
          assert.equal(observed.viewBox, `0 0 ${canvasWidth} 620`, where + ': authored viewBox changed');
          assert.deepEqual(observed.nodes.map(node => node.label), spec.participants.map(node => node.label), where);
          for (const node of observed.nodes) {
            assert.ok(node.visible && node.font >= 7.5, where + ': participant label must remain visible and readable');
            assert.ok(contains(observed.canvas, node.box), where + ': participant escapes canvas');
            assert.ok(contains(node.box, node.text), where + ': real glyph bounds escape participant: ' + node.label);
            assert.ok(!overlaps(node.text, node.sigil), where + ': label overlaps semantic sigil');
          }
          for (let i = 1; i < observed.nodes.length; i++) {
            assert.ok(!overlaps(observed.nodes[i - 1].box, observed.nodes[i].box), where + ': participant boxes overlap');
          }
          for (let i = 0; i < observed.text.length; i++) {
            const text = observed.text[i];
            assert.ok(contains(observed.canvas, text.box), where + ': visible text escapes canvas: ' + text.value);
            for (const other of observed.text.slice(i + 1)) {
              assert.ok(!overlaps(text.box, other.box), where + ': visible labels overlap: ' + text.value + ' / ' + other.value);
            }
          }
          const geometry = observed.nodes.map(node => node.geometry);
          if (positions[fit]) assert.deepEqual(geometry, positions[fit], where + ': theme changed column geometry');
          else positions[fit] = geometry;
        }
      }
      assert.deepEqual(positions.omitted, positions.spread, `${canvasWidth}px: omitted fit must use spread on the same authored canvas`);
      assert.notDeepEqual(positions.omitted, positions.fixed, `${canvasWidth}px: regression must distinguish fixed from spread`);
      assert.equal(positions.fixed[0][0], 19, 'fixed keeps its historical first box position');
      assert.ok(positions.fixed.every((box, i) => box[1] === 86 && (i === 0 || box[0] - positions.fixed[i - 1][0] === 108)),
        'explicit fixed keeps its historical 86px boxes and 108px column spacing');
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('automatic sequence spread recovers crowded headers without losing real browser glyphs or masks', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome, 'The configured browser regression requires Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-capacity-'));
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const session = await browser.sessionPromise;
    // Synthetic endpoints require more than the nominal seven-column width,
    // but fit within the existing automatic canvas, margins and card gutters.
    const spec = {
      schema_version: 1, diagram_type: 'sequence',
      meta: { title: 'Event delivery', quality_profile: 'showcase', output: 'diagram.html' },
      participants: ['NotificationGateway', 'Access', 'Policy', 'Events', 'Cache', 'Store', '审计DeliveryService']
        .map((label, i) => ({ id: `p${i}`, type: 'backend', label, sublabel: ['入口', 'token', 'rules', 'queue', 'hot', 'data', '审计'][i] })),
      messages: [{ from: 'p0', to: 'p1', y: 180, label: 'send' }],
    };
    const input = path.join(dir, 'capacity.json');
    const output = path.join(dir, 'capacity.html');
    fs.writeFileSync(input, JSON.stringify(spec));
    execFileSync(process.execPath, [cli, 'render', 'sequence', input, output], { stdio: ['ignore', 'pipe', 'pipe'] });
    let geometry;
    for (const theme of ['light', 'dark']) {
      await browser.inspect({ artifactPath: output, width: 1440, height: 900, theme });
      const observed = await observeSequence(browser, session);
      const where = `automatic capacity/${theme}`;
      const canvasWidth = Number(observed.viewBox.split(' ')[2]);
      assert.equal(observed.theme, theme, where);
      assert.ok(canvasWidth <= 1085, where + ': preserve the automatic desktop width cap');
      assert.deepEqual(observed.nodes.map(node => node.label), spec.participants.map(node => node.label), where);
      assert.deepEqual(observed.nodes.map(node => node.sublabel?.value), spec.participants.map(node => node.sublabel), where);
      for (const node of observed.nodes) {
        assert.ok(node.visible && node.font >= 7.5, where + ': primary label must remain readable');
        assert.ok(node.sublabel.visible && node.sublabel.font >= 6.5, where + ': sublabel must remain readable');
        assert.ok(contains(observed.canvas, node.box), where + ': participant escapes canvas');
        for (const text of [node.text, node.sublabel.box]) {
          assert.ok(contains(node.box, text), where + ': real glyph bounds escape participant: ' + node.label);
          assert.ok(!overlaps(text, node.sigil), where + ': text overlaps semantic sigil');
        }
      }
      const boxes = observed.nodes.map(node => node.geometry);
      assert.ok(boxes[0][0] >= 40 && canvasWidth - boxes.at(-1)[0] - boxes.at(-1)[1] >= 40,
        where + ': keep both outer card margins');
      for (let i = 1; i < boxes.length; i++) {
        assert.ok(boxes[i][0] - boxes[i - 1][0] - boxes[i - 1][1] >= 16 - 0.01,
          where + ': keep the minimum card gutter');
      }
      assert.equal(observed.messageMasks.length, spec.messages.length, where + ': message mask missing');
      for (const mask of observed.messageMasks) {
        // Column recovery changes horizontal geometry. SVG font bounds can
        // overhang the mask vertically on unchanged baseline output too.
        assert.ok(mask.text.left >= mask.box.left - 0.1 && mask.text.right <= mask.box.right + 0.1,
          where + ': message glyphs escape the mask horizontally');
        assert.ok(contains(observed.canvas, mask.box), where + ': message mask escapes canvas');
        for (const node of observed.nodes) assert.ok(!overlaps(mask.box, node.box), where + ': message mask covers a header');
      }
      for (let i = 0; i < observed.text.length; i++) {
        const text = observed.text[i];
        assert.ok(contains(observed.canvas, text.box), where + ': visible text escapes canvas: ' + text.value);
        for (const other of observed.text.slice(i + 1)) {
          assert.ok(!overlaps(text.box, other.box), where + ': visible labels overlap: ' + text.value + ' / ' + other.value);
        }
      }
      if (geometry) assert.deepEqual(boxes, geometry, where + ': theme changed column geometry');
      else geometry = boxes;
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
