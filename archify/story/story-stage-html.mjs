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
      video: '视频',
      exporting: '正在导出 1080p 视频…',
      hint: '空格键播放/暂停 · 点击步骤条跳转 · 支持离线流式导出 1080p 60fps MP4 / WebM 视频',
      feedbackLabel: '反馈与支持',
      feedbackTrigger: '反馈', feedbackIssue: '提交 Issue', feedbackIssueHint: '反馈问题或功能建议',
      feedbackEmail: '发邮件反馈', feedbackCopyEmail: '复制邮箱地址', feedbackCopied: '已复制',
      feedbackStar: 'Star', feedbackStarLabel: '在 GitHub 给 Archify 点 Star',
      feedbackStarTitle: '觉得 Archify 有用？', feedbackStarBody: '如果它帮到了你，点个 Star 支持我们继续打磨。',
    }
  : {
      play: 'Play', pause: 'Pause', replay: 'Replay',
      video: 'Video',
      exporting: 'Exporting 1080p video…',
      hint: 'Space to play/pause · Click any step to seek · Streams 1080p 60fps MP4 / WebM offline',
      feedbackLabel: 'Feedback and support',
      feedbackTrigger: 'Feedback', feedbackIssue: 'Open an issue', feedbackIssueHint: 'Bug report or suggestion',
      feedbackEmail: 'Send email', feedbackCopyEmail: 'Copy email address', feedbackCopied: 'Copied',
      feedbackStar: 'Star', feedbackStarLabel: 'Star Archify on GitHub',
      feedbackStarTitle: 'Found Archify helpful?', feedbackStarBody: 'A star on GitHub helps us keep building it.',
    });

function stageThemeCss(styles) {
  const chrome = {
    'stage-bg': 'bg', surface: 'panel', ink: 'text', muted: 'text-muted',
    border: 'panel-border', accent: 'arrow-emphasis', 'control-bg': 'toolbar-bg',
    'control-ink': 'toolbar-text', 'control-border': 'toolbar-border',
    'control-hover': 'toolbar-hover', 'menu-bg': 'toolbar-menu-bg',
  };
  const toolbarTokens = ['bg', 'frontend-stroke', 'arrow-emphasis', 'cloud-stroke', 'toolbar-menu-bg', 'panel', 'panel-border', 'text', 'text-muted', 'text-faint'];
  return BAKE_PRESETS.flatMap(preset => BAKE_THEMES.map(theme => {
    const vars = resolveThemeVariables(styles.rules, { theme, preset });
    const css = [...Object.entries(chrome), ...toolbarTokens.map(key => [key, key])]
      .map(([name, key]) => `--${name}:${vars.get(`--${key}`)}`).join(';');
    return `html[data-theme="${theme}"][data-preset="${preset}"]{color-scheme:${theme};${css}}`;
  })).join('\n');
}

const toolbarIds = {
  'btn-theme': 'stage-theme', 'theme-icon': 'stage-theme-icon', 'theme-label': 'stage-theme-label',
  'btn-preset': 'stage-preset', 'preset-label': 'stage-preset-label', 'preset-menu': 'stage-preset-menu',
  'btn-export': 'stage-export', 'export-menu': 'stage-export-menu',
};

function stageToolbar(toolbar, locale, labels, switchable) {
  const localize = markup => localizeTemplate(markup.replace(/\b(id|aria-controls)="([^"]+)"/g,
    (match, attr, id) => toolbarIds[id] ? `${attr}="${toolbarIds[id]}"` : match), locale);
  const css = toolbar.css
    .replace(/#([\w-]+)\b/g, (match, id) => toolbarIds[id] ? `#${toolbarIds[id]}` : match)
    .replace('[data-format="webm"]::before', ':is([data-format="webm"],[data-format="mp4"])::before');
  const row = (format, label, hint) => `<button id="stage-export-${format}" data-format="${format}" type="button" role="menuitem" tabindex="-1"><span class="export-item-copy"><strong>${label}</strong><small class="hint">${hint}</small></span></button>`;
  const image = '{{i18n:viewer.export.image}}';
  const videoHint = '1080p · 60 fps';
  const markup = `<div class="toolbar stage-toolbar" role="toolbar" aria-label="{{i18n:viewer.toolbar.actions}}">
      <div class="toolbar-group">
        ${toolbar.theme}
        ${switchable ? toolbar.preset : ''}
      </div>
      <div class="export-wrap">
        ${toolbar.exportButton}
        <div class="export-menu" id="export-menu" role="menu" aria-label="{{i18n:viewer.export.menu}}">
          ${toolbar.exportHeader}
          <div class="export-menu-section" role="group" aria-label="${image}">
            <span class="export-menu-heading" aria-hidden="true">${image}</span>
            ${row('png', 'PNG', '{{i18n:viewer.export.lossless}} · 1080p')}
          </div>
          <div class="export-menu-section" role="group" aria-label="${labels.video}">
            <span class="export-menu-heading" aria-hidden="true">${labels.video}</span>
            ${row('mp4', 'MP4', videoHint)}
            ${row('webm', 'WebM', videoHint)}
          </div>
        </div>
      </div>
    </div>`;
  return { markup: localize(markup), css };
}

// CLI output uses a single switchable SVG. Fixed-theme SVG pairs remain supported.
export function buildStoryStageHtml({ plan, stageSvg, lightSvg, darkSvg, defaultTheme = 'light', preset = 'classic', styles = loadViewerStyles() }) {
  const { containerCode, runtimeCode } = loadStageRuntimeAssets();
  const title = plan.title || 'Archify Story Stage';
  const isZh = (plan.locale || '').toLowerCase().startsWith('zh');
  const locale = isZh ? 'zh-CN' : 'en';
  const labels = stageLabelsFor(isZh);
  labels.themeDark = translateMessage(locale, 'viewer.theme.dark');
  labels.themeLight = translateMessage(locale, 'viewer.theme.light');
  defaultTheme = defaultTheme === 'dark' ? 'dark' : 'light';
  const stripXml = svg => svg.replace(/^<\?xml[^>]*>\s*/, '');
  const panes = stageSvg
    ? `<div class="stage-pane is-active" data-stage-switchable>${stripXml(stageSvg)}</div>`
    : BAKE_THEMES.map(theme => `<div class="stage-pane${theme === defaultTheme ? ' is-active' : ''}" data-stage-theme="${theme}">${stripXml(theme === 'light' ? lightSvg : darkSvg)}</div>`).join('\n');
  const presets = stageSvg ? BAKE_PRESETS : [];
  const toolbar = stageToolbar(styles.toolbar ?? loadViewerStyles().toolbar, locale, labels, Boolean(stageSvg));
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
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
${stageThemeCss(styles)}
*{box-sizing:border-box}
body{margin:0;background:var(--stage-bg);color:var(--ink);min-height:100vh;display:flex;justify-content:center;padding:16px 20px}
.shell{width:min(1040px,100%);display:flex;flex-direction:column;gap:10px}
.bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.bar h1{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em}
:where(.controls>button,.stage-step){appearance:none;border:1px solid var(--control-border);background-color:var(--control-bg);color:var(--control-ink);border-radius:999px;padding:7px 14px;font:inherit;font-size:12.5px;font-weight:500;line-height:1.2;cursor:pointer}
:where(.controls>button,.stage-step):hover{border-color:var(--accent);background-color:var(--control-hover)}
:where(.controls>button,.stage-step):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.55;cursor:wait}
${toolbar.css}
.stage-toolbar{position:relative;inset:auto;margin:0 0 0 auto}
@media (max-width:720px){
  .stage-toolbar .toolbar-group,.stage-toolbar .export-wrap{position:static}
  .stage-toolbar :is(.preset-menu,.export-menu){position:absolute;top:calc(100% + .125rem);left:auto;right:0;width:min(19rem,calc(100vw - 40px))}
  .stage-toolbar .preset-menu{width:min(17.5rem,calc(100vw - 40px))}
  .controls .timeline{min-width:0}
}
.canvas-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:10px}
.stage-pane{display:none}
.stage-pane.is-active{display:block}
.stage-pane>svg{display:block;width:100%;height:auto;border-radius:10px}
.stage-feedback{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:2px 0 0;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
.stage-feedback-brand{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-weight:500;text-decoration:none;transition:color .15s}
.stage-feedback-brand:hover{color:var(--ink)}
.stage-feedback-mark{display:inline-block;width:22px;height:22px;border-radius:6px;border:1px solid var(--border);background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 360' fill='none'%3E%3Cpath d='M151 94 81 164C67 178 60 191 60 212V248H97V212C97 204 100 199 106 193L179 120Z' fill='%230856F5'/%3E%3Cpath d='M238 135C252 132 261 126 270 116L321 167C334 180 339 194 339 213V248H303V213C303 204 300 199 294 193Z' fill='%231DBBB7'/%3E%3Crect x='146' y='16' width='110' height='104' rx='30' fill='%230856F5'/%3E%3Crect x='18' y='238' width='110' height='104' rx='28' fill='%230856F5'/%3E%3Crect x='274' y='238' width='108' height='104' rx='28' fill='%231DBBB7'/%3E%3C/svg%3E") center/13px 12px no-repeat;flex-shrink:0}
.stage-feedback-actions{display:inline-flex;align-items:center;gap:8px}
.stage-feedback-menu{position:relative}
.stage-feedback-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--ink);font-size:12px;font-weight:500;line-height:1;text-decoration:none;cursor:pointer;user-select:none;list-style:none;transition:border-color .15s,background-color .15s}
.stage-feedback-btn::-webkit-details-marker{display:none}
.stage-feedback-btn:hover,.stage-feedback-menu[open]>.stage-feedback-btn{border-color:color-mix(in srgb,var(--ink) 28%,var(--border));background:var(--control-hover)}
.stage-feedback :is(a,summary,button):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.stage-feedback-icon,.stage-feedback-item-icon{display:inline-block;flex-shrink:0;background:currentColor;-webkit-mask:var(--fb-glyph) center/contain no-repeat;mask:var(--fb-glyph) center/contain no-repeat}
.stage-feedback-icon{width:13px;height:13px;color:var(--muted)}
.stage-feedback-btn:hover .stage-feedback-icon,.stage-feedback-menu[open]>.stage-feedback-btn .stage-feedback-icon{color:var(--ink)}
.stage-feedback-icon[data-icon="chat"]{--fb-glyph:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.5 3.5h11a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H6.6L3.5 14v-2.3h-1a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z'/%3E%3C/svg%3E")}
.stage-feedback-item-icon{width:15px;height:15px;color:var(--muted);margin-top:1px}
.stage-feedback-item-icon[data-icon="issue"]{--fb-glyph:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='8' cy='8' r='6'/%3E%3Ccircle cx='8' cy='8' r='1.2' fill='black' stroke='none'/%3E%3C/svg%3E")}
.stage-feedback-item-icon[data-icon="mail"]{--fb-glyph:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='3.2' width='12' height='9.6' rx='1.6'/%3E%3Cpath d='m2.6 4.2 5.4 4.1 5.4-4.1'/%3E%3C/svg%3E")}
.stage-feedback-item-icon[data-icon="copy"]{--fb-glyph:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='5.5' y='5.5' width='8' height='8' rx='1.5'/%3E%3Cpath d='M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8A1.3 1.3 0 0 0 2.5 3.8v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7'/%3E%3C/svg%3E")}
.stage-feedback-menu:not([open])>.stage-feedback-popover{display:none}
.stage-feedback-popover{position:absolute;bottom:calc(100% + 8px);right:0;z-index:40;width:236px;padding:6px;border:1px solid var(--border);border-radius:14px;background:var(--menu-bg,var(--stage-bg));box-shadow:0 14px 36px rgb(15 23 42/.18),0 2px 8px rgb(15 23 42/.06);backdrop-filter:blur(12px)}
.stage-feedback-item{display:flex;align-items:flex-start;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:var(--ink);font:inherit;text-align:left;text-decoration:none;cursor:pointer;transition:background-color .12s}
.stage-feedback-item:hover,.stage-feedback-item:focus-visible{background:var(--control-hover)}
.stage-feedback-item-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.stage-feedback-item-copy strong{font-size:12.5px;font-weight:550;line-height:1.3;color:var(--ink)}
.stage-feedback-item-copy span{font-size:11.5px;line-height:1.3;color:var(--muted);overflow-wrap:anywhere}
.stage-feedback-copy.is-copied .stage-feedback-item-copy strong,.stage-feedback-copy.is-copied .stage-feedback-item-icon{color:var(--accent)}
.stage-feedback-divider{height:1px;margin:4px 8px;background:var(--border)}
.stage-star-wrap{position:relative;display:inline-flex}
.stage-star-tip{position:absolute;bottom:calc(100% + 8px);right:0;z-index:40;display:flex;flex-direction:column;gap:4px;width:256px;max-width:calc(100vw - 32px);padding:10px 12px;border:1px solid var(--border);border-radius:14px;background:var(--menu-bg,var(--stage-bg));box-shadow:0 14px 36px rgb(15 23 42/.18),0 2px 8px rgb(15 23 42/.06);backdrop-filter:blur(12px);text-align:left;pointer-events:none;opacity:0;visibility:hidden;transform:translateY(4px);transition:opacity .16s ease,transform .16s ease,visibility .16s}
.stage-star-tip strong{font-size:12.5px;font-weight:600;line-height:1.3;color:var(--ink)}
.stage-star-tip span{font-size:11.5px;line-height:1.45;color:var(--muted)}
.stage-star-wrap:is(:hover,:focus-within) .stage-star-tip{opacity:1;visibility:visible;transform:translateY(0)}
@media(prefers-reduced-motion:reduce){.stage-star-tip{transform:none;transition:opacity .12s ease,visibility .12s}}
.stage-star-icon{width:13px;height:13px;background:#e2a421;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z'/%3E%3C/svg%3E") center/contain no-repeat}
.stage-star:hover{border-color:color-mix(in srgb,#e2a421 55%,var(--border))}
.stage-star:hover .stage-star-icon{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z' stroke='black' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z' stroke='black' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E")}
@media(max-width:560px){.stage-feedback-popover{right:auto;left:0}}
@media(forced-colors:active){.stage-star-icon{forced-color-adjust:none;background:LinkText}.stage-feedback-icon,.stage-feedback-item-icon{forced-color-adjust:none;background:ButtonText}}
.controls{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px}
.timeline{flex:1;min-width:120px;accent-color:var(--accent)}
.clock{font:500 12px/1 ui-monospace,Consolas,monospace;color:var(--muted);min-width:96px;text-align:right;font-variant-numeric:tabular-nums}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.stage-step{background-color:var(--surface);color:var(--ink);border-color:var(--border);border-radius:10px;padding:8px 10px;text-align:left;display:flex;align-items:center;gap:8px}
.stage-step.is-active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.step-num{font:600 11px/1 ui-monospace,Consolas,monospace;color:var(--accent)}
.step-title{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stage-status{margin:0;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<main class="shell">
  <header class="bar">
    <h1>${escapeHtml(title)}</h1>
    ${toolbar.markup}
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
  <footer class="stage-feedback" aria-label="${labels.feedbackLabel}">
    <a class="stage-feedback-brand" href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer"><span class="stage-feedback-mark" aria-hidden="true"></span><span>Archify</span></a>
    <div class="stage-feedback-actions">
      <details class="stage-feedback-menu" data-feedback-menu>
        <summary class="stage-feedback-btn"><span class="stage-feedback-icon" data-icon="chat" aria-hidden="true"></span><span>${labels.feedbackTrigger}</span></summary>
        <div class="stage-feedback-popover" role="menu" aria-label="${labels.feedbackTrigger}">
          <a class="stage-feedback-item" role="menuitem" href="https://github.com/tt-a1i/archify/issues/new/choose" target="_blank" rel="noopener noreferrer"><span class="stage-feedback-item-icon" data-icon="issue" aria-hidden="true"></span><span class="stage-feedback-item-copy"><strong>${labels.feedbackIssue}</strong><span>${labels.feedbackIssueHint}</span></span></a>
          <a class="stage-feedback-item" role="menuitem" href="mailto:2801884530@qq.com?subject=Archify%20feedback"><span class="stage-feedback-item-icon" data-icon="mail" aria-hidden="true"></span><span class="stage-feedback-item-copy"><strong>${labels.feedbackEmail}</strong><span>2801884530@qq.com</span></span></a>
          <div class="stage-feedback-divider" role="separator"></div>
          <button class="stage-feedback-item stage-feedback-copy" type="button" role="menuitem" data-copy-email="2801884530@qq.com" data-copied-text="${labels.feedbackCopied}"><span class="stage-feedback-item-icon" data-icon="copy" aria-hidden="true"></span><span class="stage-feedback-item-copy"><strong data-copy-label>${labels.feedbackCopyEmail}</strong></span></button>
        </div>
      </details>
      <span class="stage-star-wrap"><a class="stage-feedback-btn stage-star" href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer" aria-label="${labels.feedbackStarLabel}" aria-describedby="stage-star-tip"><span class="stage-star-icon" aria-hidden="true"></span><span>${labels.feedbackStar}</span></a><span class="stage-star-tip" id="stage-star-tip" role="tooltip"><strong>${labels.feedbackStarTitle}</strong><span>${labels.feedbackStarBody}</span></span></span>
    </div>
  </footer>
</main>
<script type="application/json" id="story-stage-meta">${meta}</script>
<script>${containerCode}</script>
<script>${runtimeCode}</script>
<script>(function(){var m=document.querySelector('[data-feedback-menu]');if(!m)return;var s=m.querySelector('summary'),b=m.querySelector('[data-copy-email]'),t=null;document.addEventListener('click',function(e){if(m.open&&!m.contains(e.target))m.open=false;});m.addEventListener('keydown',function(e){if(e.code==='Space'||e.key==='Enter')e.stopPropagation();if(e.key==='Escape'&&m.open){e.stopPropagation();m.open=false;if(s)s.focus({preventScroll:true});}});if(b){var l=b.querySelector('[data-copy-label]'),orig=l?l.textContent:'';b.addEventListener('click',function(){var email=b.getAttribute('data-copy-email')||'';var done=function(ok){if(!l||!ok)return;l.textContent=b.getAttribute('data-copied-text')||'Copied';b.classList.add('is-copied');clearTimeout(t);t=setTimeout(function(){l.textContent=orig;b.classList.remove('is-copied');},1800);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(email).then(function(){done(true);},function(){done(false);});}else{var a=document.createElement('textarea');a.value=email;a.setAttribute('readonly','');a.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(a);a.select();var ok=false;try{ok=document.execCommand('copy');}catch(_){}a.remove();done(ok);}});}})();</script>
</body>
</html>
`;
}
