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
.header{height:52px;padding:8px 16px;border-bottom:1px solid var(--panel-border);display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:15px;font-weight:600;margin:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toolbar{display:flex;align-items:center;gap:8px;flex:none}button{font:inherit;color:var(--text);border:1px solid var(--panel-border);background:var(--panel);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;white-space:nowrap}button:focus-visible{outline:2px solid var(--backend-stroke);outline-offset:2px}#btn-reader-drawer[aria-expanded="true"]{border-color:var(--backend-stroke);background:color-mix(in srgb,var(--backend-stroke) 14%,var(--panel))}
.container{position:relative;display:block;padding:0;height:calc(100dvh - 52px);min-height:480px;overflow:hidden}.analysis-stage{width:100%;height:100%;min-width:0;min-height:0;position:relative;overflow:hidden}
html[data-analysis-mode="standalone"]:not([data-standalone-reader="open"]) #bauify-reader{display:none!important}
html[data-analysis-mode="standalone"][data-standalone-reader="open"] #bauify-reader{display:flex;position:fixed;top:60px;left:12px;bottom:12px;width:min(420px,calc(100vw - 24px));height:auto;max-height:none;margin:0;z-index:75;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.42)}
html[data-analysis-mode="standalone"] #bauify-atlas{position:absolute;inset:0;height:100%;z-index:2;border:0;border-radius:0}
html[data-analysis-mode="standalone"] #btn-bauify{display:none!important}
@media(max-width:600px){.header{padding:8px 12px;gap:8px}h1{font-size:14px}.header button{padding:5px 8px;font-size:11px}html[data-analysis-mode="standalone"][data-standalone-reader="open"] #bauify-reader{top:58px;left:10px;right:10px;bottom:10px;width:auto}}
</style></head><body>
<header class="header"><h1>${esc(title)} · ${esc(t('Code Analysis'))}</h1><nav class="toolbar" aria-label="${esc(t('Theme'))}"><button id="btn-reader-drawer" type="button" aria-expanded="false" aria-controls="bauify-reader">${esc(t('Diagnostics & AI tasks'))}</button><button id="btn-theme" type="button" aria-label="${esc(t('Toggle theme'))}">${esc(t('Toggle theme'))}</button></nav></header>
<main class="container"><section class="analysis-stage" aria-label="${esc(t('Code analysis atlas'))}"></section></main>
<script>(function(){var root=document.documentElement;function set(theme){root.setAttribute('data-theme',theme);document.getElementById('btn-theme').setAttribute('aria-pressed',String(theme==='light'));}var theme;try{theme=new URLSearchParams(location.search).get('theme')||localStorage.getItem('archify-theme');}catch(_){}set(theme==='light'?'light':'dark');document.getElementById('btn-theme').addEventListener('click',function(){var next=root.getAttribute('data-theme')==='light'?'dark':'light';set(next);try{localStorage.setItem('archify-theme',next);}catch(_){}});})();</script>
</body></html>`;
}
