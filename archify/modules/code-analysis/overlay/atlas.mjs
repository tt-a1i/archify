// Atlas: a second way to read the same analysis. The Classic view reads the
// result against the authored architecture diagram and opens source evidence;
// the Atlas draws the whole analyzed tree at file and function level so the
// shape of the problems is visible at once:
//
// - modules are arcs around a circle (a thicker arc is a reported hub);
// - files are ticks just inside the arcs, grouped by module;
// - every resolved in-tree dependency between two files is a curve, bundled
//   through its modules so dense coupling reads as thick strands;
// - every measured function is a spike outside its file whose length is its
//   cyclomatic complexity; reported functions carry a dot in their severity colour;
// - a selected finding (import cycle path, module cycle, hub, boundary imports,
//   complex function) is drawn over everything else.
//
// Nothing here is new analysis: the payload is a projection of raw facts, the
// module graph and the findings already shown in the Classic view. Unresolved
// dependency records draw no curve, so a missing curve is not proof of absent
// coupling; the side panel states the unresolved counts. Source text stays in
// the Classic view, which the Atlas links to for any finding's evidence.

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Shortest unambiguous label for each module: the fewest trailing path
// segments that no other module shares (`executor`, `cache/decorators`).
// The full path stays available for tooltips.
export function moduleLabels(paths) {
  const split = paths.map((p) => (p ? p.split('/') : []));
  return split.map((segs, i) => {
    if (!segs.length) return '.';
    for (let n = 1; n <= segs.length; n += 1) {
      const tail = segs.slice(-n).join('/');
      if (split.every((other, j) => j === i || other.slice(-n).join('/') !== tail)) return tail;
    }
    return paths[i];
  });
}

function fileModuleOf(graph) {
  if (graph.fileModules) return new Map(Object.entries(graph.fileModules));
  // Graphs written before fileModules existed: the deepest module path containing the file.
  const byDepth = [...graph.modules].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  return {
    get: (file) => (byDepth.find((m) => m.path && (file === m.path || file.startsWith(`${m.path}/`))) || {}).id,
    has() { return true; },
  };
}

function title(f, labelOf) {
  const s = f.subject || {};
  if (f.code === 'complexity/function' && s.function) return s.function + (s.function.endsWith(')') ? '' : '()');
  if (f.code === 'coupling/import-cycle' && s.files) return `Import cycle · ${s.files.length} files`;
  if (f.code === 'coupling/cycle' && s.modules) return `Module cycle · ${s.modules.length} modules`;
  if (f.code === 'coupling/hub' && s.module) return `Hub · ${labelOf(s.module)}`;
  if (f.code === 'architecture/boundary' && s.boundary) return `${s.boundary.from} → ${s.boundary.to}`;
  return f.code;
}

// The Atlas payload: compact arrays indexed by position. Returns null without
// raw facts, since files, dependencies and functions all come from them.
export function buildAtlas({ graph, facts, findings = [], review = null }) {
  if (!facts || !graph) return null;
  const fileModule = fileModuleOf(graph);
  const graphModules = [...graph.modules].sort((a, b) => compareText(a.path, b.path) || compareText(a.id, b.id));
  const analyzed = facts.files.filter((f) => !(graph.excluded?.roles || []).includes(f.role) && fileModule.get(f.path));
  const byModule = new Map();
  for (const f of analyzed) {
    const id = fileModule.get(f.path);
    (byModule.get(id) || byModule.set(id, []).get(id)).push(f);
  }
  const modules = graphModules.filter((m) => byModule.has(m.id));
  const labels = moduleLabels(modules.map((m) => m.path));
  const moduleIndex = new Map(modules.map((m, i) => [m.id, i]));
  const labelOf = (id) => (moduleIndex.has(id) ? labels[moduleIndex.get(id)] : id);

  const files = [];
  const fileIndex = new Map();
  modules.forEach((m, mi) => {
    for (const f of byModule.get(m.id).sort((a, b) => compareText(a.path, b.path))) {
      fileIndex.set(f.path, files.length);
      files.push({ path: f.path, module: mi, loc: f.loc });
    }
  });

  const pairs = new Set();
  let resolved = 0;
  for (const i of facts.imports) {
    if (!i.resolved) continue;
    resolved += 1;
    if (!fileIndex.has(i.from) || !fileIndex.has(i.to) || i.from === i.to) continue;
    pairs.add(`${fileIndex.get(i.from)}>${fileIndex.get(i.to)}`);
  }
  const edges = [...pairs].map((k) => k.split('>').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const accepted = new Set(Object.entries(review?.findings || {}).filter(([, r]) => r.status === 'accepted').map(([id]) => id));
  const listed = [];
  const functionFinding = new Map();
  for (const f of findings) {
    const s = f.subject || {};
    const entry = { id: f.id, code: f.code, severity: f.severity, title: title(f, labelOf), accepted: accepted.has(f.id) };
    if (f.code === 'complexity/function' && fileIndex.has(s.file)) {
      entry.kind = 'function';
      functionFinding.set(`${s.file}\u0000${s.function}`, listed.length);
    } else if (f.code === 'coupling/import-cycle' && Array.isArray(s.files)) {
      entry.kind = 'cycle';
      entry.files = s.files.filter((p) => fileIndex.has(p)).map((p) => fileIndex.get(p));
      const path = (f.evidence?.path || []).filter((p) => fileIndex.has(p)).map((p) => fileIndex.get(p));
      entry.path = path.length > 1 ? path : entry.files;
    } else if (f.code === 'coupling/cycle' && Array.isArray(s.modules)) {
      entry.kind = 'modules';
      entry.modules = s.modules.filter((id) => moduleIndex.has(id)).map((id) => moduleIndex.get(id));
    } else if (f.code === 'coupling/hub' && moduleIndex.has(s.module)) {
      entry.kind = 'module';
      entry.module = moduleIndex.get(s.module);
    } else if (f.code === 'architecture/boundary') {
      entry.kind = 'edges';
      entry.edges = (f.evidence?.imports || []).filter((i) => fileIndex.has(i.file) && fileIndex.has(i.to)).map((i) => [fileIndex.get(i.file), fileIndex.get(i.to)]);
    } else entry.kind = 'other';
    listed.push(entry);
  }

  // [file, name, line, complexity, nesting, length, finding index or -1]
  const functions = (facts.functions || [])
    .filter((fn) => fileIndex.has(fn.file))
    .map((fn) => [fileIndex.get(fn.file), fn.qualname || fn.name, fn.line, fn.complexity, fn.nesting ?? 0, (fn.endLine ?? fn.line) - fn.line + 1,
      functionFinding.has(`${fn.file}\u0000${fn.qualname}`) ? functionFinding.get(`${fn.file}\u0000${fn.qualname}`) : -1])
    .sort((a, b) => a[0] - b[0] || a[2] - b[2] || compareText(a[1], b[1]));
  for (const [i, fn] of functions.entries()) if (fn[6] !== -1) listed[fn[6]].fn = i;

  const unresolved = facts.unresolved || graph.unresolved || {};
  return {
    language: facts.repository?.language ?? null,
    measured: Array.isArray(facts.functions),
    modules: modules.map((m, i) => ({ id: m.id, label: labels[i], path: m.path, fanIn: m.fanIn, fanOut: m.fanOut })),
    files: files.map((f) => [f.path, f.module, f.loc]),
    edges,
    functions,
    findings: listed,
    coverage: {
      records: facts.imports.length,
      resolved,
      external: unresolved.external || 0,
      unknown: (unresolved.unknown || 0) + (unresolved.opaque || 0),
      outside: unresolved.outside || 0,
      parseErrors: (facts.parse_errors || []).length,
      excluded: graph.excluded?.files || 0,
    },
  };
}

export const ATLAS_CSS = `
html[data-bauify-view="atlas"] #bauify-reader { display: none; }
#bauify-atlas { position: fixed; left: 16px; right: 16px; top: var(--bauify-reader-top, 76px); bottom: 16px; z-index: 63; display: flex; flex-direction: column; border: 1px solid var(--panel-border, #1e293b); border-radius: 12px; background: var(--bg, #0b1220); color: var(--text, #f8fafc); font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
#bauify-atlas[hidden] { display: none; }
#bauify-atlas .atlas-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 16px; border-bottom: 1px solid var(--panel-border, #1e293b); }
#bauify-atlas .atlas-title { font: 600 13px ui-monospace, Menlo, Consolas, monospace; }
#bauify-atlas .atlas-title span { color: var(--text-muted, #94a3b8); font-weight: 400; margin-left: 8px; }
#bauify-atlas button { border: 1px solid var(--panel-border, #1e293b); border-radius: 6px; padding: 5px 10px; background: none; color: var(--text, #f8fafc); cursor: pointer; font: inherit; font-size: 12px; }
#bauify-atlas button:hover { background: color-mix(in srgb, var(--text, #f8fafc) 6%, transparent); }
#bauify-atlas button:focus-visible { outline: 2px solid var(--backend-stroke, #159f88); outline-offset: 2px; }
#bauify-atlas .atlas-body { flex: 1; min-height: 0; display: flex; }
#bauify-atlas .atlas-stage { flex: 1; min-width: 0; position: relative; }
#bauify-atlas canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
#bauify-atlas .atlas-tip { position: absolute; pointer-events: none; max-width: 340px; padding: 6px 9px; border-radius: 6px; background: var(--panel, #0f172a); border: 1px solid var(--panel-border, #1e293b); font: 11px/1.45 ui-monospace, Menlo, Consolas, monospace; box-shadow: 0 8px 24px rgba(0,0,0,.25); overflow-wrap: anywhere; }
#bauify-atlas .atlas-tip[hidden] { display: none; }
#bauify-atlas .atlas-tip b { display: block; }
#bauify-atlas .atlas-side { width: 360px; flex: none; overflow: auto; border-left: 1px solid var(--panel-border, #1e293b); padding: 12px 16px 20px; box-sizing: border-box; background: var(--panel, #0f172a); }
#bauify-atlas .k { color: var(--text-muted, #94a3b8); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin: 16px 0 6px; }
#bauify-atlas .k:first-child { margin-top: 2px; }
#bauify-atlas .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
#bauify-atlas .stat { border: 1px solid var(--panel-border, #1e293b); border-radius: 8px; padding: 6px 8px; }
#bauify-atlas .stat b { display: block; font: 600 16px ui-monospace, Menlo, Consolas, monospace; }
#bauify-atlas .stat span { color: var(--text-muted, #94a3b8); font-size: 11px; }
#bauify-atlas .selected { border: 1px solid var(--panel-border, #1e293b); border-radius: 8px; padding: 10px; margin-top: 8px; }
#bauify-atlas .selected h4 { margin: 0 0 4px; font: 600 12px ui-monospace, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
#bauify-atlas .selected p { margin: 4px 0 8px; color: var(--text-muted, #94a3b8); font-size: 12px; overflow-wrap: anywhere; }
#bauify-atlas .row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 8px; align-items: center; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 5px 6px; margin: 0; }
#bauify-atlas .row.active { background: color-mix(in srgb, var(--backend-stroke, #34D399) 12%, transparent); }
#bauify-atlas .row i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
#bauify-atlas .row .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
#bauify-atlas .row .n { color: var(--text-muted, #94a3b8); font: 11px ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; }
#bauify-atlas .row.accepted .t { text-decoration: line-through; opacity: .7; }
#bauify-atlas details summary { cursor: pointer; font-size: 12px; padding: 3px 0; }
#bauify-atlas .hist { display: flex; align-items: flex-end; gap: 2px; height: 72px; border-bottom: 1px solid var(--panel-border, #1e293b); }
#bauify-atlas .hist div { flex: 1 1 0; min-height: 1px; border-radius: 2px 2px 0 0; background: var(--text-muted, #94a3b8); opacity: .75; }
#bauify-atlas .hist div.hot { background: #FBBF24; opacity: 1; }
#bauify-atlas .axis { display: flex; justify-content: space-between; color: var(--text-muted, #94a3b8); font: 10px ui-monospace, Menlo, Consolas, monospace; margin-top: 3px; }
#bauify-atlas .note { color: var(--text-muted, #94a3b8); font-size: 11px; margin-top: 6px; }
#bauify-atlas .legend { display: grid; gap: 4px; font-size: 11px; color: var(--text-muted, #94a3b8); }
#bauify-atlas .legend i { display: inline-block; width: 14px; height: 3px; vertical-align: middle; margin-right: 6px; border-radius: 2px; }
#bauify-atlas .bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 4px; }
@media (max-width: 900px) {
  #bauify-atlas .atlas-body { flex-direction: column; overflow: auto; }
  #bauify-atlas .atlas-stage { flex: none; height: min(100vw, 70vh); }
  #bauify-atlas .atlas-side { width: auto; border-left: 0; border-top: 1px solid var(--panel-border, #1e293b); overflow: visible; }
}
@media print { #bauify-atlas { display: none; } }
`;

export const ATLAS_JS = `
(function () {
  var source = document.getElementById('bauify-atlas-data');
  if (!source) return;
  var atlas = JSON.parse(source.textContent);
  var root = document.documentElement;
  var TONE = { error: '#FB7185', warning: '#FBBF24', info: '#60A5FA' };
  var NAMES = { 'complexity/function': 'Complex functions', 'coupling/import-cycle': 'Import cycles', 'coupling/cycle': 'Module cycles', 'coupling/hub': 'Hub modules', 'architecture/boundary': 'Boundary violations' };
  var M = atlas.modules, F = atlas.files, E = atlas.edges, FN = atlas.functions, FD = atlas.findings;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : many || one + 's'); }
  var fnsByFile = F.map(function () { return []; }), fnSlot = [];
  FN.forEach(function (fn, i) { fnSlot[i] = fnsByFile[fn[0]].length; fnsByFile[fn[0]].push(i); });
  var edgesByModule = M.map(function () { return { out: 0, in: 0 }; });
  E.forEach(function (e) { var a = F[e[0]][1], b = F[e[1]][1]; if (a !== b) { edgesByModule[a].out++; edgesByModule[b].in++; } });
  var hubOf = {}; FD.forEach(function (f, i) { if (f.kind === 'module') hubOf[f.module] = i; });

  var panel = document.createElement('section');
  panel.id = 'bauify-atlas'; panel.hidden = true; panel.setAttribute('aria-label', 'Code analysis atlas');
  panel.innerHTML = '<nav class="atlas-nav" aria-label="Atlas navigation"><div class="atlas-title">Atlas<span>' + esc(plural(F.length, 'file') + ' · ' + plural(E.length, 'file dependency', 'file dependencies') + ' · ' + plural(FN.length, 'function')) + '</span></div>' +
    '<div><button type="button" class="atlas-clear">Clear selection</button> <button type="button" class="atlas-classic" title="Back to the diagram view with source evidence">Classic view</button></div></nav>' +
    '<div class="atlas-body"><div class="atlas-stage"><canvas role="img"></canvas><div class="atlas-tip" hidden></div></div><aside class="atlas-side"></aside></div>';
  document.body.appendChild(panel);
  var stage = panel.querySelector('.atlas-stage'), canvas = panel.querySelector('canvas'), tip = panel.querySelector('.atlas-tip'), side = panel.querySelector('.atlas-side');
  canvas.setAttribute('aria-label', 'Dependency atlas: ' + plural(M.length, 'module') + ' around a circle, ' + plural(F.length, 'file') + ' grouped by module, ' + plural(E.length, 'file dependency', 'file dependencies') + ' drawn between them, and ' + plural(FN.length, 'function') + ' as spikes whose length is their complexity. The side panel lists the same findings and modules.');

  // ---- state ----
  var state = { focusModule: -1, finding: -1, hover: null };
  var LABEL_FONT = '11px ui-monospace, Menlo, Consolas, monospace';
  // Long module names are cut on the circle (the tooltip and side panel keep them whole).
  function shortLabel(label) { return label.length > 20 ? '…' + label.slice(-19) : label; }
  // Many curves add up: fainter strokes for denser graphs keep strands readable.
  function density(n, most) { return Math.max(0.05, Math.min(most, 8 / Math.sqrt(Math.max(n, 1)))); }
  var geo = null, base = null;

  // ---- colours: module hues spaced around the wheel, lightness by theme ----
  function cssVar(name, fallback) { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback; }
  function theme() {
    var dark = (root.getAttribute('data-theme') || '') !== 'light';
    return { dark: dark, bg: cssVar('--bg', dark ? '#0b1220' : '#ffffff'), text: cssVar('--text', dark ? '#f8fafc' : '#0f172a'), muted: cssVar('--text-muted', dark ? '#94a3b8' : '#475569'), grid: cssVar('--panel-border', dark ? '#1e293b' : '#e2e8f0') };
  }
  function hue(i, t, alpha) {
    var h = Math.round(((i / Math.max(M.length, 1)) * 330 + 200) % 360);
    return 'hsla(' + h + ', ' + (t.dark ? 62 : 55) + '%, ' + (t.dark ? 64 : 42) + '%, ' + (alpha == null ? 1 : alpha) + ')';
  }

  // ---- geometry: angles for files, module spans, radii ----
  function layout() {
    var w = stage.clientWidth, h = stage.clientHeight, dpr = window.devicePixelRatio || 1;
    var size = Math.max(200, Math.min(w, h));
    // Leave room outside the arcs for the longest module label.
    var measure = canvas.getContext('2d'); measure.font = LABEL_FONT;
    var longest = M.reduce(function (n, m) { return Math.max(n, measure.measureText(shortLabel(m.label)).width); }, 0);
    var R = Math.max(40, Math.min(size * 0.34, (size / 2 - Math.min(longest, size * 0.22) - 12) / 1.53)), gap = 2.2, slots = F.length + gap * M.length;
    var ang = new Float64Array(F.length), span = [], k = 0, fi = 0;
    M.forEach(function (m, mi) {
      var start = k;
      while (fi < F.length && F[fi][1] === mi) { ang[fi] = -Math.PI / 2 + 2 * Math.PI * (k + 0.5) / slots; k += 1; fi += 1; }
      span.push([-Math.PI / 2 + 2 * Math.PI * start / slots, -Math.PI / 2 + 2 * Math.PI * k / slots]);
      k += gap;
    });
    geo = { w: w, h: h, dpr: dpr, cx: w / 2, cy: h / 2, R: R, slot: 2 * Math.PI / slots, ang: ang, span: span,
      tick: R * 0.04, spike0: R * 1.06, spikeMax: R * 0.36, arc: R * 1.48, label: R * 1.53 };
  }
  function pt(a, r) { return [geo.cx + r * Math.cos(a), geo.cy + r * Math.sin(a)]; }
  function mid(mi) { return (geo.span[mi][0] + geo.span[mi][1]) / 2; }
  function spikeLen(cx) { return geo.spikeMax * (0.06 + 0.94 * Math.min(cx, 26) / 26); }
  function fnAngle(i) {
    var fn = FN[i], n = fnsByFile[fn[0]].length;
    return geo.ang[fn[0]] + (n > 1 ? (fnSlot[i] / (n - 1) - 0.5) * geo.slot * 0.8 : 0);
  }
  // A dependency is a cubic curve bundled through both modules' mid-angles near the
  // centre; one inside a module stays near the rim.
  function curvePoints(a, b) {
    var ma = F[a][1], mb = F[b][1], R = geo.R * 0.985;
    var p0 = pt(geo.ang[a], R), p3 = pt(geo.ang[b], R);
    if (ma === mb) return [p0, pt(geo.ang[a], geo.R * 0.8), pt(geo.ang[b], geo.R * 0.8), p3];
    return [p0, pt(mid(ma), geo.R * 0.42), pt(mid(mb), geo.R * 0.42), p3];
  }
  function curve(ctx, a, b) {
    var c = curvePoints(a, b);
    ctx.moveTo(c[0][0], c[0][1]); ctx.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]);
  }
  function along(c, u) {
    var v = 1 - u, a = v * v * v, b = 3 * v * v * u, d = 3 * v * u * u, e = u * u * u;
    return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
  }

  // ---- what the current selection lights up ----
  function selection() {
    var sel = { modules: {}, files: {}, edges: null, fns: {}, tone: null, any: false };
    if (state.focusModule !== -1) { sel.modules[state.focusModule] = true; sel.any = true; }
    var f = FD[state.finding];
    if (f) {
      sel.any = true; sel.tone = TONE[f.severity] || TONE.info;
      if (f.kind === 'function' && f.fn != null) { sel.fns[f.fn] = true; sel.files[FN[f.fn][0]] = true; sel.anchor = FN[f.fn][0]; }
      if (f.kind === 'cycle') { f.files.forEach(function (x) { sel.files[x] = true; }); sel.edges = f.path.map(function (x, i) { return [x, f.path[(i + 1) % f.path.length]]; }); }
      if (f.kind === 'module') sel.modules[f.module] = true;
      if (f.kind === 'modules') f.modules.forEach(function (x) { sel.modules[x] = true; });
      if (f.kind === 'edges') { sel.edges = f.edges; f.edges.forEach(function (e) { sel.files[e[0]] = true; sel.files[e[1]] = true; }); }
    }
    return sel;
  }
  function inSel(sel, file) { return sel.files[file] || sel.modules[F[file][1]]; }

  // ---- drawing ----
  // The whole picture is painted into an off-screen frame; the visible canvas
  // composites it with the motion layer (opening reveal, cross-fade between
  // selections, a light travelling around a selected import cycle) and the hover
  // mark. Motion only shows what changed or where a cycle goes, and is skipped
  // when the reader asks for reduced motion.
  var frame = document.createElement('canvas'), previous = document.createElement('canvas');
  var REVEAL_MS = 700, FADE_MS = 300, HOP_MS = 900;
  var anim = { reveal: 0, fade: 0, flow: 0, flowFor: -1, raf: 0, timer: 0 };
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function draw(how) {
    if (panel.hidden) return;
    var still = motion.matches;
    var fade = how === 'fade' && !still && frame.width > 0;
    if (fade) { previous.width = frame.width; previous.height = frame.height; previous.getContext('2d').drawImage(frame, 0, 0); }
    layout();
    var W = Math.round(geo.w * geo.dpr), H = Math.round(geo.h * geo.dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    frame.width = W; frame.height = H;
    paint(frame.getContext('2d'));
    root.setAttribute('data-bauify-atlas-drawn', String(E.length));
    var now = performance.now(), f = FD[state.finding];
    anim.reveal = how === 'reveal' && !still ? now : 0;
    anim.fade = fade && previous.width === W && previous.height === H ? now : 0;
    var flowing = f && f.kind === 'cycle' && f.path.length > 1 && !still;
    if (!flowing) { anim.flow = 0; anim.flowFor = -1; }
    else if (anim.flowFor !== state.finding) { anim.flow = now; anim.flowFor = state.finding; }
    markMotion(); schedule();
  }
  // Motion state on <html>, set as soon as it changes, for tests and styling.
  function markMotion() {
    if (anim.reveal || anim.fade) root.setAttribute('data-bauify-atlas-animating', 'true'); else root.removeAttribute('data-bauify-atlas-animating');
    root.setAttribute('data-bauify-atlas-flow', anim.flow ? 'on' : 'off');
  }
  // Frames come from requestAnimationFrame; a timer backs it up where frames are
  // throttled (a page not in view), so time-based motion still reaches its end.
  function schedule() {
    if (anim.raf) return;
    anim.raf = requestAnimationFrame(tick);
    anim.timer = setTimeout(tick, 40);
  }
  function tick() {
    // One clock for every start time: a frame's own timestamp can precede them.
    var now = performance.now();
    cancelAnimationFrame(anim.raf); clearTimeout(anim.timer);
    anim.raf = 0; anim.timer = 0;
    if (panel.hidden) return;
    var busy = present(now);
    markMotion();
    if (busy) schedule();
  }
  function present(now) {
    var ctx = canvas.getContext('2d'), busy = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (anim.reveal) {
      // Opening: the picture grows out from the centre, curves first, then rim and labels.
      var p = Math.min(1, (now - anim.reveal) / REVEAL_MS), e = 1 - Math.pow(1 - p, 3);
      ctx.save(); ctx.beginPath(); ctx.arc(geo.cx * geo.dpr, geo.cy * geo.dpr, Math.max(1, e * Math.hypot(geo.w, geo.h) / 2 * geo.dpr), 0, 2 * Math.PI); ctx.clip();
      ctx.globalAlpha = 0.25 + 0.75 * e; ctx.drawImage(frame, 0, 0); ctx.restore();
      if (p < 1) busy = true; else anim.reveal = 0;
    } else if (anim.fade) {
      // A new focus or finding cross-fades in, so it is clear what changed.
      var q = Math.min(1, (now - anim.fade) / FADE_MS), s = q * q * (3 - 2 * q);
      ctx.globalAlpha = 1 - s; ctx.drawImage(previous, 0, 0); ctx.globalAlpha = s; ctx.drawImage(frame, 0, 0); ctx.globalAlpha = 1;
      if (q < 1) busy = true; else anim.fade = 0;
    } else ctx.drawImage(frame, 0, 0);
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    if (anim.flow) { drawFlow(ctx, now); busy = true; }
    drawHover(ctx, theme());
    return busy;
  }
  // A light runs along the selected import cycle, hop by hop, and back to its start.
  function drawFlow(ctx, now) {
    var f = FD[state.finding]; if (!f || f.kind !== 'cycle') return;
    var path = f.path, n = path.length, phase = (Math.max(0, now - anim.flow) % (n * HOP_MS)) / HOP_MS;
    var hop = Math.floor(phase), u = phase - hop, c = curvePoints(path[hop], path[(hop + 1) % n]), tone = TONE[f.severity] || TONE.info;
    ctx.save(); ctx.fillStyle = tone; ctx.shadowColor = tone; ctx.shadowBlur = 14;
    for (var j = 5; j >= 0; j--) {
      var w = u - j * 0.045; if (w < 0) continue;
      var q = along(c, w); ctx.globalAlpha = 1 - j * 0.16;
      ctx.beginPath(); ctx.arc(q[0], q[1], 4.5 - j * 0.6, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
  }
  function paint(ctx) {
    var t = theme(), dpr = geo.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);
    var sel = selection(), dimmed = sel.any;
    // guide rings
    ctx.lineWidth = 1; ctx.strokeStyle = t.grid;
    [0.42, 0.8, 1.0, 1.42].forEach(function (f) { ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.R * f, 0, 2 * Math.PI); ctx.stroke(); });
    // dependencies, one path per source module
    var focusM = state.focusModule;
    var byModule = M.map(function () { return []; });
    E.forEach(function (e) { byModule[F[e[0]][1]].push(e); });
    ctx.lineCap = 'round';
    var litCount = 0, inCount = 0;
    if (dimmed) E.forEach(function (e) {
      var mi = F[e[0]][1];
      if (focusM !== -1 && F[e[1]][1] === focusM && mi !== focusM) inCount++;
      else if ((focusM !== -1 && mi === focusM) || (state.finding !== -1 && inSel(sel, e[0]) && inSel(sel, e[1])) || (sel.anchor != null && (e[0] === sel.anchor || e[1] === sel.anchor))) litCount++;
    });
    var baseAlpha = density(E.length, t.dark ? 0.26 : 0.22), litAlpha = density(litCount, 0.85) * 2.2, inAlpha = density(inCount, 0.7) * 1.8;
    byModule.forEach(function (list, mi) {
      var faint = [], lit = [], inbound = [];
      list.forEach(function (e) {
        if (!dimmed) { faint.push(e); return; }
        if (focusM !== -1 && F[e[1]][1] === focusM && mi !== focusM) inbound.push(e);
        else if ((focusM !== -1 && mi === focusM) || (state.finding !== -1 && inSel(sel, e[0]) && inSel(sel, e[1])) || (sel.anchor != null && (e[0] === sel.anchor || e[1] === sel.anchor))) lit.push(e);
        else faint.push(e);
      });
      ctx.beginPath(); faint.forEach(function (e) { curve(ctx, e[0], e[1]); });
      ctx.strokeStyle = hue(mi, t, dimmed ? Math.min(0.05, baseAlpha) : baseAlpha); ctx.lineWidth = 0.6; ctx.stroke();
      if (lit.length) { ctx.beginPath(); lit.forEach(function (e) { curve(ctx, e[0], e[1]); }); ctx.strokeStyle = hue(mi, t, Math.min(0.85, litAlpha)); ctx.lineWidth = 1.1; ctx.stroke(); }
      if (inbound.length) { ctx.beginPath(); inbound.forEach(function (e) { curve(ctx, e[0], e[1]); }); ctx.strokeStyle = t.text; ctx.globalAlpha = Math.min(0.7, inAlpha); ctx.lineWidth = 1.1; ctx.stroke(); ctx.globalAlpha = 1; }
    });
    // the selected finding's own edges, drawn last and thick
    if (sel.edges && sel.edges.length) {
      ctx.save(); ctx.shadowColor = sel.tone; ctx.shadowBlur = 8;
      ctx.beginPath(); sel.edges.forEach(function (e) { curve(ctx, e[0], e[1]); });
      ctx.strokeStyle = sel.tone; ctx.lineWidth = 2.6; ctx.stroke(); ctx.restore();
    }
    // files
    F.forEach(function (f, i) {
      var a = geo.ang[i], p0 = pt(a, geo.R), p1 = pt(a, geo.R + geo.tick), on = !dimmed || inSel(sel, i);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
      ctx.strokeStyle = sel.files[i] ? sel.tone : hue(f[1], t, on ? 0.95 : 0.2); ctx.lineWidth = sel.files[i] ? 2.4 : 1.3; ctx.stroke();
    });
    // functions as spikes; reported ones carry a dot in their severity colour
    var dots = [];
    FN.forEach(function (fn, i) {
      var a = fnAngle(i), len = spikeLen(fn[3]), hit = fn[6] !== -1 ? FD[fn[6]] : null;
      var on = !dimmed || inSel(sel, fn[0]) || sel.fns[i];
      var p0 = pt(a, geo.spike0), p1 = pt(a, geo.spike0 + len);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
      ctx.strokeStyle = hit ? TONE[hit.severity] || TONE.info : t.muted;
      ctx.globalAlpha = (hit ? 1 : fn[3] >= 8 ? 0.85 : 0.45) * (on ? 1 : 0.15);
      ctx.lineWidth = hit ? 1.6 : 0.8; ctx.stroke(); ctx.globalAlpha = 1;
      if (hit && !hit.accepted) dots.push([p1, TONE[hit.severity] || TONE.info, on, sel.fns[i]]);
    });
    dots.forEach(function (d) {
      ctx.globalAlpha = d[2] ? 1 : 0.2; ctx.beginPath(); ctx.arc(d[0][0], d[0][1], d[3] ? 5 : 3, 0, 2 * Math.PI); ctx.fillStyle = d[1]; ctx.fill();
      if (d[3]) { ctx.lineWidth = 2; ctx.strokeStyle = t.text; ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
    // module arcs and labels
    ctx.font = LABEL_FONT; ctx.textBaseline = 'middle';
    M.forEach(function (m, mi) {
      var on = !dimmed || sel.modules[mi] || F.some(function (f, i) { return f[1] === mi && sel.files[i]; });
      var hub = hubOf[mi] != null;
      ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.arc, geo.span[mi][0], Math.max(geo.span[mi][1], geo.span[mi][0] + 0.004));
      ctx.strokeStyle = hue(mi, t, on ? 1 : 0.25); ctx.lineWidth = hub ? 5 : 2; ctx.lineCap = 'butt'; ctx.stroke();
      var a = mid(mi), deg = (a * 180 / Math.PI + 360) % 360, flip = deg > 90 && deg < 270, p = pt(a, geo.label);
      // A module too narrow for its own label is named only when selected or hovered.
      var named = (geo.span[mi][1] - geo.span[mi][0]) * geo.arc >= 12 || sel.modules[mi];
      if (!named) return;
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(flip ? a + Math.PI : a);
      ctx.textAlign = flip ? 'right' : 'left'; ctx.fillStyle = hue(mi, t, on ? 1 : 0.35);
      ctx.fillText(shortLabel(m.label), 0, 0); ctx.restore();
    });
    ctx.lineCap = 'round';
  }
  function drawHover(ctx, t) {
    var h = state.hover; if (!h) return;
    ctx.save(); ctx.strokeStyle = t.text; ctx.lineWidth = 2;
    if (h.type === 'function') { var a = fnAngle(h.index), p0 = pt(a, geo.spike0), p1 = pt(a, geo.spike0 + spikeLen(FN[h.index][3])); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
    if (h.type === 'file') { var q0 = pt(geo.ang[h.index], geo.R - 2), q1 = pt(geo.ang[h.index], geo.R + geo.tick + 2); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke(); }
    if (h.type === 'module') {
      ctx.lineWidth = 7; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(geo.cx, geo.cy, geo.arc, geo.span[h.index][0], geo.span[h.index][1]); ctx.stroke();
      var a = mid(h.index), deg = (a * 180 / Math.PI + 360) % 360, flip = deg > 90 && deg < 270, p = pt(a, geo.label);
      ctx.globalAlpha = 1; ctx.font = LABEL_FONT; ctx.textBaseline = 'middle'; ctx.fillStyle = t.text;
      ctx.translate(p[0], p[1]); ctx.rotate(flip ? a + Math.PI : a); ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText(shortLabel(M[h.index].label), 0, 0);
    }
    ctx.restore();
  }

  // ---- hit testing in polar coordinates ----
  function nearestFile(a, tol) {
    var best = -1, bestD = tol;
    for (var i = 0; i < F.length; i++) { var d = Math.abs(Math.atan2(Math.sin(a - geo.ang[i]), Math.cos(a - geo.ang[i]))); if (d < bestD) { bestD = d; best = i; } }
    return best;
  }
  function hit(x, y) {
    if (!geo) return null;
    var dx = x - geo.cx, dy = y - geo.cy, r = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
    if (r > geo.arc - 8 && r < geo.label + 140) {
      for (var mi = 0; mi < M.length; mi++) {
        var s = geo.span[mi], d0 = ((a - s[0]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (d0 <= s[1] - s[0] + 0.01 || d0 >= 2 * Math.PI - 0.01) return { type: 'module', index: mi };
      }
      return null;
    }
    if (r >= geo.spike0 - 2 && r <= geo.spike0 + geo.spikeMax + 6) {
      var file = nearestFile(a, geo.slot * 0.75); if (file === -1) return null;
      var best = -1, bestD = geo.slot;
      fnsByFile[file].forEach(function (i) { var d = Math.abs(Math.atan2(Math.sin(a - fnAngle(i)), Math.cos(a - fnAngle(i)))); if (d <= bestD && r <= geo.spike0 + spikeLen(FN[i][3]) + 6) { bestD = d; best = i; } });
      return best === -1 ? { type: 'file', index: file } : { type: 'function', index: best };
    }
    if (r >= geo.R - 4 && r <= geo.spike0) { var f2 = nearestFile(a, geo.slot * 0.75); return f2 === -1 ? null : { type: 'file', index: f2 }; }
    return null;
  }
  function tipText(h) {
    if (h.type === 'module') { var m = M[h.index], c = F.filter(function (f) { return f[1] === h.index; }).length; return '<b>' + esc(m.label) + '</b>' + (m.path && m.path !== m.label ? esc(m.path) + '<br>' : '') + plural(c, 'file') + ' · fan-in ' + m.fanIn + ' · fan-out ' + m.fanOut + (hubOf[h.index] != null ? ' · reported hub' : '') + '<br>Click to focus its dependencies.'; }
    if (h.type === 'file') { var f = F[h.index]; return '<b>' + esc(f[0]) + '</b>' + esc(M[f[1]].label) + ' · ' + plural(f[2], 'line') + ' · ' + plural(fnsByFile[h.index].length, 'function'); }
    var fn = FN[h.index], fd = fn[6] !== -1 ? FD[fn[6]] : null;
    return '<b>' + esc(fn[1]) + '</b>' + esc(F[fn[0]][0]) + ':' + fn[2] + '<br>complexity ' + fn[3] + ' · nesting ' + fn[4] + ' · ' + plural(fn[5], 'line') + (fd ? '<br>Reported (' + esc(fd.severity) + '). Click to select.' : '');
  }
  canvas.addEventListener('mousemove', function (e) {
    var b = canvas.getBoundingClientRect(), h = hit(e.clientX - b.left, e.clientY - b.top);
    var same = h && state.hover && h.type === state.hover.type && h.index === state.hover.index;
    if (!same) { state.hover = h; schedule(); }
    if (!h) { tip.hidden = true; return; }
    tip.innerHTML = tipText(h); tip.hidden = false;
    var x = e.clientX - b.left + 14, y = e.clientY - b.top + 14;
    tip.style.left = Math.min(x, b.width - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y, b.height - tip.offsetHeight - 8) + 'px';
  });
  canvas.addEventListener('mouseleave', function () { tip.hidden = true; if (state.hover) { state.hover = null; schedule(); } });
  canvas.addEventListener('click', function (e) {
    var b = canvas.getBoundingClientRect(), h = hit(e.clientX - b.left, e.clientY - b.top);
    if (!h) { select(-1, -1); return; }
    if (h.type === 'module') select(state.focusModule === h.index ? -1 : h.index, -1);
    else if (h.type === 'function' && FN[h.index][6] !== -1) select(-1, FN[h.index][6]);
    else select(F[h.type === 'function' ? FN[h.index][0] : h.index][1], -1);
  });

  // ---- side panel ----
  function select(module, finding) {
    state.focusModule = module; state.finding = finding;
    root.setAttribute('data-bauify-atlas-focus', module === -1 ? '' : M[module].id);
    root.setAttribute('data-bauify-atlas-finding', finding === -1 ? '' : FD[finding].id);
    renderSide(); draw('fade');
  }
  function selectedCard() {
    var f = FD[state.finding];
    if (f) {
      var what = '';
      if (f.kind === 'function' && f.fn != null) { var fn = FN[f.fn]; what = F[fn[0]][0] + ':' + fn[2] + ' · complexity ' + fn[3] + ' · nesting ' + fn[4] + ' · ' + plural(fn[5], 'line') + '. Curves: dependencies of its file.'; }
      if (f.kind === 'cycle') what = 'Path: ' + f.path.map(function (x) { return F[x][0].split('/').pop(); }).join(' → ') + ' → back';
      if (f.kind === 'modules') what = f.modules.map(function (x) { return M[x].label; }).join(', ');
      if (f.kind === 'module') what = 'fan-in ' + M[f.module].fanIn + ' · fan-out ' + M[f.module].fanOut;
      if (f.kind === 'edges') what = plural(f.edges.length, 'import') + ' cross the rule.';
      return '<div class="selected"><h4>' + esc(f.title) + '</h4><p><span style="color:' + (TONE[f.severity] || TONE.info) + '">' + esc(f.severity) + '</span>' + (f.accepted ? ' · accepted in baseline' : '') + ' · ' + esc(what) + '</p>' +
        '<button type="button" class="atlas-evidence" data-id="' + esc(f.id) + '">Open evidence in Classic view</button></div>';
    }
    if (state.focusModule !== -1) {
      var m = M[state.focusModule], files = F.filter(function (x) { return x[1] === state.focusModule; }).length;
      var fns = FN.filter(function (fn) { return F[fn[0]][1] === state.focusModule; });
      return '<div class="selected"><h4>' + esc(m.label) + '</h4><p>' + plural(files, 'file') + ' · ' + plural(fns.length, 'function') + ' · fan-in ' + m.fanIn + ' · fan-out ' + m.fanOut + '<br>Coloured curves: dependencies inside it and its ' + plural(edgesByModule[state.focusModule].out, 'dependency', 'dependencies') + ' on other modules. Neutral curves: ' + plural(edgesByModule[state.focusModule].in, 'dependency', 'dependencies') + ' of other modules on it.</p></div>';
    }
    return '<div class="note">Hover the circle for names. Click a module arc to focus it, a dotted spike or a finding below to light it up.</div>';
  }
  function renderSide() {
    var h = '<div class="k">Selection</div>' + selectedCard();
    h += '<div class="k">Totals</div><div class="stats">' +
      [[F.length, 'files'], [E.length, 'file dependencies'], [FN.length, 'functions'], [M.length, 'modules']].map(function (s) { return '<div class="stat"><b>' + fmt(s[0]) + '</b><span>' + s[1] + '</span></div>'; }).join('') + '</div>';
    var groups = {};
    FD.forEach(function (f, i) { (groups[f.code] = groups[f.code] || []).push(i); });
    var codes = Object.keys(groups).sort();
    h += '<div class="k">Findings · ' + FD.length + '</div>';
    if (!FD.length) h += '<div class="note">No rule fired within the checks that ran.</div>';
    codes.forEach(function (code) {
      var list = groups[code].slice().sort(function (a, b) { var r = { error: 0, warning: 1, info: 2 }; return (r[FD[a].severity] - r[FD[b].severity]) || (FD[a].title < FD[b].title ? -1 : 1); });
      h += '<details' + (list.indexOf(state.finding) !== -1 ? ' open' : '') + '><summary>' + esc(NAMES[code] || code) + ' · ' + list.length + '</summary>' + list.map(function (i) {
        var f = FD[i];
        return '<button type="button" class="row' + (i === state.finding ? ' active' : '') + (f.accepted ? ' accepted' : '') + '" data-finding="' + i + '"><i style="background:' + (TONE[f.severity] || TONE.info) + '"></i><span class="t" title="' + esc(f.title) + '">' + esc(f.title) + '</span><span class="n">' + esc(f.severity) + '</span></button>';
      }).join('') + '</details>';
    });
    if (atlas.measured && FN.length) {
      var counts = []; for (var c = 0; c < 20; c++) counts.push(0);
      FN.forEach(function (fn) { counts[Math.max(1, Math.min(fn[3], 20)) - 1]++; });
      var max = Math.max.apply(Math, counts);
      h += '<div class="k">Cyclomatic complexity · √ scale</div><div class="hist" role="img" aria-label="Function counts by complexity 1 to 20 or more: ' + counts.join(', ') + '">' + counts.map(function (n, i) { return '<div class="' + (i >= 14 ? 'hot' : '') + '" title="' + (i === 19 ? '20+' : i + 1) + ': ' + plural(n, 'function') + '" style="height:' + (n ? Math.max(2, Math.round(100 * Math.sqrt(n / max))) : 0) + '%"></div>'; }).join('') + '</div><div class="axis"><span>1</span><span>15</span><span>20+</span></div>';
    }
    var order = M.map(function (m, i) { return i; }).sort(function (a, b) { return (M[b].fanIn + M[b].fanOut) - (M[a].fanIn + M[a].fanOut) || (M[a].label < M[b].label ? -1 : 1); });
    h += '<div class="k">Modules by coupling · fan-in / fan-out</div>' + order.map(function (i) {
      return '<button type="button" class="row' + (i === state.focusModule ? ' active' : '') + '" data-module="' + i + '"><i style="background:' + hue(i, theme()) + '"></i><span class="t">' + esc(M[i].label) + (hubOf[i] != null ? ' · hub' : '') + '</span><span class="n">' + M[i].fanIn + ' / ' + M[i].fanOut + '</span></button>';
    }).join('');
    var cov = atlas.coverage, total = Math.max(cov.records, 1);
    h += '<div class="k">Dependency records · ' + fmt(cov.records) + '</div><div class="bar" role="img" aria-label="' + fmt(cov.resolved) + ' resolved, ' + fmt(cov.external) + ' external, ' + fmt(cov.unknown) + ' unresolved"><span style="width:' + (100 * cov.resolved / total) + '%;background:#34D399"></span><span style="width:' + (100 * cov.external / total) + '%;background:#64748B"></span><span style="width:' + (100 * cov.unknown / total) + '%;background:#FBBF24"></span></div>' +
      '<div class="note">' + fmt(cov.resolved) + ' resolved · ' + fmt(cov.external) + ' external · ' + fmt(cov.unknown) + ' could not be resolved' + (cov.parseErrors ? ' · ' + plural(cov.parseErrors, 'file') + ' failed to parse' : '') + '. Unresolved records draw no curve, so a missing curve does not prove there is no dependency.</div>';
    h += '<div class="k">Reading the atlas</div><div class="legend"><span><i style="background:' + hue(0, theme()) + '"></i>outer arc: module (thick: reported hub)</span><span><i style="background:' + theme().muted + '"></i>tick: file · spike: function, length = complexity</span><span><i style="background:#FBBF24;height:8px;width:8px;border-radius:50%"></i>dot: reported function, severity colour</span><span><i style="background:' + hue(3, theme(), 0.6) + '"></i>curve: file dependency, coloured by the importing module</span></div>';
    side.innerHTML = h;
    side.querySelectorAll('[data-finding]').forEach(function (el) { el.addEventListener('click', function () { var i = Number(el.getAttribute('data-finding')); select(-1, state.finding === i ? -1 : i); }); });
    side.querySelectorAll('[data-module]').forEach(function (el) { el.addEventListener('click', function () { var i = Number(el.getAttribute('data-module')); select(state.focusModule === i ? -1 : i, -1); }); });
    var ev = side.querySelector('.atlas-evidence');
    if (ev) ev.addEventListener('click', function () { var id = ev.getAttribute('data-id'); close(); if (window.__archifyShowFinding) window.__archifyShowFinding(id); });
  }

  // ---- open / close ----
  function open() {
    if (root.getAttribute('data-bauify') !== 'on') return;
    panel.hidden = false; root.setAttribute('data-bauify-view', 'atlas');
    renderSide(); draw('reveal');
    panel.querySelector('.atlas-classic').focus({ preventScroll: true });
  }
  function close() {
    panel.hidden = true; root.removeAttribute('data-bauify-view'); tip.hidden = true;
    if (anim.raf) { cancelAnimationFrame(anim.raf); clearTimeout(anim.timer); }
    anim.raf = 0; anim.timer = 0; anim.reveal = 0; anim.fade = 0; anim.flow = 0; anim.flowFor = -1;
    markMotion();
  }
  panel.querySelector('.atlas-classic').addEventListener('click', close);
  panel.querySelector('.atlas-clear').addEventListener('click', function () { select(-1, -1); });
  window.__archifyAtlas = { open: open, close: close };
  new MutationObserver(function () { if (root.getAttribute('data-bauify') !== 'on' && !panel.hidden) close(); else if (!panel.hidden) { renderSide(); draw(); } }).observe(root, { attributes: true, attributeFilter: ['data-bauify', 'data-theme'] });
  var pending = 0;
  window.addEventListener('resize', function () { if (panel.hidden) return; cancelAnimationFrame(pending); pending = requestAnimationFrame(function () { draw(); }); });
  if (motion.addEventListener) motion.addEventListener('change', function () { if (!panel.hidden) draw(); });
})();
`;
