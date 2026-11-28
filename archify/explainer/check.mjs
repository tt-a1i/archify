import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseExplainer } from './parse.mjs';
import { validateExplainer } from './validate.mjs';
import { nativeExplainerPreview } from './diagrams.mjs';
import { explainerWords, renderExplainer } from './render.mjs';
import { isWhatIf } from './whatif-engine.mjs';
import { boardProjection, matchesWhatIfScripts, scanHtml, verifiedNativeScriptHashes, whatIfPolicy } from './whatif-csp.mjs';
import { computeExplainerRevision } from './revision.mjs';
import { parse } from '../story/vendor/html-parser.mjs';
import { unpackPageBundle } from './page-bundle.mjs';

export const isExplainerHtml = html => /<html\b[^>]*\bdata-archify-artifact\s*=\s*["']explainer["']/i.test(html) || (html.includes('archify-explainer-prepared') && scanHtml(html).scripts.some(s=>s.attrs.id==='archify-explainer-prepared'));
const hash = value => createHash('sha256').update(value).digest('hex');
export { scanHtml } from './whatif-csp.mjs';

export function checkExplainerHtml(html, { file = '<html>', checkNative = true } = {}) {
  const bytes = Buffer.from(html);
  const scanned = scanHtml(html);
  const {elements,scripts} = scanned;
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
  let parsed;
  if (bundle && typeof bundle.sourceText==='string') {
    parsed=parseExplainer(bundle.sourceText,{inputPath:bundle.sourcePath,output:document?.meta?.output});
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
  const nativeVerified = [];
  for (const [id,child] of Object.entries(children || {})) {
    const binding=manifest?.children?.[id];
    if (typeof child.html!=='string' || hash(child.html || '')!==child.sha256 || Buffer.byteLength(child.html || '')!==child.bytes || binding?.sha256!==child.sha256 || binding?.bytes!==child.bytes) { issue('native-hash',`Native diagram payload is corrupt: ${id}.`,'Re-render the native diagram and freeze its original HTML bytes.',ids.get(id),'diagram'); continue; }
    if (isExplainerHtml(child.html)) {issue('native-family',`Nested explainers are not native diagrams: ${id}.`,'Use an existing Archify native diagram type.',ids.get(id),'diagram');continue;}
    if (isWhatIf(document) && !verifiedNativeScriptHashes(child.html)) {
      issue('native-script-inventory',`Unexpected native Viewer script: ${id}.`,'Freeze HTML rendered with the packaged Viewer template.',ids.get(id),'diagram');
      continue;
    }
    if (checkNative) {
      const directory=fs.mkdtempSync(path.join(os.tmpdir(),'archify-explainer-check-'));
      try {
        const artifactPath=path.join(directory,'child.html'); fs.writeFileSync(artifactPath,child.html);
        const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-render-output.mjs',import.meta.url)),artifactPath],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000});
        let receipt; try {receipt=JSON.parse(run.stdout);} catch {receipt=null;}
        childReceipts.push({id,receipt});
        if (run.status!==0 || !receipt?.ok || receipt.artifact?.sha256!==child.sha256 || receipt.composition?.profile!==(bundle?.quality || document?.meta?.quality_profile || 'standard')) {
          issue('native-check',`Native diagram failed its existing composition checks: ${id}.`,'Fix the nested diagram using the native checker diagnostics.',ids.get(id),'diagram');
          continue;
        }
      } finally {fs.rmSync(directory,{recursive:true,force:true});}
    }
    nativeVerified.push([id, child]);
  }
  add('explainer_native_diagrams',before,childReceipts.map(({id,receipt})=>`${id}: ${receipt?.ok ? 'pass':'fail'}`));
  if (isWhatIf(document) || isWhatIf(parsed?.document)) {
    const repair='Re-render the validated draft and its frozen native children with the packaged reader.';
    before=diagnostics.length;
    try {
      const validated=validateExplainer(parsed.document,{sourceMap:parsed.sourceMap,sourceText:parsed.sourceText,writingMode:'off'});
      if (!validated.ok || JSON.stringify(validated.grid)!==JSON.stringify(bundle.grid)) {
        issue('grid-receipt','The prepared grid receipt disagrees with the authored model.',repair);
      }
      if (validated.ok && nativeVerified.length===expected.length) {
        const blocks=new Map(parsed.document.panels.flatMap(panel=>panel.blocks).filter(block=>block.type==='diagram').map(block=>[block.id,block]));
        const diagrams=Object.fromEntries(nativeVerified.map(([id,child])=>{
          const native=nativeExplainerPreview(child.html,blocks.get(id).changes);
          if (native.svg!==child.svg || JSON.stringify(native.semantic)!==JSON.stringify(child.semantic) ||
              !isDeepStrictEqual(child.previewLanes, native.previewLanes)) {
            issue('native-preview-binding',`The preview, lane metadata or semantic graph differs from the frozen native child: ${id}.`,repair,ids.get(id),'diagram');
          }
          return [id,{...child,...native}];
        }));
        const projection=renderExplainer(parsed.document,{...bundle,preparedDiagrams:{diagrams},projectionOnly:true});
        const main=ids.get('board');
        if (main?.tag!=='main' || !isDeepStrictEqual(boardProjection(html.slice(main.index,main.end)),boardProjection(projection))) {
          issue('default-projection','The displayed default state disagrees with the authored calculator or scenarios.',repair);
        }
      }
    } catch {
      issue('default-projection','The default projection could not be reproduced from the draft and frozen resources.',repair);
    }
    add('explainer_default_projection',before);
    before=diagnostics.length;
    // Keep the byte scanner for script inventory and projection. Use the
    // browser's tree rules for head placement and live reader targets.
    const dom = [];
    function visit(node, parent) {
      let element = parent;
      if (node.tagName) {
        const location = node.sourceCodeLocation;
        element = {tag:node.tagName,html:node.namespaceURI==='http://www.w3.org/1999/xhtml',
          attrs:Object.fromEntries(node.attrs.map(({name,value})=>[name,value])),parent,
          line:location?.startLine,index:location?.startOffset};
        dom.push(element);
      }
      for (const child of node.childNodes || []) visit(child,element);
    }
    visit(parse(html,{sourceCodeLocationInfo:true}));
    const root = dom.find(element=>element.html && element.tag==='html');
    const head = dom.find(element=>element.html && element.tag==='head' && element.parent===root);
    const policies = dom.filter(e=>e.html && e.tag==='meta' && e.attrs['http-equiv']?.toLowerCase()==='content-security-policy');
    const policy = policies[0];
    const expectedPolicy=whatIfPolicy(Object.fromEntries(nativeVerified));
    if (policies.length!==1 || policy.attrs.content!==expectedPolicy || policy.parent!==head ||
        dom.some(e=>e.tag==='script' && e.index<policy.index)) {
      issue('content-security-policy','The hash-based policy must be in the document head before any script and match the frozen native children.',repair,policy);
    }
    if (!matchesWhatIfScripts(scanned)) issue('script-inventory','The standalone page has a missing or unexpected script.',repair);
    const locale = document?.meta?.locale || 'zh-CN';
    if (!isDeepStrictEqual(payload('explainer-reader-words'),JSON.parse(JSON.stringify(explainerWords(locale))))) {
      issue('reader-words','The reader language payload differs from the packaged translations.',repair);
    }
    add('explainer_script_policy',before);
    before=diagnostics.length;
    const under = (element,parent) => {
      for (let ancestor=element.parent; ancestor; ancestor=ancestor.parent) if (ancestor===parent) return true;
      return false;
    };
    const hasClass = name => element => element.attrs.class?.split(/\s+/u).includes(name);
    const hasAttr = name => element => Object.hasOwn(element.attrs,name);
    const firstLegends = new Map();
    for (const element of dom) {
      const {parent} = element;
      if (element.html && element.tag==='legend' && parent?.html && parent.tag==='fieldset' && !firstLegends.has(parent)) {
        firstLegends.set(parent,element);
      }
    }
    function isDisabledControl(element) {
      if (hasAttr('disabled')(element)) return true;
      let child = element;
      for (let ancestor=element.parent; ancestor; ancestor=ancestor.parent) {
        if (ancestor.html && ancestor.tag==='fieldset' && hasAttr('disabled')(ancestor) && firstLegends.get(ancestor)!==child) return true;
        child = ancestor;
      }
      return false;
    }
    function isBlocked(element, {parent, visible, stop} = {}) {
      for (let ancestor=element; ancestor && ancestor!==stop; ancestor=ancestor.parent) {
        // Menu panels and closed dialogs can start hidden. Their controls must
        // still be usable when opened, and inert is never allowed on this path.
        const closedContainer = ancestor===parent && (ancestor.attrs.role==='menu' ||
          (ancestor.tag==='dialog' && !hasAttr('open')(ancestor)));
        if (hasAttr('inert')(ancestor) || (visible && !closedContainer &&
            (hasAttr('hidden')(ancestor) || ancestor.attrs['aria-hidden']?.toLowerCase()==='true'))) {
          return true;
        }
      }
      return false;
    }
    function target(tag, selector, test, parent, enabled = false, visible = enabled) {
      const matches = dom.filter(test);
      const element = matches[0];
      if (matches.length!==1 || !element.html || element.tag!==tag || (parent && !under(element,parent)) ||
          isBlocked(element,{parent,visible}) || (enabled && (element.attrs.type!=='button' || isDisabledControl(element)))) {
        issue('reader-target',`Expected one usable ${selector} in the interactive reader.`,repair,element);
      }
      return element;
    }
    const attrIs = (name,value) => element => element.attrs[name]===value;
    const byId = id => attrIs('id',id);
    const button = (name,parent,value) => target('button',`[${name}${value===undefined ? '' : '='+value}]`,
      value===undefined ? hasAttr(name) : attrIs(name,value),parent,true);
    const masthead = target('header','.masthead',hasClass('masthead'),null,false,true);
    const toolbar = target('div','.masthead .tools',hasClass('tools'),masthead,false,true);
    const theme = target('div','.theme-controls',hasClass('theme-controls'),toolbar,false,true);
    for (const choice of ['auto','light','dark']) button('data-theme-choice',theme,choice);
    const menu = name => {
      const container = target('div',`.${name}-menu`,hasClass(`${name}-menu`),toolbar,false,true);
      const toggle = target('button',`[data-${name}-toggle]`,
        e=>hasAttr(`data-${name}-toggle`)(e) && e.attrs['aria-haspopup']==='menu',container,true);
      const panel = target('div',`.${name}-menu [role=menu]`,e=>e.attrs.role==='menu' && under(e,container),container);
      return {toggle,panel};
    };
    const style = menu('style');
    if (!style.panel || !hasClass('style-options')(style.panel)) issue('reader-target','Expected .style-options on the style menu panel.',repair,style.panel);
    target('span','[data-style-label]',hasAttr('data-style-label'),style.toggle);
    target('span','[data-style-toggle] .style-swatch',e=>hasClass('style-swatch')(e) && under(e,style.toggle),style.toggle);
    for (const choice of ['clean','editorial','product','swiss']) {
      target('button',`[data-style-choice=${choice}]`,e=>e.attrs.role==='menuitemradio' && e.attrs['data-style-choice']===choice,style.panel,true);
    }
    const exports = menu('export');
    for (const format of ['png','webp','jpeg']) {
      target('button',`[data-export-image=${format}]`,e=>e.attrs.role==='menuitem' && e.attrs['data-export-image']===format,exports.panel,true);
    }
    target('button','[data-print]',e=>e.attrs.role==='menuitem' && hasAttr('data-print')(e),exports.panel,true);
    const source = target('dialog','#explainer-source',byId('explainer-source'));
    button('data-open-source',toolbar);
    target('button','[data-close-source]',hasAttr('data-close-source'),source,true);
    target('p','[data-source-format]',hasAttr('data-source-format'),source);
    target('p','[data-source-grid]',hasAttr('data-source-grid'),source);
    target('pre','source text',element=>element.tag==='pre' && under(element,source),source);
    const viewer = target('dialog','#diagram-dialog',byId('diagram-dialog'));
    target('button','[data-close-diagram]',hasAttr('data-close-diagram'),viewer,true);
    target('h2','#diagram-dialog-title',byId('diagram-dialog-title'),viewer);
    target('p','.dialog-loading',hasClass('dialog-loading'),viewer);
    target('p','#explainer-whatif-status',byId('explainer-whatif-status'));
    target('div','#toast',byId('toast'));
    const main = target('main', '#board', byId('board'), null, false, true);
    for (const element of dom) {
      const whatIfTarget = Object.keys(element.attrs).some(name=>name.startsWith('data-whatif-'));
      const control = element.html && ['input','select','button','textarea'].includes(element.tag);
      const inBoard = (whatIfTarget || control) && under(element,main);
      if (element.tag==='template' || (whatIfTarget && !inBoard)) {
        issue('reader-target','Interactive controls and result targets must be in the live reading board.',repair,element);
      } else if (inBoard &&
          (isBlocked(element,{visible:true,stop:main}) || (control && isDisabledControl(element)))) {
        issue('reader-target','Interactive controls and result targets must be visible and usable in the reading board.',repair,element);
      }
    }
    if (!root || !hasAttr('data-explainer-whatif')(root) || root.attrs.lang!==locale) {
      issue('reader-target','The interactive reader is missing its document marker or language.',repair,root);
    }
    add('explainer_reader_targets',before);
  }
  const profile=bundle?.quality || document?.meta?.quality_profile || 'standard';
  const errors=diagnostics.length;
  return {ok:errors===0,file,family:'explainer',artifact:{sha256:hash(bytes),bytes:bytes.length},checks,composition:{schemaVersion:1,profile,status:errors ? 'fail':'pass',summary:{errors,warnings:0},issues:diagnostics,nativeDiagrams:childReceipts},diagnostics};
}
function decodeURIComponentSafe(value) { try {return decodeURIComponent(value);} catch {return value;} }
