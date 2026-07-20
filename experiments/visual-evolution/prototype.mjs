#!/usr/bin/env node

// PROTOTYPE — three visual directions for one real workflow artifact,
// switchable with ?variant=signal|blueprint|ember and a floating bottom bar.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const skillRoot = path.join(repoRoot, 'archify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-prototype-'));
const input = path.join(tmp, 'workflow.json');
const rendered = path.join(tmp, 'workflow.html');
const output = path.join(here, 'prototype.html');

try {
  const source = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples/agent-tool-call.workflow.json'),
    'utf8',
  ));
  // Keep the three experimental treatments isolated from the production
  // preset now carried by the bundled workflow example.
  source.meta = { ...source.meta, animation: 'trace', visual_preset: 'classic' };
  delete source.meta.output;
  fs.writeFileSync(input, `${JSON.stringify(source, null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers/workflow/render-workflow.mjs'),
    input,
    rendered,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'workflow render failed');
  }

  let html = fs.readFileSync(rendered, 'utf8');
  html = html.replace('</head>', `${prototypeStyle()}\n</head>`);
  html = html.replace('</body>', `${prototypeSwitcher()}\n${prototypeScript()}\n</body>`);
  fs.writeFileSync(output, html);
  console.log(output);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function prototypeStyle() {
  return `  <style id="archify-visual-evolution-prototype">
    /* PROTOTYPE ONLY — intentionally isolated from the production template. */
    html { --prototype-accent: #67e8f9; }
    body { background-attachment: fixed; }
    .container, .header, .diagram-container, .cards, .footer {
      transition: background .25s ease, border-color .25s ease, box-shadow .25s ease,
                  transform .25s ease, color .25s ease;
    }

    /* A — Signal Flow: luminous, layered, motion-forward. */
    html[data-prototype-variant="signal"] {
      --bg: #030711;
      --grid: #15233a;
      --panel: rgba(6, 14, 28, .78);
      --panel-border: #1d3350;
      --lane-fill: rgba(9, 22, 40, .5);
      --lane-stroke: #2c4564;
      --text: #f5fbff;
      --text-muted: #9eb0c7;
      --text-dim: #52667f;
      --frontend-fill: rgba(6, 182, 212, .14);
      --frontend-stroke: #67e8f9;
      --backend-fill: rgba(16, 185, 129, .14);
      --backend-stroke: #5eead4;
      --database-fill: rgba(139, 92, 246, .16);
      --database-stroke: #c4b5fd;
      --cloud-fill: rgba(245, 158, 11, .13);
      --cloud-stroke: #fcd34d;
      --security-fill: rgba(244, 63, 94, .13);
      --security-stroke: #fda4af;
      --messagebus-fill: rgba(249, 115, 22, .13);
      --messagebus-stroke: #fdba74;
      --external-fill: rgba(71, 85, 105, .24);
      --external-stroke: #a5b4c7;
      --arrow: #7890ad;
      --arrow-emphasis: #2dd4bf;
      --prototype-accent: #67e8f9;
    }
    html[data-prototype-variant="signal"] body {
      background-image:
        radial-gradient(circle at 18% -8%, rgba(34, 211, 238, .14), transparent 34rem),
        radial-gradient(circle at 92% 18%, rgba(139, 92, 246, .12), transparent 30rem);
    }
    html[data-prototype-variant="signal"] .header-row::after {
      content: "SIGNAL FLOW / LIVE";
      margin-left: auto;
      color: var(--frontend-stroke);
      border: 1px solid color-mix(in srgb, var(--frontend-stroke) 45%, transparent);
      border-radius: 999px;
      padding: .28rem .6rem;
      font-size: .625rem;
      letter-spacing: .12em;
      box-shadow: 0 0 20px rgba(34, 211, 238, .12);
    }
    html[data-prototype-variant="signal"] .diagram-container {
      position: relative;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(8, 20, 38, .82), rgba(3, 8, 18, .94));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 28px 80px rgba(0,0,0,.34);
    }
    html[data-prototype-variant="signal"] .diagram-container::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(115deg, transparent 28%, rgba(103,232,249,.035) 48%, transparent 68%);
      transform: translateX(-70%);
      animation: prototype-scan 6s ease-in-out infinite;
    }
    html[data-prototype-variant="signal"] .card {
      background: linear-gradient(145deg, rgba(10,24,43,.86), rgba(5,12,24,.92));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
    }
    html[data-prototype-variant="signal"] svg[data-animation="trace"] [data-animate="edge"] {
      stroke-linecap: round;
      filter: drop-shadow(0 0 3px var(--arrow-emphasis));
      animation-duration: 1.75s;
    }
    html[data-prototype-variant="signal"] svg[data-animation="trace"] [data-animate="node"] {
      animation-duration: 3.1s;
    }

    /* B — Blueprint Review: denser inspector layout and drafting semantics. */
    html[data-prototype-variant="blueprint"] {
      --bg: #061426;
      --grid: #1c4b73;
      --panel: #081b31;
      --panel-border: #2b668f;
      --lane-fill: rgba(8, 35, 61, .62);
      --lane-stroke: #3b7398;
      --text: #e9f7ff;
      --text-muted: #91b8cf;
      --text-dim: #4d7895;
      --frontend-fill: rgba(14, 116, 144, .08);
      --frontend-stroke: #6ee7f9;
      --backend-fill: rgba(8, 145, 178, .08);
      --backend-stroke: #7dd3fc;
      --database-fill: rgba(59, 130, 246, .08);
      --database-stroke: #93c5fd;
      --cloud-fill: rgba(2, 132, 199, .08);
      --cloud-stroke: #bae6fd;
      --security-fill: rgba(56, 189, 248, .07);
      --security-stroke: #38bdf8;
      --messagebus-fill: rgba(125, 211, 252, .08);
      --messagebus-stroke: #7dd3fc;
      --external-fill: rgba(14, 116, 144, .07);
      --external-stroke: #7dd3fc;
      --arrow: #5c8bad;
      --arrow-emphasis: #67e8f9;
      --prototype-accent: #7dd3fc;
    }
    html[data-prototype-variant="blueprint"] body { padding: 1.25rem; }
    html[data-prototype-variant="blueprint"] .container {
      max-width: 1480px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      grid-template-areas: "header header" "diagram cards" "footer footer";
      gap: 1rem;
    }
    html[data-prototype-variant="blueprint"] .header {
      grid-area: header;
      margin: 0;
      border-block: 1px solid var(--panel-border);
      padding: .8rem 0;
    }
    html[data-prototype-variant="blueprint"] .header-row { margin: 0; }
    html[data-prototype-variant="blueprint"] h1 {
      text-transform: uppercase;
      letter-spacing: .08em;
      font-size: 1.1rem;
    }
    html[data-prototype-variant="blueprint"] .subtitle { margin: .35rem 0 0 1.7rem; }
    html[data-prototype-variant="blueprint"] .diagram-container {
      grid-area: diagram;
      border-radius: 0;
      border-style: dashed;
      background-color: rgba(4, 21, 39, .86);
      background-image:
        linear-gradient(rgba(51, 125, 173, .08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(51, 125, 173, .08) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    html[data-prototype-variant="blueprint"] .cards {
      grid-area: cards;
      display: flex;
      flex-direction: column;
      gap: .65rem;
      margin: 0;
    }
    html[data-prototype-variant="blueprint"] .card {
      border-radius: 0;
      border-style: dashed;
      padding: .9rem;
    }
    html[data-prototype-variant="blueprint"] .footer { grid-area: footer; margin: 0; }
    html[data-prototype-variant="blueprint"] svg[data-animation="trace"] [data-animate="edge"] {
      stroke-dasharray: 4 5;
      animation-duration: 2.8s;
    }

    /* C — Ember Ops: cards become a status rail above a cinematic canvas. */
    html[data-prototype-variant="ember"] {
      --bg: #0b0807;
      --grid: #30201a;
      --panel: rgba(24, 15, 12, .84);
      --panel-border: #4b2b20;
      --lane-fill: rgba(42, 24, 18, .38);
      --lane-stroke: #69402f;
      --text: #fff8f0;
      --text-muted: #c9aa96;
      --text-dim: #775648;
      --frontend-fill: rgba(249, 115, 22, .12);
      --frontend-stroke: #fb923c;
      --backend-fill: rgba(245, 158, 11, .12);
      --backend-stroke: #fbbf24;
      --database-fill: rgba(239, 68, 68, .11);
      --database-stroke: #f87171;
      --cloud-fill: rgba(251, 191, 36, .10);
      --cloud-stroke: #fde68a;
      --security-fill: rgba(244, 63, 94, .12);
      --security-stroke: #fb7185;
      --messagebus-fill: rgba(234, 88, 12, .13);
      --messagebus-stroke: #fdba74;
      --external-fill: rgba(120, 53, 15, .16);
      --external-stroke: #d6a47f;
      --arrow: #a06f59;
      --arrow-emphasis: #fb923c;
      --prototype-accent: #fb923c;
    }
    html[data-prototype-variant="ember"] body {
      background-image: radial-gradient(circle at 50% -20%, rgba(249,115,22,.17), transparent 44rem);
    }
    html[data-prototype-variant="ember"] .container {
      max-width: 1320px;
      display: flex;
      flex-direction: column;
    }
    html[data-prototype-variant="ember"] .header {
      text-align: center;
      margin-bottom: 1rem;
    }
    html[data-prototype-variant="ember"] .header-row { justify-content: center; }
    html[data-prototype-variant="ember"] .subtitle { margin-left: 0; }
    html[data-prototype-variant="ember"] .cards {
      order: 1;
      grid-template-columns: repeat(3, 1fr);
      margin: 0 0 .75rem;
      gap: .5rem;
    }
    html[data-prototype-variant="ember"] .diagram-container {
      order: 2;
      border-radius: .25rem;
      border-color: #7c3b23;
      box-shadow: 0 0 0 1px rgba(251,146,60,.08), 0 30px 90px rgba(0,0,0,.44);
    }
    html[data-prototype-variant="ember"] .card {
      padding: .8rem 1rem;
      border-radius: .25rem;
      border-top: 2px solid var(--prototype-accent);
      background: linear-gradient(180deg, rgba(47,26,18,.88), rgba(24,15,12,.92));
    }
    html[data-prototype-variant="ember"] .footer { order: 3; }
    html[data-prototype-variant="ember"] svg[data-animation="trace"] [data-animate="edge"] {
      stroke-dasharray: 14 10;
      filter: drop-shadow(0 0 4px rgba(251,146,60,.65));
      animation-duration: 2.05s;
    }

    @keyframes prototype-scan {
      0%, 15% { transform: translateX(-75%); }
      68%, 100% { transform: translateX(75%); }
    }

    .prototype-switcher {
      position: fixed;
      left: 50%;
      bottom: 1rem;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: .35rem;
      transform: translateX(-50%);
      padding: .35rem;
      border: 1px solid rgba(148,163,184,.35);
      border-radius: 999px;
      background: rgba(2,6,23,.92);
      box-shadow: 0 14px 40px rgba(0,0,0,.45);
      backdrop-filter: blur(14px);
      font: 600 11px/1.2 'JetBrains Mono', monospace;
      color: #e2e8f0;
    }
    .prototype-switcher button {
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 50%;
      background: rgba(148,163,184,.12);
      color: inherit;
      cursor: pointer;
    }
    .prototype-switcher button:hover { background: rgba(148,163,184,.24); }
    .prototype-switcher output { min-width: 13.5rem; text-align: center; }
    .prototype-switcher .prototype-key { color: var(--prototype-accent); }
    @media (max-width: 900px) {
      html[data-prototype-variant="blueprint"] .container { display: block; }
      html[data-prototype-variant="blueprint"] .cards { margin-top: 1rem; }
      html[data-prototype-variant="ember"] .cards { grid-template-columns: 1fr; }
    }
  </style>`;
}

function prototypeSwitcher() {
  return `  <div class="prototype-switcher no-print" aria-label="Visual prototype variants">
    <button type="button" data-prototype-direction="-1" aria-label="Previous variant">&#8592;</button>
    <output id="prototype-label" aria-live="polite"></output>
    <button type="button" data-prototype-direction="1" aria-label="Next variant">&#8594;</button>
  </div>`;
}

function prototypeScript() {
  return `  <script>
    (function () {
      var variants = [
        { key: 'signal', name: 'Signal Flow' },
        { key: 'blueprint', name: 'Blueprint Review' },
        { key: 'ember', name: 'Ember Ops' }
      ];
      var params = new URLSearchParams(window.location.search);
      var selected = params.get('variant');
      var index = Math.max(0, variants.findIndex(function (v) { return v.key === selected; }));
      var label = document.getElementById('prototype-label');

      function apply(nextIndex, replace) {
        index = (nextIndex + variants.length) % variants.length;
        var variant = variants[index];
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.setAttribute('data-prototype-variant', variant.key);
        label.innerHTML = '<span class="prototype-key">' + (index + 1) + '/' + variants.length + '</span> — ' + variant.name;
        params.set('variant', variant.key);
        var url = window.location.pathname + '?' + params.toString() + window.location.hash;
        history[replace ? 'replaceState' : 'pushState'](null, '', url);
      }

      document.querySelectorAll('[data-prototype-direction]').forEach(function (button) {
        button.addEventListener('click', function () {
          apply(index + Number(button.dataset.prototypeDirection), false);
        });
      });
      document.addEventListener('keydown', function (event) {
        var target = event.target;
        if (target && (target.matches('input,textarea,[contenteditable]'))) return;
        if (event.key === 'ArrowLeft') { event.preventDefault(); apply(index - 1, false); }
        if (event.key === 'ArrowRight') { event.preventDefault(); apply(index + 1, false); }
      });
      window.addEventListener('popstate', function () {
        var key = new URLSearchParams(window.location.search).get('variant');
        var found = variants.findIndex(function (v) { return v.key === key; });
        apply(found < 0 ? 0 : found, true);
      });
      apply(index, true);
    })();
  </script>`;
}
