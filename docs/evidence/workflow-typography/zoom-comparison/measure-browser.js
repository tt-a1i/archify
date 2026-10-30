// 在已打开的生成 HTML 页面中执行；只读取 DOM 和实际绘制几何。
// 字号比较只使用三种状态共有的副标题，不把 READ 隐藏的 tag 混入。
(async () => {
  await document.fonts.ready;
  await Archify.layoutStability.whenStable();
  const svg = document.querySelector('.diagram-container > svg');
  await new Promise((resolve, reject) => {
    const start = performance.now();
    const sample = () => {
      const matrix = new DOMMatrix(getComputedStyle(svg).transform);
      if (Math.abs(matrix.a - Number(svg.dataset.viewScale || 1)) < 0.001) {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      } else if (performance.now() - start > 3000) reject(new Error('Camera did not settle'));
      else requestAnimationFrame(sample);
    };
    sample();
  });
  const container = svg.parentElement;
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const intersect = (a, b) => {
    const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const inside = (a, b) => a.left >= b.left - 0.75 && a.top >= b.top - 0.75
    && a.right <= b.right + 0.75 && a.bottom <= b.bottom + 0.75;
  const shown = element => {
    for (let e = element; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < 0.01) return false;
    }
    return true;
  };
  let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (let e = container; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    const r = rect(e);
    if (/(hidden|clip|scroll|auto)/.test(s.overflowX)) {
      clip.left = Math.max(clip.left, r.left); clip.right = Math.min(clip.right, r.right);
    }
    if (/(hidden|clip|scroll|auto)/.test(s.overflowY)) {
      clip.top = Math.max(clip.top, r.top); clip.bottom = Math.min(clip.bottom, r.bottom);
    }
  }
  const svgRect = rect(svg);
  const style = getComputedStyle(svg);
  const inset = style.clipPath.match(/^inset\(([^)]+)\)$/);
  let cameraClip = svgRect;
  if (inset) {
    const values = inset[1].split(/\s+/).map(Number.parseFloat);
    const [t, r = t, b = t, l = r] = values;
    const sx = svgRect.width / svg.clientWidth, sy = svgRect.height / svg.clientHeight;
    cameraClip = { left: svgRect.left + l * sx, right: svgRect.right - r * sx,
      top: svgRect.top + t * sy, bottom: svgRect.bottom - b * sy };
  }
  clip = intersect(clip, cameraClip);
  const font = text => {
    const matrix = text.getScreenCTM();
    return parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b);
  };
  const nodes = [...svg.querySelectorAll('[data-node-id]')].map(node => {
    const shape = rect(node.querySelector(':scope > rect.c-mask'));
    const sublabels = [...node.querySelectorAll(':scope > text:not([data-node-label]):not([data-detail="fine"])')]
      .map(text => ({ text: text.textContent, cssPx: font(text), shown: shown(text),
        fullyInViewport: shown(text) && inside(rect(text), clip) }));
    return { id: node.dataset.nodeId, shape, fullyInViewport: inside(shape, clip),
      partlyInViewport: intersect(shape, clip).width > 0 && intersect(shape, clip).height > 0,
      sublabels,
      textOverflow: [...node.querySelectorAll(':scope > text')].filter(text => !inside(rect(text), shape)).map(text => text.textContent) };
  });
  const captions = nodes.flatMap(node => node.sublabels).filter(text => text.shown);
  const inFrame = captions.filter(text => text.fullyInViewport);
  const edgeIds = [...new Set([...svg.querySelectorAll('[data-edge-id]')].map(e => e.dataset.edgeId))];
  return {
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    theme: document.documentElement.dataset.theme,
    scale: Number(svg.dataset.viewScale || 1), detail: container.dataset.detailLevel,
    viewBox: svg.getAttribute('viewBox'), panel: rect(container), svg: svgRect, clip,
    logicalViewport: Archify.view.logicalViewport(),
    pageScroll: { x: scrollX, y: scrollY, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    nodeCount: nodes.length, fullyVisibleNodes: nodes.filter(n => n.fullyInViewport).map(n => n.id),
    partlyVisibleNodes: nodes.filter(n => n.partlyInViewport).map(n => n.id),
    sublabelMinCssPx: Math.min(...captions.map(t => t.cssPx)),
    inFrameSublabelMinCssPx: inFrame.length ? Math.min(...inFrame.map(t => t.cssPx)) : null,
    nodes, edgeIds,
    textContent: [...svg.querySelectorAll('text')].map(text => text.textContent),
    userAgent: navigator.userAgent,
  };
})()
