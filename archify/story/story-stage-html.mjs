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
      feedbackTagline: '把你想理解、规划或分享的事，变成可以互动的可视化作品。',
      feedbackTrigger: '反馈', feedbackIssue: '提交 Issue', feedbackIssueHint: '反馈问题或功能建议',
      feedbackEmail: '发邮件反馈', feedbackCopyEmail: '复制邮箱地址', feedbackCopied: '已复制',
      feedbackStarPrompt: '如果 Archify 帮到了你',
      feedbackStar: '点个 Star', feedbackStarLabel: '在 GitHub 给 Archify 点 Star',
      feedbackStarTitle: '在 GitHub 支持 Archify', feedbackStarBody: '你的每一颗 Star，都是我们持续开源打磨的最大动力。',
    }
  : {
      play: 'Play', pause: 'Pause', replay: 'Replay',
      video: 'Video',
      exporting: 'Exporting 1080p video…',
      hint: 'Space to play/pause · Click any step to seek · Streams 1080p 60fps MP4 / WebM offline',
      feedbackLabel: 'Feedback and support',
      feedbackTagline: 'Turn anything you want to understand, plan, or share into an interactive visual.',
      feedbackTrigger: 'Feedback', feedbackIssue: 'Open an issue', feedbackIssueHint: 'Bug report or suggestion',
      feedbackEmail: 'Send email', feedbackCopyEmail: 'Copy email address', feedbackCopied: 'Copied',
      feedbackStarPrompt: 'If Archify helped you',
      feedbackStar: 'Star', feedbackStarLabel: 'Star Archify on GitHub',
      feedbackStarTitle: 'Support Archify on GitHub', feedbackStarBody: 'Every star helps us keep building and sharing it openly.',
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
.stage-feedback{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px 18px;margin:2px 0 0;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
.stage-feedback-brand{justify-self:start;display:inline-flex;align-items:center;gap:10px;min-width:0;color:var(--ink);text-decoration:none}
.stage-feedback-brand:hover .stage-feedback-name{color:var(--accent)}
.stage-feedback-mark{display:inline-block;width:32px;height:32px;border-radius:9px;box-shadow:inset 0 0 0 1px var(--border);background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 360' fill='none'%3E%3Cpath d='M151 94 81 164C67 178 60 191 60 212V248H97V212C97 204 100 199 106 193L179 120Z' fill='%230856F5'/%3E%3Cpath d='M238 135C252 132 261 126 270 116L321 167C334 180 339 194 339 213V248H303V213C303 204 300 199 294 193Z' fill='%231DBBB7'/%3E%3Crect x='146' y='16' width='110' height='104' rx='30' fill='%230856F5'/%3E%3Crect x='18' y='238' width='110' height='104' rx='28' fill='%230856F5'/%3E%3Crect x='274' y='238' width='108' height='104' rx='28' fill='%231DBBB7'/%3E%3C/svg%3E") center/19px 17px no-repeat;flex-shrink:0}
.stage-feedback-words{display:grid;gap:4px;min-width:0}
.stage-feedback-name{font-size:13.5px;font-weight:650;line-height:1;letter-spacing:-.01em;color:var(--ink);transition:color .15s}
.stage-feedback-tagline{font-size:11.5px;line-height:1.3;color:var(--muted)}
.stage-feedback-menu{justify-self:end;position:relative}
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
.stage-star-wrap{justify-self:center;position:relative;display:inline-flex}
.stage-star{display:inline-flex;align-items:center;gap:9px;padding:3px 4px 3px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--muted);font-size:12px;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer;transition:border-color .15s,color .15s}
.stage-star:hover{border-color:color-mix(in srgb,#e2a421 55%,var(--border));color:var(--ink)}
.stage-gh{display:inline-block;width:14px;height:14px;flex-shrink:0;background:currentColor;opacity:.78;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='black' d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='black' d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z'/%3E%3C/svg%3E") center/contain no-repeat}
.stage-star:hover .stage-gh{opacity:1}
.stage-star-pill{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 11px;border:1px solid color-mix(in srgb,#e2a421 38%,var(--border));border-radius:999px;background:color-mix(in srgb,#e2a421 12%,var(--surface));color:var(--ink);font-size:12px;font-weight:600;transition:border-color .15s,background-color .15s}
.stage-star:hover .stage-star-pill{border-color:color-mix(in srgb,#e2a421 68%,var(--border));background:color-mix(in srgb,#e2a421 20%,var(--surface))}
.stage-star-arrow{opacity:.55;font-size:11px}
.stage-star-tip{position:absolute;bottom:calc(100% + 8px);left:50%;z-index:40;display:flex;flex-direction:column;gap:4px;width:256px;max-width:calc(100vw - 32px);padding:10px 12px;border:1px solid var(--border);border-radius:14px;background:var(--menu-bg,var(--stage-bg));box-shadow:0 14px 36px rgb(15 23 42/.18),0 2px 8px rgb(15 23 42/.06);backdrop-filter:blur(12px);text-align:left;pointer-events:none;opacity:0;visibility:hidden;transform:translate(-50%,4px);transition:opacity .16s ease,transform .16s ease,visibility .16s}
.stage-star-tip strong{font-size:12.5px;font-weight:600;line-height:1.3;color:var(--ink)}
.stage-star-tip span{font-size:11.5px;line-height:1.45;color:var(--muted)}
.stage-star-wrap:is(:hover,:focus-within) .stage-star-tip{opacity:1;visibility:visible;transform:translate(-50%,0)}
@media(prefers-reduced-motion:reduce){.stage-star-tip{transform:translateX(-50%);transition:opacity .12s ease,visibility .12s}}
.stage-star-icon{width:13px;height:13px;background:#e2a421;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z'/%3E%3C/svg%3E") center/contain no-repeat}
.stage-star:hover .stage-star-icon{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z' stroke='black' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z' stroke='black' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E")}
@media(max-width:960px){.stage-feedback{display:flex;flex-wrap:wrap;justify-content:space-between}}
@media(max-width:560px){.stage-feedback-popover{right:auto;left:0}.stage-star-tip{left:0;transform:translateY(4px)}.stage-star-wrap:is(:hover,:focus-within) .stage-star-tip{transform:translateY(0)}}
@media(forced-colors:active){.stage-star-icon{forced-color-adjust:none;background:LinkText}.stage-gh,.stage-feedback-icon,.stage-feedback-item-icon{forced-color-adjust:none;background:ButtonText}}
.controls{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px}
.timeline{flex:1;min-width:120px;accent-color:var(--accent)}
@media (max-width:480px){
  .controls{flex-wrap:wrap}
  .controls .timeline{flex-basis:100%;order:1}
}
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
    <a class="stage-feedback-brand" href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer"><span class="stage-feedback-mark" aria-hidden="true"></span><span class="stage-feedback-words"><span class="stage-feedback-name">Archify</span><span class="stage-feedback-tagline">${labels.feedbackTagline}</span></span></a>
    <span class="stage-star-wrap"><a class="stage-star" href="https://github.com/tt-a1i/archify" target="_blank" rel="noopener noreferrer" aria-label="${labels.feedbackStarLabel}" aria-describedby="stage-star-tip"><span class="stage-gh" aria-hidden="true"></span><span class="stage-star-prompt">${labels.feedbackStarPrompt}</span><span class="stage-star-pill"><span class="stage-star-icon" aria-hidden="true"></span><span>${labels.feedbackStar}</span><span class="stage-star-arrow" aria-hidden="true">&#8599;</span></span></a><span class="stage-star-tip" id="stage-star-tip" role="tooltip"><strong>${labels.feedbackStarTitle}</strong><span>${labels.feedbackStarBody}</span></span></span>
    <details class="stage-feedback-menu" data-feedback-menu>
      <summary class="stage-feedback-btn"><span class="stage-feedback-icon" data-icon="chat" aria-hidden="true"></span><span>${labels.feedbackTrigger}</span></summary>
      <div class="stage-feedback-popover" role="menu" aria-label="${labels.feedbackTrigger}">
        <a class="stage-feedback-item" role="menuitem" href="https://github.com/tt-a1i/archify/issues/new/choose" target="_blank" rel="noopener noreferrer"><span class="stage-feedback-item-icon" data-icon="issue" aria-hidden="true"></span><span class="stage-feedback-item-copy"><strong>${labels.feedbackIssue}</strong><span>${labels.feedbackIssueHint}</span></span></a>
        <a class="stage-feedback-item" role="menuitem" href="mailto:2801884530@qq.com?subject=Archify%20feedback"><span class="stage-feedback-item-icon" data-icon="mail" aria-hidden="true"></span><span class="stage-feedback-item-copy"><strong>${labels.feedbackEmail}</strong><span>2801884530@qq.com</span></span></a>
        <div class="stage-feedback-divider" role="separator"></div>
        <button class="stage-feedback-item stage-feedback-copy" type="button" role="menuitem" data-copy-email="2801884530@qq.com" data-copied-text="${labels.feedbackCopied}"><span class="stage-feedback-item-icon" data-icon="copy" aria-hidden="true"></span><span class="stage-feedback-item-copy"><strong data-copy-label>${labels.feedbackCopyEmail}</strong></span></button>
      </div>
    </details>
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
