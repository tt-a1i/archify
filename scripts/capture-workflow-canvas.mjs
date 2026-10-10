// Reproducible #747 prototype evidence. Uses public inputs and the real viewer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [baselineArg, outputArg] = process.argv.slice(2);
if (!baselineArg || !outputArg) throw new Error('Usage: node scripts/capture-workflow-canvas.mjs <baseline-checkout> <new-output-directory>');
const baseline = path.resolve(baselineArg);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const compilers = {};
for (const [revision, checkout] of [['before', baseline], ['after', root]]) {
  compilers[revision] = (await import(pathToFileURL(path.join(checkout, 'archify/renderers/workflow/workflow-compiler.mjs')))).compileWorkflow;
}
const cases = ['five-stage-stack', 'execution-failure-stack'].map((name) => ({
  name, workflow: read(path.join(root, `test/fixtures/reader-readability/${name}.workflow.json`)), browser: true,
}));
const copy = (index) => structuredClone(cases[index].workflow);
const labeled = copy(1);
labeled.edges.find(({ id }) => id === 'execute-record').label = 'Recover after execution failure';
cases.push({ name: 'labeled-outside-right', workflow: labeled, browser: true });
const fixed = copy(0); fixed.meta.viewBox = [1000, 1000];
cases.push({ name: 'explicit-viewbox', workflow: fixed, unchanged: true });
const wideLabel = copy(0); wideLabel.lanes[0].label = 'Public publishing pipeline with a deliberately long descriptive lane heading';
cases.push({ name: 'long-lane-label', workflow: wideLabel });
const wideNode = copy(0); wideNode.nodes[0].label = 'Collect public input material';
cases.push({ name: 'wide-node', workflow: wideNode });
const phase = copy(0); phase.phases = [{ id: 'scope', label: 'Authored phase span', fromCol: 0, toCol: 5 }];
cases.push({ name: 'wide-phase-span', workflow: phase });
const group = copy(0); group.groups = [{ id: 'group', label: 'Publishing stages', lane: 'pipeline', fromCol: 0, toCol: 4 }];
cases.push({ name: 'wide-group-span', workflow: group });
const pinned = copy(1); pinned.edges[2].channelX = 1000;
cases.push({ name: 'explicit-wide-channel', workflow: pinned, unchanged: true });
const pinBase = compilers.before({ workflow: copy(0), qualityProfile: 'showcase' });
assert.equal(pinBase.ok, true);
for (const kind of ['via', 'labelAt', 'channelY']) {
  const w = copy(0);
  // Fixed height mode moves this stack's first node to the same position as
  // its intrinsic single-lane baseline. Pin only one originally valid edge.
  const edge = pinBase.receipt.edges.find(({ id }) => id === w.edges[0].id);
  if (kind === 'via') w.edges[0].via = [[edge.points[0][0], (edge.points[0][1] + edge.points.at(-1)[1]) / 2]];
  if (kind === 'labelAt') { w.edges[0].label = 'next'; w.edges[0].labelAt = [edge.points[0][0] + 70, (edge.points[0][1] + edge.points.at(-1)[1]) / 2]; }
  if (kind === 'channelY') {
    w.nodes = w.nodes.slice(0, 2); w.nodes.forEach(node => { node.yOffset = 0; }); w.nodes[1].col = 3;
    w.edges = [{ id: 'pinned-channel', from: w.nodes[0].id, to: w.nodes[1].id, fromSide: 'bottom', toSide: 'bottom', channelY: 220 }];
  }
  cases.push({ name: `explicit-${kind}`, workflow: w, unchanged: true });
}
for (const name of fs.readdirSync(path.join(root, 'archify/examples')).filter((name) => name.endsWith('.workflow.json'))) {
  cases.push({ name: `example-${name.replace('.workflow.json', '')}`, workflow: read(path.join(root, 'archify/examples', name)), unchanged: true });
}
cases.push({ name: 'frozen-v1', workflow: read(path.join(root, 'test/fixtures/v1-baseline/agent-tool-call.workflow.json')), unchanged: true });
const matrix = [];
const receipts = {};
for (const item of cases) {
  write(`${item.name}.workflow.json`, item.workflow);
  for (const quality of ['standard', 'showcase']) {
    const results = {};
    for (const revision of ['before', 'after']) {
      results[revision] = compilers[revision]({ workflow: item.workflow, qualityProfile: quality });
      write(`${item.name}-${quality}-${revision}.receipt.json`, results[revision].receipt);
    }
    const b = results.before, a = results.after;
    assert.equal(b.ok, true, `baseline ${item.name}/${quality}: ${b.error}`);
    assert.equal(a.ok, true, `candidate ${item.name}/${quality}: ${a.error}`);
    assert.deepEqual(a.receipt.nodes, b.receipt.nodes, `${item.name}: node positions and sizes preserved`);
    assert.deepEqual(a.receipt.edges.map(({ id, from, to }) => [id, from, to]), b.receipt.edges.map(({ id, from, to }) => [id, from, to]));
    if (item.unchanged) assert.equal(a.svg, b.svg, `${item.name}: SVG must be byte-identical`);
    for (const result of [b, a]) {
      const [width, height] = result.receipt.viewBox;
      for (const edge of result.receipt.edges) for (const [x, y] of edge.points) assert.ok(x >= 0 && x <= width && y >= 0 && y <= height, `${item.name}: route containment`);
    }
    matrix.push({ name: item.name, quality, baselinePass: b.ok, candidatePass: a.ok, svgIdentical: a.svg === b.svg, expectedUnchanged: !!item.unchanged, before: b.receipt.viewBox, after: a.receipt.viewBox });
    if (quality === 'showcase') receipts[item.name] = results;
  }
}
write('compatibility.json', matrix);
// Paired, alternating order, same process/runtime/inputs; no browser competing.
const timings = [];
for (const item of cases.filter((item) => item.browser)) {
  for (let i = 0; i < 5; i++) for (const fn of Object.values(compilers)) fn({ workflow: item.workflow, qualityProfile: 'showcase' });
  const samples = { before: [], after: [] };
  for (let i = 0; i < 31; i++) for (const revision of i % 2 ? ['after', 'before'] : ['before', 'after']) {
    const started = performance.now();
    const result = compilers[revision]({ workflow: item.workflow, qualityProfile: 'showcase' });
    assert.equal(result.ok, true); samples[revision].push(performance.now() - started);
  }
  const stats = (values) => { const s = [...values].sort((a, b) => a - b); return { medianMs: s[15], p95Ms: s[29], samples: values }; };
  timings.push({ name: item.name, before: stats(samples.before), after: stats(samples.after) });
}
write('timings.json', { runtime: process.version, platform: process.platform, arch: process.arch, warmups: 5, samples: 31, method: 'paired alternating order; compiler including routing; same process, browser not started', timings });
const browser = new ChromeVisualBrowser(findChrome());
const records = [];
try {
  for (const item of cases.filter((item) => item.browser)) {
    for (const [revision, checkout] of [['before', baseline], ['after', root]]) {
      const artifact = path.join(output, `${item.name}-${revision}.html`);
      execFileSync(process.execPath, [path.join(checkout, 'archify/bin/archify.mjs'), 'render', 'workflow', path.join(output, `${item.name}.workflow.json`), artifact, '--quality', 'showcase']);
      for (const theme of ['light', 'dark']) {
        const screenshot = `${item.name}-${revision}-${theme}.png`;
        const metrics = await browser.inspect({ artifactPath: artifact, width: 1440, height: 1000, theme, screenshotPath: path.join(output, screenshot) });
        const session = await browser.sessionPromise;
        const result = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          const svg = document.querySelector('.diagram-container svg');
          const fonts = selector => [...svg.querySelectorAll(selector)].map(el => {
            const m = el.getScreenCTM(); return { text: el.textContent.trim(), px: parseFloat(getComputedStyle(el).fontSize) * Math.hypot(m.a,m.b) };
          });
          return { primary: fonts('text[data-node-label]'), auxiliary: fonts('g[data-node-id] text[data-detail="context"]'),
            allText: [...svg.querySelectorAll('text')].map(el => el.textContent.trim()),
            scrollY, pageScrollPx: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight,
            overflowX: document.documentElement.scrollWidth > innerWidth, zoom: document.querySelector('[data-view-percent]')?.textContent,
            svgRenderedWidth: svg.getBoundingClientRect().width, svgRenderedHeight: svg.getBoundingClientRect().height,
            fontStatus: document.fonts.status, reader: Archify.readerLayout.receipt() };
        })()` }, session);
        assert.equal(result.exceptionDetails, undefined);
        const measured = result.result.value;
        assert.equal(measured.zoom, '100%'); assert.equal(measured.scrollY, 0); assert.equal(measured.overflowX, false); assert.equal(measured.fontStatus, 'loaded');
        for (const node of item.workflow.nodes) for (const value of [node.label, node.sublabel].filter(Boolean)) assert.ok(measured.allText.includes(value), `full text retained: ${value}`);
        for (const edge of item.workflow.edges) if (edge.label) assert.ok(measured.allText.includes(edge.label));
        const receipt = receipts[item.name][revision].receipt;
        const routePoints = receipt.edges.flatMap(edge => edge.points);
        const scroll = await browser.cdp.send('Runtime.evaluate', {returnByValue:true, awaitPromise:true, expression:`(async () => {
          scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { scrollY, allNodesReachable: [...document.querySelectorAll('svg g[data-node-id]')].every(el => el.getBoundingClientRect().bottom <= innerHeight) };
        })()`}, session);
        assert.equal(scroll.result.value.allNodesReachable, true);
        records.push({ name:item.name, revision, theme, screenshot, artifact:path.basename(artifact), viewport:[1440,1000], preset:'signal-flow', quality:'showcase',
          viewBox:receipt.viewBox, readerFit:metrics.readerFit, minimumPrimaryPx:Math.min(...measured.primary.map(f=>f.px)), minimumAuxiliaryPx:Math.min(...measured.auxiliary.map(f=>f.px)),
          routeBounds:[Math.min(...routePoints.map(p=>p[0])),Math.min(...routePoints.map(p=>p[1])),Math.max(...routePoints.map(p=>p[0])),Math.max(...routePoints.map(p=>p[1]))],
          ...measured, bottomScroll:scroll.result.value, htmlSha256:hash(fs.readFileSync(artifact)) });
      }
    }
  }
  write('measurements.json', { baselineCompilerSha256:hash(fs.readFileSync(path.join(baseline,'archify/renderers/workflow/workflow-compiler.mjs'))), candidateCompilerSha256:hash(fs.readFileSync(path.join(root,'archify/renderers/workflow/workflow-compiler.mjs'))), node:process.version, browser:await browser.cdp.send('Browser.getVersion'), records });
} finally { await browser.close(); }
console.log(JSON.stringify({ cases:cases.length, comparisons:matrix.length, browserRecords:records.length, output }));
