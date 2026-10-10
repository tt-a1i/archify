import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

// Wrapped sequence notes are fine-detail text, hidden at the default zoom, so
// exports must still carry every line (#676).
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const LONG_NOTE = 'this note explains the whole retry and backoff policy in a lot of detail so it is very long';

test('SVG and PNG exports keep every line of a wrapped sequence note', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser export checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-note-export-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'note.json');
  const file = path.join(scratch, 'note.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Note export', output: 'note.html', quality_profile: 'showcase', column_fit: 'spread' },
    participants: [
      { id: 'client', type: 'external', label: 'Client' },
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'db', type: 'database', label: 'DB' },
    ],
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { id: 'reply', from: 'api', to: 'client', y: 300, label: 'reply', variant: 'return' },
    ],
  }));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, file]);
  const lines = [...fs.readFileSync(file, 'utf8').matchAll(/<tspan x="[\d.]+" dy="[\d.]+">([^<]*)<\/tspan>/g)].map((match) => match[1]);
  assert.ok(lines.length > 1, 'the fixture note wraps');

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  // Capture downloads at the anchor boundary; serialization, drawing and
  // encoding remain production code.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.noteDownloads=[];
    const create=URL.createObjectURL.bind(URL),blobs=new Map();
    URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download){noteDownloads.push(blobs.get(this.href));return;}return click.call(this);};
    window.noteExport=async format=>{const count=noteDownloads.length;await Archify.exportMenu.run(format);
      const start=performance.now();while(noteDownloads.length===count){if(performance.now()-start>15000)throw new Error('export timed out');await new Promise(r=>setTimeout(r,20));}
      return noteDownloads[noteDownloads.length-1];};
    window.notePixels=async blob=>{const bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return context.getImageData(0,0,bitmap.width,bitmap.height);};
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await run('document.fonts.ready');
  await run('Archify.readerLayout.whenStable()');

  // The default zoom hides fine detail; the export must not.
  assert.equal(await run(`getComputedStyle(document.querySelector('text[data-detail="fine"]')).opacity`), '0');
  const svg = await run(`noteExport('svg').then(blob=>blob.text())`);
  for (const line of lines) assert.ok(svg.includes(`>${line}</tspan>`), `SVG export keeps "${line}"`);
  assert.doesNotMatch(svg, /data-detail="fine"/, 'SVG export removes the zoom-only marker');

  // Compare PNG exports with and without the note text: the difference is the
  // note itself, and it must be as tall as its wrapped lines.
  const diff = await run(`(async()=>{
    const withNote=await notePixels(await noteExport('png'));
    const note=document.querySelector('text[data-detail="fine"]');const saved=note.innerHTML;note.innerHTML='';
    const withoutNote=await notePixels(await noteExport('png'));note.innerHTML=saved;
    if(withNote.width!==withoutNote.width||withNote.height!==withoutNote.height)return {sameSize:false};
    let top=Infinity,bottom=-1,left=Infinity,right=-1;
    for(let y=0;y<withNote.height;y+=1)for(let x=0;x<withNote.width;x+=1){const i=(y*withNote.width+x)*4;
      if(Math.abs(withNote.data[i]-withoutNote.data[i])+Math.abs(withNote.data[i+1]-withoutNote.data[i+1])+Math.abs(withNote.data[i+2]-withoutNote.data[i+2])>24){
        top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}}
    return {sameSize:true,width:withNote.width,top,bottom,left,right};
  })()`);
  assert.equal(diff.sameSize, true);
  assert.ok(diff.bottom >= 0, 'the PNG export draws the note');
  const exportedWidth = Number(svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) [\d.]+"/)[1]);
  const scale = diff.width / exportedWidth;
  assert.ok(diff.bottom - diff.top >= (lines.length - 1) * 11 * scale * 0.8, `the PNG note spans its ${lines.length} lines (${diff.bottom - diff.top}px at scale ${scale.toFixed(2)})`);

  if (process.env.ARCHIFY_NOTE_EXPORT_EVIDENCE) {
    const png = await run(`noteExport('png').then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);}))`);
    fs.writeFileSync(process.env.ARCHIFY_NOTE_EXPORT_EVIDENCE, Buffer.from(png, 'base64'));
  }

  // This fixture has no segment overlays: the note sits on the panel over
  // the body background. Measure computed colors in Full detail, not a class
  // name, and retain the default Read/export checks above.
  await run(`for(let i=0;i<3;i++) Archify.view.zoomIn();
    new Promise((resolve,reject)=>{
      const deadline=performance.now()+2000;
      function settled(){
        if(getComputedStyle(document.querySelector('text[data-detail="fine"]')).opacity==='1') return resolve();
        if(performance.now()>deadline) return reject(new Error('Full-detail note did not become visible'));
        requestAnimationFrame(settled);
      }
      settled();
    })`);
  for (const theme of ['dark', 'light']) {
    await t.test(`${theme} Full-detail note has at least 4.5:1 contrast`, async () => {
      await run(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const colors = await run(`(() => {
        const note = document.querySelector('text[data-detail="fine"]');
        const panel = document.querySelector('.diagram-container');
        const style = getComputedStyle(note);
        const rgba = value => {
          const parts = value.match(/[\\d.]+/g).map(Number);
          return [...parts.slice(0, 3), parts[3] ?? 1];
        };
        const over = (front, back) => front.slice(0, 3).map((c, i) => c * front[3] + back[i] * (1 - front[3]));
        const body = rgba(getComputedStyle(document.body).backgroundColor);
        const background = over(rgba(getComputedStyle(panel).backgroundColor), body);
        const fill = rgba(style.fill);
        fill[3] *= Number(style.fillOpacity);
        const foreground = over(fill, background);
        const luminance = rgb => rgb.map(c => {
          c /= 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(foreground), b = luminance(background);
        return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          foreground, background, bodyAlpha: body[3], opacity: style.opacity,
          visibility: style.visibility, display: style.display,
          detail: panel.getAttribute('data-detail-level'),
          svgBackgroundAlpha: rgba(getComputedStyle(note.ownerSVGElement).backgroundColor)[3],
          segments: document.querySelectorAll('[data-composition-frame-kind="segment"]').length };
      })()`);
      assert.equal(colors.detail, 'full');
      assert.equal(colors.opacity, '1', 'contrast is measured on a visible note');
      assert.notEqual(colors.visibility, 'hidden');
      assert.notEqual(colors.display, 'none');
      assert.equal(colors.bodyAlpha, 1, 'body provides the opaque background');
      assert.equal(colors.svgBackgroundAlpha, 0, 'SVG leaves the panel background visible');
      assert.equal(colors.segments, 0, 'no segment overlay changes the note background');
      t.diagnostic(`${theme} note contrast ${colors.ratio.toFixed(3)}:1; foreground ${colors.foreground}; background ${colors.background}`);
      assert.ok(colors.ratio >= 4.5, `${theme} note contrast ${colors.ratio.toFixed(3)}:1 must be at least 4.5:1`);
    });
  }
});
