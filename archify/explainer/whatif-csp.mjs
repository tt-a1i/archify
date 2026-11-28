import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NOTICE_SCRIPT, UPDATE_NOTICE_ATTRIBUTE } from '../bin/update-notice.mjs';

const browserText = text => text.replace(/\r\n?/gu, '\n');
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

const decode = value => value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/gi, token => {
  const names = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"};
  if (names[token.toLowerCase()]) return names[token.toLowerCase()];
  const n = token[2].toLowerCase() === 'x' ? parseInt(token.slice(3,-1),16) : Number(token.slice(2,-1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD';
});

// Bounded HTML token scanner: quoted attributes, comments, and raw-text elements
// are consumed together, so a JSON string containing markup is never a DOM ID.
export function scanHtml(html, { project = false } = {}) {
  const elements = [];
  const scripts = [];
  const comments = [];
  const stack = [];
  const projection = [];
  const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let match, line = 1, lineOffset = 0, cursor = 0;
  function appendText(end) {
    if (!project || end === cursor) return;
    const text = decode(browserText(html.slice(cursor,end)));
    projection.push(['text',text]);
  }
  while ((match = token.exec(html))) {
    appendText(match.index);
    cursor = token.lastIndex;
    if (!match[2]) {
      if (match[0].startsWith('<!--')) comments.push(match[0]);
      continue;
    }
    const tag = match[2].toLowerCase();
    if (match[1]) {
      if (project) projection.push(['close',tag]);
      const open = stack.findLastIndex(entry => entry.tag === tag);
      if (open !== -1) {
        stack[open].end = cursor;
        stack.length = open;
      }
      continue;
    }
    const attrs = Object.create(null);
    const attr = /([^\s=<>"'`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const raw = match[0].slice(match[0].indexOf(match[2]) + match[2].length, -1);
    let a;
    while ((a = attr.exec(raw))) {
      const key = a[1].toLowerCase();
      if (!Object.hasOwn(attrs,key)) attrs[key] = decode(browserText(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    // Advance once through the input, including skipped raw text, instead of
    // recounting every preceding line for each element of a large native SVG.
    for (let newline = html.indexOf('\n', lineOffset); newline >= 0 && newline < match.index; newline = html.indexOf('\n', newline + 1)) line++;
    lineOffset = match.index;
    const element = {tag,attrs,line,index:match.index,end:cursor,parent:stack.at(-1)};
    elements.push(element);
    const selfClosing = voidTags.has(tag) || match[0].endsWith('/>');
    if (project) projection.push([selfClosing ? 'void' : 'open',tag,Object.entries(attrs).sort()]);
    if (['script','style','textarea','title','noscript'].includes(tag)) {
      const end = new RegExp(`</${tag}\\s*>`,'gi');
      end.lastIndex = token.lastIndex;
      const closing = end.exec(html);
      const text = html.slice(token.lastIndex, closing?.index ?? html.length);
      token.lastIndex = closing ? end.lastIndex : html.length;
      element.end = cursor = token.lastIndex;
      if (tag === 'script') scripts.push({...element,text,closed:Boolean(closing)});
      if (project) projection.push(['raw',browserText(text)],['close',tag]);
    } else if (!selfClosing) stack.push(element);
  }
  appendText(html.length);
  return {elements,scripts,comments,projection};
}

// Compare the structure and text the reader consumes, independent of tag
// formatting and attribute order. Keep inline spacing and raw CSS significant.
export function boardProjection(html) {
  const {projection} = scanHtml(html,{project:true});
  const blocks = new Set('main section header article aside div p dl ol ul li table thead tbody tr figure'.split(' '));
  const block = token => token && ['open','close'].includes(token[0]) && blocks.has(token[1]);
  return projection.filter(([kind,text],i)=>kind!=='text' || !/^[ \t\n\f]+$/u.test(text) ||
    (!block(projection[i-1]) && !block(projection[i+1])));
}

const engine = fs.readFileSync(new URL('./whatif-engine.mjs', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('./reader.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('./viewer-bridge.js', import.meta.url), 'utf8');
const readerSource = 'const explainerViewerBridge = ' + JSON.stringify(bridge).replaceAll('<', '\\u003c') + ';\n' + reader;
const sha = text => "'sha256-" + createHash('sha256').update(browserText(text)).digest('base64') + "'";

export const explainerScript = interactive => interactive ? engine + '\n' + readerSource : readerSource;
const inert = script => ['application/json','application/ld+json','text/plain'].includes(script.attrs.type);

function nativeScriptHashes(html) {
  return scanHtml(html).scripts.filter(script=>!inert(script)).map(script=>
    script.closed && Object.keys(script.attrs).length === 0 ? sha(script.text) : null);
}

let nativeInventory;
// Shipped v1 children verified by the native checker against their exact bytes.
const legacyChildren = new Set([
  'fc1b9b8966d1ba7e1aa0b4d9984d3110c2dc942387db7f257fec047197d011cd', // finalize-delivery
  'ddf7f348a7983ccf0dfbd5ab70524905d1db6606bb84b0d33743925ad714949b', // first-rental
  '873065dba7efa5c1be6a2bf9f5b895b79e6d9e69493cb92a1d559b3f73fed324', // p99-tail-latency
  'd1e9c4be7d5890e10f1647786fd85c0aa0642b342dbb52d1480372c0658ab8f2', // tls-first-visit
]);
const legacyInventory = [
  "'sha256-2bHRpy6NCJnBMLP1uWLpzCNclUMg79W5Fzj8fNLlOAI='",
  "'sha256-YWS+1DFzBSGt+uQOcONOEDePUeAhGV9pRDOl0XLUQlc='",
];

export function verifiedNativeScriptHashes(html) {
  if (typeof html !== 'string') return null;
  nativeInventory ||= nativeScriptHashes(fs.readFileSync(new URL('../assets/template.html',import.meta.url),'utf8'));
  const hashes = nativeScriptHashes(html);
  const matches = expected => hashes.length === expected.length && hashes.every((hash,i)=>hash && hash===expected[i]);
  if (matches(nativeInventory)) return hashes;
  if (matches(legacyInventory) && legacyChildren.has(createHash('sha256').update(html).digest('hex'))) return hashes;
  return null;
}

export function whatIfPolicy(diagrams) {
  const hashes = new Set([sha(explainerScript(true)), sha(bridge), sha(NOTICE_SCRIPT)]);
  for (const child of Object.values(diagrams)) {
    for (const hash of verifiedNativeScriptHashes(child.html) || []) hashes.add(hash);
  }
  return [
    "default-src 'none'", "base-uri 'none'", "object-src 'none'", "connect-src 'none'", "form-action 'none'",
    "script-src " + [...hashes].sort().join(' '), "script-src-attr 'none'", "style-src 'unsafe-inline'",
    'font-src data:', 'img-src data: blob:', 'media-src blob:', 'frame-src about:',
  ].join('; ');
}

const noticeBanner = element => element && (Object.hasOwn(element.attrs,UPDATE_NOTICE_ATTRIBUTE) ||
  element.attrs.class?.split(/\s+/u).includes('archify-update-notice'));

export function matchesWhatIfScripts({elements,scripts,comments}) {
  const payloads = new Set(['archify-explainer-prepared','explainer-manifest','explainer-reader-words','archify-software-notices']);
  let readers = 0;
  let notices = 0;
  for (const script of scripts) {
    if (!script.closed) return false;
    const keys = Object.keys(script.attrs);
    if (script.attrs.type === 'application/json' && keys.length === 2 && payloads.delete(script.attrs.id)) continue;
    if (keys.length === 1 && script.attrs.type === 'module' && browserText(script.text) === browserText(explainerScript(true))) { readers++; continue; }
    if (!keys.length && noticeBanner(script.parent) && browserText(script.text) === browserText(NOTICE_SCRIPT)) { notices++; continue; }
    return false;
  }
  const banners = elements.filter(noticeBanner).length;
  const hasNotice = banners > 0 || comments.some(comment => /^<!-- archify-update-notice:(?:start|end) -->$/u.test(comment));
  return readers === 1 && notices === Number(hasNotice) && notices === banners && payloads.size === 0;
}
