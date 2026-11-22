import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { normalizeChoreographySpec } from '../archify/story/choreography-plan.mjs';
import { createCompiledStoryTheme } from '../archify/story/story-svg.mjs';
import { BAKE_PRESETS, BAKE_THEMES, bakeSvg, compileColorMix, extractCanonicalSvg, loadViewerStyles, resolveThemeVariables } from '../archify/story/svg-bake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function run(args, cwd = skillRoot) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
}

function buildChoreographySample(dir) {
  const before = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Sync Request', output: 'before.html' },
    components: [
      { id: 'api', type: 'backend', label: 'Checkout API', pos: [60, 120], size: [140, 60] },
      { id: 'mail', type: 'external', label: 'SMTP Sync', pos: [300, 120], size: [140, 60] },
    ],
    connections: [
      { id: 'sync_send', from: 'api', to: 'mail', label: 'sendMail()' },
    ],
  };
  const after = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Async Queue', output: 'after.html' },
    components: [
      { id: 'api', type: 'backend', label: 'Checkout API', pos: [60, 120], size: [140, 60] },
      { id: 'queue', type: 'messagebus', label: 'Event Queue', pos: [300, 120], size: [140, 60] },
    ],
    connections: [
      { id: 'enqueue', from: 'api', to: 'queue', label: 'enqueue()' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'before.json'), JSON.stringify(before, null, 2));
  fs.writeFileSync(path.join(dir, 'after.json'), JSON.stringify(after, null, 2));
  fs.writeFileSync(path.join(dir, 'queue.mjs'), '\tconst markup = "<tag>&";\n  return send(markup);\n');
  const spec = path.join(dir, 'choreo.json');
  fs.writeFileSync(spec, JSON.stringify({
    schema_version: 1,
    kind: 'story-choreography',
    id: 'browser-demo',
    title: 'Async Queue Choreography',
    chrome: 'story',
    stills: [2, 6],
    views: [
      { id: 'before', type: 'architecture', input: 'before.json', callouts: { mail: { text: 'Retired', tone: 'removed' } } },
      { id: 'after', type: 'architecture', input: 'after.json', callouts: { api: { text: 'Modified', tone: 'modified' }, queue: { text: 'New Queue', tone: 'added' } } },
    ],
    steps: [
      { view: 'before', duration: 4.0, title: 'Synchronous SMTP call', body: 'Initially Checkout API blocks on synchronous SMTP delivery.' },
      {
        view: 'after',
        duration: 5.0,
        title: 'Switch to Event Queue',
        body: 'Checkout API persists across stages while Event Queue enters and connects.',
        transition: { from: 'before', shared: [{ id: 'api' }] },
        enter: ['queue'],
        connect: ['enqueue'],
        trace: { edges: ['enqueue'], travel: 1.0 },
        detail: { nodes: ['api'], title: 'Cited queue source', path: 'queue.mjs', lines: [1, 2], highlight: [2] },
      },
    ],
  }, null, 2));
  return spec;
}

test('story SVGs render in <img>/<picture>, settle under prefers-reduced-motion, and story video/stage export 1080p MP4 & WebM in Chrome', {
  timeout: 120000,
  skip: chrome ? false : 'Set ARCHIFY_CHROME for the real-browser choreography check.',
}, async (t) => {
  const dir = createScratchDirectory(path.join(os.tmpdir(), 'archify-story-choreo-browser-'));
  const spec = buildChoreographySample(dir);
  const svgRes = run(['story', 'svg', spec, path.join(dir, 'walkthrough'), '--theme', 'both', '--still', '--json'], dir);
  assert.equal(svgRes.status, 0, svgRes.stdout + svgRes.stderr);
  const svgJson = JSON.parse(svgRes.stdout);

  const stageHtml = path.join(dir, 'stage.html');
  const stageRes = run(['story', 'stage', spec, stageHtml, '--theme', 'dark', '--json'], dir);
  assert.equal(stageRes.status, 0, stageRes.stdout + stageRes.stderr);

  const lightSvg = svgJson.outputs.find((o) => o.theme === 'light').path;
  const darkSvg = svgJson.outputs.find((o) => o.theme === 'dark').path;
  const lightStills = svgJson.stills.filter((s) => s.theme === 'light');

  const hostHtml = path.join(dir, 'host.html');
  const toDataUri = (f) => `data:image/svg+xml;base64,${fs.readFileSync(f).toString('base64')}`;
  fs.writeFileSync(hostHtml, `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <img id="img-light" src="${toDataUri(lightSvg)}" alt="light">
    <img id="img-dark" src="${toDataUri(darkSvg)}" alt="dark">
    <img id="img-still" src="${pathToFileURL(lightStills[0].path).href}" alt="still">
    <picture><source media="(prefers-color-scheme: dark)" srcset="${pathToFileURL(darkSvg).href}"><img id="pic" src="${pathToFileURL(lightSvg).href}" alt="pic"></picture>
  </body></html>`);

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session, 60000);
  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    assert.equal(res.exceptionDetails, undefined, res.exceptionDetails?.exception?.description || res.exceptionDetails?.text);
    return res.result?.value;
  };

  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // 1. Sandboxed <img>/<picture> rendering
  let loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(hostHtml).href });
  await loaded;
  const imgs = await evalJs(`Promise.all([...document.images].map(img => (img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })).then(() => ({ id: img.id, ok: img.complete && img.naturalWidth === 960 && img.naturalHeight === 560, w: img.naturalWidth, h: img.naturalHeight }))))`);
  for (const item of imgs) {
    assert.equal(item.ok, true, `${item.id} must decode cleanly at 960x560, got ${item.w}x${item.h}`);
  }

  // 2. Caption clearance + reduced-motion visibility on settled stage
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(lightSvg).href });
  await loaded;
  const reduced = await evalJs(`(() => {
    const stage = document.getElementById('view-after');
    const entered = document.querySelector('#view-after [data-node-id="queue"]');
    const tok = document.querySelector('[data-story-token]');
    const captionRects = [...document.querySelectorAll('.story-caption text')].map(el => el.getBoundingClientRect().bottom);
    return {
      captionCount: captionRects.length,
      tokenPresent: Boolean(tok),
      stageOpacity: getComputedStyle(stage).opacity,
      enteredOpacity: getComputedStyle(entered).opacity,
      enteredVisibility: getComputedStyle(entered).visibility,
      tokenDisplay: tok ? getComputedStyle(tok).display : 'none',
      maxCaptionBottom: Math.max(...captionRects),
    };
  })()`);
  assert.equal(reduced.stageOpacity, '1');
  assert.ok(reduced.captionCount > 0);
  assert.equal(reduced.tokenPresent, true);
  assert.equal(reduced.enteredOpacity, '1');
  assert.equal(reduced.enteredVisibility, 'visible');
  assert.equal(reduced.tokenDisplay, 'none');
  assert.ok(reduced.maxCaptionBottom <= 112, `caption bottom ${reduced.maxCaptionBottom} must stay above 112px viewport`);

  const nativeColors = `svg => [...svg.querySelectorAll('[data-node-id] text')].map(el => ({ text: el.textContent, fill: getComputedStyle(el).fill }))`;
  const expectedColors = { light: await evalJs(`(${nativeColors})(document.documentElement)`) };
  loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(darkSvg).href }); await loaded;
  expectedColors.dark = await evalJs(`(${nativeColors})(document.documentElement)`);

  // 3. Interactive Stage playback and export with reduced motion enabled.
  loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(stageHtml).href });
  await loaded;
  const playback = await evalJs(`(() => {
    const captionOpacity = () => [...document.querySelectorAll('.stage-pane.is-active .story-caption')]
      .map(caption => Number(getComputedStyle(caption).opacity));
    const opening = window.ArchifyStoryStage.state();
    const openingCaptions = captionOpacity();
    const range = document.getElementById('stage-range');
    range.value = 6;
    range.dispatchEvent(new Event('change'));
    const scrubbed = window.ArchifyStoryStage.state();
    return { opening, openingCaptions, scrubbed, scrubbedCaptions: captionOpacity() };
  })()`);
  await t.test('Stage opens paused and scrubs between scenes with reduced motion', () => {
    assert.deepEqual(playback.openingCaptions, [1, 0]);
    assert.equal(playback.opening.playing, false);
    assert.equal(playback.opening.time, 0);
    assert.equal(playback.scrubbed.playing, false);
    assert.equal(playback.scrubbed.time, 6);
    assert.deepEqual(playback.scrubbedCaptions, [0, 1]);
  });
  for (const theme of ['light', 'dark']) {
    const actualColors = await evalJs(`(() => { window.ArchifyStoryStage.pause(); window.ArchifyStoryStage.setTheme('${theme}'); return (${nativeColors})(document.querySelector('.stage-pane.is-active > svg')); })()`);
    assert.deepEqual(actualColors, expectedColors[theme], `${theme} native diagram colors match the standalone SVG`);
  }
  await t.test('Stage preset menu follows Viewer click, focus, and keyboard behavior', async () => {
    const menu = await evalJs(`(() => {
      const api = window.StoryStage;
      const trigger = document.getElementById('stage-preset');
      const menu = document.getElementById('stage-preset-menu');
      const sendKey = (key, target = document.activeElement, options = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
      const active = () => document.activeElement.dataset.presetValue;
      const expanded = () => trigger.getAttribute('aria-expanded');
      trigger.querySelector('.preset-control-mark').click();
      const opened = [expanded(), getComputedStyle(menu).display, active()];
      const navigation = ['End', 'ArrowDown', 'ArrowUp', 'Home'].map(key => {
        sendKey(key);
        return active();
      });
      menu.querySelector('[data-preset-value="blueprint"] strong').click();
      const svg = document.querySelector('[data-story-switchable]');
      const selection = {
        preset: api.state().preset, html: document.documentElement.dataset.preset, svg: svg.dataset.preset,
        trigger: trigger.dataset.presetOption, label: trigger.querySelector('#stage-preset-label').textContent,
        checked: [...menu.querySelectorAll('[aria-checked="true"]')].map(el => el.dataset.presetValue),
        closed: expanded(), focusReturned: document.activeElement === trigger,
      };
      sendKey('ArrowUp');
      const keyboardOpened = [expanded(), active()];
      sendKey('Escape');
      const escaped = [expanded(), document.activeElement === trigger];
      trigger.click();
      document.querySelector('h1').click();
      const outside = expanded();
      sendKey('s', document.body, { ctrlKey: true });
      sendKey('s', document.getElementById('stage-range'));
      sendKey('s', trigger);
      const ignored = api.state().preset;
      sendKey('S', document.body, { shiftKey: true });
      const cycled = api.state().preset;
      sendKey('s', document.body);
      return { opened, navigation, selection, keyboardOpened, escaped, outside, ignored, cycled, wrapped: api.state().preset };
    })()`);
    assert.deepEqual(menu.opened, ['true', 'block', 'classic']);
    assert.deepEqual(menu.navigation, ['editorial', 'classic', 'editorial', 'classic']);
    assert.deepEqual(menu.selection, {
      preset: 'blueprint', html: 'blueprint', svg: 'blueprint', trigger: 'blueprint', label: 'Blueprint',
      checked: ['blueprint'], closed: 'false', focusReturned: true,
    });
    assert.deepEqual(menu.keyboardOpened, ['true', 'editorial']);
    assert.deepEqual(menu.escaped, ['false', true]);
    assert.equal(menu.outside, 'false');
    assert.equal(menu.ignored, 'blueprint');
    assert.equal(menu.cycled, 'editorial');
    assert.equal(menu.wrapped, 'classic');
  });
  await t.test('Stage Export menu shares toolbar focus and dispatches PNG, MP4, and WebM actions', async () => {
    const result = await evalJs(`(async () => {
      const preset = document.getElementById('stage-preset');
      const trigger = document.getElementById('stage-export');
      const expanded = () => [preset, trigger].map(button => button.getAttribute('aria-expanded'));
      const key = (key, target = document.activeElement, options = {}) =>
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
      preset.click();
      key('e', document.body);
      const exportByKey = [...expanded(), document.activeElement.id];
      preset.click();
      const presetByClick = expanded();
      trigger.click();
      const exportByClick = expanded();
      const navigation = ['ArrowUp', 'ArrowDown', 'End', 'Home'].map(value => {
        key(value);
        return document.activeElement.id;
      });
      key('Escape');
      const escaped = [...expanded(), document.activeElement.id];
      key('e', document.getElementById('stage-range'));
      key('e', document.body, { ctrlKey: true });
      const ignored = expanded();
      key('e', document.body);
      key('e');
      const toggled = expanded();
      trigger.click();
      document.querySelector('h1').click();
      const outside = expanded();

      let receiveDownload;
      const downloaded = new Promise(resolve => { receiveDownload = resolve; });
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith('.png')) receiveDownload(fetch(this.href).then(response => response.blob()));
        else originalClick.call(this);
      };
      let png;
      try {
        trigger.click();
        document.querySelector('#stage-export-png strong').click();
        const timeout = setTimeout(() => receiveDownload(null), 5000);
        const blob = await downloaded;
        clearTimeout(timeout);
        const image = await createImageBitmap(blob);
        png = [blob.type, image.width, image.height, ...expanded()];
        image.close();
      } finally {
        HTMLAnchorElement.prototype.click = originalClick;
      }
      const pickers = [];
      const originalPicker = window.showSaveFilePicker;
      window.showSaveFilePicker = async ({ suggestedName }) => {
        pickers.push([suggestedName.split('.').at(-1), ...expanded(), trigger.disabled]);
        throw new DOMException('test cancellation', 'AbortError');
      };
      try {
        for (const format of ['mp4', 'webm']) {
          trigger.click();
          document.getElementById('stage-export-' + format).click();
          // Let the asynchronous save picker cancellation restore the toolbar.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } finally {
        window.showSaveFilePicker = originalPicker;
      }
      return { exportByKey, presetByClick, exportByClick, navigation, escaped, ignored, toggled, outside, png, pickers, restored: !trigger.disabled };
    })()`);
    assert.deepEqual(result.exportByKey, ['false', 'true', 'stage-export-png']);
    assert.deepEqual(result.presetByClick, ['true', 'false']);
    assert.deepEqual(result.exportByClick, ['false', 'true']);
    assert.deepEqual(result.navigation, ['stage-export-webm', 'stage-export-png', 'stage-export-webm', 'stage-export-png']);
    assert.deepEqual(result.escaped, ['false', 'false', 'stage-export']);
    for (const key of ['ignored', 'toggled', 'outside']) assert.deepEqual(result[key], ['false', 'false'], key);
    assert.deepEqual(result.png, ['image/png', 1920, 1080, 'false', 'false']);
    assert.deepEqual(result.pickers, [['mp4', 'false', 'false', true], ['webm', 'false', 'false', true]]);
    assert.equal(result.restored, true);
  });
  await t.test('Stage switches all eight Viewer palettes and PNG captures the active syntax and canvas', async () => {
    const { rules } = loadViewerStyles();
    const combinations = BAKE_PRESETS.flatMap(preset => BAKE_THEMES.map(theme => {
      const vars = resolveThemeVariables(rules, { theme, preset });
      const backend = vars.get('--backend-stroke');
      const node = theme === 'dark' ? compileColorMix(`color-mix(in srgb, ${backend} 72%, ${vars.get('--mask')})`) : backend;
      return { preset, theme, background: vars.get('--bg'), node, text: vars.get('--text') };
    }));
    const result = await evalJs(`(async () => {
      await document.fonts.ready;
      const api = window.StoryStage;
      const svg = document.querySelector('.stage-pane.is-active > svg');
      const presetControl = document.getElementById('stage-preset');
      const presetMenu = document.getElementById('stage-preset-menu');
      const code = [...svg.querySelectorAll('.story-source-detail text')].find(row => row.getAttribute('xml:space') === 'preserve');
      const keyword = code.querySelector('tspan');
      const node = svg.querySelector('[data-node-id] rect.c-backend');
      const caption = svg.querySelector('.caption-body');
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const bytes = color => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      api.pause();
      api.seek(6);
      const palettes = [];
      for (const { preset, theme, background, node: expectedNode, text } of ${JSON.stringify(combinations)}) {
        presetControl.click();
        presetMenu.querySelector('[data-preset-value="' + preset + '"]').click();
        api.setTheme(theme);
        const blob = await api.exportPNG();
        const image = await createImageBitmap(blob);
        const expectedBg = bytes(background);
        const keywordColor = bytes(getComputedStyle(keyword).fill);
        ctx.drawImage(image, 0, 0);
        image.close();
        const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        const letterbox = pixel(0, 500);
        const canvasBg = pixel(120, 25);
        const codeBg = pixel(1700, 760);
        // The first code row begins at (564, 188) in the SVG. Search for
        // solid glyph interiors to avoid relying on antialiasing at one point.
        const textPixels = ctx.getImageData(1110, 332, 90, 34).data;
        let colored = 0;
        for (let i = 0; i < textPixels.length; i += 4) {
          if (keywordColor.every((channel, j) => channel === textPixels[i + j])) colored++;
        }
        palettes.push({
          preset, theme, state: api.state(),
          expectedBg, letterbox, canvasBg, codeBg,
          chrome: bytes(getComputedStyle(document.body).backgroundColor),
          node: bytes(getComputedStyle(node).stroke), expectedNode: bytes(expectedNode),
          ink: bytes(getComputedStyle(code).fill), expectedInk: bytes(text),
          caption: getComputedStyle(caption).fill, keywordColor, colored,
          activeTimeline: svg.getAnimations({ subtree: true }).some(a => a.currentTime === 6000),
        });
      }
      const pending = api.exportPNG();
      api.setPreset('classic');
      api.setTheme('light');
      const frozen = await createImageBitmap(await pending);
      ctx.drawImage(frozen, 0, 0);
      frozen.close();
      const pendingPng = [0, 120].map(x => [...ctx.getImageData(x, 500, 1, 1).data]);
      api.play();
      const animation = svg.getAnimations({ subtree: true })[0];
      const before = animation.currentTime;
      api.setPreset('signal-flow');
      api.setTheme('dark');
      const playing = api.state().playing;
      const after = animation.currentTime;
      api.pause();
      api.setPreset('classic');
      return { palettes, pendingPng, before, after, playing, source: code.textContent };
    })()`);
    for (const item of result.palettes) {
      const label = `${item.preset} ${item.theme}`;
      assert.equal(item.state.preset, item.preset, label);
      assert.equal(item.state.theme, item.theme, label);
      assert.equal(item.state.time, 6, label);
      assert.equal(item.state.playing, false, label);
      assert.equal(item.activeTimeline, true, label);
      for (const region of ['chrome', 'letterbox', 'canvasBg', 'codeBg']) assert.deepEqual(item[region], item.expectedBg, `${label} ${region}`);
      assert.deepEqual(item.node, item.expectedNode, label);
      assert.deepEqual(item.ink, item.expectedInk, label);
      assert.ok(item.colored > 8, `${label} exports syntax-colored glyphs`);
    }
    assert.equal(new Set(result.palettes.map(item => item.caption)).size, 8);
    assert.equal(new Set(result.palettes.map(item => String(item.keywordColor))).size, 8);
    const capturedBg = result.palettes.at(-1).expectedBg;
    assert.deepEqual(result.pendingPng, [capturedBg, capturedBg], 'canvas and letterbox use the same preset captured at export start');
    assert.equal(result.source, '  const markup = "<tag>&";');
    assert.equal(result.playing, true);
    assert.ok(Math.abs(result.before - result.after) < 5, 'switching while playing does not restart or reseek the animation');
  });
  const stageCheck = await evalJs(`(async () => {
    window.ArchifyStoryStage.pause();
    window.ArchifyStoryStage.seek(6.0);
    window.ArchifyStoryStage.setTheme('light');
    const state = window.ArchifyStoryStage.state();
    const pngBlob = await window.ArchifyStoryStage.exportPNG({ time: 6.0 });
    const bmp = await createImageBitmap(pngBlob);
    const pngDims = { width: bmp.width, height: bmp.height };
    bmp.close();
    let controlsLocked = false;
    let overlappingExport;
    const controls = [...document.querySelectorAll('.stage-toolbar button:not(.preset-option),#stage-play,#stage-replay,#stage-range,.stage-step')];
    const presetButton = document.getElementById('stage-preset');
    presetButton.click();
    const presetOpenBeforeExport = presetButton.getAttribute('aria-expanded') === 'true';
    const vidBlob = await window.ArchifyStoryStage.exportVideo({ format: 'webm', start: 2, seconds: 5, fps: 1, onProgress: ev => {
      if (ev.frame === 1) {
        controlsLocked = controls.every(el => el.disabled) && presetButton.getAttribute('aria-expanded') === 'false';
        document.getElementById('stage-theme').click();
        presetButton.click();
        document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'s',bubbles:true}));
        document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'e',bubbles:true}));
        controlsLocked = controlsLocked && document.getElementById('stage-export').getAttribute('aria-expanded') === 'false';
        window.ArchifyStoryStage.setTheme('dark');
        window.ArchifyStoryStage.setPreset('blueprint');
        document.getElementById('stage-replay').click();
        document.dispatchEvent(new KeyboardEvent('keydown', {code:'Space',bubbles:true}));
        controlsLocked = controlsLocked && !window.ArchifyStoryStage.state().playing;
        overlappingExport = window.ArchifyStoryStage.exportVideo({ format: 'webm', start: 0, seconds: 0.1, fps: 10 })
          .then(() => null, error => error.message);
      }
    } });
    const overlapMessage = await overlappingExport;
    const themeAfterExport = window.ArchifyStoryStage.state().theme;
    const presetAfterExport = window.ArchifyStoryStage.state().preset;
    const timeAfterExport = window.ArchifyStoryStage.state().time;
    const stage = window.ArchifyStoryStage;
    const cancelDuringExport = async (startExport, cancel, signal) => {
      try {
        await startExport({
          format: 'webm', start: 4.5, seconds: 0.5, fps: 10, signal,
          onProgress: (ev) => { if (ev.frame === 1) cancel(); },
        });
        return { error: null };
      } catch (error) {
        return { error: error.name, time: stage.state().time, unlocked: controls.every(el => !el.disabled) };
      }
    };
    const controller = new AbortController();
    const writer = { write: async () => {} };
    const cancellations = {
      callerSignal: await cancelDuringExport(stage.exportVideo, () => controller.abort(), controller.signal),
      blob: await cancelDuringExport(stage.exportVideo, stage.cancelExport),
      writer: await cancelDuringExport(
        (options) => stage.writeVideo(writer, options), stage.cancelExport, new AbortController().signal,
      ),
    };
    let invalidRangeRejected = false;
    try { await window.ArchifyStoryStage.exportVideo({start:window.ArchifyStoryStage.duration + 1,seconds:1}); }
    catch(error) { invalidRangeRejected = /range/i.test(error.message); }
    const head = [...new Uint8Array(await vidBlob.slice(0, 4).arrayBuffer())];
    const vUrl = URL.createObjectURL(vidBlob);
    const video = document.createElement('video');
    video.muted = true;
    video.src = vUrl;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebM decode timeout')), 5000);
      video.onloadeddata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('WebM decode failed')); };
    });
    const videoDims = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    // Compare decoded frames with the requested timeline stills.
    const thumbnail = document.createElement('canvas');
    thumbnail.width = 96;
    thumbnail.height = 54;
    const ctx = thumbnail.getContext('2d', { willReadFrequently: true });
    const frameSample = (source, x = 0, width = thumbnail.width) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, thumbnail.width, thumbnail.height);
      ctx.drawImage(source, x, 0, width, thumbnail.height);
      return ctx.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
    };
    const seekVideo = (video, time) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video seek timeout')), 5000);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.currentTime = time;
    });
    // loadeddata can precede the first frame being drawable into a canvas.
    await seekVideo(video, 0.25);
    const firstFrame = frameSample(video);
    await seekVideo(video, video.duration - 0.5);
    const lastFrame = frameSample(video);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(vUrl);
    const stills = await Promise.all(${JSON.stringify(lightStills.map(still => toDataUri(still.path)))}.map(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const width = thumbnail.height * img.width / img.height;
      return frameSample(img, (thumbnail.width - width) / 2, width);
    }));
    const distance = (pixels, still) => pixels.reduce((sum, channel, i) => sum + Math.abs(channel - still[i]), 0);
    const frameDistances = [firstFrame, lastFrame].map(frame => stills.map(still => distance(frame, still)));
    const matchedStills = frameDistances.map(([first, second]) => first < second ? 0 : 1);
    const supportsH264 = typeof VideoEncoder !== 'undefined' && (await VideoEncoder.isConfigSupported({
      codec: 'avc1.64002a', width: 1920, height: 1080, framerate: 30, bitrate: 12000000, latencyMode: 'quality', avc: { format: 'avc' },
    })).supported;
    let silentMp4Head = null;
    if (supportsH264) {
      const originalAudioEncoder = window.AudioEncoder;
      try {
        window.AudioEncoder = undefined;
        const mp4 = await window.ArchifyStoryStage.exportVideo({format:'mp4',start:4.5,seconds:0.1,fps:10});
        silentMp4Head = new TextDecoder().decode(await mp4.slice(4,12).arrayBuffer());
      } finally { window.AudioEncoder = originalAudioEncoder; }
    }
    return { state, pngDims, head, videoDims, matchedStills, frameDistances, overlapMessage, supportsH264, silentMp4Head, themeAfterExport, presetAfterExport, timeAfterExport, presetOpenBeforeExport, controlsLocked, cancellations, invalidRangeRejected, controlsRestored: controls.every(el => !el.disabled) };
  })()`);

  await t.test('Stage rejects an overlapping export before it can change reader state', () => {
    assert.match(stageCheck.overlapMessage ?? '', /already running/i);
  });
  await t.test('decoded Stage video advances under reduced motion', () => {
    assert.deepEqual(stageCheck.matchedStills, [0, 1], JSON.stringify(stageCheck.frameDistances));
  });
  await t.test('Stage programmatic video cancellation restores controls and reader position', () => {
    const cancelled = { error: 'AbortError', time: stageCheck.state.time, unlocked: true };
    assert.deepEqual(stageCheck.cancellations, { callerSignal: cancelled, blob: cancelled, writer: cancelled });
  });
  assert.equal(stageCheck.state.theme, 'light');
  assert.equal(stageCheck.state.playing, false);
  assert.equal(stageCheck.themeAfterExport, 'light', 'Theme control cannot mix light and dark frames during export');
  assert.equal(stageCheck.presetAfterExport, 'classic', 'Preset API cannot mix palettes during video export');
  assert.equal(stageCheck.presetOpenBeforeExport, true);
  assert.equal(stageCheck.controlsLocked, true);
  assert.equal(stageCheck.controlsRestored, true);
  assert.equal(stageCheck.timeAfterExport, stageCheck.state.time, 'Export restores the paused reader position');
  if (stageCheck.supportsH264) assert.equal(stageCheck.silentMp4Head, 'ftypmp42', 'Stage MP4 needs no AudioEncoder');
  assert.equal(stageCheck.invalidRangeRejected, true);
  assert.equal(stageCheck.pngDims.width, 1920);
  assert.equal(stageCheck.pngDims.height, 1080);
  assert.deepEqual(stageCheck.head, [0x1a, 0x45, 0xdf, 0xa3]);
  assert.equal(stageCheck.videoDims.width, 1920);
  assert.equal(stageCheck.videoDims.height, 1080);
  assert.ok(stageCheck.videoDims.duration > 0.25);

  // 4. End-to-end CLI `archify story video` (.webm always; .mp4 when Chrome H.264 codec is compiled in)
  const webmOut = path.join(dir, 'cli-export.webm');
  const webmCli = run(['story', 'video', spec, webmOut, '--format', 'webm', '--fps', '10', '--start', '4.5', '--seconds', '0.4', '--json'], dir);
  assert.equal(webmCli.status, 0, webmCli.stdout + webmCli.stderr);
  assert.deepEqual([...fs.readFileSync(webmOut).subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);

  if (stageCheck.supportsH264) {
    const mp4Out = path.join(dir, 'cli-export.mp4');
    const mp4Cli = run(['story', 'video', spec, mp4Out, '--fps', '30', '--start', '4.5', '--seconds', '0.4', '--json'], dir);
    assert.equal(mp4Cli.status, 0, mp4Cli.stdout + mp4Cli.stderr);
    const mp4Rec = JSON.parse(mp4Cli.stdout);
    assert.equal(mp4Rec.format, 'mp4');
    assert.equal(mp4Rec.fps, 30);
    assert.equal(fs.readFileSync(mp4Out).subarray(4, 12).toString('ascii'), 'ftypmp42');
  }

  await t.test('Stage uses native Viewer toolbar paint and both menus fit at 320px and 768px', async () => {
    const nativeHtml = path.join(dir, 'native-toolbar.html');
    const rendered = run(['render', 'architecture', path.join(dir, 'before.json'), nativeHtml], dir);
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
    const navigate = async (file, theme) => {
      const url = pathToFileURL(file);
      url.searchParams.set('theme', theme);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await send('Page.navigate', { url: url.href });
      await loaded;
    };
    const paint = (theme) => evalJs(`(async () => {
      await document.fonts.ready;
      const stage = window.StoryStage;
      if (stage) stage.setTheme('${theme}');
      const themeButton = document.getElementById(stage ? 'stage-theme' : 'btn-theme');
      const presetButton = document.getElementById(stage ? 'stage-preset' : 'btn-preset');
      const exportButton = document.getElementById(stage ? 'stage-export' : 'btn-export');
      exportButton.click();
      const menu = exportButton.nextElementSibling;
      const toolbar = exportButton.closest('.toolbar');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.allSettled(toolbar.getAnimations({ subtree: true }).map(animation => animation.finished));
      const style = (node, props, pseudo) => props.map(prop => getComputedStyle(node, pseudo).getPropertyValue(prop));
      const buttonPaint = node => style(node, ['color', 'border-radius', 'border-width', 'font-size', 'font-weight', 'padding', 'height']);
      return {
        toolbar: style(toolbar, ['gap', 'align-items']),
        group: style(themeButton.parentElement, ['background-color', 'border-color', 'box-shadow', 'border-radius'], '::before'),
        theme: buttonPaint(themeButton),
        themeTrack: style(themeButton, ['background-color', 'border-radius', 'box-shadow', 'inset'], '::before'),
        themeThumb: style(themeButton, ['background-color', 'border-radius', 'box-shadow', 'left', 'width'], '::after'),
        themeIcon: style(themeButton.querySelector('.toolbar-icon'), ['mask-image', 'color']),
        preset: buttonPaint(presetButton),
        presetMark: style(presetButton.querySelector('.preset-control-mark'), ['border-color', 'background-color', 'border-radius']),
        export: buttonPaint(exportButton),
        exportFill: style(exportButton, ['background-color', 'border-radius', 'box-shadow'], '::before'),
        chevron: style(exportButton.querySelector('.toolbar-chevron'), ['mask-image', 'transform']),
        menu: style(menu, ['background-color', 'border-color', 'box-shadow', 'border-radius', 'width', 'padding']),
        header: style(menu.querySelector('.export-menu-header'), ['padding', 'gap', 'display', 'align-items']),
        shortcut: style(menu.querySelector('kbd'), ['background-color', 'border-color', 'color', 'font-size']),
        png: buttonPaint(menu.querySelector('[data-format="png"]')),
        pngIcon: style(menu.querySelector('[data-format="png"]'), ['mask-image', 'color'], '::before'),
        videoIcon: style(menu.querySelector('[data-format="webm"]'), ['mask-image', 'color'], '::before'),
      };
    })()`);
    await send('Network.setBlockedURLs', { urls: [] });
    for (const theme of BAKE_THEMES) {
      await navigate(nativeHtml, theme);
      const nativePaint = await paint(theme);
      await navigate(stageHtml, theme);
      assert.deepEqual(await paint(theme), nativePaint, `Classic ${theme} toolbar paint`);
    }
    for (const width of [320, 768]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: false });
      await navigate(stageHtml, 'light');
      const boxes = await evalJs(`(() => {
        const toolbar = document.querySelector('.stage-toolbar');
        const box = node => {
          const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
          return { left, right, top, bottom, width, height };
        };
        return [box(toolbar), ...['stage-preset', 'stage-export'].map(id => {
          const trigger = document.getElementById(id);
          trigger.click();
          return box(trigger.nextElementSibling);
        })];
      })()`);
      for (const box of boxes) {
        assert.ok(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= width
          && box.top >= 0 && box.bottom <= 640, `${width}px viewport includes ${JSON.stringify(box)}`);
      }
    }
  });
});

test('Story Stage seeks by pointer and keyboard at 320px and 768px', { skip: !chrome }, async (t) => {
  const dir = createScratchDirectory(path.join(os.tmpdir(), 'archify-story-seek-'));
  const spec = buildChoreographySample(dir);
  const stageHtml = path.join(dir, 'stage.html');
  const stage = run(['story', 'stage', spec, stageHtml], dir);
  assert.equal(stage.status, 0, stage.stdout + stage.stderr);

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const read = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.text);
    return result.result.value;
  };
  for (const width of [320, 768]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(stageHtml).href });
    await loaded;
    const target = await read(`(() => {
      const slider = document.getElementById('stage-range');
      slider.scrollIntoView({ block: 'nearest' });
      const box = slider.getBoundingClientRect();
      return { width: box.width, x: box.left + 0.8 * box.width, y: box.top + box.height / 2, value: Number(slider.value) };
    })()`);
    assert.ok(target.width >= 100, `${width}px viewport has a usable seek track`);
    const { x, y } = target;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    const clicked = await read("Number(document.getElementById('stage-range').value)");
    assert.ok(clicked > target.value, `${width}px viewport can seek by clicking the track`);
    assert.equal(await read('document.activeElement.id'), 'stage-range');
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    }
    assert.ok(await read("Number(document.getElementById('stage-range').value)") > clicked,
      `${width}px viewport can continue seeking with the arrow key`);
  }
});

test('choreography preserves revisits, successive labels, parallel travel, initial focus and finite playback', { skip: !chrome }, async (t) => {
  const dir = createScratchDirectory(path.join(os.tmpdir(), 'archify-story-motion-'));
  buildChoreographySample(dir);
  const diagramPath = path.join(dir, 'before.json');
  const diagram = JSON.parse(fs.readFileSync(diagramPath, 'utf8'));
  diagram.components.push({ id: 'audit', type: 'backend', label: 'Audit', pos: [60, 320], size: [140, 60] });
  diagram.connections.push({ id: 'audit_call', from: 'api', to: 'audit', label: 'audit()', labelAt: [165, 245] });
  fs.writeFileSync(diagramPath, JSON.stringify(diagram));
  const native = path.join(dir, 'native.html');
  const rendered = run(['render', 'architecture', diagramPath, native], dir);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const styles = loadViewerStyles();
  const baked = bakeSvg(extractCanonicalSvg(fs.readFileSync(native, 'utf8')), { theme: 'light', preset: 'classic', styles });
  const bakedViews = new Map(['main', 'other'].map(id => [id, new Map([['light', baked]])]));
  const views = ['main', 'other'].map(id => ({ id, type: 'architecture', input: 'before.json' }));
  const compile = (spec) => createCompiledStoryTheme({
    plan: normalizeChoreographySpec({ schema_version: 1, views, ...spec }, {
      declaredViews: ['main', 'other'], loadSourceLines: () => ['const result = 1;'],
    }), bakedViews, viewTypes: new Map(views.map(v => [v.id, v.type])), theme: 'light', styles,
  });
  const beat = { view: 'main', at: 0, title: 'Overview', body: 'Explain the current structure.' };
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session, 60000);
  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(res.exceptionDetails, undefined, res.exceptionDetails?.exception?.description || res.exceptionDetails?.text);
    return res.result?.value;
  };
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  let sampleIndex = 0;
  const sample = async (svg, seconds, expression) => {
    const file = path.join(dir, `sample-${sampleIndex++}.svg`);
    fs.writeFileSync(file, svg);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await loaded;
    return evalJs(`(async () => {
      await document.fonts.ready;
      for (const anim of document.documentElement.getAnimations({subtree:true})) { anim.pause(); anim.currentTime = ${seconds * 1000}; }
      await new Promise(requestAnimationFrame);
      ${expression}
    })()`);
  };

  await t.test('returning to a view hides it during the intervening scene', async () => {
    const compiled = compile({ duration: 12, steps: [beat, { ...beat, view: 'other', at: 4 }, { ...beat, at: 8 }] });
    for (const [at, visible, hidden] of [[2, 'main', 'other'], [6, 'other', 'main'], [10, 'main', 'other']]) {
      const state = await sample(compiled.renderAnimatedSvg().svg, at, `return ['main','other'].map(id => [id,Number(getComputedStyle(document.getElementById('view-'+id)).opacity)]);`);
      const opacity = Object.fromEntries(state);
      assert.ok(opacity[visible] > 0.99 && opacity[hidden] < 0.01, JSON.stringify({at, opacity}));
    }
    const still = await sample(compiled.renderStillSvg(6).svg, 0, "return Number(getComputedStyle(document.getElementById('view-main')).opacity);");
    assert.equal(still, 0, 'Static output follows the same disjoint scene windows');
  });

  await t.test('successive relabels retire the previous label and subtitle', async () => {
    const compiled = compile({ duration: 10, steps: [beat], relabel: [
      { view: 'main', node: 'api', at: 1, label: 'API', subtitle: 'version one' },
      { view: 'main', node: 'api', at: 5, label: 'Edge API', subtitle: 'version two' },
    ] });
    const read = "return [...document.querySelectorAll('#view-main [data-node-id=api] text')].filter(el=>Number(getComputedStyle(el).opacity)>.99).map(el=>el.textContent);";
    const animated = await sample(compiled.renderAnimatedSvg().svg, 7, read);
    const still = await sample(compiled.renderStillSvg(7).svg, 0, read);
    for (const labels of [animated, still]) {
      assert.ok(labels.includes('Edge API') && labels.includes('version two'), JSON.stringify(labels));
      assert.ok(!labels.includes('API') && !labels.includes('version one'), JSON.stringify(labels));
    }
  });

  await t.test('parallel tokens finish their own edge travel', async () => {
    const compiled = compile({ duration: 5, steps: [{ ...beat, trace: { action: 'parallel', edges: ['sync_send', 'audit_call'], travel: 1.4 } }] });
    const tokens = await sample(compiled.renderAnimatedSvg().svg, 1.2, "return [...document.querySelectorAll('[data-story-token]')].map(el=>({opacity:Number(getComputedStyle(el).opacity),distance:parseFloat(getComputedStyle(el).offsetDistance)}));");
    assert.equal(tokens.length, 2);
    assert.ok(tokens.every(token => token.opacity > 0.99 && token.distance > 0 && token.distance < 100), JSON.stringify(tokens));
  });

  await t.test('time-zero focus applies to both animation and still', async () => {
    const base = { duration: 6, steps: [beat] };
    const wide = await sample(compile(base).renderStillSvg(0).svg, 0, "return getComputedStyle(document.getElementById('camera-main')).transform;");
    const focused = compile({ ...base, focus: [{ view: 'main', nodes: ['audit'], at: 0 }] });
    const read = "return getComputedStyle(document.getElementById('camera-main')).transform;";
    const animated = await sample(focused.renderAnimatedSvg().svg, 0, read);
    const still = await sample(focused.renderStillSvg(0).svg, 0, read);
    assert.notEqual(animated, wide, 'Initial focus must not leave the wide camera unchanged');
    assert.equal(still, animated);
  });

  await t.test('non-looping output holds its ending after one playback', async () => {
    const compiled = compile({ duration: 6, loop: false, steps: [beat, { ...beat, at: 3, title: 'Ending' }] });
    const state = await sample(compiled.renderAnimatedSvg().svg, 7, "return {iterations:[...document.documentElement.getAnimations({subtree:true})].map(a=>a.effect.getTiming().iterations),ending:Number(getComputedStyle(document.getElementById('story-caption-1')).opacity)};");
    assert.ok(state.iterations.length > 0);
    assert.ok(state.iterations.every(n => n === 1), JSON.stringify(state));
    assert.equal(state.ending, 1);
  });

  await t.test('an explicit short beat closes its detail and caption during a gap', async () => {
    const compiled = compile({ duration: 20, steps: [
      { ...beat, duration: 3, detail: { nodes: ['api'], title: 'Source', path: 'worker.mjs', lines: [1] } },
      { ...beat, at: 10, duration: 4, title: 'Next' },
    ] });
    const state = await sample(compiled.renderAnimatedSvg().svg, 6, "return {detail:Number(getComputedStyle(document.getElementById('story-source-detail')).opacity),caption:Number(getComputedStyle(document.getElementById('story-caption-0')).opacity)};");
    assert.deepEqual(state, { detail: 0, caption: 0 });
  });

  await t.test('shared nodes retain source relabels, metrics and camera motion', async () => {
    const compiled = compile({ duration: 10, steps: [beat, { ...beat, view: 'other', at: 4 }],
      transitions: [{ from: 'main', to: 'other', at: 4, shared: [{ id: 'api' }] }],
      focus: [{ view: 'main', nodes: ['api'], at: 1 }],
      relabel: [{ view: 'main', node: 'api', label: 'Reviewed API', at: 1 }],
      metrics: [{ view: 'main', node: 'api', label: 'Complexity', before: 2, after: 6, at: 1 }],
    });
    const state = await sample(compiled.renderAnimatedSvg().svg, 2.8, `
      const shared = document.querySelector('.story-shared-layer [data-node-id=api]');
      const native = document.querySelector('#view-main [data-node-id=api]');
      const box = group => {const r = group.querySelector('rect').getBoundingClientRect(); return [r.x,r.y,r.width,r.height];};
      return { sharedBox:box(shared), nativeBox:box(native), labels:[...shared.querySelectorAll('text')].filter(el=>Number(getComputedStyle(el).opacity)>.99 && Number(getComputedStyle(el.parentElement).opacity)>.99).map(el=>el.textContent) };
    `);
    for (let i = 0; i < state.sharedBox.length; i++) assert.ok(Math.abs(state.sharedBox[i]-state.nativeBox[i]) < 0.1, JSON.stringify(state));
    assert.ok(state.labels.includes('Reviewed API'), JSON.stringify(state));
    assert.ok(state.labels.includes('2 → 6'), JSON.stringify(state));
    assert.ok(!state.labels.includes('2'), JSON.stringify(state));
  });

  await t.test('sampled stills match eased animated frames between keyframes', async () => {
    const compiled = compile({ duration: 6, steps: [beat], enter: [{ view: 'main', nodes: ['api'], at: 1 }] });
    const read = "const s=getComputedStyle(document.querySelector('#view-main [data-node-id=api]')); return {opacity:Number(s.opacity),transform:s.transform};";
    const animated = await sample(compiled.renderAnimatedSvg().svg, 1.2625, read);
    const still = await sample(compiled.renderStillSvg(1.2625).svg, 0, read);
    assert.ok(Math.abs(animated.opacity-still.opacity) < 0.002, JSON.stringify({animated,still}));
    const matrix = value => value.match(/-?[\d.]+/g).map(Number);
    assert.ok(matrix(animated.transform).every((n,i)=>Math.abs(n-matrix(still.transform)[i]) < 0.02), JSON.stringify({animated,still}));
  });
});
