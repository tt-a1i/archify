import { extractArchitectureSvg, extractArtifactCss, transformNodeGroups } from '../delta/svg-annotate.mjs';
import { LocateError } from './error.mjs';

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const safeJson = (value) => JSON.stringify(value, null, 2).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

const FORBIDDEN = /\b(?:SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/i;
const REPO_PATH_OK = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\u0000-\u001f]+$/;

const THEME_BOOTSTRAP = `<script>
(function () {
  try {
    var theme = null;
    try {
      var param = new URLSearchParams(window.location.search).get('theme');
      if (param === 'light' || param === 'dark') theme = param;
    } catch (_) {}
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {}
})();
</script>`;

export function headerMapPath(mapPath) {
  const value = String(mapPath || '');
  if (REPO_PATH_OK.test(value)) return value;
  const parts = value.split(/[\\/]+/).filter((part) => part && part !== '.' && part !== '..');
  return parts.pop() || 'map.json';
}

// Mark escaped input at its insertion site; never remove matching words globally.
function inputText(value) {
  return `<span data-locate-input="">${esc(value)}</span>`;
}

function chromeTextForForbidCheck(html) {
  return String(html)
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // inputText emits only escaped text, so these spans cannot contain tags.
    .replace(/<span data-locate-input="">[^<]*<\/span>/g, '')
    .replace(/<[^>]*>/g, tag => ` ${[...tag.matchAll(/\s(?:aria-label|title|alt)=["']([^"']*)["']/g)]
      .map(match => match[1]).join(' ')} `)
    .replace(/\s+/g, ' ');
}

function lastRectBox(group) {
  const rects = [...group.matchAll(/<rect\b[^>]*>/g)];
  const last = rects.length ? rects[rects.length - 1][0] : '';
  const attr = (name) => {
    const match = last.match(new RegExp(`\\b${name}="([^"]+)"`));
    return match ? Number(match[1]) : NaN;
  };
  return { x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') };
}

function withInsideBadge(group, count) {
  if (!(count > 0)) return group;
  const box = lastRectBox(group);
  const x = Number.isFinite(box.x) && Number.isFinite(box.width) ? box.x + box.width - 6 : 0;
  const y = Number.isFinite(box.y) ? box.y + 11 : 11;
  const badge = `<text data-locate-inside-count="" class="t-muted" font-size="8" text-anchor="end" x="${x}" y="${y}">${count}</text>`;
  return group.replace(/<\/g>\s*$/, `${badge}</g>`);
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '—';
}

function blobHref(receipt, filePath) {
  if (receipt.repository.linkMode !== 'web' || !receipt.repository.url) return '';
  const head = receipt.repository.head || receipt.repository.revision;
  if (!head) return '';
  const base = String(receipt.repository.url).replace(/\.git$/i, '').replace(/\/+$/, '');
  return `${base}/blob/${head}/${filePath}`;
}

function addLocateState(tag, state) {
  const append = (attributes) => (tag.endsWith('/>')
    ? tag.replace(/\/>$/, `${attributes}/>`)
    : tag.replace(/>$/, `${attributes}>`));
  const focus = state === 'touched' || state === 'stale' ? ' data-focus-match=""' : '';
  return append(` data-locate-state="${esc(state)}"${focus}`);
}

export function annotateLocateSvg(svg, receipt) {
  const byId = new Map(receipt.components.map((component) => [component.id, component]));
  let result = transformNodeGroups(svg, (group, id) => {
    const component = byId.get(id);
    const state = component?.state || 'untouched';
    const inside = Number(component?.inside?.touched || 0);
    const annotated = group.replace(/^<g[^>]*>/, (tag) => {
      let next = addLocateState(tag, state);
      if (inside > 0) next = next.replace(/>$/, ` data-locate-inside="${inside}">`);
      return next;
    });
    return withInsideBadge(annotated, inside);
  });
  result = result.replace(/<svg\b/, '<svg data-locate-active="true" data-focus-active="true"');
  return result;
}

function fileLink(receipt, filePath) {
  const href = blobHref(receipt, filePath);
  return href
    ? `<a href="${esc(href)}">${inputText(filePath)}</a>`
    : inputText(filePath);
}

function listBlock(title, items, render) {
  return `<section class="panel-block">
    <h2>${esc(title)}</h2>
    ${items.length ? `<ul>${items.map((item) => `<li>${render(item)}</li>`).join('')}</ul>` : '<p class="empty">None.</p>'}
  </section>`;
}

export function renderLocateHtml({ receipt, svg, artifactCss = '', mapDeltaHref }) {
  const annotated = annotateLocateSvg(svg, receipt);
  const range = receipt.mode === 'lint'
    ? shortSha(receipt.repository.revision)
    : `${shortSha(receipt.repository.base)}..${shortSha(receipt.repository.head)}`;
  const componentBlocks = receipt.components.map((component) => `<article class="component" data-locate-state="${esc(component.state)}">
      <h3>${inputText(component.label)} <code>${inputText(component.id)}</code> <span class="state">${esc(component.state)}</span></h3>
      ${component.inside ? `<p class="inside">${component.inside.touched} files touched inside</p>` : ''}
      ${component.touchedFiles.length
        ? `<ul>${component.touchedFiles.map((filePath) => `<li>${fileLink(receipt, filePath)}</li>`).join('')}</ul>`
        : '<p class="empty">No touched files.</p>'}
    </article>`).join('');
  const uncovered = receipt.files.filter((file) => file.state === 'uncovered');
  const ambiguous = receipt.files.filter((file) => file.state === 'ambiguous');
  const excluded = receipt.files.filter((file) => file.state === 'excluded');
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Locate ${esc(range)}</title>
${THEME_BOOTSTRAP}
<style>
:root { color-scheme: light dark; --ink:#1b1f24; --muted:#5c6570; --line:#d5dbe3; --bg:#f6f7f9; --panel:#fff; --touch:#8a4b08; --stale:#7a1f2b; }
html[data-theme="dark"] { --ink:#e8edf2; --muted:#9aa3ad; --line:#2a333d; --bg:#0e141a; --panel:#151c23; --touch:#e2a15a; --stale:#e38790; }
@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) { --ink:#e8edf2; --muted:#9aa3ad; --line:#2a333d; --bg:#0e141a; --panel:#151c23; --touch:#e2a15a; --stale:#e38790; }
}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
header{padding:18px 22px 10px;border-bottom:1px solid var(--line)}
header h1{margin:0;font-size:18px;letter-spacing:.02em}
header p{margin:6px 0 0;color:var(--muted)}
main{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,0.9fr);gap:18px;padding:18px 22px 28px}
.canvas{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto}
.canvas svg{display:block;width:100%;height:auto;max-height:72vh}
svg[data-focus-active] [data-node-id] { opacity: 0.13; }
svg[data-focus-active] [data-focus-match] { opacity: 1; }
.side{display:flex;flex-direction:column;gap:14px}
.component,.panel-block,.review{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.component h3,.panel-block h2,.review h2{margin:0 0 8px;font-size:13px}
.component code{color:var(--muted);font-size:12px}
.state{text-transform:uppercase;letter-spacing:.04em;font-size:11px;color:var(--muted)}
.component[data-locate-state="touched"] .state{color:var(--touch)}
.component[data-locate-state="stale"] .state{color:var(--stale)}
ul{margin:0;padding-left:18px}
.empty,.inside,footer{color:var(--muted);margin:0}
a{color:inherit}
${artifactCss}
</style>
</head><body>
<header>
  <h1>Locate ${esc(range)}</h1>
  <p>${inputText(headerMapPath(receipt.map.path))} · ${receipt.summary.files.touched} touched / ${receipt.summary.files.uncovered} uncovered / ${receipt.summary.files.ambiguous} ambiguous / ${receipt.summary.files.excluded} excluded</p>
</header>
<main>
  <section class="canvas" aria-label="Annotated architecture">${annotated}</section>
  <aside class="side">
    ${componentBlocks}
    ${listBlock('Uncovered', uncovered, (file) => inputText(file.path))}
    ${listBlock('Ambiguous', ambiguous, (file) => `${inputText(file.path)} (${(file.candidates || []).map(inputText).join(', ')})`)}
    ${listBlock('Excluded', excluded, (file) => inputText(file.path))}
    <section class="review">
      <h2>Review</h2>
      <p>required: ${receipt.review.required ? 'yes' : 'no'}</p>
      <p>blocking: ${receipt.review.blocking.length ? receipt.review.blocking.map(esc).join(', ') : 'none'}</p>
      <p>advisory: ${receipt.review.advisory.length ? receipt.review.advisory.map(esc).join(', ') : 'none'}</p>
      ${mapDeltaHref ? `<p>Map changed. Compare: <a href="${esc(mapDeltaHref)}">${inputText(mapDeltaHref)}</a></p>` : ''}
    </section>
    <footer>
      ${receipt.limitations.map((line) => `<p>${esc(line)}</p>`).join('')}
    </footer>
  </aside>
</main>
<script id="archify-locate-receipt" type="application/json">${safeJson(receipt)}</script>
</body></html>`;
  return html.replace(/[ \t]+$/gm, '');
}

export function renderLocateHtmlFromArtifact({ receipt, mapHtml, mapDeltaHref }) {
  return renderLocateHtml({
    receipt,
    svg: extractArchitectureSvg(mapHtml),
    artifactCss: extractArtifactCss(mapHtml),
    mapDeltaHref,
  });
}

// Receipt strings, labels and file paths are not geometry. Inspect only SVG
// attributes whose values represent coordinates, lengths or transforms.
function hasNonFiniteSvgGeometry(html) {
  const numeric = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'width', 'height', 'dx', 'dy', 'd', 'points', 'viewbox', 'transform', 'font-size',
    'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity',
    'stroke-opacity', 'pathlength', 'markerwidth', 'markerheight', 'refx', 'refy']);
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const svg of markup.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    for (const tag of svg[0].matchAll(/<[a-z][^>]*>/gi)) {
      for (const attr of tag[0].matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        if (numeric.has(attr[1].toLowerCase()) && /\b(?:NaN|Infinity|undefined)\b/.test(attr[2] ?? attr[3])) return true;
      }
    }
  }
  return false;
}

export function validateLocateHtml(html, receipt, options = {}) {
  const failures = [];
  const checks = [];
  const check = (name, ok, message) => {
    checks.push({ name, ok: Boolean(ok) });
    if (!ok) failures.push(message);
  };
  const diagramType = options.diagramType || receipt?.map?.diagramType || 'architecture';
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
  if (diagramType === 'architecture') {
    check('annotation', html.includes('data-locate-state='), 'annotated SVG is missing data-locate-state');
  } else {
    check('receipt-only', html.includes('Locate receipt only.'), 'receipt-only HTML is missing its marker');
  }
  const forbiddenHit = chromeTextForForbidCheck(html).match(FORBIDDEN);
  check('forbidden-claims', !forbiddenHit, 'contains a forbidden risk or mergeability claim');
  check('finite-output', !hasNonFiniteSvgGeometry(html), 'contains non-finite output');
  check('complete-receipt', !(receipt && receipt.completeness !== 'complete'), 'receipt is not complete');
  const checkCount = checks.length;
  const checksPassed = checks.filter((item) => item.ok).length;
  if (failures.length) {
    throw new LocateError('locate/artifact-invalid', `Locate HTML failed validation: ${failures.join('; ')}.`, {
      evidence: {
        failures,
        checksPassed,
        checkCount,
        ...(forbiddenHit ? { match: forbiddenHit[0] } : {}),
      },
      supportedFixes: forbiddenHit
        ? ['remove the risk or mergeability claim from locate HTML chrome; file paths and receipt JSON are not scanned']
        : [],
    });
  }
  return { ok: true, checksPassed, checkCount };
}
