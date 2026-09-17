import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const DATA_BRANCH = 'contributor-cards';
export const templateVersion = 1;
export function validRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || '') || value.includes('..')) throw new Error('Expected owner/repository.');
  return value;
}
export function prNumber(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value))) throw new Error('Expected a positive PR number.');
  return Number(value);
}
function displayTitle(title) {
  const normalized = title.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069·•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('PR title has no displayable text.');
  return normalized;
}
export function recordFromPull(pull, repository) {
  validRepository(repository);
  const number = prNumber(pull.number);
  if (pull.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error('PR belongs to a different repository.');
  if (pull.merged !== true || !pull.merged_at || !Number.isFinite(Date.parse(pull.merged_at))) throw new Error('Only merged pull requests receive contribution cards.');
  if (!/^[a-f0-9]{40}$/.test(pull.merge_commit_sha || '')) throw new Error('Missing merge commit.');
  if (pull.user?.type !== 'User' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(pull.user.login || '')) throw new Error('A human GitHub author is required.');
  if (typeof pull.title !== 'string' || !pull.title.trim() || pull.title.length > 512) throw new Error('Invalid PR title.');
  displayTitle(pull.title);
  return {
    templateVersion, repository, number, author: pull.user.login,
    title: pull.title, mergedAt: pull.merged_at, mergeCommit: pull.merge_commit_sha,
    url: `https://github.com/${repository}/pull/${number}`,
  };
}
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export async function cardHtml(record) {
  const data = {
    AUTHOR: record.author, NUMBER: record.number, REPOSITORY: record.repository,
    TITLE: displayTitle(record.title),
    DATE: record.mergedAt.slice(0, 10), SHORT_SHA: record.mergeCommit.slice(0, 7),
  };
  let html = (await fs.readFile(path.join(root, 'template.html'), 'utf8'))
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
      if (!(key in data)) throw new Error(`Unknown template field: ${key}`);
      return escapeHtml(data[key]);
    });
  for (const [name, mime] of [['map.png', 'image/png'], ['fonts/Manrope-Variable.ttf', 'font/ttf'], ['fonts/BarlowCondensed-SemiBold.ttf', 'font/ttf']]) {
    const bytes = await fs.readFile(path.join(root, 'assets', name));
    html = html.replace(`./assets/${name}`, `data:${mime};base64,${bytes.toString('base64')}`);
  }
  return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; base-uri \'none\'">');
}
export async function renderCard(record, outputDirectory, { chrome = findChrome() } = {}) {
  if (!chrome) throw new Error('Chrome is required. Set ARCHIFY_CHROME to its executable.');
  await fs.mkdir(outputDirectory, { recursive: true });
  const stem = path.resolve(outputDirectory, `pr-${record.number}`);
  const html = await cardHtml(record);
  await fs.writeFile(`${stem}.html`, html);
  const browser = new ChromeVisualBrowser(chrome);
  let receipt;
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session, 30000);
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1500, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    const navigation = await send('Page.navigate', { url: pathToFileURL(`${stem}.html`).href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    await loaded;
    const metrics = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(i => i.decode()));
      const overflow = e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
      for (const e of document.querySelectorAll('[data-fit-min]')) {
        let size = parseFloat(getComputedStyle(e).fontSize);
        while (overflow(e) && size > Number(e.dataset.fitMin)) {
          size -= 1; e.style.fontSize = size + 'px';
        }
        if (overflow(e) && e.dataset.wrap === 'true') {
          e.style.whiteSpace = 'normal'; e.style.overflowWrap = 'anywhere';
          e.dataset.wrapped = 'true';
        }
        if (overflow(e) && e.dataset.ellipsis === 'true') {
          e.dataset.truncated = 'true';
          const parts = [...new Intl.Segmenter('en', {granularity:'grapheme'}).segment(e.textContent)].map(p => p.segment);
          while (parts.length && overflow(e)) { parts.pop(); e.textContent = parts.join('').trimEnd() + '…'; }
        }
        if (overflow(e)) throw new Error('Text exceeds supported layout: ' + e.className + ' ' + [e.clientWidth,e.scrollWidth,e.clientHeight,e.scrollHeight]);
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const selectors = ['.handle','.role','.moment','.datum','.datum-value','.series','.record'];
      const clipped = [...document.querySelectorAll(selectors.join(','))].filter(overflow).map(e => e.className);
      const fonts = [...document.fonts].map(f => ({family:f.family,status:f.status}));
      if (fonts.some(f => f.status !== 'loaded')) throw new Error('A bundled font did not load');
      if (clipped.length) throw new Error('Clipped elements: ' + clipped.join(', '));
      if (document.querySelector('.identity').getBoundingClientRect().bottom > 320) throw new Error('Contributor identity exceeds the map clearance');
      if (document.querySelector('.moment').getBoundingClientRect().bottom + 20 > document.querySelector('footer').getBoundingClientRect().top) throw new Error('Message overlaps the contribution record');
      return {width:1000,height:1500,fonts,clipped,text:document.body.innerText,
        fitted:[...document.querySelectorAll('[data-fit-min]')].map(e=>({text:e.innerText,fontSize:getComputedStyle(e).fontSize,truncated:e.dataset.truncated === 'true',wrapped:e.dataset.wrapped === 'true'}))};
    })()` });
    if (metrics.exceptionDetails) throw new Error(metrics.exceptionDetails.exception?.description || metrics.exceptionDetails.text);
    receipt = metrics.result.value;
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const png = Buffer.from(screenshot.data, 'base64');
    if (png.readUInt32BE(16) !== 1000 || png.readUInt32BE(20) !== 1500) throw new Error('Wrong export size');
    await fs.writeFile(`${stem}.png`, png);
    await fs.writeFile(`${stem}.json`, JSON.stringify({ ...record, pngSha256: createHash('sha256').update(png).digest('hex') }, null, 2) + '\n');
    await fs.writeFile(`${stem}.check.json`, JSON.stringify(receipt, null, 2) + '\n');
  } finally { await browser.close(); }
  return { stem, receipt };
}
