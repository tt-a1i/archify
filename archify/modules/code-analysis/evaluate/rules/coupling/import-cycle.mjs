// File-level dependency cycles, with conservative load-time risk estimates.
// Type-only edges are structural facts, not runtime imports. Deferred and
// conditional execution is not modeled as safe: callers may run at import
// time. Module-scope cycles warn; binding line order supplies an inspectable
// partial-initialization candidate, never an execution proof.
// Test and generated files follow the module graph's exclusion policy.
export const code = 'coupling/import-cycle';
export const dimension = 'coupling';
export const severity = 'warning';
export const confidence = 0.7;

/** Canonicalize ties before choosing candidates or truncating evidence. */
const canonical = (v) => JSON.stringify(Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.keys(v).sort().map((key) => [key, canonical(v[key])]) : v);
const compareImport = (a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0;

export function run({ graph, facts }) {
  if (!facts) return [];
  const excluded = new Set(graph.excluded.roles || []);
  const skip = new Set(facts.files.filter((f) => excluded.has(f.role)).map((f) => f.path));
  const edges = facts.imports.filter((i) => i.resolved && !i.typeOnly && !skip.has(i.from) && !skip.has(i.to)).map((e) => ({ ...e, ...(e.names ? { names: [...e.names].sort() } : {}) })).sort(compareImport);
  const files = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort();
  const all = tarjan(files, edges);
  const eagerEdges = edges.filter((e) => !e.lazy && !e.conditional && !(facts.repository.language === 'ts' && e.kind === 'dynamic'));
  const eager = tarjan(files, eagerEdges);
  const eagerKeys = new Set(eager.map((s) => s.join('\n')));
  const bindings = indexBindings(facts.symbols || []);

  const findings = [];
  const seen = new Set();
  const emit = (scc, isEager) => {
    const key = scc.join('\n');
    if (seen.has(key)) return;
    seen.add(key);
    const set = new Set(scc);
    const internal = (isEager ? eagerEdges : edges).filter((e) => set.has(e.from) && set.has(e.to));
    const path = shortestCycle(scc[0], internal, set);
    const candidate = isEager ? findPartialInitCandidate(set, internal, bindings) : null;
    const tier = isEager ? 'warning' : 'info';
    const cycleText = `${path.join(' → ')} → ${path[0]}`;
    findings.push({
      code, dimension, confidence,
      severity: tier,
      message: candidate
        ? `${scc.length} files form a module-scope import cycle with a possible partial-initialization read: ${candidate.importer}:${candidate.line} imports ${candidate.name} from ${candidate.entry}, whose recorded binding is at line ${candidate.boundAt}, after its line-${candidate.viaLine} import. Inspect the candidate load order starting with ${candidate.entry}; static line ordering alone does not prove failure.`
        : isEager
          ? `${scc.length} files form a module-scope import cycle: ${cycleText}. Load-time behavior is not verified; accesses to partially initialized modules may depend on import order.`
          : `${scc.length} files form a dependency cycle containing deferred or conditional imports: ${cycleText}. Initialization-time behavior is not proven: functions can be called during import, and dynamic imports or guards need execution context. Any module-scope subcycles are reported separately.`,
      subject: { files: scc },
      evidence: {
        kind: isEager ? 'eager' : 'deferred',
        risk: {
          loading: candidate ? 'potential-partial-init' : isEager ? 'potential-at-import' : 'not-proven',
          coupling: 'present',
          loadingNote: candidate
            ? `inspect the candidate order starting with ${candidate.entry}; failure is not proven`
            : isEager
              ? 'module-scope dependency cycle; execution and attribute reads are not fully modeled'
              : 'call timing and conditional execution are not modeled; no import-safety guarantee',
        },
        path,
        pathImports: path.map((from, i) => {
          const to = path[(i + 1) % path.length];
          const options = internal.filter((e) => e.from === from && e.to === to);
          const edge = options.find((e) => eagerEdges.includes(e)) || options[0];
          return { file: from, to, line: edge.line, deferred: !eagerEdges.includes(edge) };
        }),
        imports: internal.map((e) => ({ file: e.from, line: e.line, to: e.to, ...(e.names && e.names.length ? { names: e.names } : {}), ...Object.fromEntries(['lazy', 'conditional', 'implicit'].filter((flag) => e[flag]).map((flag) => [flag, true])), kind: e.kind, ...(facts.repository.language === 'ts' && e.kind === 'dynamic' ? { deferred: true } : {}) })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || compareImport(a, b))).slice(0, 16),
        lazyImports: internal.filter((e) => e.lazy).length,
        totalImports: internal.length,
        ...(candidate ? { partialInitCandidate: candidate } : {}),
        threshold: null,
      },
      supportedFixes: candidate
        ? [`verify the load order and binding of \`${candidate.name}\` in ${candidate.entry} before changing code`, 'move shared definitions into a module both sides import if the cycle is unintended', 'pass the dependency in as a parameter instead of importing it']
        : isEager
          ? ['prefer `import module` + attribute access at call time over `from module import name` inside the cycle', 'move the shared definitions into a new module both sides import', 'turn one direction into a function-scope import if the dependency is only needed at call time']
          : ['keep the lazy import if the call-back is intentional, and say so in a comment at the import', 'if the two sides should be testable in isolation, inject the callee (a callback or protocol) from the composition root instead of importing it'],
    });
  };
  for (const scc of all) emit(scc, eagerKeys.has(scc.join('\n')));
  // Eager sub-cycles that are strict subsets of a lazy-closed SCC are their own, sharper fact.
  for (const scc of eager) emit(scc, true);
  const rank = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.subject.files[0] < b.subject.files[0] ? -1 : a.subject.files[0] > b.subject.files[0] ? 1 : 0));
}

// file -> Map(name -> line where it is first bound at module scope)
function indexBindings(symbols) {
  const byFile = new Map();
  for (const s of symbols) {
    if (!byFile.has(s.file)) byFile.set(s.file, new Map());
    const m = byFile.get(s.file);
    if (!m.has(s.name) || m.get(s.name) > s.line) m.set(s.name, s.line);
  }
  return byFile;
}

// Candidate search. For every module-scope `from A import X` (importer B, explicit name X
// bound in A at line boundAt): is there an eager path A → … → B whose first
// hop leaves A at a line before boundAt? If so, importing A first executes A
// up to that hop, which (transitively) runs B, which asks the half-built A
// for X before it exists under this assumed path. Returns the first candidate.
// Branches, callbacks, earlier import caches and dynamic bindings can change
// execution, so this graph search cannot establish a guaranteed failure.
function findPartialInitCandidate(set, internal, bindings) {
  const out = new Map();
  for (const e of internal) (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e);
  for (const list of out.values()) list.sort((a, b) => a.line - b.line || (a.to < b.to ? -1 : 1));
  const sorted = [...internal].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line));
  for (const e of sorted) {
    if (!e.names || !e.names.length || e.names[0] === '*') continue;
    const bound = bindings.get(e.to);
    if (!bound) continue;
    for (const name of e.names) {
      const boundAt = bound.get(name);
      if (boundAt === undefined) continue; // not a module-scope binding we know (submodule, __getattr__, star import)
      const hit = reaches(e.to, e.from, out, set, boundAt);
      if (hit) return { entry: e.to, module: e.specifier, name, boundAt, viaLine: hit.viaLine, importer: e.from, line: e.line, chain: hit.chain };
    }
  }
  return null;
}

// BFS from `start` to `target` through eager edges inside the SCC; the first
// hop out of `start` must sit above `beforeLine`. Returns the chain of files.
function reaches(start, target, out, set, beforeLine) {
  for (const first of out.get(start) || []) {
    if (first.line >= beforeLine) continue;
    if (first.to === start) {
      if (target === start) return { viaLine: first.line, chain: [start, start] };
      continue;
    }
    // `start` is already in sys.modules (half-built); re-importing it returns at once, so never walk through it again.
    const prev = new Map([[start, null], [first.to, start]]);
    const queue = [first.to];
    while (queue.length) {
      const v = queue.shift();
      if (v === target) {
        const chain = [v]; let p = prev.get(v);
        while (p !== null) { chain.unshift(p); p = prev.get(p); }
        return { viaLine: first.line, chain };
      }
      for (const e of out.get(v) || []) if (set.has(e.to) && !prev.has(e.to)) { prev.set(e.to, v); queue.push(e.to); }
    }
  }
  return null;
}

/** Return cyclic strongly connected components, including singleton self-imports. */
function tarjan(nodes, edges) {
  const out = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) out.get(e.from).push(e.to);
  for (const list of out.values()) list.sort();
  let index = 0;
  const idx = new Map(); const low = new Map(); const onStack = new Set(); const stack = [];
  const sccs = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index += 1; stack.push(v); onStack.add(v);
    for (const w of out.get(v)) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const scc = []; let w;
      do { w = stack.pop(); onStack.delete(w); scc.push(w); } while (w !== v);
      if (scc.length > 1 || out.get(v).includes(v)) sccs.push(scc.sort());
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return sccs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function shortestCycle(start, edges, set) {
  const out = new Map();
  for (const e of edges) (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e.to);
  for (const list of out.values()) list.sort();
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const v = queue.shift();
    for (const w of out.get(v) || []) {
      if (!set.has(w)) continue;
      if (w === start) { const path = [v]; let p = prev.get(v); while (p !== null) { path.unshift(p); p = prev.get(p); } return path; }
      if (!prev.has(w)) { prev.set(w, v); queue.push(w); }
    }
  }
  return [start];
}
