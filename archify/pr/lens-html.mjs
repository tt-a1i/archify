import { createHash } from 'node:crypto';
import { softwareNotices } from '../renderers/shared/software-notices.mjs';
import { assertReviewText } from './manifest.mjs';
import { escapeHtml, sha256 } from './markdown.mjs';
import { alignPayloadLines, runLens } from './lens-runtime.mjs';

const css = `
:root {
  color-scheme: light;
  scrollbar-gutter: stable;
  --paper:#f4f5f7; --panel:#fff; --sunk:#f6f7fa; --ink:#171b24; --secondary:#313945; --muted:#596577;
  --rule:#e0e4eb; --strong:#ccd3dc; --lens-accent:#2657ce; --tint:#e9effc; --link:#1b46b4;
  --green:#116941; --green-bg:#e9f5ee; --red:#a52f36; --red-bg:#fcebed; --amber:#8b5610; --amber-bg:#fdf3e2;
  --mono:"JetBrains Mono",ui-monospace,monospace;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper:#0d0f13; --panel:#16191f; --sunk:#1c2028; --ink:#f0f2f7; --secondary:#cdd2dc; --muted:#a3adbd;
  --rule:#2b323e; --strong:#414b5a; --lens-accent:#83a8ff; --tint:#1a2743; --link:#abc5ff;
  --green:#86d6a9; --green-bg:#162b22; --red:#f3a3a1; --red-bg:#352022; --amber:#edbb69; --amber-bg:#302618;
}
* { box-sizing:border-box; }
[hidden] { display:none !important; }
body { margin:0; background:var(--paper); color:var(--secondary); font:14px/1.5 system-ui,sans-serif; }
h1,h2,h3,p,ol,ul,pre { margin:0; }
h1,h2,h3 { color:var(--ink); }
h1 { margin:.25em 0 .15em; font-size:clamp(25px,3.4vw,48px); line-height:1.15; letter-spacing:-.045em; overflow-wrap:anywhere; }
h2 { font-size:15px; }
h3 { font-size:13px; }
button,select { font:inherit; color:inherit; background:var(--panel); border:1px solid var(--strong); border-radius:5px; }
button { cursor:pointer; padding:5px 10px; }
button:hover:not(:disabled) { color:var(--ink); background:var(--tint); }
button:disabled { cursor:default; opacity:.48; }
:focus-visible { outline:2px solid var(--lens-accent); outline-offset:2px; }
code,kbd,.mono,.ordinal,.meta,.counts,.paging,.mark { font-family:var(--mono); }
.shell { width:min(1440px,calc(100% - 64px)); margin-inline:auto; }
.masthead { background:var(--panel); border-bottom:1px solid var(--rule); }
.mast { min-height:58px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:650; color:var(--ink); }
.brand svg { width:25px; height:25px; color:var(--lens-accent); }
.brand strong { font-size:18px; letter-spacing:-.035em; }
.brand span { border-left:1px solid var(--strong); padding-left:10px; color:var(--secondary); }
.overview { padding:24px 0 17px; }
#summary { overflow-wrap:anywhere; }
.meta,.counts,.tools,.segmented,.toolbar,.paging,.step-meta,.facts { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.meta,.counts,.facts { font-size:12px; color:var(--muted); overflow-wrap:anywhere; }
.meta>span,.counts>li { border:1px solid var(--rule); border-radius:5px; padding:3px 8px; background:var(--panel); }
.meta .pr-number { color:var(--link); background:var(--tint); }
.counts,.facts { list-style:none; padding:0; }
.counts { margin-top:12px; }
.facts { gap:6px 20px; margin-top:10px; }
.facts:empty,.counts:empty { display:none; }
.facts li::before { content:"▪"; color:var(--lens-accent); margin-right:8px; }
.toolbar { justify-content:space-between; padding:9px 0; margin-bottom:14px; border-block:1px solid var(--rule); }
.segmented { gap:2px; padding:3px; border:1px solid var(--strong); border-radius:8px; background:var(--sunk); flex-wrap:nowrap; }
.segmented button { white-space:nowrap; border-color:transparent; background:none; color:var(--muted); }
.segmented button[aria-pressed="true"] { background:var(--panel); border-color:var(--strong); color:var(--ink); }
.progress-info { display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; font-size:12px; }
progress { width:90px; accent-color:var(--green); }
kbd { padding:1px 4px; border:1px solid var(--rule); border-radius:4px; }
.board { display:grid; grid-template-columns:minmax(235px,1fr) minmax(0,2.15fr); gap:14px; align-items:start; }
.stage { display:grid; gap:12px; min-width:0; }
.panel { background:var(--panel); border:1px solid var(--rule); border-radius:10px; min-width:0; box-shadow:0 1px 2px #0001; }
.panel-head { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:44px; padding:7px 12px; border-bottom:1px solid var(--rule); }
.paging { flex-wrap:nowrap; font-size:11px; color:var(--muted); }
.paging button { padding:1px 7px; font-size:16px; }
.steps { list-style:none; padding:5px; max-height:65vh; overflow:auto; }
.step:not(:last-child)::after { content:""; position:absolute; top:34px; bottom:-10px; left:20px; border-left:1px solid var(--rule); pointer-events:none; }
.step { position:relative; border:1px solid transparent; border-radius:7px; padding:7px 9px 8px 43px; overflow-wrap:anywhere; }
.step + .step { margin-top:3px; }
.step.active { background:var(--tint); border-color:color-mix(in srgb,var(--lens-accent) 35%,var(--rule)); }
.step:not(.active):hover { background:var(--sunk); }
.step-button { border:0; border-radius:3px; background:none; padding:0; width:100%; text-align:left; }
.ordinal { position:absolute; top:8px; left:9px; display:grid; place-items:center; width:24px; height:24px; border:1px solid var(--strong); border-radius:50%; font-size:11px; color:var(--muted); }
.active .ordinal { border-color:var(--lens-accent); color:var(--link); background:var(--panel); }
.step-title { display:block; color:var(--ink); font-weight:650; }
.step-body,.step-path { display:block; margin-top:4px; font-size:12px; }
.step-meta { justify-content:space-between; margin-top:5px; }
.review { margin-inline-start:auto; display:flex; align-items:center; gap:4px; font-size:12px; color:var(--muted); cursor:pointer; }
.review input { accent-color:var(--green); }
.changes { list-style:none; padding:0; margin-top:6px; font-size:12px; }
.changes li { display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 6px; margin:3px 0; }
.mark { font-size:10px; border:1px solid var(--rule); border-radius:4px; padding:0 4px; }
.muted,.step-path { color:var(--muted); }
.added { color:var(--green); }
.removed { color:var(--red); }
.modified { color:var(--amber); }
.tabs { display:flex; min-width:0; overflow:auto; padding-inline:7px; border-bottom:1px solid var(--rule); }
.tabs button { border:0; border-radius:0; border-bottom:2px solid transparent; color:var(--muted); padding:9px; white-space:nowrap; background:none; }
.tabs button[aria-selected="true"] { border-color:var(--lens-accent); color:var(--ink); font-weight:650; }
.tabs button:focus-visible { outline-offset:-3px; }
.tabs small { margin-inline-start:6px; font:11px var(--mono); color:var(--muted); }
#canvas { overflow:auto; max-height:clamp(300px,44vh,550px); scrollbar-color:var(--strong) var(--panel); }
#canvas:focus-visible { outline-offset:-2px; }
.caption { height:40px; display:grid; align-items:center; border-top:1px solid var(--rule); padding:0 11px; font-size:12px; overflow:auto; }
.filebar { display:flex; justify-content:space-between; align-items:center; gap:6px 10px; flex-wrap:wrap; padding:6px 11px; border-bottom:1px solid var(--rule); background:var(--sunk); font:11px/1.55 var(--mono); overflow-wrap:anywhere; }
.filebar:has(#diff-path):not(:has(label:not([hidden]), span:not(:empty))) { display:none; }
.filebar select { max-width:min(100%,31ch); margin-inline-start:6px; }
.evidence-scroll { overflow:auto; max-height:230px; min-height:100px; scrollbar-color:var(--strong) var(--panel); }
.diff-content,.payload-table { font:12px/1.55 var(--mono); min-width:max-content; }
.hunk { display:block; color:var(--link); background:var(--tint); padding:3px 11px; white-space:pre; }
.diff-line { display:grid; grid-template-columns:5ch 5ch 2ch auto; min-height:1.55em; }
.diff-line code,.payload-row code,.sample { white-space:pre; }
.diff-line code { padding-inline-end:12px; }
.line-number { text-align:end; padding-inline-end:5px; color:var(--muted); border-right:1px solid var(--rule); user-select:none; }
.sign { text-align:center; user-select:none; }
.addition { background:var(--green-bg); }
.deletion { background:var(--red-bg); }
.empty,.payload-note,.sample { padding:8px 11px; }
.empty,.payload-note { color:var(--muted); font-size:12px; }
.payload-row { display:grid; grid-template-columns:minmax(24ch,1fr) minmax(24ch,1fr); }
.payload-row > * { padding-inline:10px; min-height:1.55em; }
.payload-row > :last-child { border-left:1px solid var(--rule); }
.payload-head { background:var(--sunk); color:var(--ink); padding-block:3px; border-block:1px solid var(--rule); }
.sample { font:12px/1.55 var(--mono); }
#unassigned { margin-top:12px; }
.pan-hint { display:none; }
.footer { margin-top:14px; border-top:1px solid var(--rule); padding-block:10px 15px; gap:8px; display:flex; align-items:center; justify-content:space-between; color:var(--muted); font-size:12px; }
dialog { width:min(690px,calc(100% - 32px)); color:var(--secondary); background:var(--panel); border:1px solid var(--strong); border-radius:10px; padding:0; }
dialog::backdrop { background:#0008; }
dialog pre { max-height:65vh; overflow:auto; padding:14px; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.5 var(--mono); }
@media(max-width:800px) {
  .shell { width:calc(100% - 26px); }
  .board { grid-template-columns:minmax(0,1fr); }
  .steps { max-height:245px; }
  #canvas { max-height:52vh; }
  .pan-hint { display:block; padding:4px 11px; font-size:11px; color:var(--muted); }
}
@media(max-width:490px) {
  .mast { min-height:51px; }
  .brand svg { display:none; }
  .brand { gap:6px; }
  .brand span { padding-left:6px; }
  .tools button { padding-inline:6px; }
  .shortcuts { display:none; }
  .toolbar { gap:8px; }
}
`;

const page = `
<header class="masthead"><div class="shell mast">
  <div class="brand">
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M6 6h16v16H6zM6 14h16" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <g fill="var(--panel)" stroke="currentColor" stroke-width="1.4">
        <rect x="3" y="3" width="6" height="6" rx="1"/><rect x="19" y="3" width="6" height="6" rx="1"/>
        <rect x="3" y="19" width="6" height="6" rx="1"/><rect x="19" y="19" width="6" height="6" rx="1"/>
      </g><circle cx="14" cy="14" r="2.4" fill="currentColor"/>
    </svg>
    <strong>Archify</strong><span>PR Lens</span>
  </div>
  <div class="tools"><div class="segmented" role="group" aria-label="Theme">
    <button data-theme-choice="dark" aria-pressed="true">Dark</button>
    <button data-theme-choice="light" aria-pressed="false">Light</button>
  </div></div>
</div></header>
<main class="shell">
  <section class="overview" aria-labelledby="title">
    <div class="meta" id="meta"></div><h1 id="title"></h1><p id="summary"></p>
    <ul class="counts" id="counts" aria-label="Change counts"></ul>
    <ul class="facts" id="facts" aria-label="Declared facts"></ul>
    <section id="unassigned" hidden><h2>Changes without a view</h2></section>
  </section>
  <div class="toolbar">
    <div class="segmented" role="group" aria-label="Diagram version">
      <button data-mode-choice="delta" aria-pressed="true">Delta</button>
      <button data-mode-choice="before" aria-pressed="false">Before</button>
      <button data-mode-choice="after" aria-pressed="false">After</button>
    </div>
    <div class="progress-info">
      <output id="progress-label" for="progress" aria-live="polite"></output>
      <progress id="progress" aria-label="Walkthrough progress"></progress>
      <span id="storage-note" class="muted" hidden>Progress lasts until reload.</span>
      <span class="shortcuts muted"><kbd>J</kbd> <kbd>K</kbd> or <kbd>←</kbd> <kbd>→</kbd> to move between steps</span>
    </div>
  </div>
  <div class="board">
    <section class="panel" aria-labelledby="walkthrough-title">
      <div class="panel-head"><h2 id="walkthrough-title">Walkthrough</h2>
        <div class="paging"><button id="previous" aria-label="Previous step">‹</button>
          <span id="step-count"></span><button id="next" aria-label="Next step">›</button></div>
      </div>
      <ol class="steps" id="steps"></ol>
    </section>
    <div class="stage">
      <section class="panel" aria-label="Change diagrams">
        <div class="tabs" id="view-tabs" role="tablist" aria-label="Diagram views"></div>
        <div id="canvas" role="tabpanel" tabindex="0"></div>
        <p class="pan-hint">Scroll the diagram to see more.</p>
        <p id="diagram-caption" class="caption"></p>
      </section>
      <section class="panel" aria-labelledby="evidence-title">
        <div class="panel-head"><h2 id="evidence-title">Evidence</h2></div>
        <div class="tabs" id="evidence-tabs" role="tablist" aria-label="Evidence type">
          <button id="diff-tab" role="tab" aria-controls="diff-panel">Git diff</button>
          <button id="payload-tab" role="tab" aria-controls="payload-panel">Payload</button>
        </div>
        <section id="diff-panel" role="tabpanel" aria-labelledby="diff-tab">
          <div class="filebar"><span id="diff-path"></span>
            <label hidden>Source slice<select id="slices"></select></label>
          </div>
          <div id="diff" class="evidence-scroll" data-evidence-scroll tabindex="0" aria-label="Diff with base and head line numbers"></div>
        </section>
        <section id="payload-panel" role="tabpanel" aria-labelledby="payload-tab" hidden>
          <div class="filebar"><label hidden>Payload edge<select id="payloads"></select></label></div>
          <div id="payload" class="evidence-scroll" data-evidence-scroll tabindex="0" aria-label="Authored payload"></div>
        </section>
      </section>
    </div>
  </div>
</main>
<footer class="shell footer"><span>Local review file</span><button id="notices-button">Notices</button></footer>
<dialog id="notices" aria-labelledby="notices-title">
  <div class="panel-head"><h2 id="notices-title">Software notices</h2><button id="close-notices" autofocus>Close</button></div>
  <pre id="notice-text" tabindex="0"></pre>
</dialog>`;

export function serializeLensData(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

const cspHash = (block) => `'sha256-${createHash('sha256').update(block).digest('base64')}'`;

export function compileLensHtml(model, scenes, fontCss) {
  assertReviewText({ ...model, notices: softwareNotices });
  const digest = sha256(JSON.stringify([model, scenes.map(({ svg, css }) => [svg, css])]));
  const data = serializeLensData({ ...model, digest, notices: softwareNotices });
  const runtime = `(${runLens.toString()})(${alignPayloadLines.toString()});`;
  const sheet = `${fontCss}\n${css}`;
  const hashes = [...new Set([sheet, ...scenes.map((scene) => scene.css)].map(cspHash))];
  const csp = [
    "default-src 'none'", "base-uri 'none'", "object-src 'none'", "connect-src 'none'",
    "frame-src 'none'", "worker-src 'none'", "form-action 'none'",
    `script-src ${cspHash(runtime)}`, "script-src-attr 'none'",
    `style-src ${hashes.join(' ')}`, "style-src-attr 'none'", 'font-src data:', 'img-src data:',
  ].join('; ');
  const templates = scenes.map(({ svg, css }, index) => `<template id="scene-${index}"><style>${css}</style>${svg}</template>`).join('\n');
  const html = `<!doctype html>
<html lang="en" data-theme="dark" data-mode="delta">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)} · PR Lens</title>
<style>${sheet}</style>
</head>
<body>${page}
${templates}
<script id="lens-data" type="application/json">${data}</script>
<script>${runtime}</script>
</body>
</html>
`;
  assertReviewText(html);
  return html;
}
