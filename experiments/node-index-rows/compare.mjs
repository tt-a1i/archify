import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';

const experiment = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(experiment, '../..');
const output = process.argv[2];
assert.ok(output, 'Pass an output directory outside the repository');
fs.mkdirSync(output, { recursive: true });
const bottomSelector = 'html[data-reader-rail="bottom"]';
const comparisonSelector = 'html:is([data-reader-rail="bottom"], [data-node-index-prototype-narrow])';
const variants = new Map([['columns', ''], ...[['rows', 'prototype.css'], ['compact', 'compact.css'], ['continuation', 'continuation.css']]
  .map(([name, file]) => [name, fs.readFileSync(path.join(experiment, file), 'utf8').replaceAll(bottomSelector, comparisonSelector)])]);
const fixtures = new Map([['sample-web-app', fs.readFileSync(path.join(root, 'examples/web-app-rendered.html'), 'utf8')]]);
const stress = {
  schema_version: 1, diagram_type: 'architecture',
  meta: { title: 'Uneven groups and long bilingual labels', output: 'stress.html', viewBox: [2500, 1250] },
  components: Array.from({ length: 26 }, (_, i) => ({
    id: `node-${i}`, type: i % 3 ? 'backend' : 'database',
    label: i % 2 ? `Authorization policy and audit service ${i}` : `跨区域订单处理与权限校验服务节点 ${i}`,
    sublabel: i % 2 ? 'Tenant-aware policy decisions with durable audit records' : '用于跨区域处理、审计追踪与长期持久化的内部服务',
    pos: [50 + (i % 4) * 340, 85 + Math.floor(i / 4) * 155], size: [310, 75],
  })),
  boundaries: [
    { kind: 'region', label: 'Small group', wraps: ['node-0', 'node-1'] },
    { kind: 'region', label: '跨区域服务分组 / Long English service group', wraps: Array.from({ length: 24 }, (_, i) => `node-${i + 2}`) },
  ],
  connections: [],
};
const input = path.join(output, 'stress.json');
const rendered = path.join(output, 'stress-source.html');
fs.writeFileSync(input, JSON.stringify(stress));
execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'architecture', input, rendered]);
fixtures.set('stress', fs.readFileSync(rendered, 'utf8'));
const browser = new ChromeVisualBrowser(findChrome());
const observations = [];
try {
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  for (const [name, original] of fixtures) {
    for (const width of [1440, 390]) {
      for (const theme of ['light', 'dark']) {
        let baseline;
        let baselineInteraction;
        for (const [variant, css] of variants) {
          const candidate = variant !== 'columns';
          // Expose the existing bottom CSS under a separate experiment attribute
          // at narrow widths; the reader does not own or clear this attribute.
          const comparison = original.replaceAll(bottomSelector, comparisonSelector).replace('</head>',
            '<script>if(innerWidth<768)document.documentElement.setAttribute("data-node-index-prototype-narrow", "")</script></head>');
          const html = candidate ? comparison.replace('</head>', `<style>${css}</style></head>`) : comparison;
          const label = `${name}-${width}-${theme}-${variant}`;
          const artifact = path.join(output, `${label}.html`);
          fs.writeFileSync(artifact, html);
          await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
          const url = pathToFileURL(artifact); url.searchParams.set('theme', theme);
          const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
          await send('Page.navigate', { url: url.href }); await loaded;
          const measured = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
            await document.fonts.ready; await Archify.layoutStability.whenStable();
            const panel = document.getElementById('node-outline');
            const items = [...panel.querySelectorAll('[data-outline-node]')];
            const svg = document.querySelector('.diagram-container > svg');
            return {
              rail: document.documentElement.getAttribute('data-reader-rail'),
              narrowPanelExperiment: document.documentElement.hasAttribute('data-node-index-prototype-narrow'),
              scrollWidth: document.documentElement.scrollWidth,
              panelHeight: panel.getBoundingClientRect().height,
              svg: svg.outerHTML,
              items: items.map(item => ({id:item.dataset.outlineNode, text:item.textContent, tone:item.style.getPropertyValue('--outline-tone')})),
              clipped: items.flatMap(item => [...item.querySelectorAll('strong,small')]).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)
            };
          })()` });
          assert.equal(measured.exceptionDetails, undefined);
          const value = measured.result.value;
          if (!candidate) baseline = structuredClone(value);
          else {
            assert.deepEqual(value.items, baseline.items, `${label}: order, text or category changed`);
            assert.equal(value.svg, baseline.svg, `${label}: SVG changed`);
            assert.ok(value.scrollWidth <= width, `${label}: horizontal overflow`);
            assert.deepEqual(value.clipped, [], `${label}: clipped index text`);
          }
          const interaction = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
              Archify.focus.clear(); Archify.routeProbe.clear();
              const button=document.querySelector('[data-outline-node]');
              button.focus(); await new Promise(r=>requestAnimationFrame(r));
              const focused=document.activeElement===button;
              const focusPreview=document.querySelector('.diagram-container > svg').getAttribute('data-intent-trace-active');
              button.dispatchEvent(new PointerEvent('pointerenter'));
              const hoverPreview=document.querySelector('.diagram-container > svg').getAttribute('data-intent-trace-active');
              button.click(); await new Promise(r=>requestAnimationFrame(r));
              return {focused, focusPreview, hoverPreview, id:button.dataset.outlineNode, selected:button.getAttribute('aria-current')};
            })()` });
            assert.equal(interaction.exceptionDetails, undefined);
            assert.equal(interaction.result.value.focused, true);
            assert.equal(interaction.result.value.hoverPreview, interaction.result.value.id, `${label}: pointer-enter preview did not activate the hovered node`);
            assert.equal(interaction.result.value.selected, 'true');
            if (!candidate) baselineInteraction = interaction.result.value;
            else assert.deepEqual(interaction.result.value, baselineInteraction, `${label}: interaction changed`);
            value.interaction = interaction.result.value;
            // Restore the same unselected state before taking the comparison.
            const resetLoaded = browser.cdp.waitFor('Page.loadEventFired', session);
            await send('Page.navigate', { url: url.href }); await resetLoaded;
            await send('Runtime.evaluate', { awaitPromise: true, expression: 'document.fonts.ready.then(()=>Archify.layoutStability.whenStable())' });
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          fs.writeFileSync(path.join(output, `${label}.png`), Buffer.from(shot.data, 'base64'));
          delete value.svg;
          observations.push({ label, ...value });
        }
      }
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2));
}
console.log(`Saved matched comparisons to ${output}`);
