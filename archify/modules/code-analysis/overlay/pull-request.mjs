// PR-specific presentation data, derived from the two native analysis runs.
// Rules, source excerpts, review decisions and AI tasks retain their existing owners.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareArchitectureDrift, checkDriftMapping } from '../lib/architecture-drift.mjs';
import { reviewMarkdown } from './pull-request-markdown.mjs';
import { createTranslator, messagesFor } from './i18n.mjs';
import { buildAtlas } from './atlas.mjs';
import { buildPullRequestImpact } from '../lib/pull-request-impact.mjs';

const count = atlas => ({ files: atlas.files.length, dependencies: atlas.edges.length, functions: atlas.functions.length, modules: atlas.modules.length });
const histogram = atlas => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const fn of atlas.functions) counts[fn[3] === 1 ? 0 : fn[3] < 5 ? 1 : fn[3] < 10 ? 2 : fn[3] < 15 ? 3 : fn[3] < 25 ? 4 : 5]++;
  return counts;
};

const PREVIEW_MAX_FILE = 128 * 1024;
const PREVIEW_MAX_SIDE = 4 * 1024 * 1024;

function changedText(root, manifest, names, known) {
  const byPath = new Map(manifest.files.map(entry => [entry.path, entry.oid]));
  const files = [];
  let remaining = PREVIEW_MAX_SIDE;
  for (const name of new Set(names)) {
    if (!name || known.has(name) || !byPath.has(name)) continue;
    const filename = path.join(root, name);
    const size = fs.lstatSync(filename).size;
    if (size > Math.min(PREVIEW_MAX_FILE, remaining)) continue;
    const bytes = fs.readFileSync(filename);
    if (bytes.length !== size || createHash('sha1').update('blob ' + size + '\0').update(bytes).digest('hex') !== byPath.get(name)) continue;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { continue; }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) continue;
    files.push({ path: name, sourceText: text });
    remaining -= size;
  }
  return files;
}

export function buildPullRequestView({ pr, scope, changedFiles, manifests, sourceRoot, baseSourceRoot = null, sourceGitRoot, facts, graph, findings, ir, map, resolutionInputs, locale, base }) {
  const read = name => JSON.parse(fs.readFileSync(path.join(base, name + '.json'), 'utf8'));
  const baseFacts = read('raw-facts'), baseFindings = read('findings');
  const baseGraph = read('module-graph');
  const before = buildAtlas({ facts: baseFacts, graph: baseGraph, findings: baseFindings.diagnostics });
  const after = buildAtlas({ facts, graph, findings: findings.diagnostics });
  const impact = buildPullRequestImpact({ baseFacts, headFacts: facts, baseGraph, headGraph: graph,
    baseFindings, headFindings: findings, baseRoot: baseSourceRoot, headRoot: sourceRoot, changedFiles });
  const markers = buildMarkerModel(before, after, changedFiles.filter(file => file.status !== 'removed').map(file => file.path),
    impact.records.filter(record => ['function-metrics','definition-text'].includes(record.kind)));
  let componentDrift = null;
  if (pr.local && ir && resolutionInputs) {
    checkDriftMapping(ir, map);
    const capture = (side, facts, graph, resolutionInputs) => ({ facts, graph, resolutionInputs,
      omitted: new Map(manifests[side].skipped.map(entry => [entry.path, entry.mode])) });
    const { components, summary, coverage, edges } = compareArchitectureDrift({
      base: capture('base', baseFacts, baseGraph, new Map(read('resolution-inputs'))),
      head: capture('head', facts, graph, resolutionInputs),
      ir: { ...ir, connections: ir.connections || [] }, map,
      pins: { base: pr.baseSHA, head: pr.headSHA }, locale,
    });
    const tr = createTranslator(messagesFor(locale));
    const states = { 'new-undeclared': 'New in code · undeclared in diagram', 'new-declared': 'New in code · declared in diagram',
      'not-observed-at-head': 'Not observed at head', inconclusive: 'Inconclusive' };
    // Keep evidence coordinates without duplicating source lines in the payload.
    componentDrift = { components, summary, coverage, edges: edges
      .filter(edge => edge.state !== 'previously-observed').map(edge => ({
        from: edge.from, to: edge.to, state: edge.state, label: tr(states[edge.state]), reasons: edge.reasons,
        base: edge.base.locations.map(({ path, line }) => ({ path, line })),
        head: edge.head.locations.map(({ path, line }) => ({ path, line })),
      })) };
  }
  const wanted = new Set([...changedFiles.flatMap(file => [file.path, file.previousPath].filter(Boolean)), ...impact.records.flatMap(record => record.locations.map(item => item.file))]);
  for (const edge of componentDrift?.edges || []) {
    for (const loc of [...edge.base, ...edge.head]) wanted.add(loc.path);
  }
  const selectedBase = baseFacts.files.filter(file => wanted.has(file.path));
  const headSources = pr.local ? changedText(sourceRoot, manifests.head,
    changedFiles.filter(file => file.status !== 'removed').map(file => file.path), new Set(facts.files.map(file => file.path))) : [];
  if (pr.local) selectedBase.push(...changedText(baseSourceRoot, manifests.base,
    changedFiles.filter(file => file.status !== 'added').map(file => file.previousPath || file.path), new Set(selectedBase.map(file => file.path))));
  const beforeSources = Object.fromEntries(selectedBase.map(file => {
    const lines = file.sourceText.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
    return [file.path, { total: lines.length, lines }];
  }));
  const view = {
    number: pr.number, title: pr.title, url: pr.url, repository: pr.repository, scope,
    ...(pr.local ? { local: true, componentDrift, headSources } : {}), simulation: pr.simulation === true, baseSHA: pr.mergeBaseSHA, headSHA: pr.headSHA, targetBaseSHA: pr.baseSHA,
    capturedAt: pr.capturedAt, sourceRoot, baseSourceRoot, sourceGitRoot, changedFiles, impact,
    before: count(before), after: count(after),
    distribution: { labels: ['1', '2–4', '5–9', '10–14', '15–24', '25+'], before: histogram(before), after: histogram(after) },
    changes: markers.records, moduleChanges: markers.modules, ambiguousFunctions: markers.ambiguousFunctions, beforeSources,
    omitted: Object.fromEntries(Object.entries(manifests).map(([side, manifest]) => [side, manifest.skipped])),
  };
  if (pr.local) view.markdown = reviewMarkdown(view, locale);
  return view;
}
export function buildMarkerModel(before,after,changedPaths=[],changedDefinitions=[]){
  const out=[],bf=new Map(before.files.map(f=>[f[0],f])),af=new Map(after.files.map(f=>[f[0],f]));
  const changed=new Set(changedPaths);
  const changedBodies=new Set(changedDefinitions.map(record=>JSON.stringify([record.path,record.name])));
  const entity=(kind,status,key,extra)=>({id:kind+':'+status+':'+JSON.stringify(key),kind,status,...extra});
  for(const p of new Set([...bf.keys(),...af.keys()])){
    const b=bf.get(p),a=af.get(p),status=!b?'added':!a?'removed':changed.has(p)?'modified':null;
    if(status)out.push(entity('file',status,p,{path:p,module:a?after.modules[a[1]].id:before.modules[b[1]].id,before:b?{loc:b[2],module:before.modules[b[1]].id}:null,after:a?{loc:a[2],module:after.modules[a[1]].id}:null}));
  }
  const edgeMap=m=>new Map(m.edges.map(e=>{const paths=[m.files[e[0]][0],m.files[e[1]][0]];return[JSON.stringify(paths),paths];}));
  const be=edgeMap(before),ae=edgeMap(after);
  for(const key of new Set([...be.keys(),...ae.keys()])){
    if(be.has(key)&&ae.has(key))continue;
    const [from,to]=ae.get(key)||be.get(key);
    out.push(entity('edge',ae.has(key)?'added':'removed',[from,to],{from,to,before:be.has(key),after:ae.has(key)}));
  }
  const functionMap=m=>{
    const map=new Map();
    for(const f of m.functions){
      const path=m.files[f[0]][0],name=f[1],key=JSON.stringify([path,name]);
      const record={path,name,module:m.modules[m.files[f[0]][1]].id,line:f[2],complexity:f[3],nesting:f[4],length:f[5],severity:f[6]>=0?m.findings[f[6]]?.severity:null};
      map.set(key,(map.get(key)||[]).concat([record]));
    }return map;
  };
  const bfn=functionMap(before),afn=functionMap(after);let ambiguous=0;
  for(const key of new Set([...bfn.keys(),...afn.keys()])){
    const bs=bfn.get(key)||[],as=afn.get(key)||[];
    if(bs.length>1||as.length>1){ambiguous++;continue;}
    const b=bs[0]||null,a=as[0]||null,r=a||b;
    const status=!b?'added':!a?'removed':b.complexity!==a.complexity||b.nesting!==a.nesting||changedBodies.has(key)?'modified':null;
    if(status)out.push(entity('function',status,[r.path,r.name],{path:r.path,name:r.name,module:r.module,before:b,after:a}));
  }
  out.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const modules=new Map();
  for(const record of out) {
    if(!record.module) continue;
    if(!modules.has(record.module)) modules.set(record.module,{id:record.module,files:{added:0,removed:0,modified:0},functions:{added:0,removed:0,modified:0}});
    modules.get(record.module)[record.kind==='file'?'files':'functions'][record.status]++;
  }
  return {records:out,modules:[...modules.values()],ambiguousFunctions:ambiguous};
}
