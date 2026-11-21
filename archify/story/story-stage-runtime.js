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
  const presetBtn = document.getElementById('stage-preset');
  const presetLabel = document.getElementById('stage-preset-label');
  const presetMenu = document.getElementById('stage-preset-menu');
  const presetOptions = presetMenu ? [...presetMenu.querySelectorAll('[data-preset-value]')] : [];
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
  const switchableSvg = document.querySelector('.stage-pane[data-stage-switchable] > svg');
  const themedSvgs = switchableSvg ? [switchableSvg, ...switchableSvg.querySelectorAll('svg[data-archify-bake]')] : [];

  let currentTheme = meta.defaultTheme;
  let currentPreset = meta.preset;
  let playing = true;
  let currentTime = 0;
  let activeJob = null;

  const activeSvg = () => switchableSvg || panes[currentTheme]?.querySelector('svg') || null;
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
    if (activeJob || !['light', 'dark'].includes(theme) || theme === currentTheme) return;
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    for (const svg of themedSvgs) svg.dataset.theme = theme;
    if (!switchableSvg) {
      panes.light.classList.toggle('is-active', theme === 'light');
      panes.dark.classList.toggle('is-active', theme === 'dark');
      applyTime(currentTime, playing);
    }
    themeBtn.textContent = theme === 'dark' ? labels.themeLight : labels.themeDark;
  }

  function setPreset(preset) {
    if (activeJob || !meta.presets.includes(preset)) return;
    currentPreset = preset;
    document.documentElement.dataset.preset = preset;
    for (const svg of themedSvgs) svg.dataset.preset = preset;
    const { label, aria } = meta.presetLabels[preset];
    presetBtn.dataset.presetOption = preset;
    presetBtn.setAttribute('aria-label', aria);
    presetLabel.textContent = label;
    for (const option of presetOptions) {
      option.setAttribute('aria-checked', String(option.dataset.presetValue === preset));
    }
  }

  function openPresetMenu(focusLast = false) {
    if (activeJob || presetBtn.disabled) return;
    presetMenu.classList.add('open');
    presetBtn.setAttribute('aria-expanded', 'true');
    const option = focusLast ? presetOptions.at(-1) : presetOptions.find(button => button.dataset.presetValue === currentPreset);
    (option || presetOptions[0]).focus();
  }

  function closePresetMenu(restoreFocus = false) {
    if (!presetMenu?.classList.contains('open')) return;
    presetMenu.classList.remove('open');
    presetBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) presetBtn.focus();
  }

  function bindPresetMenu() {
    const wrap = presetBtn.closest('.preset-wrap');
    setPreset(currentPreset);
    presetBtn.addEventListener('click', () => {
      if (presetMenu.classList.contains('open')) closePresetMenu();
      else openPresetMenu();
    });
    presetMenu.addEventListener('click', (event) => {
      const option = event.target.closest('[data-preset-value]');
      if (!option || activeJob) return;
      setPreset(option.dataset.presetValue);
      closePresetMenu(true);
    });
    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) closePresetMenu();
    });
    wrap.addEventListener('keydown', (event) => {
      const { key } = event;
      const open = presetMenu.classList.contains('open');
      if (key === 'Escape' && open) {
        event.preventDefault();
        closePresetMenu(true);
        return;
      }
      if (key === 'Tab') closePresetMenu();
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.target === presetBtn) {
        if (!open && (key === 'ArrowDown' || key === 'ArrowUp')) {
          event.preventDefault();
          openPresetMenu(key === 'ArrowUp');
        }
        return;
      }
      const active = presetOptions.indexOf(document.activeElement);
      const count = presetOptions.length;
      const next = { ArrowDown: (active + 1) % count, ArrowUp: (active - 1 + count) % count, Home: 0, End: count - 1 };
      if (open && Object.hasOwn(next, key)) {
        event.preventDefault();
        presetOptions[next[key]].focus();
      }
    });
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
      const background = svg.querySelector(':scope > rect[fill]');
      const fill = background ? getComputedStyle(background).fill : getComputedStyle(document.body).backgroundColor;
      const copy = freezeSvgClone(svg, support, drawW, drawH);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializer.serializeToString(copy))}`;
      try {
        await img.decode();
        const ctx = targetCanvas.getContext('2d', { willReadFrequently: false });
        ctx.fillStyle = fill;
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
    if (!Number.isFinite(start) || !Number.isFinite(seconds) || start < 0 || seconds <= 0 || start + seconds > meta.duration + 0.001 || !Number.isFinite(fps) || fps < 1) {
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
    seconds = meta.duration - start,
    fps = DEFAULT_FPS,
    format = 'webm',
    onProgress = () => {},
    signal,
  } = {}, writer) {
    abortCheck(signal);
    const { selected, frames } = validateVideoRequest({ start, seconds, fps, format }, writer);
    const vc = await selectSupportedVideoConfig(selected, format, fps);

    abortCheck(signal);
    const wasPlaying = playing;
    const savedTime = currentTime;
    const controls = [themeBtn, playBtn, replayBtn, range, ...stepButtons];
    const disabledStates = controls.map(control => control.disabled);
    let target, encoder, mux, failure, wake;
    const check = () => { abortCheck(signal); if (failure) throw failure; };
    const failed = (error) => { failure ??= error; wake?.(); };
    const cancel = () => { if (encoder && encoder.state !== 'closed') encoder.close(); wake?.(); };

    try {
      pause();
      controls.forEach(control => { control.disabled = true; });
      target = makeCanvas(FRAMES_PER_READ);
      const capture = createStageCapturer();
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
      try { await mux?.settle(); }
      finally {
        if (target) target.width = target.height = 1;
        controls.forEach((control, i) => { control.disabled = disabledStates[i]; });
        playing = wasPlaying;
        applyTime(savedTime, wasPlaying);
      }
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

  async function withVideoExport(run, callerSignal) {
    if (activeJob) throw Error('A story export is already running.');
    const controller = new AbortController();
    activeJob = controller;
    const presetWasDisabled = presetBtn?.disabled;
    closePresetMenu();
    if (presetBtn) presetBtn.disabled = true;
    const abortFromCaller = () => controller.abort(callerSignal.reason);
    try {
      if (callerSignal?.aborted) abortFromCaller();
      else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
      return await run(controller.signal);
    } finally {
      activeJob = null;
      if (presetBtn) presetBtn.disabled = presetWasDisabled;
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  function startVideoExport(options, writer) {
    return withVideoExport(signal => encodeVideo({ ...options, signal }, writer), options?.signal);
  }

  async function saveVideo(format, signal) {
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
      mp4Btn.disabled = webmBtn.disabled = pngBtn.disabled = false;
    }
  }

  function runDownload(format) {
    if (activeJob) return;
    return withVideoExport(signal => saveVideo(format, signal));
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) pause();
  requestAnimationFrame(tick);
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  replayBtn.addEventListener('click', () => { playing = true; applyTime(0, true); });
  themeBtn.addEventListener('click', () => setTheme(currentTheme === 'dark' ? 'light' : 'dark'));
  if (presetBtn) bindPresetMenu();
  range.addEventListener('input', () => applyTime(Number(range.value), false));
  range.addEventListener('change', () => applyTime(Number(range.value), playing));
  stepButtons.forEach((btn) => btn.addEventListener('click', () => seek(Number(btn.dataset.stepAt))));
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (target?.isContentEditable || target?.closest('input,textarea,button,select')) return;
    if (!activeJob && presetBtn && !presetBtn.disabled && (event.key === 's' || event.key === 'S')) {
      event.preventDefault();
      const next = (meta.presets.indexOf(currentPreset) + 1) % meta.presets.length;
      setPreset(meta.presets[next]);
    }
    if (event.code === 'Space' && !playBtn.disabled) {
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
    setPreset,
    exportPNG,
    exportVideo: (options) => startVideoExport(options),
    writeVideo: (writer, options) => startVideoExport(options, writer),
    cancelExport: () => activeJob?.abort(),
    duration: meta.duration,
    defaults: { width: WIDTH, height: HEIGHT, fps: DEFAULT_FPS, format: 'webm' },
    state: () => ({ theme: currentTheme, preset: currentPreset, playing, time: currentTime, duration: meta.duration, steps: meta.steps }),
  };
  window.ArchifyStoryStage = api;
  window.StoryStage = api;
  Promise.resolve(document.fonts?.ready).finally(() => { window.storyStageReady = true; });
})();
