// Standalone analysis has no authored components or fabricated architecture IR.
import { analysisLocale, createTranslator, messagesFor } from './i18n.mjs';

const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export function standaloneShell({ locale = 'en', title = 'Repository' } = {}) {
  locale = analysisLocale(locale);
  const t = createTranslator(messagesFor(locale));
  return `<!doctype html>
<html lang="${locale}" data-theme="dark" data-analysis-mode="standalone">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(t('Code Analysis'))}</title>
<style>
:root{color-scheme:dark;--bg:#020617;--text:#ffffff;--text-muted:#94a3b8;--panel:rgba(15,23,42,.5);--panel-border:#1e293b;--backend-stroke:#34d399}
[data-theme="light"]{color-scheme:light;--bg:#f4f5f7;--text:#111827;--text-muted:#596476;--panel:#ffffff;--panel-border:#dce1e8;--backend-stroke:#159f88}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
.header{padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:20px;margin:0;overflow-wrap:anywhere}.toolbar{display:flex;gap:8px;flex:none}button{font:inherit;color:var(--text);border:1px solid var(--panel-border);background:var(--panel);border-radius:7px;padding:7px 11px;cursor:pointer}button:focus-visible{outline:2px solid var(--backend-stroke);outline-offset:2px}.theme-icon{display:grid;place-items:center;width:34px;height:34px;padding:0;border-color:transparent;background:none;color:var(--text-muted)}.theme-icon:hover{color:var(--text);background:color-mix(in srgb,var(--text) 5%,transparent)}
.container{--analysis-reader-width:420px;display:grid;grid-template-columns:minmax(0,1fr) var(--analysis-reader-width);gap:16px;padding:0 16px 16px;height:calc(100dvh - 74px);min-height:480px;transition:grid-template-columns 320ms cubic-bezier(.22,.68,.20,1)}
html[data-bauify-source="on"] .container{--analysis-reader-width:min(760px,54vw)}
.analysis-reader-shell,.analysis-stage{min-width:0;min-height:0;position:relative;grid-row:1}
.analysis-reader-shell{grid-column:2}
.analysis-stage{grid-column:1}
.analysis-reader-shell{overflow:clip}
.reader-restore{position:absolute;inset:0;display:grid;place-items:center;padding:0;border:0;background:none;z-index:1}
.reader-restore[hidden]{display:none}
.reader-restore span{width:3px;height:36px;border-radius:2px;background:var(--text-muted);opacity:.6}
.reader-restore:hover span,.reader-restore:focus-visible span{background:var(--backend-stroke);opacity:1}
.reader-restore:focus-visible{outline-offset:-2px}
html[data-analysis-mode="standalone"] #bauify-reader{position:relative;inset:auto;width:100%;height:100%;max-width:none;max-height:none;margin:0;transition:opacity 220ms ease,transform 320ms cubic-bezier(.22,.68,.20,1),visibility 0ms}
html[data-analysis-mode="standalone"][data-bauify-reader-collapsed] .container{grid-template-columns:minmax(0,1fr) 20px}
html[data-analysis-mode="standalone"] #bauify-reader.collapsed{opacity:0;transform:translateX(100%);visibility:hidden;pointer-events:none;transition:opacity 180ms ease,transform 320ms cubic-bezier(.22,.68,.20,1),visibility 0ms 320ms}
html[data-analysis-mode="standalone"] #bauify-atlas{position:relative;inset:auto;height:100%;z-index:auto}
html[data-analysis-mode="standalone"] #btn-bauify{display:none}
@media(max-width:1000px){
  .header{flex-wrap:wrap}
  .container{display:block;height:auto;min-height:0;transition:none}
  .analysis-reader-shell{margin-bottom:16px}
  html[data-analysis-mode="standalone"] #bauify-reader{width:100%;height:min(66vh,600px)}
  html[data-analysis-mode="standalone"] #bauify-reader.collapsed{display:none}
  .reader-restore{position:relative;width:36px;height:28px}
  .reader-restore span{width:24px;height:3px}
  .analysis-stage{height:85vh;min-height:560px}
  html[data-analysis-mode="standalone"] #bauify-atlas .atlas-body{flex-direction:column;overflow:auto}
  html[data-analysis-mode="standalone"] #bauify-atlas .atlas-stage{height:min(100vw,70vh);flex:none}
  html[data-analysis-mode="standalone"] #bauify-atlas .atlas-side{width:auto;border-left:0;border-top:1px solid var(--panel-border);overflow:visible}
}
@media(prefers-reduced-motion:reduce){.container,html[data-analysis-mode="standalone"] #bauify-reader,html[data-analysis-mode="standalone"] #bauify-reader.collapsed{transition:none}}
</style></head><body>
<header class="header"><h1>${esc(title)} · ${esc(t('Code Analysis'))}</h1><nav class="toolbar" aria-label="${esc(t('Theme'))}"><button id="btn-theme" class="theme-icon" type="button" aria-label="${esc(t('Toggle theme'))}"></button></nav></header>
<main class="container"><section class="analysis-stage" aria-label="${esc(t('Code analysis atlas'))}"></section></main>
<script>
(function () {
  var root = document.documentElement, button = document.getElementById('btn-theme');
  var icons = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M20.5 14.4A8 8 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z"/>'
  };
  function set(theme) {
    var light = theme === 'light';
    var label = light ? ${JSON.stringify(t('Use dark theme'))} : ${JSON.stringify(t('Use light theme'))};
    root.setAttribute('data-theme', theme);
    button.setAttribute('aria-pressed', String(light));
    button.setAttribute('aria-label', label);
    button.dataset.analysisTip = label;
    button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + icons[light ? 'moon' : 'sun'] + '</svg>';
  }
  var theme;
  try { theme = new URLSearchParams(location.search).get('theme') || localStorage.getItem('archify-theme'); } catch (_) {}
  set(theme === 'light' ? 'light' : 'dark');
  button.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    set(next);
    try { localStorage.setItem('archify-theme', next); } catch (_) {}
  });
})();
</script>
</body></html>`;
}
