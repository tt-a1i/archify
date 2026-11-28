import { parse } from '../story/vendor/html-parser.mjs';
import { bakeSvg, extractCanonicalSvg, parseStylesheet, resolveThemeVariables } from '../renderers/shared/svg-bake.mjs';
import { rasterSignatureMatches } from '../renderers/shared/brand-marks.mjs';
import { failPrPack } from './errors.mjs';
import { assertReviewText } from './manifest.mjs';
import { escapeHtml } from './markdown.mjs';

const svgNamespace = 'http://www.w3.org/2000/svg';
const drawingTags = new Set(('svg g defs title desc rect circle ellipse line polyline polygon path text tspan '
  + 'marker clipPath mask pattern linearGradient radialGradient stop filter feDropShadow feGaussianBlur '
  + 'feOffset feBlend feComposite feColorMatrix feFlood feMerge feMergeNode symbol use image').split(' '));
const attributes = new Set(('id class role lang aria-label aria-labelledby aria-describedby aria-hidden '
  + 'viewBox preserveAspectRatio version x y x1 y1 x2 y2 cx cy r rx ry dx dy width height d points transform '
  + 'fill fill-opacity fill-rule opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin '
  + 'stroke-dasharray stroke-dashoffset stroke-miterlimit paint-order vector-effect color display visibility '
  + 'text-anchor alignment-baseline dominant-baseline font-family font-weight font-size font-style lengthAdjust '
  + 'textLength letter-spacing pointer-events shape-rendering marker marker-start marker-mid marker-end '
  + 'markerUnits markerWidth markerHeight orient refX refY clip-path clip-rule clipPathUnits mask maskUnits '
  + 'maskContentUnits patternUnits patternContentUnits patternTransform filter filterUnits primitiveUnits '
  + 'gradientUnits gradientTransform spreadMethod fx fy offset stop-color stop-opacity stdDeviation '
  + 'in in2 result mode type values operator flood-color flood-opacity color-interpolation-filters').split(' '));
const paintAttributes = new Set('fill stroke filter clip-path mask marker marker-start marker-mid marker-end'.split(' '));

const cssProperties = new Set(('fill fill-opacity fill-rule opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin '
  + 'stroke-dasharray stroke-dashoffset stroke-miterlimit paint-order vector-effect color display visibility '
  + 'text-anchor alignment-baseline dominant-baseline font-family font-weight font-size font-style '
  + 'letter-spacing word-spacing white-space text-decoration text-decoration-color text-decoration-line '
  + 'pointer-events shape-rendering marker marker-start marker-mid marker-end clip-path clip-rule mask filter '
  + 'stop-color stop-opacity flood-color flood-opacity color-interpolation-filters cursor rx '
  + '--cl-hue --er-hue --er-wash --tree-hue --tree-wash --card-tone').split(' '));

function isEmbeddedRaster(value) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp|vnd\.microsoft\.icon|x-icon));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const [, mime, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.toString('base64') === encoded && rasterSignatureMatches(mime, bytes);
}

function sceneFailure(message, path) {
  failPrPack('pr-lens/invalid-scene', 'render', message, { subject: { path } });
}

function elements(node) {
  return (node.childNodes || []).filter((child) => child.tagName);
}

function textContent(node) {
  return node.value ?? (node.childNodes || []).map(textContent).join('');
}

export function compileLensScene(rendered, snapshot, view, styles, index) {
  const pointer = `/views/${index}`;
  const reject = (message) => sceneFailure(message, pointer);
  const baked = bakeSvg(extractCanonicalSvg(rendered), {
    theme: 'dark', preset: view.preset, diagramType: view.type, styles, switchable: true,
  });
  const doc = parse(baked);
  const html = elements(doc).find((node) => node.tagName === 'html');
  const [head, body] = elements(html);
  const [root, ...siblings] = elements(body);
  if (elements(head).length || siblings.length || root?.tagName !== 'svg') reject('Renderer returned an invalid SVG document.');

  const ids = new Set();
  const references = new Set();
  const css = [];
  const styleClasses = new Map();
  const nodes = new Map();
  const edges = new Map();
  const lifecycleEdgeOwners = new Map();
  const columns = new Map(snapshot.entities?.map((entity) => [entity.id, entity.attributes]) || []);
  const paint = (value) => {
    if (/[\\<]|\/\*|@import\b|image-set\s*\(/i.test(value)) reject('SVG paint contains unsupported CSS.');
    const remaining = value.replace(/url\(\s*(['"]?)#([\w.:-]+)\1\s*\)/gi, (_, quote, id) => {
      references.add(id);
      return '';
    });
    if (/url\s*\(/i.test(remaining)) reject('SVG paint references an unsupported resource.');
    return value;
  };
  function declarations(entries) {
    return entries.filter(({ property }) => cssProperties.has(property)).map(({ property, value, important }) => {
      if (/[;{}@]/.test(value)) reject('SVG paint contains an unsupported declaration.');
      return `${property}: ${paint(value)}${important ? ' !important' : ''};`;
    }).join(' ');
  }

  function retainStylesheet(stylesheet) {
    for (const { selector, media, declarations: entries } of parseStylesheet(stylesheet)) {
      if (media || /[\\<@]/.test(selector)) continue;
      // Only change strikethroughs belong to Delta. Inline UML underlines
      // identify static members in every projection.
      const changeDecoration = ({ property, value }) => property === 'text-decoration'
        && value === 'line-through' && selector.includes('[data-change');
      const normal = declarations(entries.filter((entry) => !changeDecoration(entry)));
      const delta = declarations(entries.filter(changeDecoration));
      if (normal) css.push(`${selector} { ${normal} }`);
      if (delta) css.push(`svg[data-mode="delta"] :is(${selector}) { ${delta} }`);
    }
  }
  function visit(node, context = {}) {
    if (node.nodeName === '#text') {
      assertReviewText(node.value, pointer);
      return escapeHtml(node.value);
    }
    if (!node.tagName) return '';
    const tag = node.tagName;
    if (node.namespaceURI !== svgNamespace) reject('SVG contains an unsupported namespace.');
    if (['title', 'desc', 'text'].includes(tag)) assertReviewText(textContent(node), pointer);
    const src = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
    assertReviewText(src, pointer);
    for (const { name, namespace } of node.attrs) {
      if (/^on/i.test(name) || (namespace && !(
        (name === 'href' && namespace === 'http://www.w3.org/1999/xlink')
        || (['xmlns', 'xlink'].includes(name) && namespace === 'http://www.w3.org/2000/xmlns/')
      ))) reject('SVG contains an active or unsupported attribute.');
    }
    if ((tag === 'metadata' && src.id === 'archify-software-notices')
      || Object.hasOwn(src, 'data-tree-toggle') || Object.hasOwn(src, 'data-tree-expand-all')) return '';
    if (tag === 'style') {
      const stylesheet = textContent(node).replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
      retainStylesheet(stylesheet);
      return '';
    }
    if (tag === 'a') {
      if (/^\s*(?:javascript|data|vbscript):/i.test(src.href || '')) reject('SVG contains an active link.');
      return node.childNodes.map((child) => visit(child, context)).join('');
    }
    if (!drawingTags.has(tag)) reject(`SVG contains an unsupported drawing element (${tag}).`);
    const out = Object.fromEntries(Object.entries(src).filter(([key]) =>
      attributes.has(key) || /^data-(?:node-(?:id|label|ui)$|edge-|composition-|change(?:-|$)|(?:erd|waterfall|workflow|timeline|sequence|tree|class|architecture|dataflow|lifecycle)-ui$|er-|cl-|graph-role$|lens-(?:participant|lane)$|timeline-lane$|tree-(?:depth|stack)$|class-(?:kind|row|member|continuation|compartment|relationship)$|theme$|preset$|domain-band$|detail$|emphasis$)/.test(key)));
    if (out.role === 'button') delete out.role;
    if (tag === 'svg') {
      out.xmlns = svgNamespace;
      out.role = 'group';
      out['data-mode'] = 'delta';
    }
    if (src.id) {
      if (ids.has(src.id)) reject('SVG contains duplicate fragment IDs.');
      ids.add(src.id);
    }
    for (const name of ['aria-labelledby', 'aria-describedby']) {
      if (out[name]) for (const id of out[name].split(/\s+/)) references.add(id);
    }
    if (src.href !== undefined) {
      if (tag === 'use' && /^#[\w.:-]+$/.test(src.href)) references.add(src.href.slice(1));
      else if (tag !== 'image' || !isEmbeddedRaster(src.href)) {
        reject('SVG references an unsupported resource.');
      }
      out.href = src.href;
    }
    for (const name of paintAttributes) if (out[name]) paint(out[name]);
    if (src.style !== undefined) {
      if (/[{}@]/.test(src.style)) reject('SVG inline paint contains an unsupported declaration.');
      const declaration = declarations(parseStylesheet(`.inline { ${src.style} }`)[0].declarations);
      if (declaration) {
        if (!styleClasses.has(declaration)) styleClasses.set(declaration, `lens-paint-${styleClasses.size}`);
        out.class = [out.class, styleClasses.get(declaration)].filter(Boolean).join(' ');
      }
    }
    if (src.class === 'archify-bake-background') out.fill = 'var(--bg)';

    const nodeId = src['data-node-id'];
    const from = src['data-edge-from'] ?? src['data-composition-edge-from'];
    const to = src['data-edge-to'] ?? src['data-composition-edge-to'];
    const edgeId = src['data-edge-id'] ?? src['data-composition-edge-id'];
    const nativeKey = src['data-edge-key'];
    let owner;
    if (nodeId !== undefined) {
      if (!nodes.has(nodeId)) nodes.set(nodeId, { key: `n${nodes.size}`, id: nodeId, change: src['data-change'], label: src['data-node-label'] });
      owner = nodes.get(nodeId);
      context = { ...context, nodeId };
    } else if (from !== undefined && to !== undefined && !context.edge) {
      const key = JSON.stringify([from, to, nativeKey ?? edgeId ?? null]);
      if (!edges.has(key)) edges.set(key, { key: `e${edges.size}`, id: edgeId, from, to, change: src['data-change'], label: src['data-edge-label'] });
      owner = edges.get(key);
      if (view.type === 'lifecycle' && nativeKey !== undefined) lifecycleEdgeOwners.set(nativeKey, owner.key);
      context = { ...context, edge: owner };
    }
    if (owner) out['data-lens-owner'] = owner.key;
    if (src['data-lens-route-keys'] !== undefined) {
      const keys = src['data-lens-route-keys'].split(' ').map((key) => lifecycleEdgeOwners.get(key));
      if (keys.some((key) => !key)) reject('Lifecycle decoration has no matching route.');
      out['data-lens-decoration'] = keys.join(' ');
    }
    if (src['data-graph-role'] === 'automatic-crossover-underlay' && context.crossoverOwner) {
      out['data-lens-decoration'] = context.crossoverOwner;
      out['aria-hidden'] = 'true';
    }
    if (src['data-er-row'] !== undefined) context = { ...context, column: columns.get(context.nodeId)?.[Number(src['data-er-row'])] };
    if (Object.hasOwn(src, 'data-er-type-change') && context.column?.previousType) {
      out['data-lens-before'] = context.column.previousType;
      out['data-lens-after'] = context.column.type;
    }

    const children = node.childNodes || [];
    const underlay = src['data-graph-role'] === 'automatic-crossover'
      ? children.findIndex((child) => child.attrs?.some(({ name, value }) =>
        name === 'data-graph-role' && value === 'automatic-crossover-underlay'))
      : -1;
    const rendered = children.map((child, index) => index === underlay ? '' : visit(child, context));
    if (underlay !== -1) {
      const crossoverOwner = rendered.join('').match(/data-lens-owner="(e\d+)"/)?.[1];
      rendered[underlay] = visit(children[underlay], { ...context, crossoverOwner });
    }
    const attrs = Object.entries(out).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join('');
    return `<${tag}${attrs}>${rendered.join('')}</${tag}>`;
  }

  const svg = visit(root);
  for (const id of references) if (!ids.has(id)) reject('SVG fragment reference has no target in this view.');
  for (const [declaration, className] of styleClasses) css.push(`.${className}.${className} { ${declaration} }`);
  for (const theme of ['light', 'dark']) {
    const variables = resolveThemeVariables(styles.rules, { theme, preset: view.preset });
    css.push(`svg[data-theme="${theme}"] { ${[...variables].map(([name, value]) => `${name}: ${paint(value)};`).join(' ')} }`);
  }
  css.push(`
    svg { display: block; width: 100%; min-width: 640px; height: auto; margin: 0; }
    [data-lens-absent], svg[data-mode="before"] [data-change="added"],
    svg[data-mode="after"] [data-change="removed"] {
      visibility: hidden !important; pointer-events: none !important;
    }
    [data-lens-absent] *, svg[data-mode="before"] [data-change="added"] *,
    svg[data-mode="after"] [data-change="removed"] * {
      visibility: hidden !important; pointer-events: none !important;
    }
    svg:not([data-mode="delta"]) [data-change-badge],
    svg:not([data-mode="delta"]) [class*="t-change-badge-"] { visibility: hidden; }
    [data-lens-owner][role="button"] { cursor: pointer; }
    [data-lens-owner]:focus-visible { outline: 2px solid var(--lens-accent); outline-offset: 2px; }
    [data-lens-highlight="focus"] { filter: drop-shadow(0 0 2px var(--lens-accent)); opacity: 1 !important; }
    [data-lens-highlight="near"] { opacity: 1 !important; }
    svg[data-lens-inspecting] [data-lens-owner]:not([data-lens-highlight]) { opacity: .52; }
  `);
  return { svg, css: css.join('\n'), nodes: [...nodes.values()], edges: [...edges.values()] };
}
