// PR-specific presentation data, derived from the two native analysis runs.
// Rules, source excerpts, review decisions and AI tasks retain their existing owners.
import fs from 'node:fs';
import path from 'node:path';
import { buildAtlas } from './atlas.mjs';
import { buildPullRequestImpact } from '../lib/pull-request-impact.mjs';

const count = atlas => ({ files: atlas.files.length, dependencies: atlas.edges.length, functions: atlas.functions.length, modules: atlas.modules.length });
const histogram = atlas => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const fn of atlas.functions) counts[fn[3] === 1 ? 0 : fn[3] < 5 ? 1 : fn[3] < 10 ? 2 : fn[3] < 15 ? 3 : fn[3] < 25 ? 4 : 5]++;
  return counts;
};

export function buildPullRequestView({ pr, scope, changedFiles, manifests, sourceRoot, baseSourceRoot = null, sourceGitRoot, facts, graph, findings, base }) {
  const read = name => JSON.parse(fs.readFileSync(path.join(base, name + '.json'), 'utf8'));
  const baseFacts = read('raw-facts'), baseFindings = read('findings');
  const baseGraph = read('module-graph');
  const before = buildAtlas({ facts: baseFacts, graph: baseGraph, findings: baseFindings.diagnostics });
  const after = buildAtlas({ facts, graph, findings: findings.diagnostics });
  const markers = buildMarkerModel(before, after, changedFiles.filter(file => file.status !== 'removed').map(file => file.path));
  const impact = buildPullRequestImpact({ baseFacts, headFacts: facts, baseGraph, headGraph: graph,
    baseFindings, headFindings: findings, baseRoot: baseSourceRoot, headRoot: sourceRoot, changedFiles });
  const wanted = new Set([...changedFiles.flatMap(file => [file.path, file.previousPath].filter(Boolean)), ...impact.records.flatMap(record => record.locations.map(item => item.file))]);
  const beforeSources = Object.fromEntries(baseFacts.files.filter(file => wanted.has(file.path)).map(file => {
    const lines = file.sourceText.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
    return [file.path, { total: lines.length, lines }];
  }));
  return {
    number: pr.number, title: pr.title, url: pr.url, repository: pr.repository, scope,
    simulation: pr.simulation === true, baseSHA: pr.mergeBaseSHA, headSHA: pr.headSHA, targetBaseSHA: pr.baseSHA,
    capturedAt: pr.capturedAt, sourceRoot, baseSourceRoot, sourceGitRoot, changedFiles, impact,
    before: count(before), after: count(after),
    distribution: { labels: ['1', '2–4', '5–9', '10–14', '15–24', '25+'], before: histogram(before), after: histogram(after) },
    changes: markers.records, ambiguousFunctions: markers.ambiguousFunctions, beforeSources,
    omitted: Object.fromEntries(Object.entries(manifests).map(([side, manifest]) => [side, manifest.skipped])),
  };
}
export function buildMarkerModel(before,after,changedPaths=[]){
  const out=[],bf=new Map(before.files.map(f=>[f[0],f])),af=new Map(after.files.map(f=>[f[0],f]));
  const changed=new Set(changedPaths);
  const entity=(kind,status,key,extra)=>({id:kind+':'+status+':'+JSON.stringify(key),kind,status,...extra});
  for(const p of new Set([...bf.keys(),...af.keys()])){
    const b=bf.get(p),a=af.get(p),status=!b?'added':!a?'removed':changed.has(p)?'modified':null;
    if(status)out.push(entity('file',status,p,{path:p,before:b?{loc:b[2],module:before.modules[b[1]].id}:null,after:a?{loc:a[2],module:after.modules[a[1]].id}:null}));
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
      const record={path,name,line:f[2],complexity:f[3],nesting:f[4],length:f[5],severity:f[6]>=0?m.findings[f[6]]?.severity:null};
      map.set(key,(map.get(key)||[]).concat([record]));
    }return map;
  };
  const bfn=functionMap(before),afn=functionMap(after);let ambiguous=0;
  for(const key of new Set([...bfn.keys(),...afn.keys()])){
    const bs=bfn.get(key)||[],as=afn.get(key)||[];
    if(bs.length>1||as.length>1){ambiguous++;continue;}
    const b=bs[0]||null,a=as[0]||null,r=a||b;
    const status=!b?'added':!a?'removed':b.complexity!==a.complexity||b.nesting!==a.nesting?'modified':null;
    if(status)out.push(entity('function',status,[r.path,r.name],{path:r.path,name:r.name,before:b,after:a}));
  }
  out.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {records:out,ambiguousFunctions:ambiguous};
}
