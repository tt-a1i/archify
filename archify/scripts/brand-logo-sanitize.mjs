// Allowlist sanitizer for vendored full-colour logo SVGs.
//
// Upstream files are parsed into a flat tag stream; only static vector
// elements and presentation attributes survive. Scripts, foreignObject,
// event handlers, external references (href / url() to anything but a local
// #id), CSS <style> blocks and embedded rasters are removed. Local ids are
// namespaced per logo so several logos can share one SVG document.

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use',
]);
// Elements whose whole subtree is dropped.
const DROP_SUBTREE = new Set([
  'script', 'style', 'foreignobject', 'metadata', 'title', 'desc', 'image', 'text',
  'a', 'iframe', 'animate', 'animatetransform', 'animatemotion', 'set', 'filter',
  'pattern', 'symbol', 'switch', 'sodipodi:namedview', 'inkscape:perspective',
]);
const ATTRIBUTES = new Set([
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy',
  'width', 'height', 'points', 'transform', 'fill', 'fill-rule', 'clip-rule',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity',
  'stop-color', 'stop-opacity', 'offset', 'gradientunits', 'gradienttransform',
  'spreadmethod', 'id', 'clip-path', 'mask', 'href', 'xlink:href', 'maskunits',
  'clippathunits', 'maskcontentunits', 'style', 'display', 'visibility',
]);
const STYLE_PROPERTIES = new Set([
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'opacity', 'stop-color',
  'stop-opacity', 'clip-rule', 'display', 'visibility',
]);
const CASE = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath',
  gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod',
  maskunits: 'maskUnits', clippathunits: 'clipPathUnits', maskcontentunits: 'maskContentUnits',
};

function unsafeValue(value) {
  const v = value.replace(/\s+/g, '').toLowerCase();
  if (/javascript:|data:|vbscript:|expression\(|@import|<|>/.test(v)) return true;
  for (const m of v.matchAll(/url\(([^)]*)\)/g)) {
    if (!/^['"]?#[\w.-]+['"]?$/.test(m[1])) return true;
  }
  return false;
}

function attributesOf(source) {
  const out = [];
  for (const m of source.matchAll(/([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out.push([m[1], m[3] ?? m[4] ?? '']);
  }
  return out;
}

function cleanStyle(value) {
  return value.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [prop, ...rest] = d.split(':');
    return [prop.trim().toLowerCase(), rest.join(':').trim()];
  }).filter(([p, v]) => STYLE_PROPERTIES.has(p) && v && !unsafeValue(v))
    .map(([p, v]) => `${p}:${v}`).join(';');
}

const escAttr = (v) => v.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[\da-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Geometry is rounded to a precision that stays far below one device pixel at
// the largest tile size (~1/2000 of the logo's extent).
function rounder(viewBox) {
  const extent = Math.max(viewBox[2], viewBox[3]) || 1;
  const decimals = Math.max(0, Math.min(3, 3 - Math.floor(Math.log10(extent))));
  const factor = 10 ** decimals;
  return (value) => value.replace(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi, (n) => {
    const r = Math.round(Number(n) * factor) / factor;
    const t = String(Object.is(r, -0) ? 0 : r);
    return t.replace(/^(-?)0\./, '$1.');
  });
}
const GEOMETRY = new Set(['d', 'points', 'transform', 'gradientTransform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'stroke-width']);

export function sanitizeLogoSvg(source, prefix) {
  const text = String(source)
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const ids = new Map();
  const tokens = [...text.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)];
  for (const t of tokens) {
    if (t[1]) continue;
    for (const [n, v] of attributesOf(t[3])) if (n.toLowerCase() === 'id') ids.set(v, `${prefix}-${ids.size}`);
  }
  const remap = (v) => v
    .replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (m, id) => (ids.has(id) ? `url(#${ids.get(id)})` : 'none'));
  let viewBox = null;
  let rootSeen = false;
  let round = null;
  let dropDepth = 0;
  const stack = [];
  const body = [];
  for (const t of tokens) {
    const [, closing, rawName, rawAttrs, selfClosing] = t;
    const name = rawName.toLowerCase();
    if (closing) {
      const open = stack.pop();
      if (open === undefined) continue;
      if (open.drop) { dropDepth -= 1; continue; }
      if (open.emit) body.push(`</${CASE[open.name] || open.name}>`);
      continue;
    }
    const drop = dropDepth > 0 || DROP_SUBTREE.has(name) || !ELEMENTS.has(name);
    if (name === 'svg' && !rootSeen) {
      rootSeen = true;
      const attrs = Object.fromEntries(attributesOf(rawAttrs).map(([n, v]) => [n.toLowerCase(), v]));
      const parts = String(attrs.viewbox || '').trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) viewBox = parts;
      else if (parseFloat(attrs.width) > 0 && parseFloat(attrs.height) > 0) viewBox = [0, 0, parseFloat(attrs.width), parseFloat(attrs.height)];
      if (viewBox) round = rounder(viewBox);
      const kept = attributesOf(rawAttrs).filter(([n, v]) => ['fill', 'stroke', 'fill-rule', 'clip-rule', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].includes(n.toLowerCase()) && !unsafeValue(v));
      if (!selfClosing) stack.push({ name: 'g', emit: kept.length > 0, drop: false });
      if (kept.length) body.push(`<g ${kept.map(([n, v]) => `${n.toLowerCase()}="${escAttr(v)}"`).join(' ')}>`);
      continue;
    }
    if (drop) {
      if (!selfClosing) { stack.push({ name, drop: true }); dropDepth += 1; }
      continue;
    }
    const attrs = [];
    for (const [n, value] of attributesOf(rawAttrs)) {
      const key = n.toLowerCase();
      if (!ATTRIBUTES.has(key) || key.startsWith('on')) continue;
      let v = value;
      if (key === 'id') v = ids.get(value);
      else if (key === 'href' || key === 'xlink:href') {
        const local = /^#([\w.:-]+)$/.exec(v.trim());
        if (!local || !ids.has(local[1])) continue;
        attrs.push(['href', `#${ids.get(local[1])}`]);
        continue;
      } else if (key === 'style') {
        v = cleanStyle(remap(v));
        if (!v) continue;
      } else v = remap(v);
      if (unsafeValue(v)) continue;
      const attr = CASE[key] || key;
      attrs.push([attr, round && GEOMETRY.has(attr) ? round(v) : v]);
    }
    const tag = CASE[name] || name;
    const open = `<${tag}${attrs.map(([n, v]) => ` ${n}="${escAttr(v)}"`).join('')}`;
    if (selfClosing) body.push(`${open}/>`);
    else { body.push(`${open}>`); stack.push({ name, emit: true, drop: false }); }
  }
  if (!viewBox) throw new Error('logo SVG has no usable viewBox or width/height');
  return { viewBox, body: body.join('') };
}

// Independent post-condition used by generation and tests.
export function logoBodyProblems(body) {
  const problems = [];
  if (/<\s*(script|style|foreignObject|image|iframe|a|text|animate|set)\b/i.test(body)) problems.push('forbidden element');
  if (/\son[a-z]+\s*=/i.test(body)) problems.push('event handler attribute');
  if (/javascript:|data:|vbscript:/i.test(body)) problems.push('script or data URL');
  for (const m of body.matchAll(/href="([^"]*)"/g)) if (!m[1].startsWith('#')) problems.push(`external href ${m[1]}`);
  for (const m of body.matchAll(/url\(([^)]*)\)/g)) if (!/^#[\w.-]+$/.test(m[1])) problems.push(`external url(${m[1]})`);
  return problems;
}
