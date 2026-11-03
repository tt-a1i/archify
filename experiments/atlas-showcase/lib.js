// Shared helpers for the Atlas showcase demos. Reads window.ATLAS_DATA (data.js)
// and derives per-file / per-module numbers from it. Nothing here re-analyzes
// code: every number comes from the Atlas payload of a real run.
(function () {
  const D = window.ATLAS_DATA;
  if (!D) { document.body.textContent = 'data.js is missing. Run build-data.mjs first.'; return; }

  // functions: [file, name, line, complexity, nesting, length, findingIndex]
  const fnSeverity = (fn) => (fn[6] === -1 ? null : D.findings[fn[6]].severity);

  const files = D.files.map(([path, module, loc], i) => ({
    i, path, module, loc, name: path.split('/').pop(),
    fns: [], maxCC: 0, sumCC: 0, warnings: 0, infos: 0, out: [], in: [],
  }));
  D.functions.forEach((fn, i) => {
    const f = files[fn[0]];
    f.fns.push(i);
    f.maxCC = Math.max(f.maxCC, fn[3]);
    f.sumCC += fn[3];
    const s = fnSeverity(fn);
    if (s === 'warning' || s === 'error') f.warnings += 1;
    else if (s === 'info') f.infos += 1;
  });
  D.edges.forEach(([a, b]) => { files[a].out.push(b); files[b].in.push(a); });

  const modules = D.modules.map((m, i) => ({
    ...m, i, files: [], loc: 0, fns: 0, warnings: 0, infos: 0, maxCC: 0,
  }));
  files.forEach((f) => {
    const m = modules[f.module];
    m.files.push(f.i); m.loc += f.loc; m.fns += f.fns.length;
    m.warnings += f.warnings; m.infos += f.infos; m.maxCC = Math.max(m.maxCC, f.maxCC);
  });

  // Boundary findings: the file edges they cite.
  const boundary = D.findings.filter((f) => f.kind === 'edges');
  const violatingEdge = new Set();
  boundary.forEach((b) => (b.edges || []).forEach(([x, y]) => violatingEdge.add(`${x}>${y}`)));

  // Dependency rank of each module: 0 for modules nothing in-tree depends on
  // below them... computed as longest path to a sink so shared ends lowest.
  const rank = (() => {
    const out = modules.map(() => []);
    (D.moduleEdges || []).forEach(([a, b]) => { if (a !== b) out[a].push(b); });
    const memo = new Map();
    const visiting = new Set();
    const depth = (m) => {
      if (memo.has(m)) return memo.get(m);
      if (visiting.has(m)) return 0;
      visiting.add(m);
      let d = 0;
      for (const n of out[m]) d = Math.max(d, depth(n) + 1);
      visiting.delete(m);
      memo.set(m, d);
      return d;
    };
    return modules.map((_, i) => depth(i));
  })();
  modules.forEach((m, i) => { m.rank = rank[i]; });

  const T = D.thresholds || { info: { complexity: 15, nesting: 5 }, warning: { complexity: 25, nesting: 6 } };
  const level = (cc) => (cc >= T.warning.complexity ? 2 : cc >= T.info.complexity ? 1 : 0);

  const fmt = (n) => n.toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Prompt handed to an AI coding agent for one finding. It carries the
  // analyzer's evidence and asks for a behaviour-preserving change.
  function promptFor(finding) {
    const f = typeof finding === 'number' ? D.findings[finding] : finding;
    const lines = [];
    if (f.kind === 'function') {
      const fn = D.functions[f.fn];
      const file = files[fn[0]].path;
      lines.push(`Refactor ${fn[1]} in ${file}:${fn[2]}.`);
      lines.push(`Evidence from Archify code analysis (${D.repository?.name || 'repo'}): cyclomatic complexity ${fn[3]}, nesting depth ${fn[4]}, ${fn[5]} lines. Thresholds: info at ${T.info.complexity}, warning at ${T.warning.complexity}.`);
      if (f.fix) lines.push(`Suggested first step: ${f.fix}.`);
      lines.push('Keep behaviour identical. Extract named helpers, add or update tests for each extracted path, and report the new complexity.');
    } else if (f.kind === 'edges') {
      lines.push(`Fix the architecture boundary "${f.title}".`);
      if (f.message) lines.push(f.message);
      (f.imports || []).forEach((im) => lines.push(`- ${im.file}:${im.line} imports ${im.to}`));
      if (f.fix) lines.push(`Suggested first step: ${f.fix}.`);
      lines.push('Do not change behaviour. Re-run code analysis to confirm the finding is gone.');
    } else {
      lines.push(`${f.title}: ${f.message || f.code}`);
    }
    return lines.join('\n');
  }

  async function copyPrompt(finding, button) {
    const text = promptFor(finding);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    if (button) {
      const old = button.textContent;
      button.textContent = 'Copied for AI';
      button.disabled = true;
      setTimeout(() => { button.textContent = old; button.disabled = false; }, 1400);
    }
    return text;
  }

  // Squarified treemap. items: [{value, ...}] → each gets x, y, w, h.
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, it) => s + it.value, 0);
    if (!total || w <= 0 || h <= 0) { items.forEach((it) => Object.assign(it, { x, y, w: 0, h: 0 })); return items; }
    const scale = (w * h) / total;
    const rest = items.slice().sort((a, b) => b.value - a.value).map((it) => ({ it, a: it.value * scale }));
    let rx = x, ry = y, rw = w, rh = h;
    const worst = (row, side) => {
      const s = row.reduce((t, r) => t + r.a, 0);
      let mx = 0, mn = Infinity;
      row.forEach((r) => { mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); });
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    while (rest.length) {
      const side = Math.min(rw, rh);
      const row = [rest.shift()];
      while (rest.length && worst([...row, rest[0]], side) <= worst(row, side)) row.push(rest.shift());
      const s = row.reduce((t, r) => t + r.a, 0);
      if (rw >= rh) {
        const cw = s / rh; let cy = ry;
        row.forEach((r) => { const ch = r.a / cw; Object.assign(r.it, { x: rx, y: cy, w: cw, h: ch }); cy += ch; });
        rx += cw; rw -= cw;
      } else {
        const ch = s / rw; let cx = rx;
        row.forEach((r) => { const cw = r.a / ch; Object.assign(r.it, { x: cx, y: ry, w: cw, h: ch }); cx += cw; });
        ry += ch; rh -= ch;
      }
    }
    return items;
  }

  // Deterministic pseudo-random for layouts that must not jitter between loads.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }

  // HiDPI canvas sized to its CSS box; returns ctx in CSS pixels.
  function fitCanvas(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const topFunctions = (n) => D.functions.map((fn, i) => ({ fn, i }))
    .sort((a, b) => b.fn[3] - a.fn[3]).slice(0, n);

  window.Atlas = {
    D, files, modules, boundary, violatingEdge, T, level, fnSeverity,
    fmt, esc, promptFor, copyPrompt, squarify, rng, fitCanvas, reducedMotion, topFunctions,
    totals: {
      files: files.length, modules: modules.length, functions: D.functions.length,
      loc: files.reduce((s, f) => s + f.loc, 0), edges: D.edges.length,
      warnings: D.findings.filter((f) => f.severity === 'warning' || f.severity === 'error').length,
      infos: D.findings.filter((f) => f.severity === 'info').length,
      boundary: boundary.length,
      fnWarnings: D.findings.filter((f) => f.kind === 'function' && f.severity !== 'info').length,
      fnInfos: D.findings.filter((f) => f.kind === 'function' && f.severity === 'info').length,
    },
  };
})();
