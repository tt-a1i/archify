import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { byteReceipt } from '../renderers/shared/atlas-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const forcedFallback = process.env.ARCHIFY_FORCE_GZIP_FALLBACK === '1';
test(`atlas exports actual current-member images and WebM offline over file and HTTP${forcedFallback ? ' with gzip fallback' : ''}`, {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for actual atlas export acceptance.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'atlas.html');
  const sources = path.join(directory, 'sources');
  fs.cpSync(path.join(root, 'examples/atlas'), sources, { recursive: true });
  const repository = path.join(directory, 'repository');
  fs.mkdirSync(repository);
  fs.writeFileSync(path.join(repository, 'controller.js'), '// Illustrative architecture acceptance fixture.\nexport function controller(task) { return task.id; }\n');
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' },
  }).trim();
  git('init'); git('config', 'user.name', 'Archify Tests'); git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/atlas-acceptance-fixture');
  git('add', '.'); git('commit', '-m', 'Atlas acceptance fixture');
  const revision = git('rev-parse', 'HEAD');
  const paymentPath = path.join(sources, 'payment.architecture.json');
  const payment = JSON.parse(fs.readFileSync(paymentPath, 'utf8'));
  payment.meta.repository = { url: 'https://github.com/example/atlas-acceptance-fixture', revision, link_mode: 'local-only' };
  payment.components.find((node) => node.id === 'controller').sources = [{ path: 'controller.js', line: 2, label: '示例处理器（测试夹具）' }];
  fs.writeFileSync(paymentPath, JSON.stringify(payment));
  const delivery = JSON.parse(execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', path.join(sources, 'project.atlas.json'), output, '--repo-root', repository, '--json'], { encoding: 'utf8' }));
  const bytes = fs.readFileSync(output);
  const server = http.createServer((request, response) => {
    if (request.url.split('?')[0] === '/atlas.html') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(bytes); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const version = await browser.cdp.send('Browser.getVersion');
  const evidence = process.env.ARCHIFY_ATLAS_EVIDENCE;
  const records = [];
  if (evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'atlas.html'), bytes);
    fs.writeFileSync(path.join(evidence, 'delivery.json'), JSON.stringify(delivery, null, 2));
    t.after(() => fs.writeFileSync(path.join(evidence, 'exports.json'), JSON.stringify({ version, platform: process.platform, artifact: byteReceipt(bytes), records }, null, 2)));
  }
  const requests = [];
  let wire = '';
  browser.cdp.readPipe.on('data', (chunk) => {
    wire += chunk;
    let boundary;
    while ((boundary = wire.indexOf('\0')) >= 0) {
      const raw = wire.slice(0, boundary); wire = wire.slice(boundary + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    }
  });
  await send('Network.enable');
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    ${forcedFallback ? "if(window===parent)Object.defineProperty(globalThis,'DecompressionStream',{value:undefined,configurable:true});" : ''}
    window.exportErrors=[];window.downloads=[];window.blobs=new Map();
    addEventListener('error',e=>exportErrors.push(e.message));
    addEventListener('unhandledrejection',e=>exportErrors.push(String(e.reason)));
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};
    const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){
      if(this.download){downloads.push({name:this.download,blob:blobs.get(this.href)});return;}return click.call(this);
    };
  ` });
  async function evaluate(expression, member = true) {
    const result = await send('Runtime.evaluate', {
      expression: member ? `document.querySelector('iframe[data-atlas-state=active]').contentWindow.eval(${JSON.stringify(expression)})` : expression,
      awaitPromise: true, returnByValue: true,
    });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [protocol, url] of [['file', pathToFileURL(output).href], ['http', `http://127.0.0.1:${server.address().port}/atlas.html`]]) {
    requests.length = 0;
    await send('Page.navigate', { url: url + '?theme=light#diagram=payment' });
    await evaluate(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      const child=document.querySelector('iframe[data-atlas-state=active]')?.contentWindow;
      if(child?.Archify && child.ArchifyAddress.active && !child.ArchifyAddress.restoring){clearInterval(timer);resolve();}
      else if(++tries>200){clearInterval(timer);reject(new Error('Atlas initialization failed'));}
    },50);})`, false);
    await evaluate('Archify.readerLayout.whenStable()');
    assert.equal(await evaluate('document.documentElement.dataset.atlasDecoder', false), forcedFallback ? 'fallback' : 'native');
    assert.equal(await evaluate(`JSON.parse(document.getElementById('archify-source-evidence-data').textContent).repository.revision`), revision);
    async function readyDiagram(id) {
      await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{
        const a=document.querySelector('iframe[data-atlas-state=active]')?.contentWindow.ArchifyAddress;
        if(a?.context.diagram===${JSON.stringify(id)} && a.active && !a.restoring){clearInterval(t);resolve();}
        else if(++n>200){clearInterval(t);reject(new Error('Navigation did not settle'));}
      },30);})`, false);
    }
    await evaluate(`Archify.focus.set('controller',{toggle:false});new Promise(resolve=>setTimeout(resolve,0))`);
    await evaluate(`document.querySelector('[data-atlas-detail="controller"]').click()`);
    await readyDiagram('worker');
    await evaluate('history.back()', false); await readyDiagram('payment');
    const refreshUrl = (await evaluate('location.href', false)).split('#')[0];
    await send('Page.reload'); await readyDiagram('payment');
    for (const format of ['svg', 'png', 'jpeg', 'webp', 'share-card', 'route-card', 'reach-card', 'webm']) {
      const result = await evaluate(`(async()=>{
        downloads.length=0;
        const format=${JSON.stringify(format)};
        Archify.focus.set('controller',{toggle:false,updateUrl:false});
        if(format==='route-card') {
          Archify.routeProbe.begin({source:'users',focusNode:false});
          if(!Archify.routeProbe.choose('db',{updateUrl:false}))throw new Error('Missing route');
          await Archify.exportMenu.downloadRouteShareCard();
        } else if(format==='reach-card') {
          Archify.focus.set('controller',{toggle:false,updateUrl:false});
          if(!Archify.focus.reach('downstream',{toggle:false,updateUrl:false,reveal:false}))throw new Error('Missing reach');
          await Archify.exportMenu.downloadReachShareCard();
        } else await Archify.exportMenu.run(format);
        const file=downloads.at(-1);if(!file?.blob)throw new Error('No exported '+format);
        const blob=file.blob;let width,height,text;
        if(format==='svg') {
          text=await blob.text();const doc=new DOMParser().parseFromString(text,'image/svg+xml');
          if(doc.querySelector('parsererror'))throw new Error('Invalid SVG');
          const vb=doc.documentElement.getAttribute('viewBox').split(/\\s+/).map(Number);width=vb[2];height=vb[3];
        } else if(format==='webm') {
          const video=document.createElement('video');const url=URL.createObjectURL(blob);video.src=url;
          await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Cannot decode WebM'));});
          width=video.videoWidth;height=video.videoHeight;URL.revokeObjectURL(url);
        } else {const image=await createImageBitmap(blob);width=image.width;height=image.height;image.close();}
        const encoded=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
        return {name:file.name,type:blob.type,bytes:blob.size,width,height,text,encoded,errors:exportErrors};
      })()`);
      assert.ok(result.bytes > 0 && result.width > 0 && result.height > 0, `${protocol} ${format}`);
      assert.deepEqual(result.errors, []);
      if (format === 'svg') {
        assert.match(result.text, /data-atlas-context-mark/);
        assert.match(result.text, /data-atlas-reference-diagram="system"/);
        assert.match(result.text, /支付模块/);
        assert.doesNotMatch(result.text.replace(/<style>[\s\S]*?<\/style>/g, ''), /data-focus-active|data-route-active|data-intent-trace-active/);
      }
      if (evidence) fs.writeFileSync(path.join(evidence, `${protocol}-${format}.${format.includes('card') ? 'png' : format}`), Buffer.from(result.encoded, 'base64'));
      const { encoded, text, ...receipt } = result;
      records.push({ protocol, format, ...receipt });
    }
    const httpRequests = requests.filter((request) => /^https?:/.test(request));
    const attempted = httpRequests.filter((request) => ![url + '?theme=light', refreshUrl].includes(request.split('#')[0]));
    assert.deepEqual(attempted, [], `${protocol} autonomous network attempts`);
    assert.equal(httpRequests.length, protocol === 'http' ? 2 : 0, 'Only explicit open and refresh may fetch the HTTP document');
    records.push({protocol, navigation: ['cold payment', 'worker', 'Back payment', 'refresh payment'], requests: httpRequests, autonomousRequests: attempted});
  }
});
