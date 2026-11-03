// Atlas 3D: the Atlas payload drawn as a particle tree.
//
// Everything placed here comes from window.ATLAS_DATA (buildAtlas of one run):
//   trunk      the module that the most other modules depend on, directly or
//              through others; its files make up the trunk
//   height     dependency layer: the longest chain of imports from a module
//              down to one that imports nothing in-tree
//   branch     each module's strongest dependency (most file dependencies);
//              every other dependency between modules is drawn as a thread
//   blossom    a file; each bright point is one of its functions, coloured by
//              the finding the analyzer reported for it (none, info, warning),
//              and the haze around it is its lines of code (1 speck per 4 lines)
// Nothing is measured, scored or inferred: a reader can check every number in
// the side panel against the Atlas and the Classic view of the same run.
(function () {
  const A = window.ATLAS_DATA, THREE = window.THREE;
  const stageEl = document.getElementById('stage');
  if (!A || !THREE) { stageEl.innerHTML = '<p class="fallback">The 3D view needs data.js and three.js. Run build-data.mjs, and open the page with a network connection for three.js.</p>'; return; }
  const M = A.modules, F = A.files, E = A.edges, FN = A.functions, FD = A.findings;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || `${one}s`}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAMES = { 'complexity/function': 'Complex functions', 'coupling/import-cycle': 'Import cycles', 'coupling/cycle': 'Module cycles', 'coupling/hub': 'Hub modules', 'coupling/internal-leak': 'Internal imports', 'architecture/boundary': 'Boundary violations' };

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
  const rank = [];
  const visiting = new Set();
  const depth = (m) => {
    if (rank[m] !== undefined) return rank[m];
    if (visiting.has(m)) return 0; // a module cycle: the back edge adds no layer
    visiting.add(m);
    let d = 0;
    for (const [b] of out[m]) d = Math.max(d, depth(b) + 1);
    visiting.delete(m); rank[m] = d; return d;
  };
  M.forEach((_, i) => depth(i));
  const maxRank = Math.max(...rank, 1);
  const reach = M.map((_, m) => { const seen = new Set([m]); const st = [m]; while (st.length) { const x = st.pop(); for (const [a] of inn[x]) if (!seen.has(a)) { seen.add(a); st.push(a); } } return seen.size - 1; });
  const trunk = M.map((_, i) => i).filter((i) => rank[i] === 0).sort((a, b) => reach[b] - reach[a] || locOf[b] - locOf[a])[0];
  const parent = M.map((_, m) => {
    const lower = out[m].filter(([b]) => rank[b] < rank[m]);
    if (!lower.length) return -1;
    return lower.slice().sort((p, q) => q[1] - p[1] || reach[q[0]] - reach[p[0]] || (M[p[0]].label < M[q[0]].label ? -1 : 1))[0][0];
  });
  const children = M.map(() => []); M.forEach((_, m) => { if (parent[m] !== -1) children[parent[m]].push(m); });
  const isBranch = (a, b) => parent[a] === b;
  const surface = M.map(() => new Map()); // files of a module imported from other modules -> Set(importing modules)
  E.forEach(([a, b]) => { const x = F[a][1], y = F[b][1]; if (x !== y) { const s = surface[y]; (s.get(b) || s.set(b, new Set()).get(b)).add(x); } });

  // ------------------------------------------------------------------ layout
  const rand = (seed) => { let t = (seed + 0x6d2b79f5) >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };
  const gauss = (r) => { const u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const TRUNK_H = 1.7, LAYER_H = 0.82;
  const layerY = (r) => (r === 0 ? 0 : TRUNK_H + 0.25 + (r - 1) * LAYER_H);
  const crownR = (r) => [0, 1.12, 0.86, 0.5, 0.35, 0.25][Math.min(r, 5)];
  const blobR = (m) => 0.15 + 0.0034 * Math.sqrt(locOf[m]);
  const node = M.map(() => null);
  node[trunk] = new THREE.Vector3(0, TRUNK_H, 0);
  const weight = (m) => Math.sqrt(locOf[m] + 400) + children[m].reduce((s, c) => s + weight(c), 0);
  // Children share the circle around their parent in proportion to their subtree.
  function place(m, a0, a1) {
    const kids = children[m].slice().sort((p, q) => weight(q) - weight(p) || (M[p].label < M[q].label ? -1 : 1));
    // Interleave large and small so neighbours differ in size.
    const order = []; while (kids.length) { order.push(kids.shift()); if (kids.length) order.push(kids.pop()); }
    const total = order.reduce((s, c) => s + weight(c), 0) || 1;
    let a = a0;
    order.forEach((c, k) => {
      const span = (a1 - a0) * weight(c) / total, mid = a + span / 2;
      const r = rand(c * 7919 + 13);
      const radius = crownR(rank[c]) * (0.86 + 0.28 * r());
      const y = layerY(rank[c]) + (k % 2 ? 0.22 : -0.08) + (r() - 0.5) * 0.18;
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
  const fileCenter = F.map(() => null), fileRadius = F.map(() => 0), fnPos = FN.map(() => null);
  const sevOf = (fn) => (fn[6] === -1 ? null : FD[fn[6]].severity);
  function blossom(fi, center, rf, mod, seed) {
    fileCenter[fi] = center; fileRadius[fi] = rf;
    const r = rand(seed);
    for (const i of fnsOf[fi]) {
      const fn = FN[i], sev = sevOf(fn);
      const p = new THREE.Vector3(center.x + gauss(r) * rf * 0.5, center.y + gauss(r) * rf * 0.5, center.z + gauss(r) * rf * 0.5);
      fnPos[i] = p;
      push(p, sev ? C[sev] : C.plain, sev ? 4.2 + Math.min(Math.sqrt(fn[3]), 11) * 0.95 : 2.6 + Math.sqrt(fn[3]) * 0.6, sev ? 1 : 0.6, fi, mod, i);
    }
    const n = Math.ceil(F[fi][2] / 4);
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
      blossom(fi, c, 0.06 + 0.0021 * Math.sqrt(F[fi][2]), m, fi * 31 + 7);
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
  const points = new THREE.Points(geom, material);
  scene.add(points);

  // Threads: every dependency between modules that is not a branch.
  const threadGeom = new THREE.BufferGeometry();
  const threadMat = new THREE.LineBasicMaterial({ color: 0xc9b8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
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
  const threadLines = new THREE.LineSegments(threadGeom, threadMat);
  scene.add(threadLines);
  // Selection threads: file-level imports of a selected finding or module surface.
  const selGeom = new THREE.BufferGeometry();
  const selMat = new THREE.LineBasicMaterial({ color: 0xffd1dc, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const selLines = new THREE.LineSegments(selGeom, selMat);
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
  scene.add(new THREE.LineSegments(axis, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 })));
  // Layer ticks go on whichever vertical edge of the box is at the viewer's left.
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const tickGeom = new THREE.BufferGeometry();
  const tickLines = new THREE.LineSegments(tickGeom, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  scene.add(tickLines);
  let tickCorner = -1;

  // ------------------------------------------------------------------ camera
  const cam = { theta: 0.65, phi: 1.36, dist: Math.max(boxSize.y, half * 2) * 1.92, target: new THREE.Vector3(0, boxCenter.y * 0.9, 0) };
  const home = { ...cam, target: cam.target.clone() };
  function updateCamera() {
    cam.phi = Math.min(1.62, Math.max(0.35, cam.phi));
    cam.dist = Math.min(home.dist * 2.2, Math.max(home.dist * 0.28, cam.dist));
    camera.position.set(cam.target.x + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta), cam.target.y + cam.dist * Math.cos(cam.phi), cam.target.z + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta));
    camera.lookAt(cam.target);
  }
  let W = 1, H = 1;
  function resize() {
    const r = stageEl.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    uniforms.uScale.value = H * renderer.getPixelRatio() / 95;
    dirty = true;
  }

  // ------------------------------------------------------------------ labels
  const labelLayer = document.getElementById('labels');
  const labels = M.map((m, i) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = `lbl${i === trunk ? ' core' : ''}`; el.textContent = m.label;
    el.addEventListener('click', () => select({ type: 'module', index: i }));
    labelLayer.append(el); return el;
  });
  const layerLabels = [];
  for (let r = 0; r <= maxRank; r += 1) {
    const el = document.createElement('span'); el.className = 'layer';
    el.textContent = r === 0 ? 'Layer 0 · foundations' : `Layer ${r}`;
    labelLayer.append(el); layerLabels.push([el, r]);
  }
  const v = new THREE.Vector3();
  const toScreen = (p) => { v.copy(p).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H, v.z]; };
  function placeLabels() {
    const taken = [];
    const order = M.map((_, i) => i).sort((a, b) => (state.module === b) - (state.module === a) || (b === trunk) - (a === trunk) || locOf[b] - locOf[a]);
    order.forEach((i) => {
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
    if (f && f.kind === 'module') mods.add(f.module);
    if (f && f.kind === 'modules') f.modules.forEach((x) => mods.add(x));
    const any = files.size || mods.size;
    uniforms.uDim.value = any ? 1 : 0;
    for (let i = 0; i < mark.length; i += 1) mark[i] = (files.has(aFile[i]) || mods.has(aMod[i])) ? 1 : 0;
    markAttr.needsUpdate = true;
    selGeom.setAttribute('position', curveLines(lines, 0.05)); selLines.visible = lines.length > 0;
    threadMat.opacity = any ? 0.07 : 0.22;
    const fi = state.fn !== -1 ? state.fn : f && f.kind === 'function' ? f.fn : -1;
    ring.visible = fi != null && fi !== -1 && !!fnPos[fi];
    if (ring.visible) { ringGeom.getAttribute('position').setXYZ(0, fnPos[fi].x, fnPos[fi].y, fnPos[fi].z); ringGeom.getAttribute('position').needsUpdate = true; }
    dirty = true;
  }
  function select(sel) {
    state.module = -1; state.file = -1; state.finding = -1; state.fn = -1;
    if (sel.type === 'module') state.module = state.module === sel.index ? -1 : sel.index;
    if (sel.type === 'file') state.file = sel.index;
    if (sel.type === 'finding') state.finding = sel.index;
    if (sel.type === 'function') { state.fn = sel.index; state.file = FN[sel.index][0]; if (FN[sel.index][6] !== -1) state.finding = FN[sel.index][6]; }
    document.documentElement.dataset.selection = sel.type ? `${sel.type}:${sel.index}` : '';
    applyMarks(); renderSide();
  }

  // ------------------------------------------------------------- side panel
  const side = document.getElementById('side');
  const tone = { warning: 'var(--warning)', error: 'var(--warning)', info: 'var(--info)' };
  function promptFor(fi) {
    const f = FD[fi], d = A.detail[f.id] || {};
    const lines = [`${f.title} — ${f.code} (${f.severity}, ${f.id}) in ${A.run.repository}.`, d.message || ''];
    if (f.kind === 'function' && f.fn != null) { const fn = FN[f.fn]; lines.push(`Location: ${F[fn[0]][0]}:${fn[2]} · complexity ${fn[3]} · nesting ${fn[4]} · ${fn[5]} lines.`); }
    if (f.kind === 'edges') lines.push('Imports:', ...f.edges.slice(0, 20).map(([a, b]) => `- ${F[a][0]} → ${F[b][0]}`), ...(f.edges.length > 20 ? [`- and ${f.edges.length - 20} more`] : []));
    if (d.fix) lines.push(`Suggested first step: ${d.fix}.`);
    lines.push('Keep behaviour identical. Re-run Archify code analysis afterwards and report what changed.');
    return lines.filter(Boolean).join('\n');
  }
  function selectionCard() {
    const f = FD[state.finding];
    if (f) {
      const d = A.detail[f.id] || {};
      let where = '';
      if (f.kind === 'function' && f.fn != null) { const fn = FN[f.fn]; where = `${F[fn[0]][0]}:${fn[2]} · complexity ${fn[3]} · nesting ${fn[4]} · ${plural(fn[5], 'line')}`; }
      if (f.kind === 'edges') where = `${plural(f.edges.length, 'import')} drawn as bright threads${f.module != null ? ` into ${M[f.module].label}` : ''}`;
      return `<div class="card"><div class="card-k" style="color:${tone[f.severity]}">${esc(f.severity)} · ${esc(f.code)}</div><h3>${esc(f.title)}</h3>
        <p>${esc(d.message || '')}</p><p class="mono">${esc(where)}</p>${d.fix ? `<p class="muted">First step: ${esc(d.fix)}.</p>` : ''}
        <button type="button" class="btn" id="copy">Copy fix prompt for AI</button></div>`;
    }
    if (state.file !== -1) {
      const fi = state.file, fns = fnsOf[fi].slice().sort((a, b) => FN[b][3] - FN[a][3]);
      return `<div class="card"><div class="card-k">File · ${esc(M[F[fi][1]].label)}</div><h3 class="mono">${esc(F[fi][0])}</h3>
        <p class="muted">${plural(F[fi][2], 'line')} · ${plural(fns.length, 'function')} · ${fns.filter((i) => FN[i][6] !== -1).length} reported</p>
        <div class="list">${fns.slice(0, 8).map((i) => `<button type="button" class="row${state.fn === i ? ' active' : ''}" data-fn="${i}"><i style="background:${FN[i][6] !== -1 ? tone[FD[FN[i][6]].severity] : 'var(--plain)'}"></i><span class="t">${esc(FN[i][1])}</span><span class="n">${FN[i][3]}</span></button>`).join('')}</div>
        ${fns.length > 8 ? `<p class="muted">and ${plural(fns.length - 8, 'more function')}</p>` : ''}</div>`;
    }
    if (state.module !== -1) {
      const m = state.module, s = surface[m];
      const deps = out[m].slice().sort((a, b) => b[1] - a[1]);
      return `<div class="card"><div class="card-k">${m === trunk ? 'Core · trunk' : `Layer ${rank[m]}`}</div><h3>${esc(M[m].label)}</h3>
        <p class="muted">${esc(M[m].path || '.')} · ${plural(filesOf[m].length, 'file')} · ${plural(filesOf[m].reduce((t, fi) => t + fnsOf[fi].length, 0), 'function')} · ${plural(locOf[m], 'line')}</p>
        <p>Fan-in ${M[m].fanIn} · fan-out ${M[m].fanOut} · ${plural(reach[m], 'module')} depend on it directly or through others.</p>
        <p>${deps.length ? `Depends on ${deps.map(([b, w]) => `${esc(M[b].label)} (${w}${isBranch(m, b) ? ', branch' : ''})`).join(', ')}.` : 'Imports nothing in-tree.'}</p>
        <p>${s.size ? `Other modules import ${fmt(s.size)} of its ${plural(filesOf[m].length, 'file')}; those imports are drawn as bright threads.` : 'No other module imports it.'}</p></div>`;
    }
    return '<div class="card muted">Drag to turn the model, scroll to zoom, double-click to reset. Click a blossom for its file, a label for its module, or a finding below.</div>';
  }
  const crossDeps = E.length - insideDeps;
  const branchDeps = branches.reduce((s, b) => s + b.w, 0), threadDeps = threads.reduce((s, t) => s + t.w, 0);
  const drawnFiles = new Set(aFile.filter((x) => x !== -1)).size, drawnFns = aFn.filter((x) => x !== -1).length;
  const consistent = drawnFiles === F.length && drawnFns === FN.length && branchDeps + threadDeps === crossDeps;
  function renderSide() {
    const groups = {}; FD.forEach((f, i) => (groups[f.code] = groups[f.code] || []).push(i));
    const order = M.map((_, i) => i).sort((a, b) => (M[b].fanIn + M[b].fanOut) - (M[a].fanIn + M[a].fanOut) || (M[a].label < M[b].label ? -1 : 1));
    side.innerHTML = `
      <div class="k">Selection</div>${selectionCard()}
      <div class="k">Same data as the Atlas</div>
      <div class="check ${consistent ? 'ok' : 'bad'}">${consistent ? 'Every file, function and finding of the run is in the model.' : 'The model does not account for every item of the run.'}
        <dl><dt>Files</dt><dd>${fmt(drawnFiles)} / ${fmt(F.length)}</dd><dt>Functions</dt><dd>${fmt(drawnFns)} / ${fmt(FN.length)}</dd>
        <dt>File dependencies</dt><dd>${fmt(E.length)}: ${fmt(branchDeps)} in ${plural(branches.length, 'branch', 'branches')}, ${fmt(threadDeps)} in ${plural(threads.length, 'thread')}, ${fmt(insideDeps)} inside modules (not drawn)</dd>
        <dt>Findings</dt><dd>${fmt(FD.length)} / ${fmt(A.run.summary.errors + A.run.summary.warnings + A.run.summary.info)}</dd></dl></div>
      <div class="k">Findings · ${fmt(FD.length)}</div>
      ${Object.keys(groups).sort().map((code) => {
        const list = groups[code].slice().sort((a, b) => ({ error: 0, warning: 1, info: 2 }[FD[a].severity] - { error: 0, warning: 1, info: 2 }[FD[b].severity]) || (FD[a].fn != null && FD[b].fn != null ? FN[FD[b].fn][3] - FN[FD[a].fn][3] : FD[a].title < FD[b].title ? -1 : 1));
        return `<details${list.includes(state.finding) || code !== 'complexity/function' ? ' open' : ''}><summary>${esc(NAMES[code] || code)} · ${list.length}</summary>${list.slice(0, 40).map((i) => `<button type="button" class="row${i === state.finding ? ' active' : ''}" data-finding="${i}"><i style="background:${tone[FD[i].severity]}"></i><span class="t">${esc(FD[i].title)}</span><span class="n">${FD[i].fn != null ? FN[FD[i].fn][3] : esc(FD[i].severity)}</span></button>`).join('')}${list.length > 40 ? `<p class="muted">${list.length - 40} more, smaller ones in the Atlas.</p>` : ''}</details>`;
      }).join('')}
      <div class="k">Modules by coupling · fan-in / fan-out</div>
      ${order.map((i) => `<button type="button" class="row${i === state.module ? ' active' : ''}" data-module="${i}"><i style="background:${i === trunk ? 'var(--core)' : 'var(--plain)'}"></i><span class="t">${esc(M[i].label)}${i === trunk ? ' · trunk' : ''}</span><span class="n">${M[i].fanIn} / ${M[i].fanOut}</span></button>`).join('')}`;
    side.querySelectorAll('[data-finding]').forEach((b) => b.addEventListener('click', () => select({ type: 'finding', index: Number(b.dataset.finding) })));
    side.querySelectorAll('[data-module]').forEach((b) => b.addEventListener('click', () => select({ type: 'module', index: Number(b.dataset.module) })));
    side.querySelectorAll('[data-fn]').forEach((b) => b.addEventListener('click', () => select({ type: 'function', index: Number(b.dataset.fn) })));
    const copy = document.getElementById('copy');
    if (copy) copy.addEventListener('click', async () => {
      const text = promptFor(state.finding);
      try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch { /* nothing more to try */ } ta.remove(); }
      copy.textContent = 'Copied for AI'; setTimeout(() => { copy.textContent = 'Copy fix prompt for AI'; }, 1400);
    });
  }

  // ------------------------------------------------------------ interaction
  const tip = document.getElementById('tip');
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
  let drag = null, idleSince = performance.now(), dirty = true, hover = -1;
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
    tip.innerHTML = `<b>${esc(F[fi][0])}</b>${esc(M[F[fi][1]].label)} · ${plural(F[fi][2], 'line')} · ${plural(fnsOf[fi].length, 'function')}${reported ? ` · ${reported} reported` : ''}`;
    tip.hidden = false; tip.style.transform = `translate(${Math.min(e.clientX - r.left + 14, W - 300)}px, ${e.clientY - r.top + 14}px)`;
  });
  canvas.addEventListener('pointerup', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag && !drag.moved) { const fi = pickFile(e.clientX - r.left, e.clientY - r.top); select(fi === -1 ? {} : { type: 'file', index: fi }); }
    drag = null; idleSince = performance.now();
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= e.deltaY > 0 ? 1.08 : 0.92; updateCamera(); dirty = true; idleSince = performance.now(); }, { passive: false });
  canvas.addEventListener('dblclick', () => { Object.assign(cam, { theta: home.theta, phi: home.phi, dist: home.dist }); cam.target.copy(home.target); updateCamera(); dirty = true; });
  window.addEventListener('resize', resize);
  document.getElementById('reset').addEventListener('click', () => select({}));

  // -------------------------------------------------------------------- loop
  const t0 = performance.now(), GROW_MS = 2600;
  function frame(now) {
    if (!reduced) {
      if (uniforms.uGrow.value < 1) { uniforms.uGrow.value = Math.min(1, (now - t0) / GROW_MS) * 1.18; dirty = true; }
      if (now - idleSince > 2500) { cam.theta += 0.0016; updateCamera(); dirty = true; }
    }
    if (dirty) { renderer.render(scene, camera); placeLabels(); dirty = false; document.documentElement.dataset.drawn = String(drawnFns); }
    requestAnimationFrame(frame);
  }
  window.__atlas3d = { select, state, consistent, counts: { files: drawnFiles, functions: drawnFns, branchDeps, threadDeps, insideDeps }, trunk: M[trunk].label, rank: M.map((m, i) => [m.label, rank[i]]) };
  resize(); updateCamera(); renderSide(); applyMarks();
  requestAnimationFrame(frame);
})();
