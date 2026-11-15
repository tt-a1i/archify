import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');

/** Stable authored-content identity; excludes filesystem relocation and outer reader presentation. */
export function computeExplainerRevision({document,sourceText=JSON.stringify(document),preparedSources={},preparedDiagrams={},dependencies}) {
  const sourceSha256 = hash(sourceText);
  const sources = preparedSources.sources || preparedSources;
  const assets = preparedSources.assets || {};
  const diagrams = preparedDiagrams.diagrams || preparedDiagrams;
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([,entry])=>entry !== undefined).sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([key,entry])=>[key,stable(entry)])) : value;
  const ordered = entries => entries.map(stable).sort((a,b)=>JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  const resourceIdentity = {
    version:1,sourceSha256,documentSha256:hash(JSON.stringify(stable(document))),
    dependencies:ordered((dependencies || [...(preparedSources.dependencies || []),...(preparedDiagrams.dependencies || [])]).map(({kind,id,sha256,bytes})=>({kind,id,sha256,bytes}))),
    sources:Object.fromEntries(Object.entries(sources).map(([id,source])=>[id,{title:source.title,url:source.url,path:source.path,lines:source.lines,revision:source.revision,textSha256:typeof source.text === 'string' ? hash(source.text) : undefined}])),
    children:Object.fromEntries(Object.entries(diagrams).map(([id,child])=>[id,{htmlSha256:hash(child.html),specSha256:hash(JSON.stringify(stable(child.spec || {})))}])),
    assets:Object.fromEntries(Object.entries(assets).map(([id,asset])=>[id,{sha256:asset.sha256,dataSha256:hash(asset.dataUrl || ''),mime:asset.mime,bytes:asset.bytes}]))
  };
  return hash(JSON.stringify(stable(resourceIdentity)));
}
