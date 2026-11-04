#!/usr/bin/env node
// Static file/import inventory. No target code is executed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.argv[2], output = process.argv[3];
if (!configPath || !output) throw new Error('Usage: node architecture.mjs sources.json NEW-output-directory');
const settings = JSON.parse(fs.readFileSync(configPath));
const chain = JSON.parse(fs.readFileSync(path.join(here, '../toolchain.json')));
const provider = process.env.SOURCE_REVIEW_ARCHITECTURE_PROVIDER || chain.architecture_provider;
if (!provider) throw new Error('Set SOURCE_REVIEW_ARCHITECTURE_PROVIDER to the pinned Archify code-analysis module. See README.md.');
const {extractFacts, loadConfig} = await import(pathToFileURL(path.resolve(here, '..', provider, 'lib/analysis.mjs')));
const sha = x => createHash('sha256').update(x).digest('hex');
if (fs.existsSync(output)) throw new Error('Output directory already exists; preserve earlier extraction.');
fs.mkdirSync(output, {recursive:true});
const nodes=[], edges=[], sources=[], imports=[], fileNodes=new Map();
for (const source of settings.sources) {
  if (!/^[\w.-]+$/.test(source.id)) throw new Error('Invalid source id');
  const root=fs.realpathSync(source.root), cfg=loadConfig();
  cfg.exclude.push(...(source.exclude || []));
  const {facts,adapter,otherLanguages}=extractFacts(root,{language:source.language,config:cfg});
  fs.writeFileSync(path.join(output,source.id+'.facts.json'),JSON.stringify(facts,null,2)+'\n',{flag:'wx'});
  const info={...source,root,adapter,snapshot_id:facts.repository.snapshotId,parse_errors:facts.parse_errors||[],other_languages:otherLanguages,exclude:cfg.exclude,excluded_roles:['test','generated'],unresolved: facts.unresolved};
  sources.push(info);
  const directories=new Map();
  const addDir = p => {
    if (directories.has(p)) return directories.get(p);
    const id=source.id+':'+p;
    const parent=p?addDir(path.posix.dirname(p)==='.'?'':path.posix.dirname(p)):null;
    nodes.push({id,parent,kind:p?'directory':'source',source:source.id,path:p,label:source.labels?.[p] || (p?path.posix.basename(p):source.title),files:0,loc:0});
    directories.set(p,id);return id;
  };
  addDir('');
  for(const file of facts.files){
    if(['test','generated'].includes(file.role))continue;
    const full=fs.realpathSync(path.join(root,file.path));
    if(!full.startsWith(root+path.sep))throw new Error('Source symlink escapes root: '+file.path);
    const parent=addDir(path.posix.dirname(file.path)==='.'?'':path.posix.dirname(file.path));
    const id=source.id+':'+file.path;
    const node={id,parent,kind:'file',source:source.id,path:file.path,repository:source.repository,repository_path:path.posix.join(source.prefix||'',file.path),label:path.posix.basename(file.path),files:1,loc:file.loc,sha256:sha(fs.readFileSync(full))};
    nodes.push(node);fileNodes.set(id,node);
  }
  imports.push(...facts.imports.map(i=>({...i,source:source.id})));
}
const byId=new Map(nodes.map(n=>[n.id,n]));
for(const file of fileNodes.values())for(let p=file.parent;p;p=byId.get(p).parent){byId.get(p).files++;byId.get(p).loc+=file.loc;}
const pyModules=new Map();
for(const source of sources.filter(s=>s.language==='py'))for(const f of fileNodes.values()){
  if(f.source!==source.id||!f.path.endsWith('.py'))continue;
  const name=f.path.replace(/\.py$/,'').replace(/\/__init__$/,'').replace(/^src\//,'').replaceAll('/','.');
  pyModules.set(name,[...(pyModules.get(name)||[]),f.id]);
}
let omitted=0;
for(const imp of imports){
  const from=imp.source+':'+imp.from;if(!fileNodes.has(from))continue;
  let to=imp.to?imp.source+':'+imp.to:null, resolution='provider';
  if(!to && sources.find(s=>s.id===imp.source).language==='py' && !imp.specifier.startsWith('.')){
    const candidates=(pyModules.get(imp.specifier)||[]).filter(id=>!id.startsWith(imp.source+':'));
    if(candidates.length===1){to=candidates[0];resolution='cross-source-exact-module';}
  }
  if(!to||!fileNodes.has(to)){omitted++;continue;}
  edges.push({from,to,kind:'import',file:from,line:imp.line,specifier:imp.specifier,resolution,
    ...(imp.typeOnly?{type_only:true}:{}),...(imp.lazy?{lazy:true}:{}),...(imp.conditional?{conditional:true}:{})});
}
const result={schema_version:1,created_at:new Date().toISOString(),provider:{name:'Archify static extractors',revision:chain.architecture_provider_revision,license:'MIT'},sources,nodes,edges,
  coverage:{kind:'static_imports',unresolved_or_excluded_imports:omitted,limitations:['实线箭头表示源码 import，不表示运行顺序、HTTP、消息或所有调用。','目录按源码路径分组；中文名称是展示别名。未挂问题的模块不代表已审查或没有问题。','仅收录配置中的源码类型；测试、生成代码和声明的排除项不进入地图。']}};
fs.writeFileSync(path.join(output,'architecture.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({nodes:nodes.length,files:fileNodes.size,imports:edges.length,unresolved_or_excluded:omitted,sources:sources.map(s=>({id:s.id,adapter:s.adapter,parse_errors:s.parse_errors.length}))}));
