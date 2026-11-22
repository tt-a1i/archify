import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseValidatedExplainer, rebindPreparedBundle, validatePreparedTargets } from './prepare.mjs';
import { resolveExplainerSources } from './sources.mjs';
import { prepareExplainerDiagrams } from './diagrams.mjs';
import { computeExplainerRevision } from './revision.mjs';
import { unpackPageBundle } from './page-bundle.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';

function fail(reason, message, input, panelId, example) {
  throwDiagnosticError(message, [{code:`explainer/patch-${reason}`,severity:'error',message,
    subject:{input,panelId,line:1,component:'panel'},evidence:{reason,example},supportedFixes:[example]}]);
}
function embedded(html, id, input) {
  const matches = [...html.matchAll(new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'gi'))];
  if(matches.length !== 1) fail('payload','The artifact must contain one original draft and prepared resource payload.',input,undefined,'Use an artifact produced by the formal explainer CLI.');
  try { return JSON.parse(matches[0][1]); } catch { fail('payload','Embedded draft payload is invalid.',input,undefined,'Rebuild the artifact from its original draft.'); }
}
/** Replace an authored stable panel while retaining immutable resources outside that panel. */
export async function preparePanelPatch({artifactPath,panelId,replacementPath,repoRoot,quality,writingMode,expectedArtifact}) {
  const artifactBytes=fs.readFileSync(artifactPath);
  if(expectedArtifact && (artifactBytes.length!==expectedArtifact.bytes || createHash('sha256').update(artifactBytes).digest('hex')!==expectedArtifact.sha256)) fail('artifact-changed','The original artifact changed after validation.',artifactPath,panelId,'Finish other writes to the artifact and retry the panel patch.');
  const html = artifactBytes.toString('utf8');
  let previous;
  try { previous = unpackPageBundle(embedded(html,'archify-explainer-prepared',artifactPath)); } catch (error) { if (error.archifyDiagnostics || error.diagnostics) throw error; fail('payload','Embedded native diagram payload cannot be inflated.',artifactPath,panelId,'Rebuild the original artifact before patching.'); }
  // The page names local files relative to itself; resolve them before reading or re-preparing.
  const near = value => typeof value === 'string' ? path.resolve(path.dirname(artifactPath), value) : value;
  const draft = {...previous,sourcePath:near(previous.sourcePath)};
  if(typeof draft.sourceText !== 'string' || draft.sourceText !== previous.sourceText
    || createHash('sha256').update(draft.sourceText).digest('hex') !== previous.source?.sha256
    || createHash('sha256').update(JSON.stringify({...previous,digest:undefined})).digest('hex') !== previous.digest) {
    fail('payload','The embedded original draft is not bound to the prepared resources.',artifactPath,panelId,'Rebuild the original artifact before patching.');
  }
  const oldParsed = parseValidatedExplainer(draft.sourceText,{inputPath:draft.sourcePath || artifactPath,writingMode:'off'});
  if(JSON.stringify(oldParsed.document)!==JSON.stringify(previous.document)) fail('payload','The original draft and normalized document disagree.',artifactPath,panelId,'Rebuild the original artifact before patching.');
  const index = oldParsed.document.panels.findIndex(panel=>panel.id===panelId);
  if(index<0) fail('target','The requested panel does not exist.',artifactPath,panelId,'Choose a stable panel id from the original artifact.');
  const range=oldParsed.sourceMap[`/panels/${index}`];
  if(!Number.isInteger(range?.start)||!Number.isInteger(range?.end)) fail('range','The original draft has no replaceable panel range.',artifactPath,panelId,'Rebuild the artifact using the current parser.');
  const replacementBytes = fs.readFileSync(replacementPath);
  const replacement = replacementBytes.toString('utf8');
  if(!Buffer.from(replacement).equals(replacementBytes)) fail('source-encoding','Panel replacement must contain valid UTF-8 bytes.',replacementPath,panelId,'Save the replacement panel as UTF-8 text.');
  const sourceText = draft.sourceText.slice(0,range.start)+replacement+draft.sourceText.slice(range.end);
  const parsed=parseValidatedExplainer(sourceText,{inputPath:draft.sourcePath || artifactPath,writingMode:writingMode || previous.writingMode || 'warn'});
  if(parsed.document.panels.length!==oldParsed.document.panels.length || parsed.document.panels[index]?.id!==panelId) {
    fail('identity','A panel replacement must retain the target stable id and panel count.',replacementPath,panelId,oldParsed.format==='json'?'{"id":"'+panelId+'","title":"Question?","blocks":[...]}':'## Question? {#'+panelId+'}\n\nReplacement content.');
  }
  const expected=structuredClone(oldParsed.document);
  expected.panels[index]=parsed.document.panels[index];
  if(JSON.stringify(expected)!==JSON.stringify(parsed.document)) fail('scope','The replacement changes content outside the selected panel.',replacementPath,panelId,'Replace only the target panel; preserve document metadata, sources and other panels.');
  const oldBlocks=new Map(oldParsed.document.panels[index].blocks.map(block=>[block.id,block]));
  const changed=parsed.document.panels[index].blocks.filter(block=>JSON.stringify(oldBlocks.get(block.id))!==JSON.stringify(block));
  // Already verified immutable code excerpts remain usable after the original checkout disappears.
  const changedCodeIds=new Set(changed.filter(block=>block.type==='code' && typeof previous.preparedSources?.sources?.[block.source]?.text !== 'string').map(block=>block.source));
  const selectedQuality=quality || previous.quality || 'standard';
  const qualityChanged=selectedQuality !== previous.quality;
  const oldDiagramBlocks=new Map(oldParsed.document.panels.flatMap(panel=>panel.blocks).filter(block=>block.type==='diagram').map(block=>[block.id,block]));
  const reusedDiagramSources=new Set();
  const frozenDiagramInput=block=>{
    if(block.type==='diagram' && block.source && oldDiagramBlocks.get(block.id)?.source===block.source && previous.preparedDiagrams?.diagrams?.[block.id]?.spec) {
      reusedDiagramSources.add(block.id);
      return {...block,source:undefined,spec:previous.preparedDiagrams.diagrams[block.id].spec};
    }
    return block;
  };
  const partial={...parsed.document,panels:[{...parsed.document.panels[index],blocks:changed.filter(block=>
    (block.type!=='code'||changedCodeIds.has(block.source))
    && !(block.type==='image' && oldBlocks.get(block.id)?.path===block.path && previous.preparedSources?.assets?.[block.id])
    && !(block.type==='chart' && block.data && JSON.stringify(oldBlocks.get(block.id)?.data)===JSON.stringify(block.data) && previous.preparedSources?.charts?.[block.id]))
    .map(frozenDiagramInput)}],sources:parsed.document.sources.filter(source=>changedCodeIds.has(source.id))};
  const common={repoRoot,baseDir:previous.baseDir===null ? null : near(previous.baseDir) || path.dirname(draft.sourcePath || artifactPath),sourceMap:parsed.sourceMap,sourcePath:draft.sourcePath || artifactPath,quality:selectedQuality};
  const partialMap={...parsed.sourceMap};
  for(const [partialIndex,block] of partial.panels[0].blocks.entries()) {
    const originalIndex=parsed.document.panels[index].blocks.findIndex(entry=>entry.id===block.id);
    const originalPrefix=`/panels/${index}/blocks/${originalIndex}`;
    for(const [pointer,location] of Object.entries(parsed.sourceMap)) if(pointer===originalPrefix || pointer.startsWith(`${originalPrefix}/`)) partialMap[`/panels/0/blocks/${partialIndex}${pointer.slice(originalPrefix.length)}`]=location;
  }
  for(const [partialIndex,source] of partial.sources.entries()) {
    const originalIndex=parsed.document.sources.findIndex(entry=>entry.id===source.id);
    const originalPrefix=`/sources/${originalIndex}`;
    for(const [pointer,location] of Object.entries(parsed.sourceMap)) if(pointer===originalPrefix || pointer.startsWith(`${originalPrefix}/`)) partialMap[`/sources/${partialIndex}${pointer.slice(originalPrefix.length)}`]=location;
  }
  const newSources=await resolveExplainerSources(partial,{...common,sourceMap:partialMap});
  // A profile change needs fresh native validation for every child, including
  // untouched panels. Frozen original specs keep this independent of old files.
  const diagramDocument=qualityChanged ? {...parsed.document,panels:parsed.document.panels.map(panel=>({...panel,blocks:panel.blocks.map(frozenDiagramInput)}))} : partial;
  const newDiagrams=await prepareExplainerDiagrams(diagramDocument,{...common,sourceMap:qualityChanged ? parsed.sourceMap : partialMap});
  newDiagrams.dependencies=newDiagrams.dependencies.map(entry=>{
    if(!reusedDiagramSources.has(entry.id)) return entry;
    const original=(previous.dependencies || []).find(dep=>dep.kind==='diagram-spec' && dep.id===entry.id);
    if(!original) fail('payload','The original diagram has no frozen specification evidence.',artifactPath,panelId,'Rebuild the original artifact before patching.');
    newDiagrams.diagrams[entry.id].specification=previous.preparedDiagrams.diagrams[entry.id].specification;
    return {...original,path:near(original.path),retained:true};
  });
  const preparedSources={...previous.preparedSources,sources:{...previous.preparedSources.sources,...newSources.sources},assets:{...previous.preparedSources.assets,...newSources.assets},charts:{...previous.preparedSources.charts,...newSources.charts}};
  const preparedDiagrams={...previous.preparedDiagrams,diagrams:{...previous.preparedDiagrams.diagrams,...newDiagrams.diagrams}};
  const activeBlocks=parsed.document.panels.flatMap(panel=>panel.blocks);
  const imageIds=new Set(activeBlocks.filter(block=>block.type==='image').map(block=>block.id));
  const diagramIds=new Set(activeBlocks.filter(block=>block.type==='diagram').map(block=>block.id));
  const dataChartIds=new Set(activeBlocks.filter(block=>block.type==='chart'&&block.data).map(block=>block.id));
  preparedSources.assets=Object.fromEntries(Object.entries(preparedSources.assets).filter(([id])=>imageIds.has(id)));
  preparedSources.charts=Object.fromEntries(Object.entries(preparedSources.charts).filter(([id])=>dataChartIds.has(id)));
  if(!Object.keys(preparedSources.charts).length)delete preparedSources.charts;
  preparedDiagrams.diagrams=Object.fromEntries(Object.entries(preparedDiagrams.diagrams).filter(([id])=>diagramIds.has(id)));
  validatePreparedTargets(parsed.document,preparedDiagrams.diagrams,common);
  const dependencyKey=entry=>`${entry.kind}:${entry.id}`;
  const newDependencies=[...(newSources.dependencies||[]),...(newDiagrams.dependencies||[])];
  const preparedIds=new Set(newDependencies.map(dependencyKey));
  const localDependency=(entry,baseDir)=>({...entry,...(entry.kind==='repository'||entry.inline||!entry.path?{}:{path:path.resolve(baseDir,entry.path)})});
  const dependencies=[...(previous.dependencies||[]).filter(entry=>!preparedIds.has(dependencyKey(entry)) && (entry.kind!=='image'||imageIds.has(entry.id)) && (entry.kind!=='data'||dataChartIds.has(entry.id)) && (entry.kind!=='diagram-spec'||diagramIds.has(entry.id))).map(entry=>localDependency(entry,path.dirname(artifactPath))),
    ...newDependencies.map(entry=>localDependency(entry,common.baseDir))];
  // Old dependencies are embedded immutable bytes. Only newly prepared resources are reread/verified.
  const bundle=rebindPreparedBundle({...previous,sourcePath:common.sourcePath,baseDir:common.baseDir,preparedSources,preparedDiagrams,dependencies,quality:selectedQuality,writingMode:writingMode || previous.writingMode || 'warn'},parsed);
  bundle.dependencies = dependencies.map(entry => ({...entry, retained: entry.retained===true || !preparedIds.has(dependencyKey(entry))}));
  return {bundle:rebindPreparedBundle(bundle,parsed),sourceText,sourcePath:draft.sourcePath || artifactPath,previousRevision:computeExplainerRevision(previous),previousSourceSha256:previous.source.sha256,panelId};
}
