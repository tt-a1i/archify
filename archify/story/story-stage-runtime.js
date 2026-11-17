(() => {
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const DEFAULT_FPS = 60;
  const FRAMES_PER_READ = 4;
  const FRAME_BYTES = WIDTH * HEIGHT * 4;
  const VIDEO_BITRATE = 12000000;
  const MAX_BUFFERED_BYTES = 512 * 1024 * 1024;
  const RESERVE_BYTES = 32 * 1024 * 1024;
  const FORMATS = {
    mp4: { videoCodec: 'avc1.64002a', mime: 'video/mp4', ext: '.mp4' },
    webm: { videoCodec: 'vp09.00.41.08', mime: 'video/webm', ext: '.webm' },
  };
  const ANIM_PROPS = [
    'opacity', 'visibility', 'transform', 'transform-origin', 'transform-box',
    'stroke-dasharray', 'stroke-dashoffset', 'marker-end',
    'offset-path', 'offset-distance', 'offset-rotate', 'display',
  ];

  const meta = JSON.parse(document.getElementById('story-stage-meta').textContent);
  const labels = meta.labels || {};
  const playBtn = document.getElementById('stage-play');
  const replayBtn = document.getElementById('stage-replay');
  const themeBtn = document.getElementById('stage-theme');
  const pngBtn = document.getElementById('stage-export-png');
  const mp4Btn = document.getElementById('stage-export-mp4');
  const webmBtn = document.getElementById('stage-export-webm');
  const range = document.getElementById('stage-range');
  const clock = document.getElementById('stage-clock');
  const statusEl = document.getElementById('stage-status');
  const stepButtons = [...document.querySelectorAll('.stage-step')];
  const panes = {
    light: document.querySelector('.stage-pane[data-stage-theme="light"]'),
    dark: document.querySelector('.stage-pane[data-stage-theme="dark"]'),
  };

  let currentTheme = meta.defaultTheme;
  let playing = true;
  let currentTime = 0;
  let activeJob = null;

  const activeSvg = () => panes[currentTheme]?.querySelector('svg') || null;
  const allAnims = (svg) => (svg ? svg.getAnimations({ subtree: true }) : []);
  const abortCheck = (signal) => {
    if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
  };

  function makeCanvas(rows = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT * rows;
    return canvas;
  }

  function resolveActiveStepIndex(wrappedTime) {
    let activeStep = 0;
    for (let i = 0; i < meta.steps.length; i += 1) {
      if (wrappedTime >= meta.steps[i].at - 0.05) activeStep = i;
    }
    return activeStep;
  }

  function syncUi(time) {
    const wrapped = meta.loop && meta.duration > 0
      ? (time % meta.duration)
      : Math.min(meta.duration, Math.max(0, time));
    currentTime = wrapped;
    range.value = wrapped.toFixed(2);
    clock.textContent = `${wrapped.toFixed(1)}s / ${meta.duration.toFixed(1)}s`;
    const activeStep = resolveActiveStepIndex(wrapped);
    stepButtons.forEach((btn, idx) => btn.classList.toggle('is-active', idx === activeStep));
    playBtn.textContent = playing ? labels.pause : labels.play;
    playBtn.setAttribute('aria-pressed', String(playing));
    themeBtn.textContent = currentTheme === 'dark' ? labels.themeLight : labels.themeDark;
  }

  function applyTime(time, shouldPlay) {
    const clamped = Math.max(0, Math.min(meta.duration, time));
    const ms = clamped * 1000;
    for (const anim of allAnims(activeSvg())) {
      anim.currentTime = ms;
      if (shouldPlay) anim.play();
      else anim.pause();
    }
    syncUi(clamped);
  }

  function tick() {
    if (playing) {
      const first = allAnims(activeSvg())[0];
      if (first && Number.isFinite(first.currentTime)) syncUi(first.currentTime / 1000);
    }
    requestAnimationFrame(tick);
  }

  function play() { playing = true; applyTime(currentTime, true); }
  function pause() { playing = false; applyTime(currentTime, false); }
  function seek(seconds) { applyTime(seconds, playing); }

  function setTheme(theme) {
    if (!panes[theme]) return;
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    panes.light.classList.toggle('is-active', theme === 'light');
    panes.dark.classList.toggle('is-active', theme === 'dark');
    applyTime(currentTime, playing);
  }

  // Matches story-export.js: check whether `[style]` selectors could collide with
  // @layer rules and preserve loaded @font-face rules inside serialized SVG frames.
  function inspectDocumentCaptureSupport() {
    let allowLayer = typeof CSSLayerBlockRule !== 'undefined';
    const fonts = [];
    for (const sheet of document.styleSheets || []) {
      try {
        const rules = [...sheet.cssRules];
        if (rules.some((rule) => /\[\s*style\b/i.test(rule.cssText))) allowLayer = false;
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) fonts.push(rule.cssText);
        }
      } catch {
        allowLayer = false;
      }
    }
    return { allowLayer, fontCss: fonts.join('\n') };
  }

  function buildFrozenPropertyCss(src, baseCss) {
    const computed = getComputedStyle(src);
    let css = baseCss;
    for (const prop of ANIM_PROPS) {
      const raw = computed.getPropertyValue(prop);
      if (!raw) continue;
      const normalized = raw.replace(/url\(["']?[^)#]*#([^)'" ]+)["']?\)/g, 'url(#$1)');
      css += `${prop}:${normalized}!important;`;
    }
    return `${css}animation:none!important;transition:none!important;`;
  }

  function applyFrozenStyle(dst, css, share, groups) {
    if (!share) {
      dst.setAttribute('style', css);
      return;
    }
    let id = groups.get(css);
    if (id === undefined) {
      id = groups.size;
      groups.set(css, id);
    }
    for (const key of [...dst.style]) {
      if (ANIM_PROPS.includes(key) || key.startsWith('animation-') || key.startsWith('transition-')) {
        dst.style.removeProperty(key);
      }
    }
    dst.setAttribute('data-archify-capture', id);
  }

  function freezeSvgClone(svg, support, drawW, drawH) {
    const copy = svg.cloneNode(true);
    const sources = [svg, ...svg.querySelectorAll('*')];
    const copies = [copy, ...copy.querySelectorAll('*')];
    const share = support.allowLayer && !sources.some((node) => node.hasAttribute('data-archify-capture'));
    const groups = new Map();

    for (let i = 1; i < sources.length; i += 1) {
      const src = sources[i];
      const dst = copies[i];
      if (!src.getAnimations().length && !src.id && !src.hasAttribute('style')) continue;
      const baseCss = share ? '' : (dst.getAttribute('style') ? `${dst.getAttribute('style')};` : '');
      applyFrozenStyle(dst, buildFrozenPropertyCss(src, baseCss), share, groups);
    }

    const layerRules = share && groups.size
      ? `@layer{${[...groups].map(([css, id]) => `[data-archify-capture="${id}"]{${css}}`).join('')}}`
      : '';
    const styleText = [support.fontCss, layerRules].filter(Boolean).join('\n');
    if (styleText) {
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl.textContent = styleText;
      copy.insertBefore(styleEl, copy.firstChild);
    }

    copy.setAttribute('width', String(drawW));
    copy.setAttribute('height', String(drawH));
    return copy;
  }

  function createStageCapturer() {
    const serializer = new XMLSerializer();
    const scale = Math.min(WIDTH / 960, HEIGHT / 560);
    const drawW = Math.round(960 * scale);
    const drawH = Math.round(560 * scale);
    const dx = Math.round((WIDTH - drawW) / 2);
    const dy = Math.round((HEIGHT - drawH) / 2);
    const support = inspectDocumentCaptureSupport();

    return async (targetCanvas, timeSec, offsetY = 0) => {
      const svg = activeSvg();
      applyTime(timeSec, false);
      const copy = freezeSvgClone(svg, support, drawW, drawH);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializer.serializeToString(copy))}`;
      try {
        await img.decode();
        const ctx = targetCanvas.getContext('2d', { willReadFrequently: false });
        const bg = svg.querySelector(':scope > rect[fill]')?.getAttribute('fill')
          || (currentTheme === 'dark' ? '#0f172a' : '#ffffff');
        ctx.fillStyle = bg;
        ctx.fillRect(0, offsetY, WIDTH, HEIGHT);
        ctx.drawImage(img, dx, offsetY + dy, drawW, drawH);
      } finally {
        img.src = '';
      }
    };
  }

  async function exportPNG({ time = currentTime, signal } = {}) {
    abortCheck(signal);
    const wasPlaying = playing;
    playing = false;
    const canvas = makeCanvas(1);
    try {
      await createStageCapturer()(canvas, time, 0);
      abortCheck(signal);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode PNG.'))), 'image/png');
      });
    } finally {
      canvas.width = canvas.height = 1;
      if (wasPlaying) play();
    }
  }

  function validateVideoRequest({ start, seconds, fps, format }, writer) {
    const selected = Object.hasOwn(FORMATS, format) && FORMATS[format];
    if (!selected) throw Error('Choose MP4 or WebM.');
    if (!Number.isFinite(start) || !Number.isFinite(seconds) || start < 0 || seconds <= 0 || !Number.isFinite(fps) || fps < 1) {
      throw Error('Invalid video export range or frame rate.');
    }
    if (!writer && RESERVE_BYTES + (seconds * VIDEO_BITRATE) / 8 > MAX_BUFFERED_BYTES) {
      throw Error('Video exceeds the in-memory buffer budget; stream to a file or choose a shorter range.');
    }
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw Error('Video export requires a browser with WebCodecs VideoEncoder.');
    }
    return { selected, frames: Math.max(1, Math.ceil(seconds * fps)) };
  }

  async function selectSupportedVideoConfig(selected, format, fps) {
    const config = {
      codec: selected.videoCodec,
      width: WIDTH,
      height: HEIGHT,
      framerate: fps,
      bitrate: VIDEO_BITRATE,
      latencyMode: 'quality',
      ...(format === 'mp4' ? { avc: { format: 'avc' } } : {}),
    };
    if (!(await VideoEncoder.isConfigSupported(config)).supported) {
      throw Error(format === 'mp4'
        ? 'This browser cannot encode H.264 for MP4. Try Google Chrome/Edge or select WebM.'
        : 'This browser cannot encode VP9 for WebM.');
    }
    return config;
  }

  function createEncoderDrain(encoder, mux, check, isDone, setWake) {
    return async () => {
      check();
      while (encoder.encodeQueueSize >= 4) {
        await new Promise((resolve) => {
          const ready = () => {
            encoder.removeEventListener('dequeue', ready);
            setWake(null);
            resolve();
          };
          setWake(ready);
          encoder.addEventListener('dequeue', ready, { once: true });
          if (isDone() || encoder.state === 'closed' || encoder.encodeQueueSize < 4) ready();
        });
        check();
      }
      await mux.drain();
    };
  }

  async function encodeFrameBatch({ base, count, frames, start, fps, capture, target, encoder, drain, check, onProgress }) {
    for (let offset = 0; offset < count; offset += 1) {
      check();
      await capture(target, start + (base + offset) / fps, offset * HEIGHT);
    }
    check();
    const pixels = target.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT * count).data;
    for (let index = base; index < base + count; index += 1) {
      check();
      const timestamp = Math.round((index * 1e6) / fps);
      const next = Math.round(((index + 1) * 1e6) / fps);
      const at = (index - base) * FRAME_BYTES;
      const frame = new VideoFrame(pixels.subarray(at, at + FRAME_BYTES), {
        format: 'RGBA',
        codedWidth: WIDTH,
        codedHeight: HEIGHT,
        timestamp,
        duration: next - timestamp,
        colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
      });
      try {
        encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      } finally {
        frame.close();
      }
      await drain();
      onProgress({ fraction: ((index + 1) / frames) * 0.98, frame: index + 1, frames });
    }
  }

  async function encodeVideo({
    start = 0,
    seconds = Math.max(0.5, meta.duration - start),
    fps = DEFAULT_FPS,
    format = 'mp4',
    onProgress = () => {},
    signal,
  } = {}, writer) {
    const { selected, frames } = validateVideoRequest({ start, seconds, fps, format }, writer);
    const vc = await selectSupportedVideoConfig(selected, format, fps);

    abortCheck(signal);
    const wasPlaying = playing;
    pause();
    const target = makeCanvas(FRAMES_PER_READ);
    const capture = createStageCapturer();
    let encoder, mux, failure, wake;
    const check = () => { abortCheck(signal); if (failure) throw failure; };
    const failed = (error) => { failure ??= error; wake?.(); };
    const cancel = () => { if (encoder && encoder.state !== 'closed') encoder.close(); wake?.(); };

    try {
      mux = StoryContainer.open({
        format, audio: false, width: WIDTH, height: HEIGHT, fps, frames, samples: 0,
        duration: seconds, audioBitrate: 0, writer, maxBytes: MAX_BUFFERED_BYTES, check,
      });
      encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          if (failure || signal?.aborted) return;
          try { mux.add('video', chunk, metadata); } catch (err) { failed(err); }
        },
        error: failed,
      });
      signal?.addEventListener('abort', cancel, { once: true });
      check();
      encoder.configure(vc);
      const drain = createEncoderDrain(
        encoder,
        mux,
        check,
        () => Boolean(failure || signal?.aborted),
        (fn) => { wake = fn; },
      );

      for (let base = 0; base < frames; base += FRAMES_PER_READ) {
        const count = Math.min(FRAMES_PER_READ, frames - base);
        await encodeFrameBatch({ base, count, frames, start, fps, capture, target, encoder, drain, check, onProgress });
      }
      await encoder.flush();
      check();
      const result = await mux.finish();
      check();
      onProgress({ fraction: 1, frame: frames, frames });
      return result;
    } catch (error) {
      check();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      cancel();
      await mux?.settle();
      target.width = target.height = 1;
      if (wasPlaying) play();
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function openOptionalSaveWriter(format, ext, filename) {
    if (typeof showSaveFilePicker !== 'function') return null;
    const mime = format === 'webm' ? 'video/webm' : 'video/mp4';
    const handle = await showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: `${format.toUpperCase()} video`, accept: { [mime]: [ext] } }],
    });
    return handle.createWritable();
  }

  async function runDownload(format) {
    if (activeJob) throw Error('A story export is already running.');
    activeJob = new AbortController();
    const signal = activeJob.signal;
    mp4Btn.disabled = webmBtn.disabled = pngBtn.disabled = true;
    const prev = statusEl.textContent;
    const ext = format === 'webm' ? '.webm' : '.mp4';
    const filename = `story-${currentTheme}-1080p${ext}`;
    statusEl.textContent = labels.exporting;
    let writer = null;
    try {
      writer = await openOptionalSaveWriter(format, ext, filename);
      const res = await encodeVideo({
        format,
        signal,
        onProgress: (ev) => { statusEl.textContent = `${labels.exporting} ${Math.round(ev.fraction * 100)}%`; },
      }, writer);
      if (writer) await writer.close();
      else downloadBlob(res, filename);
      statusEl.textContent = prev;
    } catch (error) {
      try { await writer?.abort(error); } catch {}
      statusEl.textContent = error.name === 'AbortError' ? prev : (error.message || String(error));
    } finally {
      activeJob = null;
      mp4Btn.disabled = webmBtn.disabled = pngBtn.disabled = false;
    }
  }

  requestAnimationFrame(tick);
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  replayBtn.addEventListener('click', () => { playing = true; applyTime(0, true); });
  themeBtn.addEventListener('click', () => setTheme(currentTheme === 'dark' ? 'light' : 'dark'));
  range.addEventListener('input', () => applyTime(Number(range.value), false));
  range.addEventListener('change', () => applyTime(Number(range.value), playing));
  stepButtons.forEach((btn) => btn.addEventListener('click', () => seek(Number(btn.dataset.stepAt))));
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !['INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      playing ? pause() : play();
    }
  });
  pngBtn.addEventListener('click', async () => {
    pngBtn.disabled = true;
    try { downloadBlob(await exportPNG(), `story-${currentTheme}.png`); }
    finally { pngBtn.disabled = false; }
  });
  mp4Btn.addEventListener('click', () => runDownload('mp4'));
  webmBtn.addEventListener('click', () => runDownload('webm'));

  const api = {
    play,
    pause,
    seek,
    setTheme,
    exportPNG,
    exportVideo: (options) => encodeVideo(options),
    writeVideo: (writer, options) => encodeVideo(options, writer),
    cancelExport: () => activeJob?.abort(),
    duration: meta.duration,
    defaults: { width: WIDTH, height: HEIGHT, fps: DEFAULT_FPS, format: 'mp4' },
    state: () => ({ theme: currentTheme, playing, time: currentTime, duration: meta.duration, steps: meta.steps }),
  };
  window.ArchifyStoryStage = api;
  window.StoryStage = api;
  Promise.resolve(document.fonts?.ready).finally(() => { window.storyStageReady = true; });
})();
