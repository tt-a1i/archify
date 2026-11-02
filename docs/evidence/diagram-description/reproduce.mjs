import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [checkout, phase, outputRoot] = process.argv.slice(2);
assert.ok(checkout && ['before', 'after'].includes(phase));
assert.ok(outputRoot, 'Usage: node reproduce.mjs CHECKOUT before|after OUTPUT_DIRECTORY');
const root = path.resolve(outputRoot);
const out = path.join(root, phase);
fs.mkdirSync(out, { recursive: true });
const examples = {
  architecture: 'web-app', workflow: 'agent-tool-call', sequence: 'cache-miss-request',
  dataflow: 'product-analytics', lifecycle: 'agent-run', erd: 'orders',
  class: 'payments', tree: 'payment-platform', timeline: 'payment-incident', waterfall: 'checkout-request',
};
const long = 'This example shows a web application and its authored connections. Users connect to CloudFront, followed by a load balancer and an API server. The API has connections to Redis for read-through caching and to PostgreSQL for SQL access. CloudFront also connects to S3 for static assets. The asynchronous branch runs from the API to an SQS queue and then to a worker. An Auth Provider is connected to the API by a relationship labelled verify JWT. The diagram groups the cloud components within an AWS region and places the load balancer and API within a security group. It illustrates structure and labelled relationships; it does not establish measured latency, runtime availability, or the exact chronological order of authentication.';
const short = 'Request path and asynchronous work';
const renders = [];
function render(type, label, change) {
  const doc = JSON.parse(fs.readFileSync(path.join(checkout, 'archify/examples', `${examples[type]}.${type}.json`)));
  change(doc.meta);
  const name = `${type}-${label}`;
  const input = path.join(out, name + '.json');
  const html = path.join(out, name + '.html');
  fs.writeFileSync(input, JSON.stringify(doc, null, 2) + '\n');
  execFileSync(process.execPath, [path.join(checkout, 'archify/bin/archify.mjs'), 'render', type, input, html],
    { env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' }, stdio: 'pipe' });
  renders.push({ type, label, name, html });
}
for (const type of Object.keys(examples)) {
  render(type, 'legacy', () => {});
  render(type, 'default', m => { delete m.subtitle; m.locale = 'zh-CN'; });
  render(type, 'translation', m => { delete m.subtitle; m.locale = 'zh-CN'; m.translations = { [`diagram.description.${type}`]: '自定义图说明 A&B' }; });
  if (phase === 'after') render(type, 'description', m => { m.description = type === 'architecture' ? long : `${type}: 中文 A&B <cache> "quote"\n</desc><script>alert(1)</script>`; });
}
render('architecture', 'long', m => { if (phase === 'before') m.subtitle = long; else { delete m.subtitle; m.description = long; } });
render('architecture', 'short', m => { m.subtitle = short; if (phase === 'after') m.description = long; });
const productDiff = execFileSync('git', ['diff', 'HEAD', '--', 'archify'], { cwd: checkout });
const report = { phase, sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim(), productDiffSha256: createHash('sha256').update(productDiff).digest('hex'), workingTree: productDiff.length ? 'modified product source on base SHA' : 'clean product source', node: process.version, date: new Date().toISOString(), compatibility: [], captures: [] };
if (phase === 'after') {
  for (const item of renders.filter(r => ['legacy', 'default', 'translation'].includes(r.label))) {
    const before = fs.readFileSync(path.join(root, 'before', item.name + '.html'));
    const after = fs.readFileSync(item.html);
    assert.ok(before.equals(after), `${item.name}: legacy HTML changed`);
    report.compatibility.push({ name: item.name, byteIdentical: true, sha256: createHash('sha256').update(after).digest('hex') });
  }
}
const { ChromeVisualBrowser, findChrome } = await import(pathToFileURL(path.join(checkout, 'archify/bin/visual-check.mjs')));
const chrome = findChrome();
assert.ok(chrome, 'Set ARCHIFY_CHROME to an installed Chrome/Chromium executable.');
const browser = new ChromeVisualBrowser(chrome);
try {
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const navigate = async file => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await loaded;
    await run('document.fonts.ready.then(()=>true)');
  };
  const ax = async () => (await send('Accessibility.getFullAXTree')).nodes.filter(n => !n.ignored && ['image', 'img'].includes(n.role?.value)).map(n => ({ name: n.name?.value, description: n.description?.value }));
  report.browser = await browser.cdp.send('Browser.getVersion');
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const item of renders.filter(r => ['legacy', 'description', 'long', 'short'].includes(r.label))) {
    for (const width of item.type === 'architecture' && ['long', 'short'].includes(item.label) ? [1280, 390] : [1280]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: width === 390 });
      await navigate(item.html);
      await run('(async()=>{await Archify.readerLayout.whenStable();await Archify.viewerChromeLayout.whenStable();return true})()');
      const state = await run(`(()=>{const s=document.querySelector('.diagram-container > svg');return {title:s.querySelector('title').textContent,desc:s.querySelector('desc').textContent,labelledby:s.getAttribute('aria-labelledby'),describedby:s.getAttribute('aria-describedby'),header:document.querySelector('.header').innerText,headerHeight:document.querySelector('.header').getBoundingClientRect().height,svgScripts:s.querySelectorAll('script').length}})()`);
      const inlineAX = await ax();
      const screenshot = `${item.name}-${width}.png`;
      fs.writeFileSync(path.join(out, screenshot), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
      if (phase === 'after' && ['legacy', 'short'].includes(item.label)) {
        assert.ok(fs.readFileSync(path.join(out, screenshot)).equals(fs.readFileSync(path.join(root, 'before', screenshot))), `${screenshot}: preserved appearance changed`);
      }
      const exported = await run(`(async()=>{const original=URL.createObjectURL;let blob;URL.createObjectURL=function(v){if(v.type.startsWith('image/svg+xml'))blob=v;return original.call(this,v)};try{await Archify.exportMenu.run('svg')}finally{URL.createObjectURL=original}if(!blob)throw new Error('No SVG export');return blob.text()})()`);
      const svgFile = path.join(out, item.name + '.svg');
      fs.writeFileSync(svgFile, exported);
      const parsed = await run(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(exported)},'image/svg+xml');const s=d.documentElement;return {desc:s.querySelector('desc')?.textContent,errors:d.querySelectorAll('parsererror').length,scripts:d.querySelectorAll('script').length,refs:['aria-labelledby','aria-describedby'].flatMap(a=>(s.getAttribute(a)||'').split(' ').filter(Boolean)).every(id=>!!d.getElementById(id))}})()`);
      assert.equal(parsed.desc, state.desc); assert.equal(parsed.errors, 0); assert.equal(parsed.scripts, 0); assert.equal(parsed.refs, true);
      if (item.label === 'description' || (phase === 'after' && ['short', 'long'].includes(item.label))) {
        const source = JSON.parse(fs.readFileSync(path.join(out, item.name + '.json')));
        assert.equal(state.desc, source.meta.description); assert.equal(inlineAX[0].name, state.title); assert.equal(inlineAX[0].description, state.desc.replace(/\s+/g, ' ').trim());
        assert.ok(!state.header.includes(state.desc));
      }
      await navigate(svgFile);
      const standaloneAX = await ax();
      assert.deepEqual(standaloneAX, inlineAX);
      report.captures.push({ name: item.name, width, screenshot, ...state, inlineAX, standaloneAX, export: parsed });
    }
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ phase, sha: report.sha, byteIdentical: report.compatibility.length, captures: report.captures.length, browser: report.browser.product }));
