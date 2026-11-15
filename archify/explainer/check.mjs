import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseExplainer } from './parse.mjs';
import { computeExplainerRevision } from './revision.mjs';
import { unpackPageBundle } from './page-bundle.mjs';

export const isExplainerHtml = html => /<html\b[^>]*\bdata-archify-artifact\s*=\s*["']explainer["']/i.test(html) || (html.includes('archify-explainer-prepared') && scanHtml(html).scripts.some(s=>s.attrs.id==='archify-explainer-prepared'));
const hash = value => createHash('sha256').update(value).digest('hex');
const decode = value => value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/gi, token => {
  const names = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"};
  if (names[token.toLowerCase()]) return names[token.toLowerCase()];
  const n = token[2].toLowerCase() === 'x' ? parseInt(token.slice(3,-1),16) : Number(token.slice(2,-1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\uFFFD';
});

// Bounded HTML token scanner: quoted attributes, comments, and raw-text elements
// are consumed together, so a JSON string containing markup is never a DOM ID.
export function scanHtml(html) {
  const elements = [];
  const scripts = [];
  const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let match, line = 1, lineOffset = 0;
  while ((match = token.exec(html))) {
    if (!match[2] || match[1]) continue;
    const tag = match[2].toLowerCase();
    const attrs = {};
    const attr = /([^\s=<>"'`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    const raw = match[0].slice(match[0].indexOf(match[2]) + match[2].length, -1);
    let a;
    while ((a = attr.exec(raw))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    // Advance once through the input, including skipped raw text, instead of
    // recounting every preceding line for each element of a large native SVG.
    for (let newline = html.indexOf('\n', lineOffset); newline >= 0 && newline < match.index; newline = html.indexOf('\n', newline + 1)) line++;
    lineOffset = match.index;
    const element = {tag,attrs,line,index:match.index};
    elements.push(element);
    if (['script','style','textarea','title'].includes(tag)) {
      const end = new RegExp(`</${tag}\\s*>`,'gi');
      end.lastIndex = token.lastIndex;
      const closing = end.exec(html);
      const text = html.slice(token.lastIndex, closing?.index ?? html.length);
      if (tag === 'script') scripts.push({...element,text});
      token.lastIndex = closing ? end.lastIndex : html.length;
    }
  }
  return {elements,scripts};
}

export function checkExplainerHtml(html, { file = '<html>', checkNative = true } = {}) {
  const bytes = Buffer.from(html);
  const {elements,scripts} = scanHtml(html);
  const diagnostics = [];
  const checks = [];
  const issue = (code,reason,example,element,component='document') => diagnostics.push({
    code:`explainer/${code}`,severity:'error',message:reason,
    subject:{input:file,line:element?.line || 1,component,...(element?.attrs?.id ? {id:element.attrs.id} : {})},
    evidence:{reason,example},supportedFixes:[example],
  });
  const add = (name, before, details=[]) => checks.push({name,ok:diagnostics.length===before,details});
  let before = diagnostics.length;
  if (elements.find(e=>e.tag==='html')?.attrs['data-archify-artifact']!=='explainer') issue('artifact-family','The document is missing its explainer family marker.','<html data-archify-artifact="explainer">');
  const ids = new Map();
  for (const e of elements) {
    if (e.attrs.id) {
      if (ids.has(e.attrs.id)) issue('duplicate-id',`Duplicate DOM ID: ${e.attrs.id}.`,'Give each panel, block, source and SVG preview a unique stable ID.',e);
      ids.set(e.attrs.id,e);
    }
    if (Object.keys(e.attrs).some(key=>/^on/.test(key))) issue('inline-handler','Inline event attributes are not permitted.','Use the packaged reader event handlers.',e);
    if (e.tag === 'script' && e.attrs.src) issue('external-runtime','The explainer runtime must be self-contained.','Embed the packaged reader script.',e);
    if (['iframe','object','embed'].includes(e.tag)) issue('external-frame','Frames must be created from immutable native payloads on demand.','Keep a static native SVG preview and the frozen child HTML payload.',e);
    for (const attr of ['href','src','xlink:href']) {
      const value=e.attrs[attr];
      if (!value) continue;
      if (/^(?:javascript|vbscript):/i.test(value)) issue('unsafe-url','An executable URL is not allowed.','Use an https URL or a stable #anchor.',e);
      if (value.startsWith('#') && !ids.has(decodeURIComponentSafe(value.slice(1)))) { /* resolved after all IDs */ }
    }
    if (e.tag==='img' && !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(e.attrs.src || '')) issue('external-image','Images must contain their frozen local bytes.','Use a prepared local image with a data:image URL.',e,'image');
  }
  for (const e of elements) {
    if (e.attrs.href?.startsWith('#') && e.attrs.href.length>1 && !ids.has(decodeURIComponentSafe(e.attrs.href.slice(1)))) issue('unresolved-reference',`Unresolved anchor: ${e.attrs.href}.`,'Link to an existing panel, block or source ID.',e,'reference');
  }
  add('explainer_structure',before,[`${ids.size} unique DOM IDs`]);
  function payload(id) {
    const found=scripts.filter(s=>s.attrs.id===id);
    if (found.length!==1 || found[0].attrs.type!=='application/json') { issue('payload',`Expected one application/json payload: ${id}.`,`<script type="application/json" id="${id}">…</script>`,found[0]); return null; }
    if (/[<>&\u2028\u2029]/.test(found[0].text)) issue('payload-escaping',`Unsafe raw characters in ${id}.`,'Escape <, >, &, U+2028 and U+2029 as JSON Unicode escapes.',found[0]);
    try { return JSON.parse(found[0].text); } catch { issue('payload-json',`Invalid JSON payload: ${id}.`,'Re-render the validated source instead of editing embedded payloads.',found[0]); return null; }
  }
  before=diagnostics.length;
  let bundle=payload('archify-explainer-prepared');
  try { bundle=unpackPageBundle(bundle); } catch { issue('native-hash','A compressed native diagram payload cannot be inflated.','Re-render the native diagram and freeze its original HTML bytes.'); bundle=null; }
  const document=bundle?.document;
  const source=bundle ? {text:bundle.sourceText} : null;
  const manifest=payload('explainer-manifest');
  const children=bundle?.preparedDiagrams?.diagrams;
  if (bundle && (bundle.kind!=='archify-explainer-prepared' || bundle.schemaVersion!==1 || hash(JSON.stringify({...bundle,digest:undefined}))!==bundle.digest)) issue('bundle-hash','The canonical prepared bundle does not match its digest.','Re-prepare and render the original draft with immutable resources.');
  if (bundle && typeof bundle.sourceText==='string') {
    const parsed=parseExplainer(bundle.sourceText,{inputPath:bundle.sourcePath,output:document?.meta?.output});
    if (!parsed.document || parsed.diagnostics.some(d=>d.severity!=='warning') || JSON.stringify(parsed.document)!==JSON.stringify(document)) issue('source-document-binding','The canonical document differs from its embedded authored draft.','Re-parse the embedded draft and render its normalized document.');
    if (bundle.source?.sha256!==hash(bundle.sourceText) || bundle.source?.bytes!==Buffer.byteLength(bundle.sourceText)) issue('bundle-source-hash','The prepared source bytes do not match their identity.','Freeze the exact original UTF-8 draft bytes.');
  }
  if (document && manifest && source) {
    if (document.diagram_type!=='explainer' || document.schema_version!==1 || !Array.isArray(document.panels) || !Array.isArray(document.sources)) issue('canonical-document','The canonical explainer envelope is invalid.','Use schema_version:1, diagram_type:"explainer", panels:[] and sources:[].');
    if (typeof source.text!=='string' || hash(source.text || '')!==manifest.sourceSha256) issue('source-hash','The embedded source does not match its immutable source hash.','Re-render the original draft and retain its exact SHA-256 source hash.');
    try {
      if (manifest.revision!==computeExplainerRevision(bundle)) issue('content-revision','The content revision does not bind the draft and frozen resources.','Recompute the revision from the canonical draft, source locations, child diagrams and contained assets.');
    } catch {issue('content-revision','The content revision cannot be computed from invalid frozen resources.','Re-prepare the original draft and every declared resource.');}
    if (hash(JSON.stringify(document))!==manifest.documentSha256) issue('document-hash','The canonical document does not match its manifest hash.','Re-render after changing the canonical document.');
    if (manifest.artifactId!==document.meta?.id || elements.find(e=>e.tag==='html')?.attrs['data-revision']!==manifest.revision) issue('artifact-identity','Artifact ID or revision disagrees with the manifest.','Use the renderer-generated identity and revision.');
    for (const panel of document.panels || []) {
      for (const item of [panel,...(panel.blocks || [])]) if (!ids.has(item.id)) issue('canonical-id',`Canonical ID is absent from the rendered document: ${item.id}.`,'Render every authored panel and block with its stable ID.');
    }
    for (const src of document.sources || []) if (!ids.has(`source-${src.id}`)) issue('source-target',`Source target is missing: ${src.id}.`,'Render every declared source in the source list.');
  }
  add('explainer_payload_identity',before);
  before=diagnostics.length;
  const dependencies=bundle?.dependencies;
  if (manifest?.dependencies && JSON.stringify(manifest.dependencies)!==JSON.stringify((dependencies || []).map(({contentBase64,...entry})=>entry))) issue('manifest-dependencies','The compact manifest disagrees with the canonical dependency identities.','Generate dependency metadata from the canonical prepared bundle.');
  if (!Array.isArray(dependencies)) issue('dependency-manifest','The frozen dependency manifest is missing.','Store dependencies:[] even when no external resources are used.');
  const depIds=new Set();
  for (const dep of dependencies || []) {
    const key=`${dep.kind}:${dep.id}`;
    if (depIds.has(key)) issue('dependency-duplicate',`Duplicate dependency: ${key}.`,'Freeze each resource once.');
    depIds.add(key);
    const frozen=typeof dep.contentBase64==='string' ? Buffer.from(dep.contentBase64,'base64') : null;
    if (!frozen || frozen.toString('base64')!==dep.contentBase64 || !Number.isSafeInteger(dep.bytes) || dep.bytes!==frozen.length || hash(frozen)!==dep.sha256) issue('dependency-hash',`Frozen dependency identity is corrupt: ${key}.`,'Regenerate the dependency bytes, byte count and SHA-256 from the source.');
  }
  for (const [id,asset] of Object.entries(manifest?.assets || {})) {
    const dep=(dependencies || []).find(d=>d.kind==='image' && d.id===id);
    if (!dep || dep.sha256!==asset.sha256 || dep.bytes!==asset.bytes) issue('asset-binding',`Image asset is not bound to its frozen dependency: ${id}.`,'Freeze the image before rendering.');
    const img=elements.find(e=>e.tag==='img' && e.attrs.src===`data:${asset.mime};base64,${dep?.contentBase64}`);
    if (!img) issue('asset-content',`Rendered image bytes differ from the frozen asset: ${id}.`,'Render the frozen data URL without replacing its bytes.');
  }
  for (const [id,src] of Object.entries(bundle?.preparedSources?.sources || {})) if (typeof src.text==='string') {
    const dep=(dependencies || []).find(d=>d.kind==='repository' && d.id===id);
    if (!dep || dep.sha256!==src.sha256 || dep.bytes!==src.bytes || !/^[0-9a-f]{40}$/.test(src.revision || '') || dep.revision!==src.revision) issue('source-binding',`Code excerpt is missing pinned frozen bytes: ${id}.`,'Resolve the repository source against a full Git commit before rendering.');
  }
  add('explainer_dependencies',before,[`${dependencies?.length || 0} frozen dependencies`]);
  before=diagnostics.length;
  const childReceipts=[];
  const expected=(document?.panels || []).flatMap(p=>p.blocks || []).filter(b=>b.type==='diagram').map(b=>b.id);
  if (!children || typeof children!=='object' || Array.isArray(children) || expected.length!==Object.keys(children).length || expected.some(id=>!children[id])) issue('native-count','Native diagram payloads do not match canonical diagram blocks.','Embed one native payload per diagram block; zero diagrams is valid.');
  for (const [id,child] of Object.entries(children || {})) {
    const binding=manifest?.children?.[id];
    if (typeof child.html!=='string' || hash(child.html || '')!==child.sha256 || Buffer.byteLength(child.html || '')!==child.bytes || binding?.sha256!==child.sha256 || binding?.bytes!==child.bytes) { issue('native-hash',`Native diagram payload is corrupt: ${id}.`,'Re-render the native diagram and freeze its original HTML bytes.',ids.get(id),'diagram'); continue; }
    if (isExplainerHtml(child.html)) {issue('native-family',`Nested explainers are not native diagrams: ${id}.`,'Use an existing Archify native diagram type.',ids.get(id),'diagram');continue;}
    if (checkNative) {
      const directory=fs.mkdtempSync(path.join(os.tmpdir(),'archify-explainer-check-'));
      try {
        const artifactPath=path.join(directory,'child.html'); fs.writeFileSync(artifactPath,child.html);
        const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-render-output.mjs',import.meta.url)),artifactPath],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000});
        let receipt; try {receipt=JSON.parse(run.stdout);} catch {receipt=null;}
        childReceipts.push({id,receipt});
        if (run.status!==0 || !receipt?.ok || receipt.artifact?.sha256!==child.sha256 || receipt.composition?.profile!==(bundle?.quality || document?.meta?.quality_profile || 'standard')) issue('native-check',`Native diagram failed its existing composition checks: ${id}.`,'Fix the nested diagram using the native checker diagnostics.',ids.get(id),'diagram');
      } finally {fs.rmSync(directory,{recursive:true,force:true});}
    }
  }
  add('explainer_native_diagrams',before,childReceipts.map(({id,receipt})=>`${id}: ${receipt?.ok ? 'pass':'fail'}`));
  const profile=bundle?.quality || document?.meta?.quality_profile || 'standard';
  const errors=diagnostics.length;
  return {ok:errors===0,file,family:'explainer',artifact:{sha256:hash(bytes),bytes:bytes.length},checks,composition:{schemaVersion:1,profile,status:errors ? 'fail':'pass',summary:{errors,warnings:0},issues:diagnostics,nativeDiagrams:childReceipts},diagnostics};
}
function decodeURIComponentSafe(value) { try {return decodeURIComponent(value);} catch {return value;} }
