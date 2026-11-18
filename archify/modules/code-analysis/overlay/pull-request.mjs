// PR-specific presentation data, derived from the two native analysis runs.
// Rules, source excerpts, review decisions and AI tasks retain their existing owners.
import fs from 'node:fs';
import path from 'node:path';
import { buildAtlas } from './atlas.mjs';
import { buildPullRequestImpact } from '../lib/pull-request-impact.mjs';
import { locationsOf } from '../lib/task.mjs';
import { prFileCounts } from '../lib/review-pack.mjs';

const count = atlas => ({ files: atlas.files.length, dependencies: atlas.edges.length, functions: atlas.functions.length, modules: atlas.modules.length });
const histogram = atlas => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const fn of atlas.functions) counts[fn[3] === 1 ? 0 : fn[3] < 5 ? 1 : fn[3] < 10 ? 2 : fn[3] < 15 ? 3 : fn[3] < 25 ? 4 : 5]++;
  return counts;
};

export function buildPullRequestView({ pr, scope, changedFiles, manifests, sourceRoot, baseSourceRoot = null, sourceGitRoot, facts, graph, findings, base, reviewPack = null }) {
  const read = name => JSON.parse(fs.readFileSync(path.join(base, name + '.json'), 'utf8'));
  const baseFacts = read('raw-facts'), baseFindings = read('findings');
  const baseGraph = read('module-graph');
  const before = buildAtlas({ facts: baseFacts, graph: baseGraph, findings: baseFindings.diagnostics });
  const after = buildAtlas({ facts, graph, findings: findings.diagnostics });
  const impact = buildPullRequestImpact({ baseFacts, headFacts: facts, baseGraph, headGraph: graph,
    baseFindings, headFindings: findings, baseRoot: baseSourceRoot, headRoot: sourceRoot, changedFiles });
  const markers = buildMarkerModel(before, after, changedFiles.filter(file => file.status !== 'removed').map(file => file.path),
    impact.records.filter(record => ['function-metrics','definition-text'].includes(record.kind)));
  const cycles = observedCycles(baseFindings.diagnostics, findings.diagnostics, impact.comparison);
  const evidencePaths = [...impact.records, ...cycles.records].flatMap(record => record.locations.map(item => item.file));
  const wanted = new Set([...changedFiles.flatMap(file => [file.path, file.previousPath].filter(Boolean)), ...evidencePaths]);
  const baseOwners = Object.fromEntries(before.files.filter(([file]) => wanted.has(file))
    .map(([file, module]) => [file, before.modules[module].id]));
  const oldIds = new Set(Object.values(baseOwners));
  const oldModules = before.modules.filter(module => oldIds.has(module.id)).map(({ id, label }) => [id, label]);
  const beforeSources = Object.fromEntries(baseFacts.files.filter(file => wanted.has(file.path) && typeof file.sourceText === 'string').map(file => {
    const lines = file.sourceText.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
    return [file.path, { total: lines.length, lines }];
  }));
  return {
    number: pr.number, title: pr.title, url: pr.url, repository: pr.repository, scope,
    simulation: pr.simulation === true, baseSHA: pr.mergeBaseSHA, headSHA: pr.headSHA, targetBaseSHA: pr.baseSHA,
    capturedAt: pr.capturedAt, sourceRoot, baseSourceRoot, sourceGitRoot, changedFiles, impact, cycles, baseOwners, oldModules,
    gitFiles: prFileCounts(pr.changedFiles || changedFiles), ...(reviewPack ? { reviewPack } : {}),
    before: count(before), after: count(after),
    distribution: { labels: ['1', '2–4', '5–9', '10–14', '15–24', '25+'], before: histogram(before), after: histogram(after) },
    changes: markers.records, moduleChanges: markers.modules, ambiguousFunctions: markers.ambiguousFunctions, beforeSources,
    omitted: Object.fromEntries(Object.entries(manifests).map(([side, manifest]) => [side, manifest.skipped])),
  };
}
// Use native finding identity and its own evidence, with the same comparison
// gate as the upstream PR impact report. A disappearance is not a repair.
export function observedCycles(base, head, comparison) {
  if (comparison?.comparable !== true) return { records: [], omitted: 0 };
  const cycles = f => !f.external && (f.code === 'coupling/cycle' || f.code === 'coupling/import-cycle');
  const before = new Map(base.filter(cycles).map(f => [f.id, f]));
  const after = new Map(head.filter(cycles).map(f => [f.id, f]));
  const records = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id), b = after.get(id), f = b || a;
    const status = a && b ? 'existing' : b ? 'detected' : 'not-detected';
    const locations = locationsOf(f).slice(0, 5).map(loc => ({ file: loc.file, line: loc.startLine ?? null, side: b ? 'head' : 'base' }));
    records.push({ id, status, code: f.code, modules: f.subject?.modules || [],
      paths: [...new Set([...(f.subject?.files || []), ...locations.map(loc => loc.file)])], locations });
  }
  records.sort((a, b) => Number(a.status === 'existing') - Number(b.status === 'existing') || a.id.localeCompare(b.id));
  return { records: records.slice(0, 40), omitted: Math.max(0, records.length - 40) };
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
