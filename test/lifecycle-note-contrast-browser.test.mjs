import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/lifecycle-dense-exit-notes.json', import.meta.url));

test('Lifecycle notes retain their content and reading depth with readable Full-detail ink', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome, 'The configured browser regression requires Chrome');
  const source = fs.readFileSync(fixture);
  const expected = JSON.parse(source).transitions.filter(edge => edge.note)
    .map(edge => ({ id: edge.id, label: edge.label, note: edge.note }));
  assert.ok(expected.length > 0, 'the public fixture carries transition notes');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-note-contrast-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const artifact = path.join(scratch, 'lifecycle.html');
  const input = path.join(scratch, 'lifecycle.json');
  const document = JSON.parse(source);
  document.transitions.find(edge => edge.id === 'advance-0').variant = 'default';
  fs.writeFileSync(input, JSON.stringify(document));
  execFileSync(process.execPath, [cli, 'render', 'lifecycle', input, artifact]);
  assert.deepEqual(fs.readFileSync(fixture), source, 'rendering preserves the authored notes');
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  async function run(expression) {
    const result = await browser.cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, session);
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  // Sample the same primary label in both depths without another browser session.
  const primaryLabel = `(() => {
    const label = document.querySelector('g[data-edge-id="advance-0"] text:not([data-detail="fine"])');
    const ink = getComputedStyle(label);
    const muted = getComputedStyle(document.querySelector('g[data-edge-id] text[data-detail="fine"]'));
    const ancestors = [];
    for (let node = label; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      ancestors.push({ opacity: Number(style.opacity), display: style.display, visibility: style.visibility });
    }
    return { text: label.textContent, role: label.getAttribute('class'), fill: ink.fill,
      mutedFill: muted.fill, fillOpacity: Number(ink.fillOpacity), ancestors };
  })()`;
  function assertPrimaryLabel(label) {
    assert.equal(label.text, 'assign worker');
    assert.equal(label.role, 't-muted', 'default primary label uses readable neutral text');
    assert.equal(label.fill, label.mutedFill, 'default label resolves to the existing readable muted ink');
    assert.equal(label.fillOpacity, 1);
    for (const ancestor of label.ancestors) {
      assert.equal(ancestor.opacity, 1, 'primary label and every ancestor remain opaque');
      assert.notEqual(ancestor.visibility, 'hidden');
      assert.notEqual(ancestor.display, 'none');
    }
  }
  for (const theme of ['light', 'dark']) {
    await t.test(`${theme} Read hides notes and Full meets opaque-plate contrast`, async () => {
      await browser.inspect({ artifactPath: artifact, width: 1440, height: 1100, theme });
      const read = await run(`(async () => {
        Archify.view.reset();
        await Archify.readerLayout.whenStable();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const panel = document.querySelector('.diagram-container');
        return { primary: ${primaryLabel}, detail: panel.dataset.detailLevel, notes: [...panel.querySelectorAll('g[data-edge-id] text[data-detail="fine"]')].map(note => ({
          id: note.parentElement.dataset.edgeId, note: note.textContent,
          noteOpacity: getComputedStyle(note).opacity,
          label: note.parentElement.querySelector('text:not([data-detail="fine"])').textContent,
          labelOpacity: getComputedStyle(note.parentElement.querySelector('text:not([data-detail="fine"])')).opacity,
          groupOpacity: getComputedStyle(note.parentElement).opacity,
        })) };
      })()`);
      assert.equal(read.detail, 'read');
      assertPrimaryLabel(read.primary);
      assert.deepEqual(read.notes.map(({ id, label, note }) => ({ id, label, note })), expected);
      for (const note of read.notes) {
        assert.equal(note.noteOpacity, '0', 'Read hides auxiliary notes');
        assert.equal(note.labelOpacity, '1', 'Read keeps the primary label');
        assert.equal(note.groupOpacity, '1', 'the label group remains visible');
      }
      const full = await run(`(async () => {
        Archify.view.reveal([...document.querySelectorAll('[data-node-id]')].map(node => node.dataset.nodeId), { instant: true, maxScale: 1 });
        const panel = document.querySelector('.diagram-container');
        await Promise.all(panel.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
        const rgba = value => {
          const channels = value.match(/[\\d.]+/g).map(Number);
          return [...channels.slice(0, 3), channels[3] ?? 1];
        };
        const luminance = rgb => rgb.slice(0, 3).map(c => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        return { primary: ${primaryLabel}, theme: document.documentElement.dataset.theme, preset: document.documentElement.dataset.preset,
          detail: panel.dataset.detailLevel, notes: [...panel.querySelectorAll('g[data-edge-id] text[data-detail="fine"]')].map(note => {
            const group = note.parentElement, mask = group.querySelector(':scope > rect.c-mask');
            const ink = getComputedStyle(note), plate = getComputedStyle(mask);
            const foreground = rgba(ink.fill), background = rgba(plate.fill);
            const ancestors = [];
            for (let node = note; node; node = node.parentElement) {
              const style = getComputedStyle(node);
              ancestors.push({ opacity: Number(style.opacity), display: style.display, visibility: style.visibility });
            }
            const inkAlpha = foreground[3] * Number(ink.fillOpacity);
            const rendered = foreground.slice(0, 3).map((c, i) => c * inkAlpha + background[i] * (1 - inkAlpha));
            const a = luminance(rendered), b = luminance(background);
            return { id: group.dataset.edgeId, note: note.textContent,
              label: group.querySelector('text:not([data-detail="fine"])').textContent,
              ancestors, maskOpacity: Number(plate.opacity), maskVisibility: plate.visibility, maskDisplay: plate.display,
              maskAlpha: background[3] * Number(plate.fillOpacity), inkAlpha,
              foreground: rendered, background: background.slice(0, 3),
              ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          }) };
      })()`);
      assert.equal(full.theme, theme);
      assert.equal(full.preset, 'classic');
      assert.equal(full.detail, 'full');
      assertPrimaryLabel(full.primary);
      assert.deepEqual(full.notes.map(({ id, label, note }) => ({ id, label, note })), expected);
      for (const note of full.notes) {
        for (const ancestor of note.ancestors) {
          assert.equal(ancestor.opacity, 1, 'Full ink and every ancestor are opaque');
          assert.notEqual(ancestor.visibility, 'hidden');
          assert.notEqual(ancestor.display, 'none');
        }
        assert.equal(note.maskOpacity, 1);
        assert.equal(note.maskAlpha, 1, 'the same-group plate supplies an opaque background');
        assert.notEqual(note.maskVisibility, 'hidden');
        assert.notEqual(note.maskDisplay, 'none');
        assert.equal(note.inkAlpha, 1);
        t.diagnostic(`${theme} ${note.id} opaque-plate contrast ${note.ratio.toFixed(3)}:1; ink ${note.foreground}; plate ${note.background}`);
        assert.ok(Number.isFinite(note.ratio) && note.ratio >= 4.5,
          `${theme} ${note.id} note contrast ${note.ratio.toFixed(3)}:1 must be at least 4.5:1`);
      }
    });
  }
});
