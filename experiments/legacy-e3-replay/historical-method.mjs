// Adapted from recovered E3 replay.mjs, stats.mjs and anchors.mjs (September 9, 2026).
// Source hashes and exact Git input versions are recorded in provenance.json.
// Historical matcher, destination-only rename classification, manual edit schedule,
// positional anchor selection and per-anchor event counts intentionally remain unchanged.
// This module is an experiment; do not import the current Locate classifier here.

// ---- glob -> regex (**, *, ?, {a,b}); * does not cross '/'
export function globToRegex(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // '**' : zero or more segments
        let j = i + 2;
        if (glob[j] === '/') {
          re += '(?:[^/]+/)*';
          i = j + 1;
        } else {
          re += '.*';
          i = j;
        }
        continue;
      }
      re += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '{') {
      const end = glob.indexOf('}', i);
      const alts = glob.slice(i + 1, end).split(',');
      re += '(?:' + alts.map((a) => a.replace(/[.+^$|()[\]\\]/g, '\\$&')).join('|') + ')';
      i = end + 1;
      continue;
    }
    if ('.+^$|()[]\\'.includes(c)) { re += '\\' + c; i++; continue; }
    re += c;
    i++;
  }
  return new RegExp('^' + re + '$');
}

export class Map0 {
  constructor(json) {
    this.base = json.base;
    this.components = {};
    for (const [id, def] of Object.entries(json.components)) {
      this.components[id] = { globs: [...def.globs] };
    }
    this.excluded = [...json.excluded];
    this.recompile();
  }
  recompile() {
    this.compiled = Object.entries(this.components).map(([id, d]) => ({
      id,
      res: d.globs.map(globToRegex),
    }));
    this.exRes = this.excluded.map(globToRegex);
  }
  classify(path) {
    if (this.exRes.some((r) => r.test(path))) return { state: 'excluded' };
    const owners = this.compiled.filter((c) => c.res.some((r) => r.test(path))).map((c) => c.id);
    if (owners.length === 1) return { state: 'covered', component: owners[0] };
    if (owners.length === 0) return { state: 'uncovered' };
    return { state: 'ambiguous', owners };
  }
  addGlob(componentId, glob) {
    if (!this.components[componentId]) this.components[componentId] = { globs: [] };
    this.components[componentId].globs.push(glob);
    this.recompile();
  }
  addExcluded(glob) {
    this.excluded.push(glob);
    this.recompile();
  }
  toJSON() {
    return { base: this.base, components: this.components, excluded: this.excluded };
  }
}

export function replay({ git, BASE, HEAD, mapInput, edits }) {
// ---- commit list
const shas = git(['rev-list', '--reverse', '--first-parent', `${BASE}..${HEAD}`]).trim().split('\n');
const allCount = Number(git(['rev-list', '--count', `${BASE}..${HEAD}`]).trim());

function changedPaths(sha) {
  // -M rename detection; against first parent
  const out = git(['diff', '--name-status', '-M', '-z', `${sha}^`, sha]);
  const tok = out.split('\0').filter((t) => t !== '');
  const res = [];
  for (let i = 0; i < tok.length; ) {
    const st = tok[i];
    if (st[0] === 'R' || st[0] === 'C') {
      res.push({ status: st, path: tok[i + 2], from: tok[i + 1] });
      i += 3;
    } else {
      res.push({ status: st, path: tok[i + 1] });
      i += 2;
    }
  }
  return res;
}

// ---- edits schedule (sha -> [{action, component, glob, why}])
const EDITS = edits;

const map = new Map0(mapInput);

// sanity: every tracked file at BASE resolves
const baseFiles = git(['ls-tree', '-r', '--name-only', BASE]).trim().split('\n');
const baseAudit = { excluded: 0, covered: 0, uncovered: [], ambiguous: [] };
for (const f of baseFiles) {
  const c = map.classify(f);
  if (c.state === 'excluded') baseAudit.excluded++;
  else if (c.state === 'covered') baseAudit.covered++;
  else if (c.state === 'uncovered') baseAudit.uncovered.push(f);
  else baseAudit.ambiguous.push({ f, owners: c.owners });
}

const trace = [];
for (const sha of shas) {
  const subject = git(['log', '-1', '--format=%s', sha]).trim();
  const parents = git(['log', '-1', '--format=%P', sha]).trim().split(' ');
  const files = changedPaths(sha);
  const classifyAll = () => {
    const counts = { excluded: 0, covered: 0, uncovered: 0, ambiguous: 0 };
    const uncovered = [], ambiguous = [], comps = new Set();
    for (const f of files) {
      const c = map.classify(f.path);
      counts[c.state]++;
      if (c.state === 'uncovered') uncovered.push(f.path);
      else if (c.state === 'ambiguous') ambiguous.push({ path: f.path, owners: c.owners });
      else if (c.state === 'covered') comps.add(c.component);
    }
    return { counts, uncovered, ambiguous, components: [...comps].sort() };
  };
  const before = classifyAll();
  const requiresEdit = before.uncovered.length > 0 || before.ambiguous.length > 0;
  const applied = [];
  if (requiresEdit && EDITS[sha]) {
    for (const e of EDITS[sha]) {
      if (e.action === 'exclude') map.addExcluded(e.glob);
      else map.addGlob(e.component, e.glob);
      applied.push(e);
    }
  }
  const after = requiresEdit ? classifyAll() : before;
  trace.push({
    sha,
    short: sha.slice(0, 7),
    subject,
    isMerge: parents.length > 1,
    changedFiles: files.length,
    before: before.counts,
    componentsTouched: after.components,
    uncoveredBefore: before.uncovered,
    ambiguousBefore: before.ambiguous,
    requiresMapEdit: requiresEdit,
    editsApplied: applied,
    after: after.counts,
    uncoveredAfter: after.uncovered,
    ambiguousAfter: after.ambiguous,
  });
}

const out = {
  base: BASE,
  head: HEAD,
  firstParentCommits: shas.length,
  allCommitsInRange: allCount,
  baseAudit,
  trace,
};
// ---- summary
const needEdit = trace.filter((t) => t.requiresMapEdit);
const residual = trace.filter((t) => t.uncoveredAfter.length || t.ambiguousAfter.length);
const dist = {};
for (const t of trace) {
  const n = t.componentsTouched.length;
  dist[n] = (dist[n] || 0) + 1;
}
const onlyViewer = trace.filter((t) => t.componentsTouched.length === 1 && t.componentsTouched[0] === 'viewer');
const touchViewer = trace.filter((t) => t.componentsTouched.includes('viewer'));
const summary = {
  firstParent: shas.length,
  allCommits: allCount,
  merges: trace.filter((t) => t.isMerge).length,
  baseUncovered: baseAudit.uncovered,
  baseAmbiguous: baseAudit.ambiguous,
  baseCovered: baseAudit.covered,
  baseExcluded: baseAudit.excluded,
  commitsRequiringEdit: needEdit.length,
  pctRequiringEdit: +(100 * needEdit.length / shas.length).toFixed(1),
  residualAfterEdits: residual.length,
  componentsTouchedDist: dist,
  singleComponentPct: +(100 * (dist[1] || 0) / shas.length).toFixed(1),
  zeroComponentPct: +(100 * (dist[0] || 0) / shas.length).toFixed(1),
  viewerOnly: onlyViewer.length,
  touchViewer: touchViewer.length,
  totalEdits: needEdit.reduce((a, t) => a + t.editsApplied.length, 0),
};

return { replay: out, map: map.toJSON(), summary };
}

export function stats({ git, HEAD, map, replay }) {
const m = map;
const ex = m.excluded.map(globToRegex);
const comps = Object.entries(m.components).map(([id, d]) => ({ id, res: d.globs.map(globToRegex) }));
const files = git(['ls-tree', '-r', '--name-only', HEAD]).trim().split('\n');
const audit = { total: files.length, excluded: 0, covered: 0, uncovered: [], ambiguous: [], perComponent: {} };
for (const f of files) {
  if (ex.some(r => r.test(f))) { audit.excluded++; continue; }
  const o = comps.filter(c => c.res.some(r => r.test(f))).map(c => c.id);
  if (o.length === 1) { audit.covered++; audit.perComponent[o[0]] = (audit.perComponent[o[0]] || 0) + 1; }
  else if (o.length === 0) audit.uncovered.push(f);
  else audit.ambiguous.push({ f, owners: o });
}

const rep = replay;
const t = rep.trace;
const n = t.length;
const compFreq = {};
for (const c of t) for (const id of c.componentsTouched) compFreq[id] = (compFreq[id] || 0) + 1;
const dist = {};
for (const c of t) dist[c.componentsTouched.length] = (dist[c.componentsTouched.length] || 0) + 1;
const single = t.filter(c => c.componentsTouched.length === 1);
const singleByComp = {};
for (const c of single) singleByComp[c.componentsTouched[0]] = (singleByComp[c.componentsTouched[0]] || 0) + 1;
const ncomp = t.map(c => c.componentsTouched.length).sort((a, b) => a - b);
const median = ncomp[Math.floor(n / 2)];
return {
  headAudit: audit,
  commits: n,
  componentsTouchedDist: dist,
  medianComponentsTouched: median,
  meanComponentsTouched: +(ncomp.reduce((a, b) => a + b, 0) / n).toFixed(2),
  singleComponentCommits: single.length,
  singleComponentBreakdown: singleByComp,
  commitsTouchingComponent: Object.fromEntries(Object.entries(compFreq).sort((a, b) => b[1] - a[1])),
  viewerOnly: single.filter(c => c.componentsTouched[0] === 'viewer').length,
  viewerTouching: t.filter(c => c.componentsTouched.includes('viewer')).length,
  zeroComponent: t.filter(c => c.componentsTouched.length === 0).map(c => c.short + ' ' + c.subject),
  ge3: t.filter(c => c.componentsTouched.length >= 3).length,
  mergeCommits: t.filter(c => c.isMerge).length,
  mergesRequiringEdit: t.filter(c => c.isMerge && c.requiresMapEdit).length,
};

}

// 1-3 representative anchor files per component (as they exist at BASE)
const FILES = {
  cli: ['archify/bin/archify.mjs', 'archify/bin/preview.mjs'],
  'renderers-shared': ['archify/renderers/shared/validator.mjs', 'archify/renderers/shared/geometry.mjs', 'archify/renderers/shared/cli.mjs'],
  'renderer-architecture': ['archify/renderers/architecture/render-architecture.mjs', 'archify/renderers/architecture/grid.mjs'],
  'renderer-workflow': ['archify/renderers/workflow/render-workflow.mjs'],
  'renderer-sequence': ['archify/renderers/sequence/render-sequence.mjs'],
  'renderer-dataflow': ['archify/renderers/dataflow/render-dataflow.mjs'],
  'renderer-lifecycle': ['archify/renderers/lifecycle/render-lifecycle.mjs'],
  delta: ['archify/delta/architecture-delta.mjs'],
  schemas: ['archify/schemas/architecture.schema.json', 'archify/schemas/common.schema.json'],
  viewer: ['archify/assets/template.html'],
  'build-scripts': ['archify/scripts/render-examples.mjs', 'scripts/build-gallery.mjs'],
  tests: ['archify/test/architecture-render.test.mjs'],
  references: ['archify/SKILL.md', 'archify/recipes/scenarios.mjs'],
  examples: ['archify/examples/web-app.architecture.json'],
  'docs-site': ['docs/article-archify.md'],
};


export function anchorDecay({ git, show, BASE, HEAD, selection }) {
const DECL = /^\s*(export\s+)?(async\s+)?(function|class|const|let)\s+[A-Za-z_$]/;
function pickAnchors(path, want = 3) {
  const src = show(BASE, path);
  if (src === null) return [];
  const lines = src.split('\n');
  const cand = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (path.endsWith('.mjs') || path.endsWith('.js')) { if (DECL.test(l)) cand.push(i + 1); }
    else if (path.endsWith('.json')) { if (/^\s{2}"[A-Za-z_]+":/.test(l)) cand.push(i + 1); }
    else if (path.endsWith('.md')) { if (/^#{1,3}\s/.test(l)) cand.push(i + 1); }
    else if (path.endsWith('.html')) { if (/^\s*(function|const|<script|<style|:root)/.test(l)) cand.push(i + 1); }
  }
  if (!cand.length) return [];
  const out = [];
  const step = Math.max(1, Math.floor(cand.length / want));
  for (let k = 0; k < want && k * step < cand.length; k++) out.push(cand[k * step]);
  return out.map((ln) => ({ path, line: ln, text: lines[ln - 1] }));
}

// A published selection is a separate recovered input, never a silent FILES edit.
const anchors = selection ? selection.map(({ component, path, line }) => {
  const src = show(BASE, path);
  if (src === null || !Number.isInteger(line) || line < 1 || src.split('\n')[line - 1] === undefined) {
    throw new Error(`Published anchor cannot be read at BASE: ${path}:${line}`);
  }
  return { component, path, line, text: src.split('\n')[line - 1] };
}) : [];
if (!selection) for (const [comp, files] of Object.entries(FILES)) {
  for (const f of files) for (const a of pickAnchors(f, 3)) anchors.push({ component: comp, ...a });
}

const shas = git(['rev-list', '--reverse', '--first-parent', `${BASE}..${HEAD}`]).trim().split('\n');
const idx = new Map(shas.map((s, i) => [s, i]));

// commits (first-parent) touching each anchor path
const touching = new Map();
for (const p of new Set(anchors.map((a) => a.path))) {
  const out = git(['rev-list', '--first-parent', `${BASE}..${HEAD}`, '--', p]).trim();
  touching.set(p, new Set(out ? out.split('\n') : []));
}

// state per anchor
const state = anchors.map((a) => ({ ...a, valid: true, invalidatedAt: null, reason: null, fileChangedCommits: 0 }));
const perCommit = [];
for (const sha of shas) {
  const events = [];
  let fileChanges = 0;
  for (const st of state) {
    if (!touching.get(st.path).has(sha)) continue;
    fileChanges++;
    st.fileChangedCommits++;
    if (!st.valid) continue;
    const src = show(sha, st.path);
    if (src === null) { st.valid = false; st.invalidatedAt = sha; st.reason = 'file removed/renamed'; events.push({ ...st }); continue; }
    const lines = src.split('\n');
    const now = lines[st.line - 1];
    if (now !== st.text) {
      st.valid = false; st.invalidatedAt = sha; st.reason = now === undefined ? 'file shorter than pinned line' : 'pinned line content changed';
      events.push({ path: st.path, line: st.line, component: st.component, reason: st.reason });
    }
  }
  perCommit.push({ sha: sha.slice(0, 7), anchorFilesTouched: fileChanges, invalidated: events.length, events });
}

// final validity at HEAD (re-verify directly)
let validAtHead = 0;
const headDetail = [];
for (const st of state) {
  const src = show(HEAD, st.path);
  const ok = src !== null && src.split('\n')[st.line - 1] === st.text;
  if (ok) validAtHead++;
  headDetail.push({ component: st.component, path: st.path, line: st.line, validAtHead: ok, firstInvalidatedAt: st.invalidatedAt ? st.invalidatedAt.slice(0, 7) : null, reason: st.reason, fileChangedInNCommits: st.fileChangedCommits });
}

const commitsWithInvalidation = perCommit.filter((c) => c.invalidated > 0).length;
const commitsTouchingAnyAnchorFile = perCommit.filter((c) => c.anchorFilesTouched > 0).length;
const summary = {
  anchors: anchors.length,
  anchorFiles: new Set(anchors.map((a) => a.path)).size,
  firstParentCommits: shas.length,
  commitsInvalidatingAtLeastOneAnchor: commitsWithInvalidation,
  pctCommitsInvalidating: +(100 * commitsWithInvalidation / shas.length).toFixed(1),
  commitsTouchingAnyAnchorFile,
  pctCommitsTouchingAnchorFile: +(100 * commitsTouchingAnyAnchorFile / shas.length).toFixed(1),
  anchorsValidAtHead: validAtHead,
  pctAnchorsValidAtHead: +(100 * validAtHead / anchors.length).toFixed(1),
  anchorsInvalidatedByComponent: headDetail.filter(d => !d.validAtHead).reduce((m, d) => (m[d.component] = (m[d.component] || 0) + 1, m), {}),
  anchorsTotalByComponent: headDetail.reduce((m, d) => (m[d.component] = (m[d.component] || 0) + 1, m), {}),
};
return { summary, anchors: headDetail, perCommit };
}
