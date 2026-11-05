import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

async function clickControl(send, run, id) {
    await run(`document.getElementById(${JSON.stringify(id)}).scrollIntoView({ block: 'nearest' })`);
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const point = await run(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    assert.ok(point.x > 0 && point.y > 0, JSON.stringify(point));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }

test('Semantic Passport flips to an authored explanation and back without moving or exporting it', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser passport explanation checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-passport-explanation-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  diagram.components.find((c) => c.id === 'users').explanation = 'Anyone with the app installed.\n\nThey never hold a key; only a session.';
  const input = path.join(scratch, 'explained.json');
  const output = path.join(scratch, 'explained.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, output]);

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(r.exceptionDetails, undefined, r.exceptionDetails?.exception?.description);
    return r.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.pageErrors=[];addEventListener('error',e=>pageErrors.push(e.message));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=dark&keep=yes' });
  await loaded;
  await checkPointer();
  await run('document.fonts.ready');
  await run('Archify.viewerChromeLayout.whenStable()');

  const click = id => clickControl(send, run, id);
  const state = () => run(`(() => { const chip = document.getElementById('focus-chip'); const face = document.getElementById('focus-explanation'); const r = chip.getBoundingClientRect();
    return { active: Archify.focus.active(), explaining: Archify.focus.explaining(), attr: chip.getAttribute('data-explaining'), chipHidden: chip.hidden, btnHidden: document.getElementById('btn-focus-explain').hidden,
      faceHidden: face.hidden, paragraphs: face.querySelectorAll('p').length, title: document.getElementById('focus-explanation-title').textContent, left: r.left, top: r.top, height: r.height,
      focused: document.activeElement && document.activeElement.id, errors: pageErrors }; })()`);

  assert.equal(await run(`Archify.focus.set('users')`), true);
  const front = await state();
  assert.equal(front.active, 'users');
  assert.equal(front.btnHidden, false, 'Explain is offered for a node with an explanation');
  assert.equal(front.explaining, false);

  await click('btn-focus-explain');
  const flipped = await state();
  assert.equal(flipped.explaining, true);
  assert.equal(flipped.attr, 'true');
  assert.equal(flipped.faceHidden, false);
  assert.equal(flipped.paragraphs, 2, 'blank lines split paragraphs');
  assert.equal(flipped.title, 'Users');
  assert.equal(flipped.left, front.left, 'the passport does not move when it flips');
  assert.equal(flipped.top, front.top, 'the passport does not move when it flips');
  assert.equal(flipped.focused, 'focus-explanation-back', 'the back link takes focus');
  if (process.env.ARCHIFY_TEST_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.ARCHIFY_TEST_EVIDENCE_DIR, { recursive: true });
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(process.env.ARCHIFY_TEST_EVIDENCE_DIR, 'short-1440x900.png'), Buffer.from(capture.data, 'base64'));
  }

  const exported = await run(`(() => { const clone = Archify.exportMenu && Archify.exportMenu.snapshot ? null : null; const svg = document.querySelector('.diagram-container > svg').outerHTML; return { svg }; })()`);
  assert.doesNotMatch(exported.svg, /Anyone with the app installed/, 'prose stays outside the canonical SVG');

  await click('focus-explanation-back');
  const back = await state();
  assert.equal(back.explaining, false);
  assert.equal(back.attr, null);
  assert.equal(back.chipHidden, false, 'clicking the face returns to the passport, not to nothing');
  assert.equal(back.active, 'users');
  assert.equal(back.focused, 'btn-focus-explain', 'focus returns to the Explain action');

  await click('btn-focus-explain');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  const escaped = await state();
  assert.equal(escaped.explaining, false, 'Escape on the back link closes the explanation');
  assert.equal(escaped.chipHidden, false, 'the passport stays open after Escape on the face');

  assert.equal(await run(`Archify.focus.set('cdn')`), true);
  const other = await state();
  assert.equal(other.btnHidden, true, 'nodes without an explanation offer no Explain action');
  assert.equal(other.explaining, false);
  assert.deepEqual(other.errors, []);
});

test('near-limit explanation keeps Back and keyboard scrolling reachable at reflow and after resize', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser passport explanation checks.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-passport-explanation-reflow-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  const prose = ('A reader needs the complete explanation, with every paragraph available.\n\n').repeat(20).slice(0, 1190);
  diagram.meta.parentHref = 'grandparent.html';
  const mixedNode = diagram.components.find(node => node.id === 'users');
  mixedNode.href = 'child.html?theme=light&embed=0&present=0#focus=users';
  mixedNode.explanation = prose;
  const input = path.join(scratch, 'long.json'), output = path.join(scratch, 'long.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, output]);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const viewport = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await run('Archify.readerLayout.whenStable()');
    await run('Archify.viewerChromeLayout.whenStable()');
    await settle();
  };
  const key = async (key, code, virtualKey, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers, ...(key === 'Enter' ? { text: String.fromCharCode(13), unmodifiedText: String.fromCharCode(13) } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
    await settle();
  };
  const click = id => clickControl(send, run, id);
  const state = () => run(`(() => {
    const chip=document.getElementById('focus-chip'), back=document.getElementById('focus-explanation-back'), body=document.getElementById('focus-explanation-body'), explain=document.getElementById('btn-focus-explain');
    const box=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    return {chip:box(chip),back:box(back),body:box(body),explain:box(explain),lineHeight:parseFloat(getComputedStyle(body.querySelector('p')||body).lineHeight),fontSize:getComputedStyle(body.querySelector('p')||body).fontSize,panelPosition:getComputedStyle(chip).position,pageScroll:scrollY,parentBackVisible:!document.querySelector('.parent-back-bar').hidden,titleVisible:(()=>{const title=document.getElementById('focus-explanation-title'),r=title.getBoundingClientRect();return title.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})(),viewport:{width:innerWidth,height:innerHeight},scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,scrollTop:body.scrollTop,
      text:[...body.querySelectorAll('p')].map(p=>p.textContent).join(String.fromCharCode(10, 10)),focused:document.activeElement.id,focusVisible:back.matches(':focus-visible'),explaining:Archify.focus.explaining()};
  })()`);
  const visible = value => {
    assert.ok(value.chip.top >= 0 && value.chip.bottom <= value.viewport.height + 1, JSON.stringify(value));
    assert.ok(value.back.top >= value.chip.top && value.back.bottom <= value.chip.bottom + 1, JSON.stringify(value));
    assert.ok(value.back.left >= 0 && value.back.right <= value.viewport.width + 1, JSON.stringify(value));
    assert.equal(value.titleVisible,true,'the explanation title stays above overlapping controls');
    assert.ok(value.clientHeight >= 2 * value.lineHeight, 'at least two complete prose lines remain readable: ' + JSON.stringify(value));
  };
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 300, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=light' });
  await loaded;
  await run('document.fonts.ready');
  await run('Archify.readerLayout.whenStable()');
  await run(`Archify.focus.set('users')`);
  await settle();
  await click('btn-focus-explain');
  const opened = await state();
  if (process.env.ARCHIFY_TEST_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.ARCHIFY_TEST_EVIDENCE_DIR, { recursive: true });
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(process.env.ARCHIFY_TEST_EVIDENCE_DIR, 'long-320x300.png'), Buffer.from(capture.data, 'base64'));
    fs.writeFileSync(path.join(process.env.ARCHIFY_TEST_EVIDENCE_DIR, 'long-320x300.json'), JSON.stringify(opened, null, 2));
  }
  assert.equal(opened.parentBackVisible,true,'the sibling page has its own parent navigation');
  visible(opened);
  assert.equal(opened.focused, 'focus-explanation-back');
  assert.equal(opened.text, prose.trim(), 'all authored prose remains in the scrollable body');
  assert.ok(opened.scrollHeight > opened.clientHeight, 'long prose has an independent scroll area');
  await key('Tab', 'Tab', 9, 8);
  assert.equal((await state()).focused, 'focus-explanation-body');
  await key('End', 'End', 35);
  const scrolled = await state();
  assert.ok(scrolled.scrollTop > 0, JSON.stringify(scrolled));
  visible(scrolled);
  await viewport(1440, 900);
  const desktop = await state();
  visible(desktop);
  assert.equal(desktop.panelPosition,'absolute','resizing out restores stage placement');
  assert.equal(desktop.fontSize,opened.fontSize,'short viewport does not shrink the prose');
  await viewport(320, 300);
  const beforeClose = await state();
  visible(beforeClose);
  assert.equal(beforeClose.panelPosition,'fixed');
  await click('focus-explanation-back');
  const closed = await state();
  assert.equal(closed.focused, 'btn-focus-explain');
  assert.equal(closed.explaining, false);
  assert.equal(closed.pageScroll,beforeClose.pageScroll,'restoring Explain does not scroll the page');
  assert.ok(closed.chip.top >= 0 && closed.chip.bottom <= closed.viewport.height + 1, JSON.stringify(closed));
  assert.ok(closed.explain.top >= 0 && closed.explain.bottom <= closed.viewport.height + 1, 'restored Explain focus is visible: ' + JSON.stringify(closed));
  await key('Enter', 'Enter', 13);
  const keyboardOpened = await state();
  visible(keyboardOpened);
  assert.equal(keyboardOpened.focused, 'focus-explanation-back');
  assert.equal(keyboardOpened.focusVisible, true, 'keyboard activation retains a visible focus indicator');
  if (process.env.ARCHIFY_TEST_EVIDENCE_DIR) {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(process.env.ARCHIFY_TEST_EVIDENCE_DIR, 'keyboard-320x300.png'), Buffer.from(capture.data, 'base64'));
  }
  await key('Escape', 'Escape', 27);
  assert.equal((await state()).focused, 'btn-focus-explain');
  assert.equal((await state()).explaining, false);
});
