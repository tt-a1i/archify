import { transformNodeGroups } from '../delta/svg-annotate.mjs';
import { LocateError } from './error.mjs';

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const safeJson = (value) => JSON.stringify(value, null, 2).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

const FORBIDDEN = /\b(?:SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/i;

function htmlChrome(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '')
    .replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi, '')
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '')
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, '');
}

function addLocateState(tag, state) {
  const append = (attributes) => (tag.endsWith('/>')
    ? tag.replace(/\/>$/, `${attributes}/>`)
    : tag.replace(/>$/, `${attributes}>`));
  const focus = state === 'touched' || state === 'stale' ? ' data-focus-match=""' : '';
  return append(` data-locate-state="${esc(state)}"${focus}`);
}

export function annotateLocateSvg(svg, receipt) {
  const byId = new Map((receipt.components || []).map((component) => [component.id, component.state]));
  let result = transformNodeGroups(svg, (group, id) => {
    const state = byId.get(id) || 'untouched';
    return group.replace(/^<g[^>]*>/, (tag) => addLocateState(tag, state));
  });
  result = result.replace(/<svg\b/, '<svg data-locate-active="true" data-focus-active="true"');
  return result;
}

export function stampUncoveredCount(html, count) {
  const value = String(Number(count) || 0);
  if (!/<svg\b/.test(html)) return html;
  return html.replace(/<svg\b/, `<svg data-locate-uncovered-count="${esc(value)}"`);
}

function blobHref(receipt, filePath) {
  if (receipt.repository?.linkMode !== 'web' || !receipt.repository.url) return '';
  const head = receipt.repository.head || receipt.repository.revision;
  if (!head) return '';
  const base = String(receipt.repository.url).replace(/\.git$/i, '').replace(/\/+$/, '');
  return `${base}/blob/${head}/${filePath}`;
}

function fileLink(receipt, filePath) {
  const href = blobHref(receipt, filePath);
  return href
    ? `<a href="${esc(href)}">${esc(filePath)}</a>`
    : `<span>${esc(filePath)}</span>`;
}

function topLevelPrefix(filePath) {
  const slash = String(filePath).indexOf('/');
  return slash === -1 ? '(root)' : String(filePath).slice(0, slash);
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

function emptyOrList(items, render) {
  if (!items.length) return '<p class="empty">None</p>';
  return `<ul>${items.map((item) => `<li>${render(item)}</li>`).join('')}</ul>`;
}

export function renderLocateHtml({ receipt, mapDeltaHref }) {
  const repo = receipt.repository || {};
  const range = receipt.mode === 'lint'
    ? (repo.revision || '—')
    : `${repo.base || '—'}..${repo.head || '—'}`;
  const presets = receipt.ownership?.presets || [];
  const uncovered = (receipt.files || []).filter((file) => file.state === 'uncovered');
  const excluded = (receipt.files || []).filter((file) => file.state === 'excluded');
  const uncoveredGroups = groupBy(uncovered, (file) => topLevelPrefix(file.path));
  const excludedGroups = groupBy(excluded, (file) => file.matchedGlob || '(none)');
  const componentRows = (receipt.components || []).map((component) => `<article class="component" data-locate-state="${esc(component.state)}">
      <h3>${esc(component.label)} <code>${esc(component.id)}</code> <span class="state">${esc(component.state)}</span></h3>
      ${emptyOrList(component.touchedFiles || [], (filePath) => fileLink(receipt, filePath))}
    </article>`).join('');
  const uncoveredBody = uncovered.length
    ? uncoveredGroups.map(([prefix, files]) => `<h3>${esc(prefix)} <span class="count">${files.length}</span></h3>
      ${emptyOrList(files, (file) => fileLink(receipt, file.path))}`).join('')
    : '<p class="empty">None</p>';
  const excludedBody = excluded.length
    ? excludedGroups.map(([glob, files]) => `<h3><code>${esc(glob)}</code> <span class="count">${files.length}</span></h3>
      ${emptyOrList(files, (file) => fileLink(receipt, file.path))}`).join('')
    : '<p class="empty">None</p>';
  const advisories = receipt.review?.advisory || [];
  const blocking = receipt.review?.blocking || [];
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Locate ${esc(range)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #020617;
  --text: #ffffff;
  --text-muted: #94a3b8;
  --panel: rgba(15, 23, 42, 0.5);
  --panel-border: #1e293b;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f8fafc;
    --text: #0f172a;
    --text-muted: #64748b;
    --panel: #ffffff;
    --panel-border: #e2e8f0;
  }
}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
header{padding:18px 22px 10px;border-bottom:1px solid var(--panel-border)}
header h1{margin:0;font-size:18px;letter-spacing:.02em}
header p{margin:6px 0 0;color:var(--text-muted)}
main{display:flex;flex-direction:column;gap:16px;padding:18px 22px 28px;max-width:960px}
section{background:var(--panel);border:1px solid var(--panel-border);border-radius:10px;padding:12px 14px}
h2{margin:0 0 8px;font-size:15px}
h3{margin:12px 0 6px;font-size:13px;color:var(--text-muted)}
.state{text-transform:uppercase;letter-spacing:.04em;font-size:11px;color:var(--text-muted)}
ul{margin:0;padding-left:18px}
.empty{color:var(--text-muted);margin:0}
.count{font-weight:400}
code{font:12px/1.4 ui-monospace,monospace}
a{color:inherit}
details{background:var(--panel);border:1px solid var(--panel-border);border-radius:10px;padding:12px 14px}
pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word}
</style>
</head><body>
<header>
  <h1>Locate</h1>
  <p>Map <code>${esc(receipt.map?.path)}</code></p>
  <p>${receipt.mode === 'lint' ? `Revision <code>${esc(repo.revision || '')}</code>` : `Range <code>${esc(repo.base || '')}</code>..<code>${esc(repo.head || '')}</code>`}</p>
  <p>Sidecar <code>${esc(receipt.ownership?.sha256 || '')}</code></p>
  <p>Presets ${presets.length ? presets.map((name) => `<code>${esc(name)}</code>`).join(' ') : 'none'}</p>
</header>
<main>
  <section id="paths-outside-the-map">
    <h2>Paths outside the map (${uncovered.length})</h2>
    ${uncoveredBody}
  </section>
  <section id="components">
    <h2>Components</h2>
    ${componentRows || '<p class="empty">None</p>'}
  </section>
  <section id="excluded">
    <h2>Excluded (${excluded.length})</h2>
    ${excludedBody}
  </section>
  <section id="advisories">
    <h2>Advisories</h2>
    <p>required: ${receipt.review?.required ? 'yes' : 'no'}</p>
    <p>blocking: ${blocking.length ? blocking.map(esc).join(', ') : 'none'}</p>
    <p>advisory: ${advisories.length ? advisories.map(esc).join(', ') : 'none'}</p>
    ${mapDeltaHref ? `<p>Map changed. Compare: <a href="${esc(mapDeltaHref)}">${esc(mapDeltaHref)}</a></p>` : ''}
  </section>
  <details>
    <summary>Receipt</summary>
    <pre>${esc(JSON.stringify(receipt, null, 2))}</pre>
  </details>
</main>
<script id="archify-locate-receipt" type="application/json">${safeJson(receipt)}</script>
</body></html>`;
  return html.replace(/[ \t]+$/gm, '');
}

export function renderLocateHtmlFromArtifact({ receipt, mapDeltaHref }) {
  return renderLocateHtml({ receipt, mapDeltaHref });
}

export function validateLocateHtml(html, receipt) {
  const failures = [];
  const checks = [];
  const check = (name, ok, message) => {
    checks.push({ name, ok: Boolean(ok) });
    if (!ok) failures.push(message);
  };
  const chrome = htmlChrome(html);
  const uncoveredAt = html.indexOf('Paths outside the map');
  const componentsAt = html.indexOf('>Components<') === -1 ? html.indexOf('Components') : html.indexOf('>Components<');
  check(
    'embedded-receipt',
    (html.match(/id="archify-locate-receipt"/g) || []).length === 1,
    'expected exactly one embedded locate receipt',
  );
  check(
    'receipt-script',
    html.includes('<script id="archify-locate-receipt" type="application/json">'),
    'locate receipt script is missing or has the wrong type',
  );
  check(
    'uncovered-first',
    uncoveredAt !== -1 && componentsAt !== -1 && uncoveredAt < componentsAt,
    'expected Paths outside the map before the components block',
  );
  check(
    'uncovered-empty-state',
    /Paths outside the map/.test(html) && (/(<p class="empty">None<\/p>|id="paths-outside-the-map")/.test(html)),
    'uncovered block must render an empty state as None, not hide',
  );
  check('forbidden-claims', !FORBIDDEN.test(chrome), 'contains a forbidden risk or mergeability claim');
  check('complete-receipt', !(receipt && receipt.completeness !== 'complete'), 'receipt is not complete');
  const checkCount = checks.length;
  const checksPassed = checks.filter((item) => item.ok).length;
  if (failures.length) {
    throw new LocateError('locate/artifact-invalid', `Locate HTML failed validation: ${failures.join('; ')}.`, {
      evidence: { failures, checksPassed, checkCount },
    });
  }
  return { ok: true, checksPassed, checkCount };
}
