import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';

// Independent DOM observation: source/native pass receipts are never read here.
// Unsupported geometry remains unknown rather than borrowing the source's claims.
export async function observeArtifact({ artifactPath, graph, chromePath, screenshotPath }) {
  const artifact = path.resolve(artifactPath);
  if (!fs.statSync(artifact).isFile()) throw new Error('artifact must be a regular file');
  const chrome = chromePath || findChrome();
  if (!chrome) throw new Error('Chrome is required for independent rendered observations');
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    loaded.catch(() => {});
    await send('Page.navigate', { url: pathToFileURL(artifact).href });
    await loaded;
    const expression = `(${inspect.toString()})(${JSON.stringify(graph)})`;
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'DOM inspection failed');
    const observation = result.result.value;
    if (screenshotPath) {
      const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'), { flag: 'wx' });
    }
    return { ...observation, method: 'chrome-dom-independent', browserProfile: browser.profileRoot };
  } finally {
    await browser.close();
  }
}

async function inspect(graph) {
  await document.fonts.ready;
  if (window.Archify?.layoutStability?.whenStable) await window.Archify.layoutStability.whenStable();
  const svg = document.querySelector('.diagram-container > svg') || document.querySelector('svg');
  const unknownReasons = [];
  if (!svg) return { status: 'unverified', unknownReasons: ['No independently observable SVG board'], nodes: [], edges: [], texts: [], bounds: { x: 80, y: 90, width: 1280, height: 720 } };
  const board = svg.getBoundingClientRect();
  if (!board.width || !board.height) return { status: 'unverified', unknownReasons: ['SVG has no rendered area'], nodes: [], edges: [], texts: [], bounds: { x: 80, y: 90, width: 1280, height: 720 } };
  const scale = Math.min(1280 / board.width, 720 / board.height);
  const offsetX = 80 + (1280 - board.width * scale) / 2;
  const offsetY = 90 + (720 - board.height * scale) / 2;
  const normalizeText = s => String(s || '').replace(/\s+/g, ' ').trim();
  const rect = e => {
    const r = e.getBoundingClientRect();
    return { x: offsetX + (r.x - board.x) * scale, y: offsetY + (r.y - board.y) * scale, width: r.width * scale, height: r.height * scale };
  };
  const visible = (e, route = false, strict = false) => {
    if (!e) return false;
    const r = e.getBoundingClientRect();
    if (route ? !(e.getTotalLength?.() > 0) : !(r.width > 0 && r.height > 0)) return false;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
      // Drop shadows add paint without erasing the source glyph. Other filters may erase it.
      const unsafeFilter = s.filter !== 'none' && s.filter.replace(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g, '').trim() !== '';
      if (s.clipPath !== 'none' || s.maskImage !== 'none' || unsafeFilter) {
        if (strict) unknownReasons.push(`Clipped, masked or filtered paint requires independent review: ${p.tagName}.${p.getAttribute('class') || ''}`);
        return false;
      }
    }
    return true;
  };
  const colorPainted = color => color && color !== 'none' && color !== 'transparent' && !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(color);
  const painted = element => {
    const s = getComputedStyle(element);
    return Number(s.opacity) > 0 && ((colorPainted(s.fill) && Number(s.fillOpacity) > 0) || (colorPainted(s.stroke) && Number(s.strokeOpacity) > 0 && parseFloat(s.strokeWidth) > 0));
  };
  const textVisible = (element, strict = false) => {
    if (!visible(element, false, strict) || !painted(element)) return false;
    if ([...element.querySelectorAll('tspan')].some(t => !visible(t, false, strict) || !painted(t))) return false;
    const r = element.getBoundingClientRect();
    const points = [0.25, 0.5, 0.75].map(f => ({ x: r.x + r.width * f, y: r.y + r.height / 2 }));
    const owner = element.closest('[data-node-id]');
    for (const p of points) {
      const top = document.elementsFromPoint(p.x, p.y)[0];
      if (top && top !== element && !element.contains(top) && !top.contains(element) && !(owner && owner.contains(top))) {
        if (strict) unknownReasons.push('Text may be occluded: ' + normalizeText(element.textContent));
        return false;
      }
      // elementsFromPoint ignores pointer-events:none overlays. Check later painted SVG fills too.
      for (const overlay of svg.querySelectorAll('rect,ellipse,circle,polygon,path')) {
        if (overlay.closest('defs') || !(element.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING) || !painted(overlay) || !visible(overlay, typeof overlay.getTotalLength === 'function')) continue;
        if (!colorPainted(getComputedStyle(overlay).fill) || typeof overlay.isPointInFill !== 'function') continue;
        const m = overlay.getScreenCTM();
        if (m && overlay.isPointInFill(new DOMPoint(p.x, p.y).matrixTransform(m.inverse()))) {
          if (strict) unknownReasons.push('Text covered by a later SVG fill: ' + normalizeText(element.textContent));
          return false;
        }
      }
    }
    return true;
  };
  const fontSize = e => {
    const m = e.getScreenCTM?.();
    return parseFloat(getComputedStyle(e).fontSize) * (m ? Math.hypot(m.a, m.b) : 1) * scale;
  };
  const groups = [...svg.querySelectorAll('[data-node-id]')];
  const nodes = (graph.nodes || []).map(n => {
    const matches = groups.filter(g => g.getAttribute('data-node-id') === n.id);
    const group = matches[0];
    if (!group || matches.length !== 1) {
      unknownReasons.push('Missing or ambiguous rendered node: ' + n.id);
      return { id: n.id, label: '', visible: false, rect: { x: 0, y: 0, width: 0, height: 0 }, fontSize: 0 };
    }
    const label = group.querySelector('text[data-node-label]') || group.querySelector('text');
    const shape = group.querySelector('rect:not(.c-mask),ellipse,polygon,path') || group;
    if (!label) unknownReasons.push('No visible text binding for ' + n.id);
    return { id: n.id, label: normalizeText(label?.textContent), visible: visible(group, false, true) && !!label && textVisible(label, true), rect: rect(shape), fontSize: label ? fontSize(label) : 0 };
  });
  const point = (element, p) => {
    const m = element.getScreenCTM();
    const q = new DOMPoint(p.x, p.y).matrixTransform(m);
    return { x: offsetX + (q.x - board.x) * scale, y: offsetY + (q.y - board.y) * scale };
  };
  const routes = [...svg.querySelectorAll('path[data-edge-from][data-edge-to],polyline[data-edge-from][data-edge-to],line[data-edge-from][data-edge-to]')];
  const edges = routes.map(e => {
    const from = e.getAttribute('data-edge-from');
    const to = e.getAttribute('data-edge-to');
    let points = [];
    if (typeof e.getTotalLength === 'function') {
      const length = e.getTotalLength();
      // Resolved vertices are measured on the actual path, never accepted from metadata.
      const samples = Math.min(256, Math.max(2, Math.ceil(length / 6)));
      for (let i = 0; i <= samples; i++) points.push(point(e, e.getPointAtLength(length * i / samples)));
    }
    const labelGroups = [...svg.querySelectorAll('g[data-edge-from][data-edge-to]')].filter(g =>
      g.getAttribute('data-edge-from') === from && g.getAttribute('data-edge-to') === to
      && g.getAttribute('data-edge-key') === e.getAttribute('data-edge-key'));
    const label = normalizeText(labelGroups.map(g => [...g.querySelectorAll('text')].filter(t => textVisible(t, true)).map(t => t.textContent).join(' ')).join(' '));
    const a = nodes.find(n => n.id === from), b = nodes.find(n => n.id === to);
    const near = (p, r) => p && r && Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.width), Math.max(r.y - p.y, 0, p.y - r.y - r.height)) <= 8;
    const bound = near(points[0], a?.rect) && near(points.at(-1), b?.rect);
    if (!bound) unknownReasons.push('Route endpoint binding requires review: ' + from + '->' + to);
    const style = getComputedStyle(e);
    const routePainted = colorPainted(style.stroke) && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0;
    const markerUrl = style.markerEnd.match(/^url\(["']?([^"')]+)["']?\)$/)?.[1];
    const resolvedMarker = markerUrl ? new URL(markerUrl, location.href) : null;
    const localMarker = resolvedMarker && resolvedMarker.href.split('#')[0] === location.href.split('#')[0];
    const markerId = localMarker ? decodeURIComponent(resolvedMarker.hash.slice(1)) : null;
    const marker = markerId && document.getElementById(markerId);
    const markerVisible = element => {
      for (let p = element; p && p !== svg; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) <= 0 || s.clipPath !== 'none' || s.maskImage !== 'none' || s.filter !== 'none' || p.hasAttribute('transform')) return false;
      }
      return true;
    };
    // Current adapter verifies the native right-pointing triangular polygon marker only.
    const triangles = marker ? [...marker.querySelectorAll('polygon')].filter(p => {
      const points = [...p.points].map(q => [q.x, q.y]);
      return p.parentElement === marker && JSON.stringify(points) === '[[0,0],[10,3.5],[0,7]]' && painted(p) && markerVisible(p);
    }) : [];
    const directed = style.markerStart === 'none' && marker?.tagName.toLowerCase() === 'marker' && marker.getAttribute('orient') === 'auto' && marker.markerWidth.baseVal.value > 0 && marker.markerHeight.baseVal.value > 0 && markerVisible(marker) && marker.children.length === 1 && triangles.length === 1;
    if (!directed) unknownReasons.push('Directed arrowhead cannot be verified: ' + from + '->' + to);
    return { from, to, label, visible: visible(e, true, true) && routePainted && directed && a?.visible === true && b?.visible === true && bound, points };
  });
  if ((graph.edges || []).length !== routes.length) unknownReasons.push('Rendered relation count differs from source');
  // Only diagram text, not viewer navigation, is part of the geometric workload.
  const texts = [...svg.querySelectorAll('text')].filter(t => !t.closest('defs')).map(t => ({
    text: normalizeText(t.textContent), rect: rect(t), fontSize: fontSize(t), visible: textVisible(t), nodeId: t.closest('[data-node-id]')?.getAttribute('data-node-id') || null,
    edgeFrom: t.closest('g[data-edge-from]')?.getAttribute('data-edge-from') || null,
    edgeTo: t.closest('g[data-edge-to]')?.getAttribute('data-edge-to') || null,
  }));
  return { status: unknownReasons.length ? 'unverified' : 'verified', unknownReasons: [...new Set(unknownReasons)], nodes, edges, texts, bounds: { x: 80, y: 90, width: 1280, height: 720 }, profile: 'desktop-single-page-v1', scale };
}
