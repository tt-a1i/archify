import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { softwareNoticesHtml } from '../renderers/shared/software-notices.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

let cachedStageAssets = null;
function loadStageRuntimeAssets() {
  if (!cachedStageAssets) {
    cachedStageAssets = {
      containerCode: fs.readFileSync(path.join(here, 'story-container.js'), 'utf8'),
      runtimeCode: fs.readFileSync(path.join(here, 'story-stage-runtime.js'), 'utf8'),
    };
  }
  return cachedStageAssets;
}

const stageLabelsFor = (isZh) => (isZh
  ? {
      play: '播放', pause: '暂停', replay: '重播',
      themeDark: '深色主题', themeLight: '浅色主题',
      png: '导出 PNG', mp4: '导出 1080p MP4', webm: 'WebM',
      exporting: '正在导出 1080p 视频…',
      hint: '空格键播放/暂停 · 点击步骤条跳转 · 支持离线流式导出 1080p 60fps MP4 / WebM 视频',
    }
  : {
      play: 'Play', pause: 'Pause', replay: 'Replay',
      themeDark: 'Dark theme', themeLight: 'Light theme',
      png: 'Export PNG', mp4: 'Export 1080p MP4', webm: 'WebM',
      exporting: 'Exporting 1080p video…',
      hint: 'Space to play/pause · Click any step to seek · Streams 1080p 60fps MP4 / WebM offline',
    });

// Builds a standalone offline HTML stage player embedding dual-theme animated SVGs,
// step scrubber controls, PNG frame snapshot, and batched 1080p MP4/WebM export.
export function buildStoryStageHtml({ plan, lightSvg, darkSvg, defaultTheme = 'light', preset = 'classic' }) {
  const { containerCode, runtimeCode } = loadStageRuntimeAssets();
  const title = plan.title || 'Archify Story Stage';
  const labels = stageLabelsFor((plan.locale || '').toLowerCase().startsWith('zh'));
  const meta = JSON.stringify({
    title,
    duration: plan.duration,
    loop: plan.loop,
    preset,
    defaultTheme: defaultTheme === 'dark' ? 'dark' : 'light',
    labels,
    steps: plan.steps.map((step, index) => ({
      index,
      at: step.at,
      title: step.title,
      body: step.body,
    })),
  }).replace(/</g, '\\u003c');

  const stepButtons = plan.steps.map((step, index) => (
    `<button type="button" class="stage-step${index === 0 ? ' is-active' : ''}" data-step-index="${index}" data-step-at="${step.at}" title="${escapeHtml(step.title)}">`
    + `<span class="step-num">${String(index + 1).padStart(2, '0')}</span>`
    + `<span class="step-title">${escapeHtml(step.title)}</span>`
    + `</button>`
  )).join('');

  return `<!doctype html>
<html lang="${escapeHtml(plan.locale || 'en')}" data-theme="${defaultTheme === 'dark' ? 'dark' : 'light'}" data-preset="${escapeHtml(preset)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Archify Story Stage</title>
${softwareNoticesHtml}
<style>
:root{--stage-bg:#eef2f7;--surface:#ffffff;--ink:#172033;--muted:#596579;--border:#d6dee8;--accent:#159f88;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
html[data-theme="dark"]{--stage-bg:#070d1a;--surface:#0f172a;--ink:#eef2f8;--muted:#9aa9be;--border:#233146;--accent:#34d399}
*{box-sizing:border-box}
body{margin:0;background:var(--stage-bg);color:var(--ink);min-height:100vh;display:flex;justify-content:center;padding:24px 20px}
.shell{width:min(1120px,100%);display:flex;flex-direction:column;gap:14px}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.bar h1{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em}
.actions{display:flex;flex-wrap:wrap;gap:8px}
button{appearance:none;border:1px solid var(--border);background:var(--surface);color:var(--ink);border-radius:999px;padding:7px 14px;font:500 12.5px/1.2 inherit;cursor:pointer}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.55;cursor:wait}
.canvas-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:12px;box-shadow:0 16px 40px rgba(15,23,42,.08)}
.stage-pane{display:none}
.stage-pane.is-active{display:block}
.stage-pane svg{display:block;width:100%;height:auto;border-radius:10px}
.controls{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px}
.timeline{flex:1;min-width:120px;accent-color:var(--accent)}
.clock{font:500 12px/1 ui-monospace,Consolas,monospace;color:var(--muted);min-width:96px;text-align:right;font-variant-numeric:tabular-nums}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.stage-step{border-radius:10px;padding:8px 10px;text-align:left;display:flex;align-items:center;gap:8px}
.stage-step.is-active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.step-num{font:600 11px/1 ui-monospace,Consolas,monospace;color:var(--accent)}
.step-title{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hint{margin:0;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<main class="shell">
  <header class="bar">
    <h1>${escapeHtml(title)}</h1>
    <div class="actions">
      <button type="button" id="stage-theme">${defaultTheme === 'dark' ? labels.themeLight : labels.themeDark}</button>
      <button type="button" id="stage-export-png">${labels.png}</button>
      <button type="button" id="stage-export-mp4">${labels.mp4}</button>
      <button type="button" id="stage-export-webm">${labels.webm}</button>
    </div>
  </header>
  <section class="canvas-wrap">
    <div class="stage-pane${defaultTheme !== 'dark' ? ' is-active' : ''}" data-stage-theme="light">${lightSvg.replace(/^<\?xml[^>]*>\s*/, '')}</div>
    <div class="stage-pane${defaultTheme === 'dark' ? ' is-active' : ''}" data-stage-theme="dark">${darkSvg.replace(/^<\?xml[^>]*>\s*/, '')}</div>
  </section>
  <section class="controls">
    <button type="button" id="stage-play" aria-pressed="true">${labels.pause}</button>
    <button type="button" id="stage-replay">${labels.replay}</button>
    <input id="stage-range" class="timeline" type="range" min="0" max="${plan.duration}" step="0.02" value="0" aria-label="Story playback time">
    <span id="stage-clock" class="clock">0.0s / ${plan.duration.toFixed(1)}s</span>
  </section>
  <nav class="steps" aria-label="Story steps">${stepButtons}</nav>
  <p class="hint" id="stage-status">${labels.hint}</p>
</main>
<script type="application/json" id="story-stage-meta">${meta}</script>
<script>${containerCode}</script>
<script>${runtimeCode}</script>
</body>
</html>
`;
}
