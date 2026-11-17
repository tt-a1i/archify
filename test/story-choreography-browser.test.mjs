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
import { bakeSvg, extractCanonicalSvg, loadViewerStyles } from '../archify/story/svg-bake.mjs';

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
    let controlsLocked = false;
    let overlappingExport;
    const controls = [...document.querySelectorAll('#stage-theme,#stage-play,#stage-replay,#stage-range,.stage-step')];
    const vidBlob = await window.ArchifyStoryStage.exportVideo({ format: 'webm', start: 2, seconds: 5, fps: 1, onProgress: ev => {
      if (ev.frame === 1) {
        controlsLocked = controls.every(el => el.disabled);
        document.getElementById('stage-theme').click();
        document.getElementById('stage-replay').click();
        document.dispatchEvent(new KeyboardEvent('keydown', {code:'Space',bubbles:true}));
        controlsLocked = controlsLocked && !window.ArchifyStoryStage.state().playing;
        overlappingExport = window.ArchifyStoryStage.exportVideo({ format: 'webm', start: 0, seconds: 0.1, fps: 10 })
          .then(() => null, error => error.message);
      }
    } });
    const overlapMessage = await overlappingExport;
    const themeAfterExport = window.ArchifyStoryStage.state().theme;
    const timeAfterExport = window.ArchifyStoryStage.state().time;
    const controller = new AbortController();
    let cancelled = false;
    try {
      await window.ArchifyStoryStage.exportVideo({format:'webm',start:4.5,seconds:0.5,fps:10,signal:controller.signal,onProgress:ev=>{if(ev.frame===1)controller.abort();}});
    } catch(error) { cancelled = error.name === 'AbortError'; }
    const cancelRestored = cancelled && window.ArchifyStoryStage.state().time === state.time && controls.every(el=>!el.disabled);
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
    const firstFrame = frameSample(video);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebM seek timeout')), 5000);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.currentTime = video.duration - 0.5;
    });
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
    const matchedStills = [firstFrame, lastFrame].map(frame => distance(frame, stills[0]) < distance(frame, stills[1]) ? 0 : 1);
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
    return { state, pngDims, head, videoDims, matchedStills, overlapMessage, supportsH264, silentMp4Head, themeAfterExport, timeAfterExport, controlsLocked, cancelRestored, invalidRangeRejected, controlsRestored: controls.every(el => !el.disabled) };
  })()`);

  await t.test('Stage rejects an overlapping export before it can change reader state', () => {
    assert.match(stageCheck.overlapMessage ?? '', /already running/i);
  });
  await t.test('decoded Stage video advances under reduced motion', () => {
    assert.deepEqual(stageCheck.matchedStills, [0, 1]);
  });
  assert.equal(stageCheck.state.theme, 'light');
  assert.equal(stageCheck.state.playing, false);
  assert.equal(stageCheck.themeAfterExport, 'light', 'Theme control cannot mix light and dark frames during export');
  assert.equal(stageCheck.controlsLocked, true);
  assert.equal(stageCheck.controlsRestored, true);
  assert.equal(stageCheck.cancelRestored, true);
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
