import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ChromeVisualBrowser, findChrome} from '../../../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const devRoot = process.env.ARCHIFY_DEV_ROOT;
const referenceRoot = process.env.ARCHIFY_REFERENCE_ROOT;
const expectedDevSha = 'b71d1b3e38f71d0f7fe91207b750cc307357c91a';
const expectedReferenceSha = 'bd5244388fedd4e74462fb04c588bbbea5c18956';
const input = 'archify/examples/delivery.explainer.json';
function verifiedRoot(variable, value, expectedSha) {
  if (!value || !fs.existsSync(path.join(value, input))) {
    throw new Error(`Set ${variable} to a checkout containing ${input}.`);
  }
  const checkout = path.resolve(value);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: checkout, encoding: 'utf8'}).trim();
  if (sha !== expectedSha) throw new Error(`${variable} must resolve to ${expectedSha}; received ${sha}.`);
  return {root: checkout, sha};
}
const dev = verifiedRoot('ARCHIFY_DEV_ROOT', devRoot, expectedDevSha);
const reference = verifiedRoot('ARCHIFY_REFERENCE_ROOT', referenceRoot, expectedReferenceSha);
const out = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(out, 'artifacts');
const screenshots = path.join(out, 'screenshots');
fs.mkdirSync(artifacts, {recursive: true});
fs.mkdirSync(screenshots, {recursive: true});

const revisions = [
  {id: 'dev-b71d1b3', ...dev},
  {id: 'bd524438', ...reference},
];
for (const revision of revisions) {
  revision.artifact = path.join(artifacts, `${revision.id}.delivery-explainer.html`);
  execFileSync(process.execPath, [path.join(revision.root, 'archify/bin/archify.mjs'), 'render', 'explainer', path.join(revision.root, input), revision.artifact], {cwd: revision.root, stdio: 'inherit'});
  revision.hasVersionControl = fs.readFileSync(revision.artifact, 'utf8').includes('reader-update');
  if (revision.hasVersionControl) fs.writeFileSync(revision.artifact, fs.readFileSync(revision.artifact, 'utf8').replace(/"generatorVersion":"[^"]+"/, '"generatorVersion":"3.2.1"'));
}

const manifest = {
  schemaVersion: 1, skillId: 'archify', channel: 'stable', version: '3.2.2', publishedAt: '2026-10-23T00:00:00Z',
  source: {repository: 'https://github.com/tt-a1i/archify', ref: 'v3.2.2', treeSha: 'a'.repeat(40)},
  artifact: {sha256: 'b'.repeat(64)}, summary: 'Baseline audit response only.',
  releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v3.2.2', severity: 'normal',
};
const viewports = [{width: 1440, height: 900}, {width: 390, height: 844}];
const records = [];
async function evaluate(browser, expression, awaitPromise = false) {
  const session = await browser.sessionPromise;
  const result = await browser.cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise}, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function wait(browser, milliseconds = 150) { await evaluate(browser, `new Promise(resolve => setTimeout(resolve, ${milliseconds}))`, true); }
async function screenshot(browser, label, revision, viewport, state) {
  const session = await browser.sessionPromise;
  const capture = await browser.cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false}, session);
  const file = path.join(screenshots, `${label}.png`);
  fs.writeFileSync(file, Buffer.from(capture.data, 'base64'));
  const measurement = await evaluate(browser, `(() => {
    const visible = node => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return !node.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
    const rect = node => { const value = node.getBoundingClientRect(); return {left:Math.round(value.left),right:Math.round(value.right),top:Math.round(value.top),bottom:Math.round(value.bottom),width:Math.round(value.width),height:Math.round(value.height)}; };
    const tools = document.querySelector('.tools');
    const controls = [...document.querySelectorAll('.tools button,.tools a')].filter(visible).map(node => ({text:node.textContent.trim().replace(/\\s+/g,' ').slice(0,60),label:node.getAttribute('aria-label'),rect:rect(node),fullyVisible:(() => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight; })()}));
    const dialog = document.getElementById('reader-update');
    return {innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,overflowX:document.documentElement.scrollWidth > innerWidth,tools:tools ? rect(tools) : null,controls,dialog:dialog ? {open:dialog.open,rect:rect(dialog),status:(document.getElementById('reader-update-status') || document.querySelector('[data-reader-update-status]'))?.textContent.trim() || ''} : null};
  })()`);
  records.push({revision: revision.id, sha: revision.sha, viewport, state, screenshot: path.relative(out, file).replaceAll('\\', '/'), measurement});
}
async function load(browser, artifact, viewport) {
  const session = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false}, session);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await browser.cdp.send('Page.navigate', {url: pathToFileURL(artifact).href}, session);
  await loaded;
  await wait(browser);
}

for (const revision of revisions) {
  for (const viewport of viewports) {
    const browser = new ChromeVisualBrowser(findChrome(), {shutdownTimeoutMs: 8000});
    try {
      if (revision.hasVersionControl) {
        const session = await browser.sessionPromise;
        await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: `window.fetch=()=>Promise.resolve(new Response(JSON.stringify(${JSON.stringify(manifest)}),{status:200,headers:{'content-type':'application/json'}}));`}, session);
      }
      await load(browser, revision.artifact, viewport);
      const prefix = `${revision.id}-${viewport.width}x${viewport.height}`;
      await screenshot(browser, `${prefix}-initial`, revision, viewport, 'initial');
      if (revision.hasVersionControl) {
        await evaluate(browser, "document.querySelector('[data-reader-update]')?.click();document.querySelector('[data-reader-update-check]')?.click();");
        await wait(browser);
        await screenshot(browser, `${prefix}-update-available`, revision, viewport, 'update-available');
      }
    } finally {
      await browser.close().catch(error => records.push({revision: revision.id, cleanup: error.message}));
    }
  }
}

fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({input, viewports, revisions: revisions.map(({id,sha,hasVersionControl}) => ({id,sha,hasVersionControl})), records}, null, 2) + '\n');
console.log(JSON.stringify({input, revisions: revisions.map(({id,sha,hasVersionControl}) => ({id,sha,hasVersionControl})), recordCount: records.length}, null, 2));
