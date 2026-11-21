import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeTemplate, translateMessage } from '../renderers/shared/i18n.mjs';
import { softwareNoticesHtml } from '../renderers/shared/software-notices.mjs';
import { BAKE_PRESETS, BAKE_THEMES, loadViewerStyles, resolveThemeVariables } from './svg-bake.mjs';

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

function stageThemeCss(styles) {
  const chrome = {
    'stage-bg': 'bg', surface: 'panel', ink: 'text', muted: 'text-muted',
    border: 'panel-border', accent: 'arrow-emphasis', 'control-bg': 'toolbar-bg',
    'control-ink': 'toolbar-text', 'control-border': 'toolbar-border',
    'control-hover': 'toolbar-hover',
  };
  const menuTokens = ['frontend-stroke', 'arrow-emphasis', 'toolbar-menu-bg', 'panel', 'panel-border', 'text', 'text-muted', 'text-faint'];
  return BAKE_PRESETS.flatMap(preset => BAKE_THEMES.map(theme => {
    const vars = resolveThemeVariables(styles.rules, { theme, preset });
    const css = [...Object.entries(chrome), ...menuTokens.map(key => [key, key])]
      .map(([name, key]) => `--${name}:${vars.get(`--${key}`)}`).join(';');
    return `html[data-theme="${theme}"][data-preset="${preset}"]{color-scheme:${theme};${css}}`;
  })).join('\n');
}

// CLI output uses a single switchable SVG. Fixed-theme SVG pairs remain supported.
export function buildStoryStageHtml({ plan, stageSvg, lightSvg, darkSvg, defaultTheme = 'light', preset = 'classic', styles = loadViewerStyles() }) {
  const { containerCode, runtimeCode } = loadStageRuntimeAssets();
  const title = plan.title || 'Archify Story Stage';
  const isZh = (plan.locale || '').toLowerCase().startsWith('zh');
  const locale = isZh ? 'zh-CN' : 'en';
  const labels = stageLabelsFor(isZh);
  defaultTheme = defaultTheme === 'dark' ? 'dark' : 'light';
  const stripXml = svg => svg.replace(/^<\?xml[^>]*>\s*/, '');
  const panes = stageSvg
    ? `<div class="stage-pane is-active" data-stage-switchable>${stripXml(stageSvg)}</div>`
    : BAKE_THEMES.map(theme => `<div class="stage-pane${theme === defaultTheme ? ' is-active' : ''}" data-stage-theme="${theme}">${stripXml(theme === 'light' ? lightSvg : darkSvg)}</div>`).join('\n');
  const presets = stageSvg ? BAKE_PRESETS : [];
  const menu = stageSvg ? (styles.presetMenu ?? loadViewerStyles().presetMenu) : null;
  const presetIds = { 'btn-preset': 'stage-preset', 'preset-label': 'stage-preset-label', 'preset-menu': 'stage-preset-menu' };
  const presetMarkup = menu ? localizeTemplate(menu.markup.replace(/\b(id|aria-controls)="(btn-preset|preset-label|preset-menu)"/g,
    (_, attr, id) => `${attr}="${presetIds[id]}"`), locale) : '';
  const presetCss = menu ? menu.css.replace(/#(btn-preset|preset-label)\b/g, (_, id) => `#${presetIds[id]}`) : '';
  const presetLabels = Object.fromEntries(presets.map(value => {
    const key = { classic: 'classic.short', 'signal-flow': 'flow.short' }[value] || value;
    const label = translateMessage(locale, `viewer.preset.${key}`);
    return [value, { label, aria: translateMessage(locale, 'viewer.preset.current', { style: label }) }];
  }));
  const meta = JSON.stringify({
    title,
    duration: plan.duration,
    loop: plan.loop,
    preset,
    defaultTheme,
    presets,
    presetLabels,
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
<html lang="${escapeHtml(plan.locale || 'en')}" data-theme="${defaultTheme}" data-preset="${escapeHtml(preset)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Archify Story Stage</title>
${softwareNoticesHtml}
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
${stageThemeCss(styles)}
*{box-sizing:border-box}
body{margin:0;background:var(--stage-bg);color:var(--ink);min-height:100vh;display:flex;justify-content:center;padding:24px 20px}
.shell{width:min(1120px,100%);display:flex;flex-direction:column;gap:14px}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.bar h1{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto;position:relative}
:where(.actions>button,.controls>button,.stage-step){appearance:none;border:1px solid var(--control-border);background-color:var(--control-bg);color:var(--control-ink);border-radius:999px;padding:7px 14px;font:inherit;font-size:12.5px;font-weight:500;line-height:1.2;cursor:pointer}
:where(.actions>button,.controls>button,.stage-step):hover{border-color:var(--accent);background-color:var(--control-hover)}
:where(.actions>button,.controls>button,.stage-step):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.55;cursor:wait}
${presetCss}
.stage-preset-toolbar{position:relative;z-index:100}
.stage-preset-toolbar #stage-preset:disabled{cursor:wait}
@media (721px <= width <= 900px){.stage-preset-toolbar .preset-menu{left:0;right:auto}}
@media (max-width:720px){
  .stage-preset-toolbar,.stage-preset-toolbar .toolbar-group{position:static}
  .stage-preset-toolbar .preset-menu{position:absolute;top:calc(100% + .125rem);left:0;right:0;z-index:100}
}
.canvas-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:12px}
.stage-pane{display:none}
.stage-pane.is-active{display:block}
.stage-pane>svg{display:block;width:100%;height:auto;border-radius:10px}
.controls{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px}
.timeline{flex:1;min-width:120px;accent-color:var(--accent)}
.clock{font:500 12px/1 ui-monospace,Consolas,monospace;color:var(--muted);min-width:96px;text-align:right;font-variant-numeric:tabular-nums}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.stage-step{background-color:var(--surface);color:var(--ink);border-color:var(--border);border-radius:10px;padding:8px 10px;text-align:left;display:flex;align-items:center;gap:8px}
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
      ${menu ? `<div class="toolbar stage-preset-toolbar"><div class="toolbar-group">${presetMarkup}</div></div>` : ''}
      <button type="button" id="stage-theme">${defaultTheme === 'dark' ? labels.themeLight : labels.themeDark}</button>
      <button type="button" id="stage-export-png">${labels.png}</button>
      <button type="button" id="stage-export-mp4">${labels.mp4}</button>
      <button type="button" id="stage-export-webm">${labels.webm}</button>
    </div>
  </header>
  <section class="canvas-wrap">
    ${panes}
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
