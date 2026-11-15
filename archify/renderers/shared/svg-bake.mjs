import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { softwareNotices } from './software-notices.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const templatePath = path.join(skillRoot, 'assets', 'template.html');

export const BAKE_THEMES = ['light', 'dark'];
export const BAKE_PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];
export const CAMO_MAX_BYTES = 5 * 1024 * 1024;

const FONT_FALLBACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace";
const SVG_RULE_RE = /^(svg\b|\.c-|\.t-|\.a-|\.m-)/;
const CANVAS_SCOPE = '.diagram-container > svg';
const INTERACTIVE_PSEUDO_RE = /:(hover|focus|focus-visible|focus-within|active)\b/;
const DROPPED_PROPERTY_RE = /^(transition|animation|cursor|will-change|pointer-events)(-|$)/;
const ROOT_SVG_LAYOUT_PROPERTIES = new Set(['width', 'min-width', 'max-width', 'display', 'transform-origin', 'height']);

// ---------------------------------------------------------------------------
// Stylesheet access

const templateStyleCache = new Map();
export function loadViewerStyles(templateFile = templatePath) {
  const cached = templateStyleCache.get(templateFile);
  if (cached) return cached;
  const html = fs.readFileSync(templateFile, 'utf8');
  const blocks = [...html.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/g)];
  const fontBlock = blocks.find((block) => /id="archify-fonts"/.test(block[1] || ''));
  if (!fontBlock) throw new Error(`svg-bake: ${templateFile} has no <style id="archify-fonts"> block`);
  const css = blocks.filter((block) => block !== fontBlock).map((block) => block[2]).join('\n');
  const styles = { fontCss: fontBlock[2].trim(), rules: parseStylesheet(css) };
  templateStyleCache.set(templateFile, styles);
  return styles;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function findBlockEnd(css, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('svg-bake: unbalanced stylesheet braces');
}

function splitDeclarations(body) {
  const declarations = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  const push = (end) => {
    const text = body.slice(start, end).trim();
    start = end + 1;
    if (!text) return;
    const colon = text.indexOf(':');
    if (colon === -1) return;
    const property = text.slice(0, colon).trim();
    let value = text.slice(colon + 1).trim();
    let important = false;
    if (/!important$/i.test(value)) { important = true; value = value.replace(/\s*!important$/i, ''); }
    declarations.push({ property, value, important });
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ';' && depth === 0) push(i);
  }
  push(body.length);
  return declarations;
}

// Flat style rules only. Viewer @media blocks describe page chrome and motion
// states; keyframes and font faces are handled separately.
export function parseStylesheet(cssText, { media = null, rules = [] } = {}) {
  const css = stripComments(cssText);
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open === -1) break;
    const prelude = css.slice(index, open).trim();
    const close = findBlockEnd(css, open);
    const body = css.slice(open + 1, close);
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|container|layer)\b/.test(prelude)) {
        parseStylesheet(body, { media: media ? `${media} and ${prelude}` : prelude, rules });
      }
    } else if (prelude) {
      rules.push({ selector: prelude, media, declarations: splitDeclarations(body) });
    }
    index = close + 1;
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Selector matching for the document root

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const COMPOUND_TOKEN_RE = /^(?::root|html|svg|body|\*|\[data-[a-z-]+(?:="[^"]*")?\]|:not\(\[data-[a-z-]+(?:="[^"]*")?\]\))/;

// Evaluates a compound selector (no combinators) against a root element that
// carries exactly data-theme and data-preset.
function compoundMatchesRoot(compound, root, { allowBody = false } = {}) {
  let rest = compound.trim();
  if (!rest) return false;
  while (rest.length) {
    const match = rest.match(COMPOUND_TOKEN_RE);
    if (!match) return false;
    const token = match[0];
    rest = rest.slice(token.length);
    if (token === 'body' && !allowBody) return false;
    const negated = token.startsWith(':not(');
    const attribute = token.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]/);
    if (!attribute) continue;
    const [, name, value] = attribute;
    const present = Object.hasOwn(root, name);
    const matches = present && (value === undefined || root[name] === value);
    if (negated ? matches : !matches) return false;
  }
  return true;
}

function hasCombinator(selector) {
  return /[\s>+~]/.test(selector.replace(/\([^)]*\)/g, '').replace(/"[^"]*"/g, ''));
}

// ---------------------------------------------------------------------------
// Custom property resolution

export function resolveThemeVariables(rules, { theme, preset }) {
  const root = { theme, preset };
  const variables = new Map();
  for (const rule of rules) {
    if (rule.media) continue;
    const parts = splitTopLevel(rule.selector, ',');
    if (!parts.some((part) => !hasCombinator(part) && compoundMatchesRoot(part, root))) continue;
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith('--')) variables.set(declaration.property, declaration.value);
    }
  }
  const resolved = new Map();
  const resolving = new Set();
  const resolveName = (name) => {
    if (resolved.has(name)) return resolved.get(name);
    if (!variables.has(name) || resolving.has(name)) return null;
    resolving.add(name);
    const value = substituteVariables(variables.get(name), resolveName);
    resolving.delete(name);
    resolved.set(name, value);
    return value;
  };
  for (const name of variables.keys()) resolveName(name);
  const output = new Map();
  for (const [name, value] of resolved) if (value !== null) output.set(name, compileColorMix(value));
  return output;
}

function findCall(text, name, from = 0) {
  const start = text.indexOf(`${name}(`, from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + name.length; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1, inner: text.slice(start + name.length + 1, i) };
    }
  }
  return null;
}

// Recursive var() substitution with fallbacks. Returns null when a variable
// has neither a value nor a fallback, which mirrors a browser dropping the
// declaration as invalid at computed-value time.
export function substituteVariables(value, lookup) {
  let text = value;
  for (let guard = 0; guard < 64; guard += 1) {
    const call = findCall(text, 'var');
    if (!call) return text;
    const [name, ...fallbackParts] = splitTopLevel(call.inner, ',');
    const fallback = fallbackParts.length ? fallbackParts.join(',') : null;
    let replacement = lookup(name.trim());
    if (replacement === null || replacement === undefined) {
      if (fallback === null) return null;
      replacement = substituteVariables(fallback, lookup);
      if (replacement === null) return null;
    }
    text = text.slice(0, call.start) + replacement + text.slice(call.end);
  }
  return text;
}

const NAMED_COLORS = {
  transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], currentcolor: null,
};

export function parseColor(input) {
  const text = input.trim().toLowerCase();
  if (Object.hasOwn(NAMED_COLORS, text)) return NAMED_COLORS[text];
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
    if (![6, 8].includes(expand.length)) return null;
    const channels = [0, 2, 4].map((i) => parseInt(expand.slice(i, i + 2), 16));
    const alpha = expand.length === 8 ? parseInt(expand.slice(6, 8), 16) / 255 : 1;
    return [...channels, alpha];
  }
  const fn = text.match(/^rgba?\((.*)\)$/);
  if (fn) {
    const parts = fn[1].includes(',') ? fn[1].split(',') : fn[1].replace('/', ' ').split(/\s+/);
    const numbers = parts.map((part) => part.trim()).filter(Boolean);
    if (numbers.length < 3) return null;
    const channel = (part) => part.endsWith('%') ? parseFloat(part) * 2.55 : parseFloat(part);
    const alphaPart = numbers[3];
    const alpha = alphaPart === undefined ? 1 : alphaPart.endsWith('%') ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart);
    const rgb = numbers.slice(0, 3).map(channel);
    if (rgb.some((n) => !Number.isFinite(n)) || !Number.isFinite(alpha)) return null;
    return [...rgb, alpha];
  }
  return null;
}

function formatColor([r, g, b, a]) {
  const round = (n) => Math.max(0, Math.min(255, Math.round(n)));
  if (a >= 0.9995) return `#${[r, g, b].map((n) => round(n).toString(16).padStart(2, '0')).join('')}`;
  const alpha = Math.round(a * 1000) / 1000;
  return `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${alpha})`;
}

function mixColors(first, second, weightFirst) {
  const w1 = weightFirst;
  const w2 = 1 - weightFirst;
  const alpha = first[3] * w1 + second[3] * w2;
  if (alpha === 0) return [0, 0, 0, 0];
  const channel = (i) => (first[i] * first[3] * w1 + second[i] * second[3] * w2) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

// Compile-time color-mix(in srgb, A p%, B q%) with premultiplied alpha.
// Anything outside sRGB or with unparsable operands is left untouched so a
// browser can still interpret it.
export function compileColorMix(value) {
  let text = value;
  for (let guard = 0; guard < 32; guard += 1) {
    const call = findCall(text, 'color-mix');
    if (!call) return text;
    const inner = compileColorMix(call.inner);
    const compiled = compileSingleMix(inner);
    if (compiled === null) return text.slice(0, call.start) + `color-mix(${inner})` + text.slice(call.end);
    text = text.slice(0, call.start) + compiled + text.slice(call.end);
  }
  return text;
}

function compileSingleMix(inner) {
  const args = splitTopLevel(inner, ',');
  if (args.length !== 3 || !/^in\s+srgb$/i.test(args[0].trim())) return null;
  const operands = args.slice(1).map((arg) => {
    const match = arg.trim().match(/^(.*?)(?:\s+([\d.]+)%)?$/);
    if (!match) return null;
    const color = parseColor(match[1]);
    if (!color) return null;
    return { color, percent: match[2] === undefined ? null : parseFloat(match[2]) };
  });
  if (operands.some((operand) => operand === null)) return null;
  let [p1, p2] = [operands[0].percent, operands[1].percent];
  if (p1 === null && p2 === null) { p1 = 50; p2 = 50; }
  else if (p1 === null) p1 = 100 - p2;
  else if (p2 === null) p2 = 100 - p1;
  const total = p1 + p2;
  if (total <= 0) return null;
  const mixed = mixColors(operands[0].color, operands[1].color, p1 / total);
  if (total < 100) mixed[3] *= total / 100;
  return formatColor(mixed);
}

// ---------------------------------------------------------------------------
// Rule collection for a standalone SVG

function rescopeSelectorPart(part, root) {
  if (INTERACTIVE_PSEUDO_RE.test(part)) return null;
  const canvasIndex = part.indexOf(CANVAS_SCOPE);
  if (canvasIndex !== -1) {
    const prefix = part.slice(0, canvasIndex).trim();
    if (prefix && !compoundMatchesRoot(prefix, root)) return null;
    return `svg[data-preset="${root.preset}"][data-theme="${root.theme}"]${part.slice(canvasIndex + CANVAS_SCOPE.length)}`;
  }
  if (!SVG_RULE_RE.test(part)) return null;
  if (part.startsWith('svg')) {
    const compoundEnd = part.search(/[\s>+~]/);
    const compound = compoundEnd === -1 ? part : part.slice(0, compoundEnd);
    if (!/^svg(\[data-(theme|preset)="[^"]*"\])*$/.test(compound)) return part;
    if (!compoundMatchesRoot(compound, root)) return null;
  }
  return part;
}

export function collectSvgRules(rules, { theme, preset, variables }) {
  const root = { theme, preset };
  const output = [];
  for (const rule of rules) {
    if (rule.media) continue;
    const parts = splitTopLevel(rule.selector, ',').map((part) => rescopeSelectorPart(part, root)).filter(Boolean);
    if (!parts.length) continue;
    const bareRootSvg = parts.every((part) => part === 'svg');
    const local = new Map(rule.declarations.filter((d) => d.property.startsWith('--')).map((d) => [d.property, d.value]));
    const lookup = (name) => (local.has(name) ? substituteVariables(local.get(name), lookup) : (variables.get(name) ?? null));
    const declarations = [];
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith('--')) continue;
      if (DROPPED_PROPERTY_RE.test(declaration.property)) continue;
      if (bareRootSvg && ROOT_SVG_LAYOUT_PROPERTIES.has(declaration.property)) continue;
      const value = substituteVariables(declaration.value, lookup);
      if (value === null) continue;
      declarations.push(`${declaration.property}: ${compileColorMix(value)}${declaration.important ? ' !important' : ''}`);
    }
    if (!declarations.length) continue;
    output.push(`${[...new Set(parts)].join(', ')} { ${declarations.join('; ')}; }`);
  }
  return output;
}

// ---------------------------------------------------------------------------
// SVG surgery

export function extractCanonicalSvg(html) {
  const container = html.indexOf('class="diagram-container"');
  const start = html.indexOf('<svg', container === -1 ? 0 : container);
  if (start === -1) throw new Error('svg-bake: rendered HTML has no canonical <svg>');
  let depth = 0;
  const tag = /<svg\b|<\/svg>/g;
  tag.lastIndex = start;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (match[0] === '<svg') depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return html.slice(start, match.index + match[0].length);
    }
  }
  throw new Error('svg-bake: canonical <svg> is not closed');
}

function splitRootTag(svg) {
  const end = svg.indexOf('>');
  const openTag = svg.slice(0, end + 1);
  const attributes = new Map();
  for (const match of openTag.slice(4, -1).matchAll(/([^\s=]+)="([^"]*)"/g)) attributes.set(match[1], match[2]);
  return { attributes, body: svg.slice(end + 1, svg.length - '</svg>'.length) };
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text) {
  return escapeXml(text).replace(/"/g, '&quot;');
}

function parseViewBox(value) {
  const numbers = (value || '').trim().split(/[\s,]+/).map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n)) || numbers[2] <= 0 || numbers[3] <= 0) {
    throw new Error(`svg-bake: canonical SVG needs a finite viewBox, got ${JSON.stringify(value)}`);
  }
  return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] };
}

function leadingAccessibleText(body) {
  const match = body.match(/^\s*(?:<title\b[^>]*>[\s\S]*?<\/title>\s*)?(?:<desc\b[^>]*>[\s\S]*?<\/desc>\s*)?/);
  return match ? match[0].length : 0;
}

const FLOW_PULSE_TYPES = new Set(['sequence', 'dataflow']);

function edgePathData(body) {
  const edges = [];
  const edgeTag = /<(path|g)\b([^>]*)\bdata-edge-from="[^"]*"([^>]*)>/g;
  for (let match = edgeTag.exec(body); match; match = edgeTag.exec(body)) {
    const attributes = match[2] + match[3];
    if (/data-change="removed"/.test(attributes)) continue;
    let d = null;
    if (match[1] === 'path') d = (attributes.match(/\bd="([^"]*)"/) || [])[1] || null;
    else {
      const groupEnd = body.indexOf('</g>', match.index);
      const inner = body.slice(match.index, groupEnd === -1 ? body.length : groupEnd);
      d = (inner.match(/<path\b[^>]*\bd="([^"]*)"/) || [])[1] || null;
    }
    if (!d) continue;
    const change = (attributes.match(/data-change="([a-z]+)"/) || [])[1] || null;
    edges.push({ d, change });
  }
  return edges;
}

// Finite, locally scoped SMIL pulse along each live edge. The first frame is
// the static diagram (opacity 0), the loop count is bounded, and the last
// state freezes back to invisible; the root viewBox and text never change.
export function flowPulseMarkup(body, variables) {
  const edges = edgePathData(body);
  if (!edges.length) return '';
  const stroke = (change) => variables.get(change === 'added' ? '--backend-stroke' : change === 'modified' ? '--cloud-stroke' : '--arrow-emphasis') || '#34d399';
  const paths = edges.map((edge, index) => {
    const begin = (index * 0.18).toFixed(2);
    return `<path d="${escapeAttribute(edge.d)}" fill="none" stroke="${escapeAttribute(stroke(edge.change))}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="4 16" opacity="0">`
      + `<animate attributeName="stroke-dashoffset" from="40" to="0" dur="1.2s" begin="${begin}s" repeatCount="3"/>`
      + `<animate attributeName="opacity" values="0;0.85;0.85;0" keyTimes="0;0.08;0.92;1" dur="3.6s" begin="${begin}s" repeatCount="1" fill="freeze"/>`
      + '</path>';
  });
  return `<g data-archify-flow-pulse="finite" aria-hidden="true" pointer-events="none">${paths.join('')}</g>`;
}

// ---------------------------------------------------------------------------
// Renderer-embedded <style> blocks and presentation attributes

function scopedSelector(scope, selector) {
  const parts = splitTopLevel(selector, ',').map((part) => part.trim()).filter(Boolean);
  const target = parts.length === 1 ? parts[0] : `:is(${parts.join(', ')})`;
  return `${scope}:is(${target}), ${scope} :is(${target})`;
}

// A renderer stylesheet may set custom properties on a scope (for example an
// ERD hue class) and read them from descendant rules. Static output has no
// cascade, so each such rule is re-emitted once per scope that defines the
// missing variables; unresolved declarations are dropped like a browser does.
export function bakeEmbeddedStylesheet(cssText, variables) {
  const rules = parseStylesheet(cssText).filter((rule) => !rule.media);
  const globalLookup = (name) => variables.get(name) ?? null;
  const scopes = [];
  for (const rule of rules) {
    const custom = rule.declarations.filter((d) => d.property.startsWith('--'));
    if (!custom.length) continue;
    const values = new Map();
    for (const declaration of custom) {
      const value = substituteVariables(declaration.value, globalLookup);
      if (value !== null) values.set(declaration.property, compileColorMix(value));
    }
    for (const part of splitTopLevel(rule.selector, ',')) scopes.push({ selector: part.trim(), values });
  }
  const output = [];
  const emit = (selector, declarations) => {
    if (declarations.length) output.push(`${selector} { ${declarations.join('; ')}; }`);
  };
  for (const rule of rules) {
    const local = new Map(rule.declarations.filter((d) => d.property.startsWith('--')).map((d) => [d.property, d.value]));
    const resolveWith = (extra) => (name) => (local.has(name)
      ? substituteVariables(local.get(name), resolveWith(extra))
      : (extra?.get(name) ?? variables.get(name) ?? null));
    const base = [];
    const pending = [];
    for (const declaration of rule.declarations) {
      if (declaration.property.startsWith('--')) continue;
      const value = substituteVariables(declaration.value, resolveWith(null));
      if (value === null) pending.push(declaration);
      else base.push(`${declaration.property}: ${compileColorMix(value)}${declaration.important ? ' !important' : ''}`);
    }
    emit(rule.selector, base);
    if (!pending.length) continue;
    for (const scope of scopes) {
      const resolved = [];
      for (const declaration of pending) {
        const value = substituteVariables(declaration.value, resolveWith(scope.values));
        if (value !== null) resolved.push(`${declaration.property}: ${compileColorMix(value)}${declaration.important ? ' !important' : ''}`);
      }
      emit(scopedSelector(scope.selector, rule.selector), resolved);
    }
  }
  return output.join('\n');
}

const PRESENTATION_VAR_RE = /\b(fill|stroke|stop-color|flood-color|color)="(var\([^"]*\))"/g;
const INLINE_STYLE_RE = /\bstyle="([^"]*(?:var\(|color-mix\()[^"]*)"/g;

function bakeInlineStyle(style, lookup) {
  const declarations = [];
  for (const entry of splitTopLevel(style, ';')) {
    const colon = entry.indexOf(':');
    if (colon === -1) continue;
    const property = entry.slice(0, colon).trim();
    const value = substituteVariables(entry.slice(colon + 1).trim(), lookup);
    if (value === null) continue;
    declarations.push(`${property}: ${compileColorMix(value)}`);
  }
  return declarations.join('; ');
}

function bakeBodyStyles(body, variables) {
  const lookup = (name) => variables.get(name) ?? null;
  return body
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/g, (match, attrs, css) => {
      const baked = bakeEmbeddedStylesheet(css, variables);
      if (/[<&]/.test(baked)) throw new Error('svg-bake: embedded stylesheet contains markup characters');
      return baked ? `<style${attrs}>${baked}</style>` : '';
    })
    .replace(PRESENTATION_VAR_RE, (match, attribute, value) => {
      const resolved = substituteVariables(value, lookup);
      return resolved === null ? match : `${attribute}="${escapeAttribute(compileColorMix(resolved))}"`;
    })
    .replace(INLINE_STYLE_RE, (match, style) => {
      const baked = bakeInlineStyle(style, lookup);
      return baked ? `style="${escapeAttribute(baked)}"` : '';
    });
}

export function bakeSvg(svg, { theme, preset = 'classic', diagramType = null, animateFlow = false, styles = loadViewerStyles() }) {
  if (!BAKE_THEMES.includes(theme)) throw new Error(`svg-bake: unsupported theme ${JSON.stringify(theme)}`);
  const { attributes, body: rawBody } = splitRootTag(svg);
  const resolvedPreset = preset || attributes.get('data-preset') || 'classic';
  const variables = resolveThemeVariables(styles.rules, { theme, preset: resolvedPreset });
  const body = bakeBodyStyles(rawBody, variables);
  const viewBox = parseViewBox(attributes.get('viewBox'));
  attributes.set('xmlns', 'http://www.w3.org/2000/svg');
  attributes.set('width', String(viewBox.width));
  attributes.set('height', String(viewBox.height));
  attributes.set('data-theme', theme);
  attributes.set('data-preset', resolvedPreset);
  attributes.set('data-archify-bake', 'static');
  attributes.delete('data-animation');
  const variableBlock = [...variables].map(([name, value]) => `${name}: ${value};`).join(' ');
  const css = [
    styles.fontCss,
    `svg { font-family: ${FONT_FALLBACK}; }`,
    ...collectSvgRules(styles.rules, { theme, preset: resolvedPreset, variables }),
    `svg[data-theme="${theme}"] { ${variableBlock} }`,
  ].join('\n');
  const background = `<rect class="archify-bake-background" x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${escapeAttribute(variables.get('--bg') || '#ffffff')}"/>`;
  const pulse = animateFlow && FLOW_PULSE_TYPES.has(diagramType) ? flowPulseMarkup(body, variables) : '';
  if (pulse) attributes.set('data-archify-bake', 'animate-flow');
  const metadata = `<metadata id="archify-software-notices">${escapeXml(softwareNotices)}</metadata>`;
  const split = leadingAccessibleText(body);
  const openTag = `<svg ${[...attributes].map(([name, value]) => `${name}="${escapeAttribute(value)}"`).join(' ')}>`;
  if (css.includes(']]>')) throw new Error('svg-bake: stylesheet cannot contain a CDATA terminator');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${openTag}${body.slice(0, split)}<style><![CDATA[\n${css}\n]]></style>${background}${body.slice(split)}${pulse}${metadata}</svg>\n`;
}

// ---------------------------------------------------------------------------
// Camo / GitHub <img> safety

const CAMO_CHECKS = [
  { code: 'svg/script', pattern: /<script\b/i, message: 'contains a <script> element', fix: 'remove script elements; GitHub strips scripted SVGs' },
  { code: 'svg/javascript-url', pattern: /javascript\s*:/i, message: 'contains a javascript: URL', fix: 'replace the URL with a data: or fragment reference' },
  { code: 'svg/event-handler', pattern: /\son[a-z]+\s*=/i, message: 'contains an inline on* event handler attribute', fix: 'remove on* attributes' },
  { code: 'svg/foreign-object', pattern: /<foreignObject\b/i, message: 'contains <foreignObject>, which Camo renders blank', fix: 'draw the content with native SVG elements' },
  { code: 'svg/css-import', pattern: /@import\b/i, message: 'contains a CSS @import', fix: 'inline the stylesheet' },
];

function externalReference(svgString) {
  const hrefs = [...svgString.matchAll(/\s(?:xlink:)?href\s*=\s*"([^"]*)"/gi)].map((match) => match[1].trim());
  const external = hrefs.find((href) => !(href === '' || href.startsWith('#') || href.startsWith('data:')));
  if (external) return { code: 'svg/external-href', message: `references an external resource ${JSON.stringify(external.slice(0, 80))}`, fix: 'embed the asset as a data: URL or drop the reference' };
  const urls = [...svgString.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)].map((match) => match[2].trim());
  const externalUrl = urls.find((url) => !(url.startsWith('#') || url.startsWith('data:')));
  if (externalUrl) return { code: 'svg/external-css-url', message: `CSS url() points outside the file ${JSON.stringify(externalUrl.slice(0, 80))}`, fix: 'use data: or #fragment url() targets only' };
  return null;
}

// Returns { ok, bytes, problems } and throws when assert !== false.
export function assertCamoSafeSvg(svgString, { maxBytes = CAMO_MAX_BYTES, assert = true } = {}) {
  const problems = [];
  const bytes = Buffer.byteLength(svgString, 'utf8');
  if (!/^(<\?xml[^>]*\?>\s*)?<svg\b/.test(svgString.trimStart())) {
    problems.push({ code: 'svg/not-svg', message: 'does not start with an <svg> root', fix: 'export through archify export-svg' });
  }
  if (!/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svgString.slice(0, 4000))) {
    problems.push({ code: 'svg/missing-xmlns', message: 'root lacks the SVG namespace, so <img> cannot render it', fix: 'declare xmlns="http://www.w3.org/2000/svg" on the root' });
  }
  for (const check of CAMO_CHECKS) {
    if (check.pattern.test(svgString)) problems.push({ code: check.code, message: check.message, fix: check.fix });
  }
  const external = externalReference(svgString);
  if (external) problems.push(external);
  if (bytes >= maxBytes) {
    problems.push({ code: 'svg/too-large', message: `${bytes} bytes meets or exceeds the ${maxBytes}-byte Camo limit`, fix: 'reduce the diagram or split it into several exports' });
  }
  const result = { ok: problems.length === 0, bytes, maxBytes, problems };
  if (assert && !result.ok) {
    const error = new Error(`SVG is not Camo-safe: ${problems.map((problem) => `[${problem.code}] ${problem.message} Fix: ${problem.fix}.`).join(' ')}`);
    error.code = problems[0].code;
    error.camo = result;
    throw error;
  }
  return result;
}
