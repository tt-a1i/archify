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
.header{padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:20px;margin:0;overflow-wrap:anywhere}.toolbar{display:flex;gap:8px;flex:none}button{font:inherit;color:var(--text);border:1px solid var(--panel-border);background:var(--panel);border-radius:7px;padding:7px 11px;cursor:pointer}button:focus-visible{outline:2px solid var(--backend-stroke);outline-offset:2px}
.container{display:grid;grid-template-columns:420px minmax(0,1fr);gap:16px;padding:0 16px 16px;height:calc(100dvh - 74px);min-height:480px}.analysis-stage{min-width:0;min-height:0;position:relative}
html[data-analysis-mode="standalone"] #bauify-reader{display:flex;position:relative;inset:auto;width:auto;height:100%;max-height:none;margin:0}
html[data-analysis-mode="standalone"] #bauify-atlas{position:relative;inset:auto;height:100%;z-index:auto}
html[data-analysis-mode="standalone"] .reader-toggle,html[data-analysis-mode="standalone"] #btn-bauify{display:none}
@media(max-width:1000px){.header{flex-wrap:wrap}.container{display:block;height:auto;min-height:0}html[data-analysis-mode="standalone"] #bauify-reader{height:min(66vh,600px);margin:0 0 16px}html[data-analysis-mode="standalone"] #bauify-reader.collapsed{height:auto;min-height:0}html[data-analysis-mode="standalone"] .reader-toggle{display:block}.analysis-stage{height:85vh;min-height:560px}html[data-analysis-mode="standalone"] #bauify-atlas .atlas-body{flex-direction:column;overflow:auto}html[data-analysis-mode="standalone"] #bauify-atlas .atlas-stage{height:min(100vw,70vh);flex:none}html[data-analysis-mode="standalone"] #bauify-atlas .atlas-side{width:auto;border-left:0;border-top:1px solid var(--panel-border);overflow:visible}}
</style></head><body>
<header class="header"><h1>${esc(title)} · ${esc(t('Code Analysis'))}</h1><nav class="toolbar" aria-label="${esc(t('Theme'))}"><button id="btn-theme" type="button" aria-label="${esc(t('Toggle theme'))}">${esc(t('Toggle theme'))}</button></nav></header>
<main class="container"><section class="analysis-stage" aria-label="${esc(t('Code analysis atlas'))}"></section></main>
<script>(function(){var root=document.documentElement;function set(theme){root.setAttribute('data-theme',theme);document.getElementById('btn-theme').setAttribute('aria-pressed',String(theme==='light'));}var theme;try{theme=new URLSearchParams(location.search).get('theme')||localStorage.getItem('archify-theme');}catch(_){}set(theme==='light'?'light':'dark');document.getElementById('btn-theme').addEventListener('click',function(){var next=root.getAttribute('data-theme')==='light'?'dark':'light';set(next);try{localStorage.setItem('archify-theme',next);}catch(_){}});})();</script>
</body></html>`;
}
