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
  const spec = path.join(dir, 'choreo.json');
  fs.writeFileSync(spec, JSON.stringify({
    schema_version: 1,
    kind: 'story-choreography',
    id: 'browser-demo',
    title: 'Async Queue Choreography',
    chrome: 'story',
    stills: [7.5],
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
  const lightStill = svgJson.stills.find((s) => s.theme === 'light').path;

  const hostHtml = path.join(dir, 'host.html');
  const toDataUri = (f) => `data:image/svg+xml;base64,${fs.readFileSync(f).toString('base64')}`;
  fs.writeFileSync(hostHtml, `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <img id="img-light" src="${toDataUri(lightSvg)}" alt="light">
    <img id="img-dark" src="${toDataUri(darkSvg)}" alt="dark">
    <img id="img-still" src="${pathToFileURL(lightStill).href}" alt="still">
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
      stageOpacity: getComputedStyle(stage).opacity,
      enteredOpacity: getComputedStyle(entered).opacity,
      enteredVisibility: getComputedStyle(entered).visibility,
      tokenDisplay: tok ? getComputedStyle(tok).display : 'none',
      maxCaptionBottom: Math.max(...captionRects),
    };
  })()`);
  assert.equal(reduced.stageOpacity, '1');
  assert.equal(reduced.enteredOpacity, '1');
  assert.equal(reduced.enteredVisibility, 'visible');
  assert.equal(reduced.tokenDisplay, 'none');
  assert.ok(reduced.maxCaptionBottom <= 112, `caption bottom ${reduced.maxCaptionBottom} must stay above 112px viewport`);

  const nativeColors = `svg => [...svg.querySelectorAll('[data-node-id] text')].map(el => ({ text: el.textContent, fill: getComputedStyle(el).fill }))`;
  const expectedColors = { light: await evalJs(`(${nativeColors})(document.documentElement)`) };
  loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(darkSvg).href }); await loaded;
  expectedColors.dark = await evalJs(`(${nativeColors})(document.documentElement)`);

  // 3. Interactive ArchifyStoryStage PNG & 1080p video export (WebM always, MP4 when H.264 supported)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(stageHtml).href });
  await loaded;
  for (const theme of ['light', 'dark']) {
    const actualColors = await evalJs(`(() => { window.ArchifyStoryStage.pause(); window.ArchifyStoryStage.setTheme('${theme}'); return (${nativeColors})(document.querySelector('.stage-pane.is-active > svg')); })()`);
    assert.deepEqual(actualColors, expectedColors[theme], `${theme} native diagram colors match the standalone SVG without contamination from the other pane`);
  }
  const stageCheck = await evalJs(`(async () => {
    window.ArchifyStoryStage.pause();
    window.ArchifyStoryStage.seek(6.0);
    window.ArchifyStoryStage.setTheme('light');
    const state = window.ArchifyStoryStage.state();
    const pngBlob = await window.ArchifyStoryStage.exportPNG({ time: 6.0 });
    const bmp = await createImageBitmap(pngBlob);
    const pngDims = { width: bmp.width, height: bmp.height };
    bmp.close();
    const vidBlob = await window.ArchifyStoryStage.exportVideo({ format: 'webm', start: 4.5, seconds: 0.5, fps: 10, onProgress: ev => {
      if (ev.frame === 1) document.getElementById('stage-theme').click();
    } });
    const themeAfterExport = window.ArchifyStoryStage.state().theme;
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
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(vUrl);
    const supportsH264 = typeof VideoEncoder !== 'undefined' && (await VideoEncoder.isConfigSupported({
      codec: 'avc1.64002a', width: 1920, height: 1080, framerate: 30, bitrate: 12000000, latencyMode: 'quality', avc: { format: 'avc' },
    })).supported;
    return { state, pngDims, head, videoDims, supportsH264, themeAfterExport, invalidRangeRejected, themeControlRestored: !document.getElementById('stage-theme').disabled };
  })()`);

  assert.equal(stageCheck.state.theme, 'light');
  assert.equal(stageCheck.state.playing, false);
  assert.equal(stageCheck.themeAfterExport, 'light', 'Theme control cannot mix light and dark frames during export');
  assert.equal(stageCheck.themeControlRestored, true);
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
});
