#!/usr/bin/env node
// Builds pro/signals.js: architecture signals the analyzer does not report yet,
// measured from the same run so the "pro" views can show them with evidence.
//
//   node experiments/atlas-showcase/build-data.mjs <out-dir> [name]     (writes ../data.js)
//   node experiments/atlas-showcase/pro/build-signals.mjs <out-dir>     (writes signals.js)
//
// Every signal here is a static heuristic over raw-facts source text and the
// module graph: names, imports and text patterns. Each one keeps file:line
// evidence and the rule that produced it (signals.method), so a view can say
// exactly why something is flagged. None of it replaces analyzer findings.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = process.argv[2];
if (!outDir) { console.error('usage: build-signals.mjs <analysis-out-dir>'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const facts = JSON.parse(readFileSync(path.join(outDir, 'raw-facts.json'), 'utf8'));
const window = {};
new Function('window', readFileSync(path.join(here, '..', 'data.js'), 'utf8'))(window);
const D = window.ATLAS_DATA;

const fileIndex = new Map(D.files.map(([p], i) => [p, i]));
const srcOf = new Map(facts.files.map((f) => [f.path, f.sourceText || '']));
const isVendor = (p) => /(^|\/)vendor\//.test(p);
const moduleVendor = D.modules.map((m) => isVendor(`${m.path}/`));

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
function hits(text, re, limit = 6) {
  const out = []; let m; const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  while ((m = r.exec(text)) && out.length < 400) { out.push(lineOf(text, m.index)); if (m.index === r.lastIndex) r.lastIndex += 1; }
  return { count: out.length, lines: out.slice(0, limit) };
}
const fnsByFile = new Map();
for (const fn of facts.functions || []) (fnsByFile.get(fn.file) || fnsByFile.set(fn.file, []).get(fn.file)).push(fn);

// ---------- Roles (MVC-style separation) ----------
const ROLE_RULES = {
  entry: 'CLI entry: shebang, process.argv / process.exit, or under bin/ or scripts/',
  view: 'View: builds SVG/HTML markup (tag literals) or is a render-* file',
  model: 'Model / contract: validate*, assert*, schema*, normalize* functions, or schema/contract/types file names',
  io: 'I/O service: synchronous file-system calls and child processes',
  domain: 'Domain logic: layout, routing, geometry, compile, parse and measure functions',
};
const reTag = /<(svg|g|path|rect|circle|line|text|tspan|div|section|span|table|tr|td|ul|li|button|style|marker|defs)[\s>/]/g;
const reFs = /\b(?:fs\.)?(readFileSync|writeFileSync|mkdirSync|renameSync|openSync|closeSync|existsSync|rmSync|unlinkSync|copyFileSync|readdirSync|statSync|lstatSync|appendFileSync|createWriteStream|createReadStream)\(/g;
const reSpawn = /\b(spawn|spawnSync|execFile|execFileSync|execSync|fork)\(/g;
function roleScores(p, text) {
  const name = p.split('/').pop();
  const fns = fnsByFile.get(p) || [];
  const s = { entry: 0, view: 0, model: 0, io: 0, domain: 0 };
  if (text.startsWith('#!')) s.entry += 5;
  s.entry += Math.min(4, hits(text, /process\.argv/).count * 2) + Math.min(4, hits(text, /process\.exit\(/).count);
  if (/^(bin|scripts)\//.test(p)) s.entry += 4;
  s.view += Math.min(10, Math.floor(hits(text, reTag).count / 4));
  if (/^render|render-/.test(name)) s.view += 4;
  s.model += Math.min(8, fns.filter((f) => /^(validate|assert|schema|normalize|check)[A-Z_]?/i.test(f.name)).length);
  if (/schema|contract|types|validat/.test(name)) s.model += 4;
  s.io += Math.min(10, Math.floor(hits(text, reFs).count / 2)) + Math.min(6, hits(text, reSpawn).count * 2);
  s.domain += Math.min(10, fns.filter((f) => /(layout|route|routing|geometry|compile|parse|measure|place|position|wrap|path)/i.test(f.name)).length);
  return s;
}

// ---------- Concurrency and locks ----------
// "Lock" as its own camel-case word or identifier start, so block/clock/blocked do not count.
const reLockId = /(?:\b[lL]ock[A-Z_]\w*|\b\w*[a-z](?:Lock|LOCK)\w*|\block\b)/g;
const allFns = facts.functions || [];
function enclosing(file, line) {
  return allFns.filter((f) => f.file === file && f.line <= line && (f.endLine ?? f.line) >= line)
    .sort((a, b) => ((a.endLine ?? a.line) - a.line) - ((b.endLine ?? b.line) - b.line))[0] || null;
}
// Top-level functions that take a lock: acquire*Lock, with*Lock, open*Lock, lock*.
const isAcquirer = (f) => !String(f.qualname || '').includes('<locals>') && /^(acquire\w*Lock\w*|with\w*Lock|open\w*Lock|lock[A-Z]\w*)$/.test(f.name);
const acquirerList = allFns.filter((f) => isAcquirer(f) && !/\/test\//.test(f.file));
// Each call of an acquirer: guarded when the calling function has a finally block
// (or the acquirer takes a callback and releases in its own finally).
const lockCalls = acquirerList.map((acq) => {
  const acqSrc = (srcOf.get(acq.file) || '').split('\n');
  const acqBody = acqSrc.slice(acq.line - 1, acq.endLine).join('\n');
  const selfGuarded = /\bfinally\b/.test(acqBody);
  const calls = [];
  for (const [p] of D.files) {
    const lines = (srcOf.get(p) || '').split('\n');
    lines.forEach((l, i) => {
      if (!new RegExp(`\\b${acq.name}\\s*\\(`).test(l) || /function\s/.test(l)) return;
      const fn = enclosing(p, i + 1);
      if (fn && fn.file === acq.file && fn.line === acq.line) return;
      const body = fn ? lines.slice(fn.line - 1, fn.endLine).join('\n') : '';
      calls.push({ file: p, line: i + 1, in: fn ? (fn.qualname || fn.name) : null, inComplexity: fn ? fn.complexity : null,
        holdLines: fn ? (fn.endLine - (i + 1)) : null, guarded: selfGuarded || /\bfinally\b/.test(body) });
    });
  }
  return { name: acq.name, file: acq.file, line: acq.line, endLine: acq.endLine, complexity: acq.complexity, length: acq.endLine - acq.line + 1,
    selfGuarded, exclusiveCreate: /["']wx["']/.test(acqBody), calls };
});
function concurrency(p, text) {
  return {
    acquire: lockCalls.filter((l) => l.file === p),
    exclusiveCreate: hits(text, /["']wx["']/),
    spawn: hits(text, reSpawn),
    parallel: hits(text, /Promise\.(all|allSettled|race|any)\(/),
    timers: hits(text, /\b(setTimeout|setInterval)\(/),
    workers: hits(text, /worker_threads|new Worker\(/),
    awaits: hits(text, /\bawait\b/).count,
  };
}

// ---------- Duplication: windows of normalized lines ----------
const WINDOW = 7;
function normalize(line) {
  return line.replace(/\/\/.*$/, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, 'S').replace(/\b\d+(\.\d+)?\b/g, 'N').replace(/\s+/g, ' ').trim();
}
const norm = new Map();
for (const [p] of D.files) {
  if (isVendor(p)) continue;
  const raw = (srcOf.get(p) || '').split('\n');
  const keep = [];
  raw.forEach((l, i) => { const n = normalize(l); if (n.length >= 6 && !/^(import|export \{|\}|\);?|\]|\{)$/.test(n) && !/^import /.test(n) && !/^[}\])\s;,]+$/.test(n)) keep.push([n, i + 1]); });
  norm.set(p, keep);
}
const windows = new Map();
for (const [p, keep] of norm) for (let i = 0; i + WINDOW <= keep.length; i += 1) {
  const key = keep.slice(i, i + WINDOW).map((x) => x[0]).join('\n');
  if (key.length < 120) continue;
  (windows.get(key) || windows.set(key, []).get(key)).push([p, i]);
}
const covered = new Map();
const pairs = new Map();
for (const occ of windows.values()) {
  if (occ.length < 2 || occ.length > 12) continue;
  for (const [p, i] of occ) { const set = covered.get(p) || covered.set(p, new Set()).get(p); for (let k = i; k < i + WINDOW; k += 1) set.add(norm.get(p)[k][1]); }
  for (let a = 0; a < occ.length; a += 1) for (let b = a + 1; b < occ.length; b += 1) {
    const [pa, ia] = occ[a], [pb, ib] = occ[b];
    if (pa === pb && Math.abs(ia - ib) < WINDOW) continue;
    const key = pa < pb || (pa === pb && ia < ib) ? `${pa}|${pb}` : `${pb}|${pa}`;
    const [x, y] = pa < pb || (pa === pb && ia < ib) ? [ia, ib] : [ib, ia];
    (pairs.get(key) || pairs.set(key, []).get(key)).push([x, y]);
  }
}
const clones = [];
for (const [key, list] of pairs) {
  const [pa, pb] = key.split('|');
  list.sort((u, v) => u[0] - v[0]);
  let run = null;
  const flush = () => {
    if (!run) return;
    const A = norm.get(pa), B = norm.get(pb);
    clones.push({ a: { file: pa, start: A[run[0]][1], end: A[run[2] + WINDOW - 1][1] }, b: { file: pb, start: B[run[1]][1], end: B[run[3] + WINDOW - 1][1] }, lines: run[2] - run[0] + WINDOW });
    run = null;
  };
  for (const [x, y] of list) {
    if (run && x === run[2] + 1 && y === run[3] + 1) { run[2] = x; run[3] = y; } else { flush(); run = [x, y, x, y]; }
  }
  flush();
}
clones.sort((u, v) => v.lines - u.lines);
const cloneList = clones.slice(0, 120).map((c) => ({ ...c, a: { ...c.a, snippet: (srcOf.get(c.a.file) || '').split('\n').slice(c.a.start - 1, Math.min(c.a.end, c.a.start + 13)).join('\n') }, b: { ...c.b, snippet: (srcOf.get(c.b.file) || '').split('\n').slice(c.b.start - 1, Math.min(c.b.end, c.b.start + 13)).join('\n') } }));

// ---------- Per file ----------
const files = D.files.map(([p, module, loc]) => {
  const text = srcOf.get(p) || '';
  const scores = roleScores(p, text);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const strong = ranked.filter(([, v]) => v >= 4).map(([k]) => k);
  const primary = ranked[0][1] >= 3 ? ranked[0][0] : 'shared';
  // A separation problem: I/O or CLI handling in the same file as view, model or domain logic.
  const mixed = strong.length >= 2 && strong.some((r) => r === 'io' || r === 'entry') && strong.some((r) => r === 'view' || r === 'model' || r === 'domain');
  // Softer: layout or compile logic living inside a renderer.
  const blended = !mixed && strong.includes('view') && strong.includes('domain');
  const viewIo = scores.view >= 4 && scores.io >= 4;
  const dupLines = covered.get(p)?.size || 0;
  return {
    path: p, module, loc, vendor: isVendor(p), scores, primary, strong, mixed, blended, viewIo,
    classes: hits(text, /^\s*(?:export\s+)?(?:default\s+)?class\s+\w+/m).count,
    typedefs: hits(text, /@typedef|@interface|@implements|\binterface\s+\w+/).count,
    exportsCount: hits(text, /^export\s+(?:async\s+)?(?:function|const|class|let|default)/m).count,
    generic: /(^|[-_])(util|utils|helpers?|misc|common|stuff|tmp)([-_.]|$)/i.test(p.split('/').pop()),
    evidence: {
      entry: hits(text, /process\.argv|process\.exit\(/, 4).lines,
      io: hits(text, reFs, 4).lines.concat(hits(text, reSpawn, 2).lines).sort((a, b) => a - b).slice(0, 4),
      view: hits(text, reTag, 3).lines,
    },
    lines: Object.fromEntries([...new Set([...hits(text, /process\.argv|process\.exit\(/, 4).lines, ...hits(text, reFs, 4).lines, ...hits(text, reSpawn, 2).lines, ...hits(text, reTag, 3).lines])].map((n) => [n, text.split('\n')[n - 1].trim().slice(0, 140)])),
    dupLines, dupRatio: loc ? dupLines / loc : 0,
    concurrency: concurrency(p, text),
  };
});

// ---------- Abstraction surface between modules ----------
const reached = D.modules.map(() => new Map()); // target module -> Map(file -> Set(consumer modules))
const pairFiles = new Map();
for (const [a, b] of D.edges) {
  const ma = files[a].module, mb = files[b].module;
  if (ma === mb) continue;
  const m = reached[mb]; (m.get(b) || m.set(b, new Set()).get(b)).add(ma);
  const k = `${ma}>${mb}`; (pairFiles.get(k) || pairFiles.set(k, new Set()).get(k)).add(b);
}

// ---------- Per module ----------
const modOut = D.modules.map(() => null);
const out = D.modules.map(() => []);
(D.moduleEdges || []).forEach(([a, b]) => { if (a !== b) out[a].push(b); });
const reachOf = (m) => { const seen = new Set(); const st = [m]; while (st.length) { const x = st.pop(); for (const y of D.modules.map((_, i) => i).filter((i) => out[i].includes(x))) if (!seen.has(y)) { seen.add(y); st.push(y); } } return seen.size; };
const boundaryModules = new Set();
D.findings.filter((f) => f.kind === 'edges').forEach((f) => (f.edges || []).forEach(([x, y]) => { boundaryModules.add(files[x].module); boundaryModules.add(files[y].module); }));

const T = {
  core: { reachShare: 0.25, fanIn: 3 },
  complexity: { watch: 1, problem: 5 },
  coupling: { watch: 3, problem: 4 },
  separation: { watch: 0.01, problem: 0.3 },
  abstraction: { watch: 3, problem: 6 },
  duplication: { watch: 0.03, problem: 0.08 },
  organization: { bigFile: 1500, hugeFile: 3000, roleKinds: 3 },
};
D.modules.forEach((m, i) => {
  const fs = files.filter((f) => f.module === i);
  const src = fs.filter((f) => !f.vendor);
  const loc = fs.reduce((s, f) => s + f.loc, 0);
  const reach = reachOf(i);
  const fanIn = m.fanIn ?? 0, fanOut = m.fanOut ?? 0;
  const warnings = D.findings.filter((f) => f.kind === 'function' && f.severity !== 'info' && D.functions[f.fn] && files[D.functions[f.fn][0]].module === i).length;
  const surfaceFiles = [...reached[i].keys()];
  const consumers = new Set([...reached[i].values()].flatMap((s) => [...s]));
  const hasIndex = fs.some((f) => /\/index\.[cm]?[jt]sx?$/.test(f.path));
  const mixedFiles = src.filter((f) => f.mixed);
  const roleKinds = new Set(src.map((f) => f.primary)).size;
  const dupLines = src.reduce((s, f) => s + f.dupLines, 0);
  const dupRatio = loc ? dupLines / loc : 0;
  const acquire = src.flatMap((f) => f.concurrency.acquire);
  const lockCallsIn = lockCalls.flatMap((l) => l.calls.map((c) => ({ ...c, lock: l.name }))).filter((c) => files.find((f) => f.path === c.file)?.module === i);
  const unguarded = lockCallsIn.filter((c) => !c.guarded);
  const heavyHold = lockCallsIn.filter((c) => (c.inComplexity ?? 0) >= (D.thresholds?.warning?.complexity ?? 25));
  const concurrencyUse = src.reduce((s, f) => s + f.concurrency.spawn.count + f.concurrency.parallel.count + f.concurrency.workers.count + f.concurrency.exclusiveCreate.count, 0);
  const big = src.filter((f) => f.loc > T.organization.bigFile);
  const huge = src.filter((f) => f.loc > T.organization.hugeFile);
  const generic = src.filter((f) => f.generic);
  const vendor = moduleVendor[i];
  const lv = (v, w, p) => (v >= p ? 2 : v >= w ? 1 : 0);
  const dims = vendor ? null : {
    complexity: { level: lv(warnings, T.complexity.watch, T.complexity.problem), value: warnings, unit: `functions past ${D.thresholds?.warning?.complexity ?? 25}` },
    coupling: { level: boundaryModules.has(i) ? 2 : lv(fanOut, T.coupling.watch, T.coupling.problem), value: fanOut, unit: 'modules imported', note: boundaryModules.has(i) ? 'in a boundary finding' : null },
    separation: { level: src.some((f) => f.viewIo) || (src.length && mixedFiles.length / src.length >= T.separation.problem) ? 2 : (mixedFiles.length || src.some((f) => f.blended)) ? 1 : 0, value: mixedFiles.length, unit: `of ${src.length} files mix I/O or CLI with logic`, note: src.filter((f) => f.blended).length ? `${src.filter((f) => f.blended).length} renderer files also hold layout logic` : null },
    abstraction: { level: hasIndex ? Math.min(1, lv(surfaceFiles.length, T.abstraction.watch, T.abstraction.problem)) : lv(surfaceFiles.length, T.abstraction.watch, T.abstraction.problem), value: surfaceFiles.length, unit: 'internal files reached from outside' },
    concurrency: { level: unguarded.length ? 2 : (lockCallsIn.length || acquire.length || concurrencyUse) ? 1 : 0, value: lockCallsIn.length + concurrencyUse, unit: 'lock calls and spawn / parallel / exclusive-create sites', note: unguarded.length ? `${unguarded.length} without a finally release` : heavyHold.length ? `lock held inside ${heavyHold.length} function${heavyHold.length === 1 ? "" : "s"} past complexity ${D.thresholds?.warning?.complexity ?? 25}` : lockCallsIn.length ? `${lockCallsIn.length} lock call${lockCallsIn.length === 1 ? '' : 's'}, all released in finally` : null },
    duplication: { level: lv(dupRatio, T.duplication.watch, T.duplication.problem), value: Math.round(dupRatio * 1000) / 10, unit: '% lines in repeated blocks' },
    organization: { level: (huge.length || roleKinds >= T.organization.roleKinds + 1) ? 2 : (big.length || generic.length || roleKinds >= T.organization.roleKinds) ? 1 : 0, value: roleKinds, unit: 'kinds of role in one module', note: [huge.length && `${huge.length} file over ${T.organization.hugeFile} lines`, big.length && !huge.length && `${big.length} file over ${T.organization.bigFile} lines`, generic.length && `${generic.length} generic name`].filter(Boolean).join(', ') || null },
  };
  const entryish = src.filter((f) => f.primary === 'entry').length * 2 >= src.length;
  const tier = vendor ? 'vendor' : (reach / D.modules.length >= T.core.reachShare || fanIn >= T.core.fanIn) ? 'core' : fanIn === 0 && fanOut === 0 ? 'isolated' : fanIn === 0 ? (entryish ? 'entry' : 'leaf') : 'supporting';
  modOut[i] = {
    tier, vendor, reach, fanIn, fanOut, loc, files: fs.length, warnings,
    surface: surfaceFiles.length, consumers: consumers.size, hasIndex,
    classes: src.reduce((s, f) => s + f.classes, 0), typedefs: src.reduce((s, f) => s + f.typedefs, 0),
    roles: Object.fromEntries(Object.keys(ROLE_RULES).concat('shared').map((r) => [r, src.filter((f) => f.primary === r).length])),
    mixed: mixedFiles.length, roleKinds, dupLines, dupRatio, acquire, unguarded: unguarded.length, concurrencyUse,
    big: big.length, huge: huge.length, generic: generic.length, lockCalls: lockCallsIn, heavyHold: heavyHold.length, blended: src.filter((f) => f.blended).length, dims,
  };
});

const surfaceEdges = [...pairFiles].map(([k, set]) => { const [a, b] = k.split('>').map(Number); return [a, b, [...set]]; });
const signals = {
  generatedFrom: { repository: D.repository, files: D.files.length },
  method: {
    roles: ROLE_RULES,
    mixed: 'A file mixes roles when two or more role scores reach 4.',
    viewIo: 'A view file that also does file-system or process I/O.',
    abstraction: 'Surface = distinct files of a module imported from other modules. A module without index.* whose consumers reach many files has no single entry point.',
    concurrency: 'Lock acquirers are top-level functions named acquire*Lock, with*Lock, open*Lock or lock*. Each call is guarded when the calling function releases in a finally block (or the acquirer releases in its own finally). A lock held inside a function past the warning complexity is listed for review, as are spawn, Promise.all/race, worker and exclusive-create (wx) sites.',
    duplication: `Repeated blocks of ${WINDOW} or more normalized lines (comments and whitespace removed, strings and numbers replaced), outside vendored code.`,
    organization: 'Oversized files, generic file names (util, helpers, misc, common), and modules whose files serve three or more roles.',
    core: `Core = depended on, directly or transitively, by at least ${T.core.reachShare * 100}% of modules, or imported by ${T.core.fanIn}+ modules.`,
  },
  thresholds: T,
  files, modules: modOut, locks: lockCalls, clones: cloneList, cloneCount: clones.length, surfaceEdges,
};
const target = path.join(here, 'signals.js');
writeFileSync(target, `// Generated by build-signals.mjs. Heuristic architecture signals with evidence; see signals.method.\nwindow.ATLAS_SIGNALS = ${JSON.stringify(signals)};\n`);
const tiers = {}; modOut.forEach((m) => { tiers[m.tier] = (tiers[m.tier] || 0) + 1; });
console.log(`wrote signals.js: tiers ${JSON.stringify(tiers)}, ${files.filter((f) => f.mixed).length} mixed files, ${clones.length} clone pairs, ${lockCalls.length} lock acquirers, ${lockCalls.reduce((t, l) => t + l.calls.length, 0)} lock calls`);
