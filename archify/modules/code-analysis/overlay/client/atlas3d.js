// Atlas 3D: the Atlas payload drawn as a particle tree (from experiments/atlas-3d).
//
// Everything placed here comes from the Atlas payload (buildAtlas of the same run):
//   trunk      the module that the most other modules depend on, directly or
//              through others; its files make up the trunk
//   height     dependency layer: the longest chain of imports from a module
//              down to one that imports nothing in-tree, with each module cycle
//              collapsed first; inside a cycle, one level per branch from the
//              point where the cycle meets the tree
//   branch     grown outward from the trunk: each module joins the tree on its
//              strongest dependency (most file dependencies) on a module already
//              in it; every other dependency between modules is a thread
//   blossom    a file; each bright point is one of its functions, coloured by
//              the finding the analyzer reported for it (none, info, warning),
//              and the haze around it is its lines of code (1 speck per 4 lines)
// Nothing is measured, scored or inferred: every number in the side panel can be
// checked against the Atlas and the Classic view of the same run.
//
// The page carries three.js as inert text; mount() runs it the first time the
// view opens, so a page that never opens Atlas 3D never parses it.
(function () {
  const source = document.getElementById('bauify-atlas-data');
  if (!source) return;
  const ui = JSON.parse(document.getElementById('bauify-analysis').textContent).ui || {};
  const tr = window.__archifyMakeAnalysisTranslator(ui.messages || {});
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ZH = { file: ' 个文件', module: ' 个模块', function: ' 个函数', line: ' 行', import: ' 条导入', branch: ' 条分枝', thread: ' 条连线', 'more function': ' 个其他函数' };
  const plural = (n, one, many) => (ui.locale === 'zh-CN' ? fmt(n) + (ZH[one] || ' ' + one) : `${fmt(n)} ${n === 1 ? one : many || `${one}s`}`);
  const NAMES = { 'complexity/function': tr('Complex functions'), 'coupling/import-cycle': tr('Import cycles'), 'coupling/cycle': tr('Module cycles'), 'coupling/hub': tr('Hub modules'), 'coupling/concentration': tr('Concentration'), 'coupling/internal-leak': tr('Internal imports'), 'architecture/boundary': tr('Boundary violations'), 'redundancy/duplicate-block': tr('Duplicate code') };

  function loadThree() {
    if (window.THREE) return window.THREE;
    const text = document.getElementById('bauify-three');
    if (!text) return null;
    const script = document.createElement('script');
    script.textContent = text.textContent;
    document.head.appendChild(script);
    return window.THREE || null;
  }
  function webgl() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (_) { return false; }
  }

  let mounted = null;
  function mount(host) {
    if (mounted) return mounted;
    const A = JSON.parse(source.textContent);
    const extra = document.getElementById('bauify-atlas3d-data');
    const more = extra ? JSON.parse(extra.textContent) : {};
    A.detail = more.detail || {}; A.run = more.run || { summary: null };
    // The model fills the card; controls, the start card and the legend float on
    // it, the right rail is the layer directory, and a selection opens a panel
    // in its place. The scene itself is unchanged.
    host.innerHTML = `<div class="a3d" lang="${esc(ui.locale || 'en')}" data-fly="closed">
      <section class="a3d-main">
        <div class="a3d-stage"><div class="a3d-labels"></div><div class="a3d-tip" hidden></div></div>
        <div class="a3d-float a3d-tl"><div class="a3d-seg"><button type="button" class="a3d-home">${esc(tr('Reset view'))}</button><button type="button" class="a3d-reset" disabled>${esc(tr('Clear selection'))}</button></div></div>
        <div class="a3d-focus" hidden><span></span><button type="button" class="a3d-focus-x" aria-label="${esc(tr('Clear selection'))}">×</button></div>
        <section class="a3d-float a3d-first" aria-label="${esc(tr('Start here'))}" hidden></section>
        <div class="a3d-float a3d-legend">
          <span><i style="background:var(--a3d-plain)"></i>${esc(tr('function, nothing reported'))}</span>
          <span><i style="background:var(--a3d-info)"></i>${esc(tr('info finding'))}</span>
          <span><i style="background:var(--a3d-warning)"></i>${esc(tr('warning finding'))}</span>
          <span title="${esc(tr('point size: complexity · haze: lines of code (1 speck per 4 lines)'))}">${esc(tr('bigger point = more complex'))}</span>
          <span title="${esc(tr('height: dependency layer · branch: strongest dependency toward the trunk'))}">${esc(tr('height = dependency layer'))}</span>
          <span><i class="thread"></i>${esc(tr('thread: other dependency between modules'))}</span>
        </div>
        <p class="a3d-hint">${esc(tr('Drag to turn · scroll to zoom · double-click to reset · a click selects, the camera stays'))}</p>
      </section>
      <aside class="a3d-side" aria-live="polite"><div class="a3d-dir"></div><div class="a3d-fly"><div class="a3d-fly-head"><button type="button" class="a3d-back">← ${esc(tr('Layers'))}</button><span></span><button type="button" class="a3d-fly-x" aria-label="${esc(tr('Close'))}">×</button></div><div class="a3d-fly-body"></div></div></aside>
    </div>`;
    const stageEl = host.querySelector('.a3d-stage');
    const THREE = webgl() ? loadThree() : null;
    if (!THREE) {
      stageEl.innerHTML = `<p class="a3d-fallback">${esc(tr('Atlas 3D needs WebGL, which this browser does not provide. The Atlas shows the same data.'))}</p>`;
      mounted = { host, failed: true };
      return mounted;
    }
    mounted = build(host, stageEl, A, THREE);
    return mounted;
  }

  function build(host, stageEl, A, THREE) {
    const root = document.documentElement;
    const M = A.modules, F = A.files, E = A.edges, FN = A.functions, FD = A.findings;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------------------------------------------------------------- structure
    const filesOf = M.map(() => []); F.forEach((f, i) => filesOf[f[1]].push(i));
    const fnsOf = F.map(() => []); FN.forEach((fn, i) => fnsOf[fn[0]].push(i));
    const locOf = M.map((_, i) => filesOf[i].reduce((s, fi) => s + F[fi][2], 0));
    const pairCount = new Map();
    let insideDeps = 0;
    E.forEach(([a, b]) => {
      const x = F[a][1], y = F[b][1];
      if (x === y) { insideDeps += 1; return; }
      const k = `${x}>${y}`; pairCount.set(k, (pairCount.get(k) || 0) + 1);
    });
    const out = M.map(() => []), inn = M.map(() => []);
    for (const [k, w] of pairCount) { const [a, b] = k.split('>').map(Number); out[a].push([b, w]); inn[b].push([a, w]); }
    const reach = M.map((_, m) => { const seen = new Set([m]); const st = [m]; while (st.length) { const x = st.pop(); for (const [a] of inn[x]) if (!seen.has(a)) { seen.add(a); st.push(a); } } return seen.size - 1; });
    // Dependency layers on the graph with each module cycle collapsed to one node
    // (Tarjan): a cycle has no order inside it, so its members share a layer.
    const comp = M.map(() => -1), compSize = [];
    {
      let index = 0; const idx = M.map(() => -1), low = M.map(() => 0), onStack = M.map(() => false), stack = [];
      const strong = (v) => {
        idx[v] = low[v] = index++; stack.push(v); onStack[v] = true;
        for (const [w] of out[v]) {
          if (idx[w] === -1) { strong(w); low[v] = Math.min(low[v], low[w]); } else if (onStack[w]) low[v] = Math.min(low[v], idx[w]);
        }
        if (low[v] === idx[v]) { const c = compSize.length; let n = 0, w; do { w = stack.pop(); onStack[w] = false; comp[w] = c; n += 1; } while (w !== v); compSize.push(n); }
      };
      M.forEach((_, v) => { if (idx[v] === -1) strong(v); });
    }
    // Tarjan numbers components in reverse topological order: a component's
    // dependencies are numbered before it, so one pass in number order settles layers.
    const compLayer = compSize.map(() => 0);
    for (let c = 0; c < compSize.length; c += 1) {
      M.forEach((_, m) => { if (comp[m] !== c) return; for (const [b] of out[m]) if (comp[b] !== c) compLayer[c] = Math.max(compLayer[c], compLayer[comp[b]] + 1); });
    }
    const layer = M.map((_, m) => compLayer[comp[m]]);
    const inCycle = (m) => compSize[comp[m]] > 1;
    const cycles = compSize.some((n) => n > 1);
    // The trunk: the module the most others depend on, directly or through others.
    const trunk = M.map((_, i) => i).sort((a, b) => reach[b] - reach[a] || (M[b].fanIn ?? 0) - (M[a].fanIn ?? 0) || locOf[b] - locOf[a])[0];
    // Branches grow outward from the trunk: repeatedly, the module with the strongest
    // dependency on a module already in the tree joins it on that dependency.
    // Modules that depend on nothing in the tree start their own small trees on the ground.
    const parent = M.map(() => -1), rootOf = M.map(() => -1), order = [];
    const inTree = new Set();
    const grow = () => {
      for (;;) {
        let best = null;
        M.forEach((_, m) => {
          if (inTree.has(m)) return;
          for (const [x, w] of out[m]) {
            if (!inTree.has(x)) continue;
            if (!best || w > best.w || (w === best.w && (reach[x] > reach[best.x] || (reach[x] === reach[best.x] && M[m].label < M[best.m].label)))) best = { m, x, w };
          }
        });
        if (!best) return;
        parent[best.m] = best.x; rootOf[best.m] = rootOf[best.x]; inTree.add(best.m); order.push(best.m);
      }
    };
    inTree.add(trunk); rootOf[trunk] = trunk; order.push(trunk); grow();
    while (inTree.size < M.length) {
      const rest = M.map((_, i) => i).filter((i) => !inTree.has(i));
      const roots = rest.filter((i) => !out[i].some(([b]) => rest.includes(b) && comp[b] !== comp[i]));
      const pick = (roots.length ? roots : rest).sort((a, b) => reach[b] - reach[a] || locOf[b] - locOf[a])[0];
      inTree.add(pick); rootOf[pick] = pick; order.push(pick); grow();
    }
    // Height level: the dependency layer above the tree's root; inside a module
    // cycle, where layers do not exist, one level per branch from the cycle's entry.
    const rank = M.map(() => 0);
    order.forEach((m) => {
      const p = parent[m];
      if (p === -1) { rank[m] = 0; return; }
      rank[m] = comp[m] === comp[p] ? rank[p] + 1 : Math.max(rank[p] + 1, layer[m] - layer[rootOf[m]]);
    });
    const maxRank = Math.max(...rank, 1);
    const children = M.map(() => []); order.forEach((m) => { if (parent[m] !== -1) children[parent[m]].push(m); });
    const isBranch = (a, b) => parent[a] === b;
    const surface = M.map(() => new Map()); // files of a module imported from other modules -> Set(importing modules)
    E.forEach(([a, b]) => { const x = F[a][1], y = F[b][1]; if (x !== y) { const s = surface[y]; (s.get(b) || s.set(b, new Set()).get(b)).add(x); } });

    // ------------------------------------------------------------------ layout
    const rand = (seed) => { let t = (seed + 0x6d2b79f5) >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };
    const gauss = (r) => { const u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const TRUNK_H = 1.7, LAYER_H = 0.8;
    const layerY = (r) => (r === 0 ? 0 : TRUNK_H + 0.25 + (r - 1) * LAYER_H);
    const crownR = (r) => [0, 1.2, 1.6, 1.55, 1.25, 0.9][Math.min(r, 5)];
    const blobR = (m) => 0.3 + 0.0068 * Math.sqrt(locOf[m]);
    const node = M.map(() => null);
    node[trunk] = new THREE.Vector3(0, TRUNK_H, 0);
    const weight = (m) => Math.sqrt(locOf[m] + 400) + children[m].reduce((s, c) => s + weight(c), 0);
    // Children share the circle around their parent in proportion to their subtree.
    function place(m, a0, a1) {
      const kids = children[m].slice().sort((p, q) => weight(q) - weight(p) || (M[p].label < M[q].label ? -1 : 1));
      // Interleave large and small so neighbours differ in size.
      const seq = []; while (kids.length) { seq.push(kids.shift()); if (kids.length) seq.push(kids.pop()); }
      const total = seq.reduce((s, c) => s + weight(c), 0) || 1;
      let a = a0;
      seq.forEach((c, k) => {
        const span = (a1 - a0) * weight(c) / total, mid = a + span / 2;
        const r = rand(c * 7919 + 13);
        const radius = crownR(rank[c]) * (0.86 + 0.28 * r());
        const y = layerY(rank[c]) + (k % 2 ? 0.35 : -0.13) + (r() - 0.5) * 0.29;
        node[c] = new THREE.Vector3(Math.cos(mid) * radius, y, Math.sin(mid) * radius);
        place(c, a, a + span);
        a += span;
      });
    }
    place(trunk, 0, Math.PI * 2);
    // Foundations other than the trunk (and anything growing from them) sit on the ground around it.
    const grounded = M.map((_, i) => i).filter((i) => !node[i] && parent[i] === -1).sort((a, b) => reach[b] - reach[a] || locOf[b] - locOf[a]);
    grounded.forEach((g, k) => {
      const a = Math.PI * 0.25 + (k / Math.max(1, grounded.length)) * Math.PI * 2;
      node[g] = new THREE.Vector3(Math.cos(a) * 1.4, 0.2, Math.sin(a) * 1.4);
      place(g, a - 0.5, a + 0.5);
    });

    // --------------------------------------------------------------- particles
    const pos = [], col = [], size = [], alpha = [], delay = [], aFile = [], aMod = [], aFn = [];
    const C = {
      bark: new THREE.Color('#f2e2e6'), branch: new THREE.Color('#e9cdd6'),
      plain: new THREE.Color('#f7e6ea'), info: new THREE.Color('#ff8fb1'), warning: new THREE.Color('#ff3b6b'), error: new THREE.Color('#ff1f4b'),
      haze: new THREE.Color('#f1c9d4'), ground: new THREE.Color('#b9a3ad'),
    };
    const yTop = layerY(maxRank) + 0.6;
    function push(p, c, s, al, file, mod, fn) {
      pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); size.push(s); alpha.push(al);
      delay.push(Math.min(1, Math.max(0, (p.y + 0.3) / (yTop + 0.3))) * 0.85);
      aFile.push(file); aMod.push(mod); aFn.push(fn);
    }
    const fileCenter = F.map(() => null), fnPos = FN.map(() => null);
    const sevOf = (fn) => (fn[6] === -1 ? null : FD[fn[6]].severity);
    function blossom(fi, center, rf, mod, seed) {
      fileCenter[fi] = center;
      const r = rand(seed);
      for (const i of fnsOf[fi]) {
        const fn = FN[i], sev = sevOf(fn);
        const p = new THREE.Vector3(center.x + gauss(r) * rf * 0.5, center.y + gauss(r) * rf * 0.5, center.z + gauss(r) * rf * 0.5);
        fnPos[i] = p;
        push(p, sev ? C[sev] : C.plain, sev ? 4.2 + Math.min(Math.sqrt(fn[3]), 11) * 0.95 : 2.6 + Math.sqrt(fn[3]) * 0.6, sev ? 1 : 0.6, fi, mod, i);
      }
      // At least one speck, so an empty file (an empty __init__.py) is still in the model.
      const n = Math.max(1, Math.ceil(F[fi][2] / 4));
      for (let k = 0; k < n; k += 1) {
        const p = new THREE.Vector3(center.x + gauss(r) * rf * 0.85, center.y + gauss(r) * rf * 0.85, center.z + gauss(r) * rf * 0.85);
        push(p, C.haze, 1.7 + r() * 1.7, 0.15 + r() * 0.11, fi, mod, -1);
      }
    }
    // Trunk: the core module's files stacked up the trunk, largest at the base.
    const trunkFiles = filesOf[trunk].slice().sort((a, b) => F[b][2] - F[a][2] || (F[a][0] < F[b][0] ? -1 : 1));
    const trunkRadius = (y) => 0.27 - 0.13 * (y / TRUNK_H);
    trunkFiles.forEach((fi, k) => {
      const y = 0.12 + (k + 0.5) / trunkFiles.length * (TRUNK_H - 0.18);
      const a = k * 2.39996, rr = trunkRadius(y) * 0.55;
      blossom(fi, new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), 0.06 + 0.0015 * Math.sqrt(F[fi][2]), trunk, fi * 31 + 7);
    });
    { // bark and root flare: structure only, no data of their own
      const r = rand(99);
      for (let k = 0; k < 5200; k += 1) {
        const y = r() * TRUNK_H, a = r() * Math.PI * 2, rr = trunkRadius(y) * (0.7 + r() * 0.35) + (y < 0.25 ? (0.25 - y) * 1.4 * r() : 0);
        push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), C.bark, 1.3 + r() * 1.1, 0.3, -1, trunk, -1);
      }
    }
    // Crowns: each module's files on a sphere around its node.
    M.forEach((_, m) => {
      if (m === trunk) return;
      const files = filesOf[m].slice().sort((a, b) => F[b][2] - F[a][2]);
      const R = blobR(m), n = files.length;
      files.forEach((fi, k) => {
        const t = n === 1 ? 0 : (k + 0.5) / n, phi = Math.acos(1 - 2 * t), th = k * 2.39996;
        const d = n === 1 ? 0 : R * 0.62 * Math.cbrt((k + 1) / n);
        const c = new THREE.Vector3(node[m].x + d * Math.sin(phi) * Math.cos(th), node[m].y + d * Math.cos(phi) * 0.8, node[m].z + d * Math.sin(phi) * Math.sin(th));
        blossom(fi, c, 0.1 + 0.0036 * Math.sqrt(F[fi][2]), m, fi * 31 + 7);
      });
    });
    // Branches: a stream of particles from the parent to each module, thicker for more file dependencies.
    const branchCurve = (m) => {
      const p = parent[m], to = node[m];
      const from = p === trunk ? new THREE.Vector3(to.x * 0.08, TRUNK_H - 0.12, to.z * 0.08) : node[p].clone();
      const out2 = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).multiplyScalar(0.45);
      return new THREE.CubicBezierCurve3(from, from.clone().add(new THREE.Vector3(out2.x * 0.3, (to.y - from.y) * 0.55 + 0.12, out2.z * 0.3)), to.clone().add(new THREE.Vector3(-out2.x * 0.35, -0.22, -out2.z * 0.35)), to);
    };
    const branches = [];
    M.forEach((_, m) => {
      if (parent[m] === -1) return;
      const w = pairCount.get(`${m}>${parent[m]}`), curve = branchCurve(m), r = rand(m * 104729);
      branches.push({ m, w, curve });
      const thick = 0.01 + 0.011 * Math.sqrt(w), n = 160 + 30 * w;
      for (let k = 0; k < n; k += 1) {
        const t = r(), p = curve.getPoint(t), taper = thick * (1 - 0.55 * t);
        push(p.add(new THREE.Vector3(gauss(r) * taper, gauss(r) * taper, gauss(r) * taper)), C.branch, 1.2 + r() * 1.1, 0.32, -1, m, -1);
      }
    });
    // Ground: a faint disc of dust so the grounded foundations read as standing on something.
    { const r = rand(7); for (let k = 0; k < 900; k += 1) { const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 1.75; push(new THREE.Vector3(Math.cos(a) * rr, -0.01 + r() * 0.02, Math.sin(a) * rr), C.ground, 1.2, 0.12, -1, -1, -1); } }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geom.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    geom.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alpha, 1));
    geom.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));
    const mark = new Float32Array(size.length).fill(1);
    const markAttr = new THREE.BufferAttribute(mark, 1); geom.setAttribute('aMark', markAttr);

    // ------------------------------------------------------------------ render
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0c0a0e, 1);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', tr('Atlas 3D: the modules as a tree. The trunk is the module the most others depend on; height is the dependency layer; every file is a blossom and every function a point in it. The side panel lists the same findings and modules.'));
    stageEl.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    const uniforms = { uGrow: { value: reduced ? 1 : 0 }, uScale: { value: 1 }, uDim: { value: 0 } };
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute float aDelay; attribute float aMark;
        uniform float uGrow; uniform float uScale; uniform float uDim;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float g = clamp((uGrow - aDelay) / 0.15, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale * g / -mv.z;
          vColor = color;
          vAlpha = aAlpha * g * mix(1.0, mix(0.07, 1.25, aMark), uDim);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor * (0.85 + 0.6 * smoothstep(0.25, 0.0, d)), a * vAlpha);
        }`,
    });
    scene.add(new THREE.Points(geom, material));

    // Threads: every dependency between modules that is not a branch.
    const threadGeom = new THREE.BufferGeometry();
    const threadMat = new THREE.LineBasicMaterial({ color: 0xc9b8ff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false });
    const threads = [];
    for (const [k, w] of pairCount) {
      const [a, b] = k.split('>').map(Number);
      if (isBranch(a, b)) continue;
      threads.push({ a, b, w });
    }
    function curveLines(list, lift) {
      const v = [];
      list.forEach(({ from, to }) => {
        const mid = from.clone().add(to).multiplyScalar(0.5); mid.y += lift + from.distanceTo(to) * 0.12;
        const c = new THREE.QuadraticBezierCurve3(from, mid, to), pts = c.getPoints(24);
        for (let i = 0; i < pts.length - 1; i += 1) v.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      });
      return new THREE.Float32BufferAttribute(v, 3);
    }
    threadGeom.setAttribute('position', curveLines(threads.map(({ a, b }) => ({ from: node[a], to: node[b] })), 0.15));
    scene.add(new THREE.LineSegments(threadGeom, threadMat));
    // Selection threads: file-level imports of a selected finding or module surface.
    const selGeom = new THREE.BufferGeometry();
    const selLines = new THREE.LineSegments(selGeom, new THREE.LineBasicMaterial({ color: 0xffd1dc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(selLines);
    // A ring on a selected function.
    const ringGeom = new THREE.BufferGeometry(); ringGeom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const ring = new THREE.Points(ringGeom, new THREE.ShaderMaterial({
      transparent: true, depthTest: false, uniforms: { uScale: uniforms.uScale },
      vertexShader: 'uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 6.0 * uScale / -mv.z; }',
      fragmentShader: 'void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.03, 0.0, abs(d - 0.42)); gl_FragColor = vec4(1.0, 0.92, 0.95, a); }',
    }));
    ring.visible = false; scene.add(ring);

    // The frame: a box around the drawing and its central axis, like a specimen case.
    const bounds = new THREE.Box3().setFromBufferAttribute(geom.getAttribute('position'));
    bounds.expandByScalar(0.18); bounds.min.y = -0.02;
    const boxSize = bounds.getSize(new THREE.Vector3()), boxCenter = bounds.getCenter(new THREE.Vector3());
    const half = Math.max(boxSize.x, boxSize.z) / 2;
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(half * 2, boxSize.y, half * 2)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42 }));
    box.position.set(0, boxCenter.y, 0); scene.add(box);
    const axis = new THREE.BufferGeometry(); axis.setAttribute('position', new THREE.Float32BufferAttribute([0, bounds.min.y, 0, 0, bounds.max.y, 0], 3));
    scene.add(new THREE.LineSegments(axis, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 })));
    // Layer ticks go on whichever vertical edge of the box is at the viewer's left.
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
    const tickGeom = new THREE.BufferGeometry();
    scene.add(new THREE.LineSegments(tickGeom, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
    let tickCorner = -1;

    // ------------------------------------------------------------------ camera
    const cam = { theta: 0.65, phi: 1.36, dist: Math.hypot(boxSize.y, half * 2 * Math.SQRT2) * 1.55, target: new THREE.Vector3(0, boxCenter.y * 0.9, 0) };
    const home = { theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone() };
    function updateCamera() {
      cam.phi = Math.min(1.62, Math.max(0.35, cam.phi));
      cam.dist = Math.min(home.dist * 2.2, Math.max(home.dist * 0.28, cam.dist));
      camera.position.set(cam.target.x + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta), cam.target.y + cam.dist * Math.cos(cam.phi), cam.target.z + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta));
      camera.lookAt(cam.target);
    }
    let W = 1, H = 1, dirty = true;
    function resize() {
      const r = stageEl.getBoundingClientRect(); if (!r.width || !r.height) return;
      W = r.width; H = r.height;
      renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
      uniforms.uScale.value = H * renderer.getPixelRatio() / 95;
      dirty = true;
    }

    // ------------------------------------------------------------------ labels
    const labelLayer = host.querySelector('.a3d-labels');
    const labels = M.map((m, i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = `a3d-lbl${i === trunk ? ' core' : ''}`; el.textContent = m.label;
      el.addEventListener('click', () => select({ type: 'module', index: i }));
      labelLayer.append(el); return el;
    });
    const layerLabels = [];
    for (let r = 0; r <= maxRank; r += 1) {
      const el = document.createElement('span'); el.className = 'a3d-layer';
      el.textContent = cycles ? (r === 0 ? tr('Level 0 · trunk and ground') : tr('Level {n}', { n: r })) : (r === 0 ? tr('Layer {n} · foundations', { n: layer[trunk] }) : tr('Layer {n}', { n: layer[trunk] + r }));
      labelLayer.append(el); layerLabels.push([el, r]);
    }
    const v = new THREE.Vector3();
    const toScreen = (p) => { v.copy(p).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z]; };
    function placeLabels() {
      const taken = [];
      const seq = M.map((_, i) => i).sort((a, b) => (state.module === b) - (state.module === a) || (b === trunk) - (a === trunk) || locOf[b] - locOf[a]);
      seq.forEach((i) => {
        const anchor = i === trunk ? new THREE.Vector3(0, TRUNK_H * 0.42, 0) : node[i].clone().add(new THREE.Vector3(0, blobR(i) + 0.06, 0));
        const [x, y, z] = toScreen(anchor), el = labels[i];
        const w = el.offsetWidth || 60, h = 18;
        const box2 = [x - w / 2, y - h, x + w / 2, y];
        const hit = taken.some((b) => !(box2[2] < b[0] || box2[0] > b[2] || box2[3] < b[1] || box2[1] > b[3]));
        const show = z < 1 && (!hit || state.module === i) && x > 0 && x < W && y > 0 && y < H;
        el.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h)}px)`;
        el.hidden = !show; if (show) taken.push(box2);
        el.classList.toggle('on', state.module === i);
      });
      let left = 0, minX = Infinity;
      corners.forEach(([cx, cz], k) => { const [x] = toScreen(new THREE.Vector3(cx, 0, cz)); if (x < minX) { minX = x; left = k; } });
      const [cx, cz] = corners[left];
      if (left !== tickCorner) {
        tickCorner = left; const t = [], inward = new THREE.Vector3(-cx, 0, -cz).normalize().multiplyScalar(0.14);
        for (let r = 0; r <= maxRank; r += 1) { const y = layerY(r) + (r === 0 ? 0.02 : 0); t.push(cx, y, cz, cx + inward.x, y, cz + inward.z); }
        tickGeom.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
      }
      layerLabels.forEach(([el, r]) => { const [x, y, z] = toScreen(new THREE.Vector3(cx, layerY(r) + (r === 0 ? 0.02 : 0), cz)); el.style.transform = `translate(${Math.round(x) - 8}px, ${Math.round(y) - 9}px) translateX(-100%)`; el.hidden = z >= 1 || x < (el.offsetWidth || 90) + 12; });
    }

    // --------------------------------------------------------------- selection
    const state = { module: -1, file: -1, finding: -1, fn: -1 };
    function applyMarks() {
      const files = new Set(), mods = new Set(), lines = [];
      const f = FD[state.finding];
      if (state.module !== -1) {
        mods.add(state.module);
        for (const [fi, from] of surface[state.module]) for (const a of from) lines.push({ from: node[a], to: fileCenter[fi] });
      }
      if (state.file !== -1) files.add(state.file);
      if (f && f.kind === 'function' && f.fn != null) files.add(FN[f.fn][0]);
      if (f && f.kind === 'edges') f.edges.forEach(([a, b]) => { files.add(a); files.add(b); lines.push({ from: fileCenter[a], to: fileCenter[b] }); });
      if (f && f.kind === 'cycle') f.path.forEach((x, i) => { files.add(x); lines.push({ from: fileCenter[x], to: fileCenter[f.path[(i + 1) % f.path.length]] }); });
      if (f && (f.kind === 'module' || f.kind === 'area')) mods.add(f.module);
      if (f && f.kind === 'modules') f.modules.forEach((x) => mods.add(x));
      if (f && f.kind === 'file' && f.files) f.files.forEach((x) => files.add(x)); else if (f && f.kind === 'file' && f.file != null) files.add(f.file);
      const any = files.size || mods.size;
      uniforms.uDim.value = any ? 1 : 0;
      for (let i = 0; i < mark.length; i += 1) mark[i] = (files.has(aFile[i]) || mods.has(aMod[i])) ? 1 : 0;
      markAttr.needsUpdate = true;
      selGeom.setAttribute('position', curveLines(lines, 0.05)); selLines.visible = lines.length > 0;
      threadMat.opacity = any ? 0.03 : 0.08;
      const fi = state.fn !== -1 ? state.fn : f && f.kind === 'function' ? f.fn : -1;
      ring.visible = fi != null && fi !== -1 && !!fnPos[fi];
      if (ring.visible) { ringGeom.getAttribute('position').setXYZ(0, fnPos[fi].x, fnPos[fi].y, fnPos[fi].z); ringGeom.getAttribute('position').needsUpdate = true; }
      dirty = true;
    }
    function select(sel) {
      const again = sel.type === 'module' && state.module === sel.index;
      state.module = -1; state.file = -1; state.finding = -1; state.fn = -1;
      if (sel.type === 'module') state.module = again ? -1 : sel.index;
      if (sel.type === 'file') state.file = sel.index;
      if (sel.type === 'finding') state.finding = sel.index;
      if (sel.type === 'function') { state.fn = sel.index; state.file = FN[sel.index][0]; if (FN[sel.index][6] !== -1) state.finding = FN[sel.index][6]; }
      if (sel.type && !again) root.setAttribute('data-bauify-atlas3d-selection', `${sel.type}:${sel.index}`); else root.removeAttribute('data-bauify-atlas3d-selection');
      applyMarks(); renderSide();
    }

    // ------------------------------------------------------------- side panel
    const side = host.querySelector('.a3d-side'), dir = side.querySelector('.a3d-dir'), flyBody = side.querySelector('.a3d-fly-body'), shell = host.querySelector('.a3d');
    const tone = { warning: 'var(--a3d-warning)', error: 'var(--a3d-warning)', info: 'var(--a3d-info)' };
    const sev = { error: 0, warning: 1, info: 2 };
    const analysis = JSON.parse(document.getElementById('bauify-analysis').textContent);
    const compOf = {}; (analysis.components || []).forEach((c) => (c.modules || []).forEach((m) => { if (!compOf[m.id]) compOf[m.id] = c; }));
    // Which modules and files a finding touches: the same projection the marks use.
    const findingsOfModule = M.map(() => []), findingsOfFile = F.map(() => []);
    FD.forEach((f, i) => {
      const files = new Set(), mods = new Set();
      if (f.kind === 'function' && f.fn != null) files.add(FN[f.fn][0]);
      if (f.kind === 'edges') f.edges.forEach(([a, b]) => { files.add(a); files.add(b); });
      if (f.kind === 'edges' && f.module != null) mods.add(f.module);
      if (f.kind === 'cycle') f.path.forEach((x) => files.add(x));
      if (f.kind === 'module' || f.kind === 'area') mods.add(f.module);
      if (f.kind === 'modules') f.modules.forEach((x) => mods.add(x));
      if (f.kind === 'file') (f.files || [f.file]).forEach((x) => { if (x != null) files.add(x); });
      files.forEach((x) => { findingsOfFile[x].push(i); mods.add(F[x][1]); });
      mods.forEach((x) => findingsOfModule[x].push(i));
    });
    const isOpen = (i) => !FD[i].accepted || FD[i].severity === 'error';
    const openOf = M.map((_, m) => findingsOfModule[m].filter(isOpen).length);
    const ranked = (list) => list.slice().sort((a, b) => (sev[FD[a].severity] - sev[FD[b].severity]) || (FD[b].fn != null ? FN[FD[b].fn][3] : 0) - (FD[a].fn != null ? FN[FD[a].fn][3] : 0) || (FD[a].title < FD[b].title ? -1 : 1));
    const layerName = (r) => (cycles ? (r === 0 ? tr('Level 0 · trunk and ground') : tr('Level {n}', { n: r })) : (r === 0 ? tr('Layer {n} · foundations', { n: layer[trunk] }) : tr('Layer {n}', { n: layer[trunk] + r })));
    const dot = (m) => (m === trunk ? 'var(--a3d-core)' : 'var(--a3d-plain)');
    const tiles = (list) => `<div class="a3d-tiles">${list.map(([v, k]) => `<div><b>${v}</b><span>${esc(k)}</span></div>`).join('')}</div>`;
    const head = (title, note) => `<h5 class="a3d-h">${esc(title)}${note ? `<small>${esc(note)}</small>` : ''}</h5>`;
    const findingRows = (list) => list.map((i) => { const f = FD[i], file = f.fn != null ? F[FN[f.fn][0]][0] : ''; return `<button type="button" class="a3d-find${i === state.finding ? ' active' : ''}" data-finding="${i}"><i style="background:${tone[f.severity] || 'var(--a3d-plain)'}"></i><b>${esc(f.title)}</b><em>${f.fn != null ? esc(tr('complexity {n}', { n: FN[f.fn][3] })) : esc(tr(f.severity))}</em>${file ? `<small>${esc(file.split('/').pop())}:${FN[f.fn][2]}</small>` : ''}</button>`; }).join('');
    function modulePanel(m) {
      const comp = compOf[M[m].id], list = ranked(findingsOfModule[m]), s = surface[m];
      const deps = out[m].slice().sort((a, b) => b[1] - a[1]), users = inn[m].slice().sort((a, b) => b[1] - a[1]);
      const files = filesOf[m].filter((fi) => findingsOfFile[fi].length).sort((a, b) => findingsOfFile[b].length - findingsOfFile[a].length || F[b][2] - F[a][2]);
      const n = { error: 0, warning: 0, info: 0 }; list.filter(isOpen).forEach((i) => { n[FD[i].severity] += 1; });
      const role = (m === trunk ? tr('Core · trunk') + ' · ' : parent[m] === -1 ? tr('On the ground') + ' · ' : '') + tr('dependency layer {n}', { n: layer[m] }) + (inCycle(m) ? ' · ' + tr('in a cycle of {n} modules', { n: compSize[comp[m]] }) : '');
      const rel = (rows, mark) => rows.map(([b, w]) => `<button type="button" class="a3d-rel" data-module="${b}"><i style="background:${dot(b)}"></i><span>${esc(M[b].label)}${mark && mark(b) ? `<u>${esc(tr('branch'))}</u>` : ''}</span><em>${esc(plural(w, 'import'))}</em></button>`).join('');
      let h = `<p class="a3d-kick"><i style="background:${dot(m)}"></i>${esc(role)}</p><h4 class="a3d-title">${esc(M[m].label)}</h4>
        <p class="a3d-sub">${esc(M[m].path || '.')} · ${comp ? esc(tr('“{name}” on the diagram', { name: comp.label })) : `<span class="a3d-off">${esc(tr('Not on the diagram'))}</span>`}</p>
        ${tiles([[fmt(filesOf[m].length), tr('files')], [fmt(locOf[m]), tr('lines')], [fmt(openOf[m]), tr('open findings')]])}
        <div class="a3d-sevbar"><i style="flex:${n.error};background:var(--a3d-warning)"></i><i style="flex:${n.warning};background:var(--a3d-warning);opacity:.75"></i><i style="flex:${n.info};background:var(--a3d-info)"></i></div>`;
      if (deps.length) h += head(tr('Depends on'), plural(deps.length, 'module')) + rel(deps, (b) => isBranch(m, b));
      if (users.length) h += head(tr('Used by'), plural(users.length, 'module')) + rel(users, (a) => isBranch(a, m));
      if (files.length) h += head(tr('Files with the most findings'), tr('{n} of {total}', { n: Math.min(files.length, 4), total: plural(filesOf[m].length, 'file') })) + files.slice(0, 4).map((fi) => `<button type="button" class="a3d-rel" data-file="${fi}"><i style="background:var(--a3d-warning)"></i><span class="a3d-mono">${esc(F[fi][0].split('/').pop())}</span><em>${esc(tr('{n} · {lines}', { n: findingsOfFile[fi].length, lines: plural(F[fi][2], 'line') }))}</em></button>`).join('');
      if (list.length) h += head(tr('Look at these first'), tr('by severity and complexity')) + findingRows(list.slice(0, 5));
      h += `<p class="a3d-note">${s.size ? esc(tr('Other modules import {n} of its {files}; those imports are drawn as bright threads.', { n: fmt(s.size), files: plural(filesOf[m].length, 'file') })) : esc(tr('No other module imports it.'))}</p>`;
      h += `<div class="a3d-acts"><button type="button" class="primary" data-go-atlas="${esc(M[m].id)}">${esc(tr('Show in the Atlas'))}</button>${comp ? `<button type="button" data-diagram="${esc(comp.id)}">${esc(tr('Show on the diagram'))}</button>` : ''}</div>`;
      return h;
    }
    function findingPanel(i) {
      const f = FD[i], d = A.detail[f.id] || {};
      let h = `<p class="a3d-kick"><span class="a3d-pill" style="--tone:${tone[f.severity] || 'var(--a3d-plain)'}">${esc(tr(f.severity))}</span>${esc(NAMES[f.code] || f.code)}</p><h4 class="a3d-title a3d-mono">${esc(f.title)}</h4>`;
      if (f.kind === 'function' && f.fn != null) { const fn = FN[f.fn]; h += `<p class="a3d-loc"><span>${esc(F[fn[0]][0])}</span><em>:${fn[2]}</em></p>${tiles([[fn[3], tr('complexity')], [fn[4], tr('nesting')], [fmt(fn[5]), tr('lines')]])}`; }
      if (f.kind === 'edges') h += `<p class="a3d-loc"><span>${esc(f.module != null ? tr('{imports} drawn as bright threads into {module}', { imports: plural(f.edges.length, 'import'), module: M[f.module].label }) : tr('{imports} drawn as bright threads', { imports: plural(f.edges.length, 'import') }))}</span></p>`;
      if (d.message) h += `<p class="a3d-msg">${esc(d.message)}</p>`;
      if (d.fix) h += head(tr('First step')) + `<p class="a3d-fix">${esc(d.fix)}</p>`;
      const owner = f.fn != null ? F[FN[f.fn][0]][1] : f.module != null ? f.module : -1;
      if (owner !== -1) h += head(tr('Module')) + `<button type="button" class="a3d-rel" data-module="${owner}"><i style="background:${dot(owner)}"></i><span>${esc(M[owner].label)}</span><em>${esc(tr('{n} open', { n: openOf[owner] }))} ›</em></button>`;
      h += `<div class="a3d-acts">${window.__archifyShowFinding ? `<button type="button" class="primary a3d-evidence" data-id="${esc(f.id)}">${esc(tr('Open evidence in the analysis panel'))}</button>` : ''}<button type="button" data-go-finding="${esc(f.id)}">${esc(tr('Show in the Atlas'))}</button></div>`;
      return h;
    }
    function filePanel(fi) {
      const fns = fnsOf[fi].slice().sort((a, b) => FN[b][3] - FN[a][3]);
      return `<p class="a3d-kick"><i style="background:${dot(F[fi][1])}"></i>${esc(tr('File · {module}', { module: M[F[fi][1]].label }))}</p><h4 class="a3d-title a3d-mono">${esc(F[fi][0])}</h4>
        ${tiles([[fmt(F[fi][2]), tr('lines')], [fmt(fns.length), tr('functions')], [fmt(fns.filter((i) => FN[i][6] !== -1).length), tr('reported')]])}
        ${fns.length ? head(tr('Most complex functions')) : ''}${fns.slice(0, 8).map((i) => `<button type="button" class="a3d-rel${state.fn === i ? ' active' : ''}" data-fn="${i}"><i style="background:${FN[i][6] !== -1 ? tone[FD[FN[i][6]].severity] : 'var(--a3d-plain)'}"></i><span class="a3d-mono">${esc(FN[i][1])}</span><em>${esc(tr('complexity {n}', { n: FN[i][3] }))}</em></button>`).join('')}
        ${fns.length > 8 ? `<p class="a3d-note">${esc(tr('and {more}', { more: plural(fns.length - 8, 'more function') }))}</p>` : ''}
        <div class="a3d-acts"><button type="button" class="primary" data-module="${F[fi][1]}">${esc(tr('Open its module'))}</button></div>`;
    }
    const bigCycles = compSize.filter((n) => n > 1);
    const cycleNote = cycles ? `<p class="a3d-muted">${esc(bigCycles.length === 1 ? tr('{n} modules form one dependency cycle, so dependency layers do not order them. Height there is the number of branches from where the cycle meets the tree; the branches and threads are still their real dependencies.', { n: bigCycles[0] }) : tr('{n} module cycles, so dependency layers do not order them. Height there is the number of branches from where a cycle meets the tree; the branches and threads are still their real dependencies.', { n: bigCycles.length }))}</p>` : '';
    const crossDeps = E.length - insideDeps;
    const branchDeps = branches.reduce((s, b) => s + b.w, 0), threadDeps = threads.reduce((s, t) => s + t.w, 0);
    const drawnFiles = new Set(aFile.filter((x) => x !== -1)).size, drawnFns = aFn.filter((x) => x !== -1).length;
    const summary = A.run.summary;
    const runFindings = summary ? summary.errors + summary.warnings + summary.info : FD.length;
    const consistent = drawnFiles === F.length && drawnFns === FN.length && branchDeps + threadDeps === crossDeps && runFindings === FD.length;
    // The rail: dependency layers from the top of the tree down, each with its modules.
    function directory() {
      const groups = {}; FD.forEach((f, i) => (groups[f.code] = groups[f.code] || []).push(i));
      const rows = [];
      for (let r = maxRank; r >= 0; r -= 1) {
        const mods = M.map((_, i) => i).filter((i) => rank[i] === r).sort((a, b) => (b === trunk) - (a === trunk) || openOf[b] - openOf[a] || (M[a].label < M[b].label ? -1 : 1));
        if (!mods.length) continue;
        rows.push(`<div class="a3d-layer-row" data-rank="${r}"><div class="t"><span>${esc(layerName(r))}</span><em>${esc(tr('{n} open', { n: mods.reduce((t, i) => t + openOf[i], 0) }))}</em></div><div class="a3d-chips">${mods.map((i) => `<button type="button" data-module="${i}" class="${i === trunk ? 'core' : ''}"><i class="${openOf[i] ? 'hot' : ''}"></i>${esc(M[i].label)}</button>`).join('')}</div></div>`);
      }
      return `<h3 class="a3d-rail-k">${esc(tr('Dependency layers'))}<small>${esc(tr('click a module to select it'))}</small></h3>${rows.join('')}
        <details class="a3d-more"><summary>${esc(tr('Findings · {n}', { n: fmt(FD.length) }))}</summary>${Object.keys(groups).sort().map((code) => {
          const list = ranked(groups[code]);
          return `<details${list.includes(state.finding) ? ' open' : ''}><summary>${esc(NAMES[code] || code)} · ${list.length}</summary>${list.slice(0, 40).map((i) => `<button type="button" class="a3d-row${i === state.finding ? ' active' : ''}" data-finding="${i}"><i style="background:${tone[FD[i].severity] || 'var(--a3d-plain)'}"></i><span class="t">${esc(FD[i].title)}</span><span class="n">${FD[i].fn != null ? FN[FD[i].fn][3] : esc(tr(FD[i].severity))}</span></button>`).join('')}${list.length > 40 ? `<p class="a3d-muted">${esc(tr('{n} more, smaller ones in the Atlas.', { n: list.length - 40 }))}</p>` : ''}</details>`;
        }).join('')}</details>
        <details class="a3d-more"><summary>${esc(tr('Same data as the Atlas'))} ${consistent ? '✓' : '!'}</summary><div class="a3d-check ${consistent ? 'ok' : 'bad'}">${esc(consistent ? tr('Every file, function and finding of the run is in the model.') : tr('The model does not account for every item of the run.'))}
          <dl><dt>${esc(tr('Files'))}</dt><dd>${fmt(drawnFiles)} / ${fmt(F.length)}</dd><dt>${esc(tr('Functions'))}</dt><dd>${fmt(drawnFns)} / ${fmt(FN.length)}</dd>
          <dt>${esc(tr('File dependencies'))}</dt><dd>${esc(tr('{total}: {branchDeps} in {branches}, {threadDeps} in {threads}, {inside} inside modules (not drawn)', { total: fmt(E.length), branchDeps: fmt(branchDeps), branches: plural(branches.length, 'branch', 'branches'), threadDeps: fmt(threadDeps), threads: plural(threads.length, 'thread'), inside: fmt(insideDeps) }))}</dd>
          <dt>${esc(tr('Findings'))}</dt><dd>${fmt(FD.length)} / ${fmt(runFindings)}</dd></dl>${cycleNote}</div></details>`;
    }
    // Start here: the busiest module, the trunk and the most complex function.
    const busiest = M.map((_, i) => i).sort((a, b) => openOf[b] - openOf[a] || locOf[b] - locOf[a])[0];
    const reportedFns = FN.map((_, i) => i).filter((i) => FN[i][6] !== -1);
    const topFn = (reportedFns.length ? reportedFns : FN.map((_, i) => i)).reduce((best, i) => (best === -1 || FN[i][3] > FN[best][3] ? i : best), -1);
    function renderFirst() {
      const card = host.querySelector('.a3d-first'), rows = [];
      if (busiest != null && openOf[busiest]) rows.push([`module:${busiest}`, 'var(--a3d-warning)', tr('{name} has the most findings', { name: M[busiest].label }), `${plural(filesOf[busiest].length, 'file')} · ${plural(locOf[busiest], 'line')}`, openOf[busiest]]);
      rows.push([`module:${trunk}`, 'var(--a3d-core)', tr('{name} is the trunk', { name: M[trunk].label }), tr('{n} modules depend on it; changes here reach furthest', { n: reach[trunk] }), reach[trunk]]);
      if (topFn !== -1) rows.push([`function:${topFn}`, 'var(--a3d-info)', tr('The most complex function'), FN[topFn][1], FN[topFn][3]]);
      card.innerHTML = `<h3>${esc(tr('Start here'))}<button type="button" class="a3d-first-x">${esc(tr('Hide'))}</button></h3><p>${esc(tr('Across {files}, the three things most worth a look', { files: plural(F.length, 'file') }))}</p>` +
        rows.map(([go, color, title, sub, n]) => `<button type="button" class="a3d-lead" data-go="${go}"><i style="background:${color}"></i><span><b>${esc(title)}</b><small${go.startsWith('function:') ? ' class="a3d-mono"' : ''}>${esc(sub)}</small></span><em>${fmt(n)}</em></button>`).join('');
      card.hidden = false;
    }
    function renderSide() {
      const mode = state.finding !== -1 ? 'finding' : state.file !== -1 ? 'file' : state.module !== -1 ? 'module' : 'closed';
      shell.setAttribute('data-fly', mode);
      host.querySelector('.a3d-reset').disabled = mode === 'closed';
      dir.innerHTML = directory();
      flyBody.innerHTML = mode === 'finding' ? findingPanel(state.finding) : mode === 'file' ? filePanel(state.file) : mode === 'module' ? modulePanel(state.module) : '';
      flyBody.scrollTop = 0;
      side.querySelector('.a3d-fly-head span').textContent = { finding: tr('Finding'), file: tr('File'), module: tr('Source module') }[mode] || '';
      const pill = host.querySelector('.a3d-focus'), m = state.module !== -1 ? state.module : state.file !== -1 ? F[state.file][1] : -1;
      let text = '';
      if (mode === 'module') text = tr('Selected {name} · {layer}', { name: M[m].label, layer: layerName(rank[m]) });
      if (mode === 'file') text = tr('File {name}', { name: F[state.file][0] });
      if (mode === 'finding') text = tr('Located {name}', { name: FD[state.finding].title });
      pill.hidden = !text; pill.querySelector('span').textContent = text;
    }
    // One click handler for the floating controls, the rail and the panel.
    const lit = (on, mods, r) => { labels.forEach((el, i) => el.classList.toggle('lit', on && mods.includes(i))); layerLabels.forEach(([el, k]) => el.classList.toggle('lit', on && k === r)); };
    host.querySelector('.a3d-main').parentElement.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !host.contains(b) || b.classList.contains('a3d-lbl')) return;
      if (b.classList.contains('a3d-first-x')) { shell.classList.add('first-hidden'); return; }
      if (b.classList.contains('a3d-reset') || b.classList.contains('a3d-focus-x') || b.classList.contains('a3d-fly-x') || b.classList.contains('a3d-back')) { select({}); return; }
      if (b.classList.contains('a3d-home')) { canvas.dispatchEvent(new MouseEvent('dblclick')); return; }
      if (b.hasAttribute('data-go')) { const [type, index] = b.dataset.go.split(':'); lit(false, []); select({ type, index: Number(index) }); return; }
      if (b.hasAttribute('data-finding')) { select({ type: 'finding', index: Number(b.dataset.finding) }); return; }
      if (b.hasAttribute('data-fn')) { select({ type: 'function', index: Number(b.dataset.fn) }); return; }
      if (b.hasAttribute('data-file')) { select({ type: 'file', index: Number(b.dataset.file) }); return; }
      if (b.hasAttribute('data-module')) { lit(false, []); select({ type: 'module', index: Number(b.dataset.module) }); return; }
      if (b.classList.contains('a3d-evidence')) { window.__archifyShowFinding(b.dataset.id); return; }
      const atlas = window.__archifyAtlas;
      if (b.hasAttribute('data-go-atlas') && atlas) { atlas.showView('atlas'); if (atlas.focusModule) atlas.focusModule(b.dataset.goAtlas); return; }
      if (b.hasAttribute('data-go-finding') && atlas) { atlas.showView('atlas'); atlas.focusFinding(b.dataset.goFinding); return; }
      if (b.hasAttribute('data-diagram')) {
        if (atlas) atlas.showView('');
        const node = document.querySelector(`.diagram-container g[data-node-id="${window.CSS && CSS.escape ? CSS.escape(b.dataset.diagram) : b.dataset.diagram}"]`);
        if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });
    // Hovering the rail or the start card lights the labels it names.
    side.addEventListener('mouseover', (e) => {
      const chip = e.target.closest('[data-module]'), row = e.target.closest('.a3d-layer-row');
      if (chip && dir.contains(chip)) lit(true, [Number(chip.dataset.module)], -1);
      else if (row) lit(true, M.map((_, i) => i).filter((i) => rank[i] === Number(row.dataset.rank)), Number(row.dataset.rank));
    });
    side.addEventListener('mouseleave', () => lit(false, []));
    host.querySelector('.a3d-first').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; const [type, index] = b.dataset.go.split(':'); const m = type === 'module' ? Number(index) : F[FN[Number(index)][0]][1]; lit(true, [m], -1); });
    host.querySelector('.a3d-first').addEventListener('mouseleave', () => lit(false, []));
    host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shell.getAttribute('data-fly') !== 'closed') { e.preventDefault(); select({}); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && host.getClientRects().length && shell.getAttribute('data-fly') !== 'closed') select({}); });
    renderFirst();

    // ------------------------------------------------------------ interaction
    const tip = host.querySelector('.a3d-tip');
    function pickFile(x, y) {
      let best = -1, bestD = 22 * 22, bestZ = 2;
      F.forEach((_, fi) => {
        if (!fileCenter[fi]) return;
        const [sx, sy, sz] = toScreen(fileCenter[fi]);
        const d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < bestD - 30 || (d < bestD + 30 && sz < bestZ)) { if (d < 22 * 22) { best = fi; bestD = d; bestZ = sz; } }
      });
      return best;
    }
    let drag = null, idleSince = performance.now(), hover = -1;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); idleSince = Infinity; });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        cam.theta += dx * 0.006; cam.phi -= dy * 0.005; drag.x = e.clientX; drag.y = e.clientY; updateCamera(); dirty = true; return;
      }
      const fi = pickFile(e.clientX - r.left, e.clientY - r.top);
      if (fi !== hover) { hover = fi; canvas.style.cursor = fi === -1 ? 'grab' : 'pointer'; }
      if (fi === -1) { tip.hidden = true; return; }
      const reported = fnsOf[fi].filter((i) => FN[i][6] !== -1).length;
      tip.innerHTML = `<b>${esc(F[fi][0])}</b>${esc(M[F[fi][1]].label)} · ${plural(F[fi][2], 'line')} · ${plural(fnsOf[fi].length, 'function')}${reported ? ` · ${esc(tr('{n} reported', { n: reported }))}` : ''}`;
      tip.hidden = false; tip.style.transform = `translate(${Math.min(e.clientX - r.left + 14, W - 300)}px, ${e.clientY - r.top + 14}px)`;
    });
    canvas.addEventListener('pointerup', (e) => {
      const r = canvas.getBoundingClientRect();
      if (drag && !drag.moved) { const fi = pickFile(e.clientX - r.left, e.clientY - r.top); select(fi === -1 ? {} : { type: 'file', index: fi }); }
      drag = null; idleSince = performance.now();
    });
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= e.deltaY > 0 ? 1.08 : 0.92; updateCamera(); dirty = true; idleSince = performance.now(); }, { passive: false });
    canvas.addEventListener('dblclick', () => { cam.theta = home.theta; cam.phi = home.phi; cam.dist = home.dist; cam.target.copy(home.target); updateCamera(); dirty = true; });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl); else window.addEventListener('resize', resize);

    // -------------------------------------------------------------------- loop
    // Hidden (collapsed, or Code Analysis off) means no frames are drawn and the
    // growth and slow turn wait; showing the view again picks up where it was.
    let grown = reduced ? 1 : 0, last = 0;
    const GROW_MS = 2600;
    const visible = () => host.isConnected && host.getClientRects().length > 0;
    function frame(now) {
      if (visible()) {
        const dt = last ? Math.min(now - last, 100) : 16;
        if (!reduced) {
          if (grown < 1) { grown = Math.min(1, grown + dt / GROW_MS); uniforms.uGrow.value = grown * 1.18; dirty = true; }
          if (now - idleSince > 2500) { cam.theta += 0.0016 * dt / 16; updateCamera(); dirty = true; }
        }
        if (dirty) { renderer.render(scene, camera); placeLabels(); dirty = false; root.setAttribute('data-bauify-atlas3d-drawn', String(drawnFns)); }
        last = now;
      } else last = 0;
      requestAnimationFrame(frame);
    }
    resize(); updateCamera(); renderSide(); applyMarks();
    requestAnimationFrame(frame);
    function saveSelection() {
      if (state.fn !== -1) { const fn = FN[state.fn]; return { type: 'function', file: F[fn[0]][0], name: fn[1], line: fn[2] }; }
      if (state.finding !== -1) return { type: 'finding', id: FD[state.finding].id };
      if (state.file !== -1) return { type: 'file', path: F[state.file][0] };
      if (state.module !== -1) { const m = M[state.module]; return { type: 'module', path: m.path, rootFile: m.path ? null : F.find(f => f[1] === state.module)?.[0] }; }
      return null;
    }
    function restoreSelection(saved) {
      if (!saved) return false;
      let indexes = [];
      if (saved.type === 'function') indexes = FN.map((fn, i) => F[fn[0]][0] === saved.file && fn[1] === saved.name && fn[2] === saved.line ? i : -1).filter(i => i !== -1);
      if (saved.type === 'finding') indexes = FD.map((f, i) => f.id === saved.id ? i : -1).filter(i => i !== -1);
      if (saved.type === 'file') indexes = F.map((f, i) => f[0] === saved.path ? i : -1).filter(i => i !== -1);
      if (saved.type === 'module') indexes = M.map((m, i) => m.path === saved.path && (m.path || F.find(f => f[1] === i)?.[0] === saved.rootFile) ? i : -1).filter(i => i !== -1);
      if (indexes.length !== 1) return true;
      select({ type: saved.type, index: indexes[0] });
      return false;
    }
    return { host, select, state, saveSelection, restoreSelection, consistent, counts: { files: drawnFiles, functions: drawnFns, branchDeps, threadDeps, insideDeps }, trunk: M[trunk].label, refresh: () => { resize(); dirty = true; } };
  }

  window.__archifyAtlas3d = { mount, get view() { return mounted; } };
})();
