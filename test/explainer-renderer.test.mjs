import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import { renderExplainer } from '../archify/explainer/render.mjs';
import { computeExplainerRevision } from '../archify/explainer/revision.mjs';
import { unpackPageBundle } from '../archify/explainer/page-bundle.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const all = (node, test) => [ ...(test(node) ? [node] : []), ...(node.childNodes || []).flatMap(child=>all(child,test)) ];
const attr = (node,key) => node.attrs?.find(attribute=>attribute.name === key)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const find = (tree,id) => all(tree,node=>attr(node,'id') === id)[0];
const payload = (tree,id) => unpackPageBundle(JSON.parse(text(find(tree,id))));
const source = {id:'code-source',title:'Real excerpt',path:'src/example.mjs',lines:[2,3]};
const nativeHtml = '<!doctype html><html><body><svg id="diagram-svg"></svg><script>const sample = "native";</script></body></html>';
const diagram = {diagramType:'architecture',spec:{meta:{title:'Actual relationships'}},html:nativeHtml,svg:'<svg id="diagram-svg" viewBox="0 0 200 80"><defs><marker id="arrow"></marker></defs><g data-node-id="api"><text x="10" y="30">API</text></g><path data-edge-id="write" data-edge-from="api" data-edge-to="redis" marker-end="url(#arrow)"/><g data-node-id="redis"><text x="90" y="30">Redis</text></g></svg>',styles:'<style>:root,[data-theme="dark"]{--native-ink:#eee}[data-theme="light"]{--native-ink:#123}body{height:100vh}text{fill:var(--native-ink)}</style>',sha256:sha(nativeHtml),bytes:Buffer.byteLength(nativeHtml),semantic:{nodes:[{id:'api',label:'API'},{id:'redis',label:'Redis'}],edges:[{id:'write',from:'api',to:'redis',label:'writes'}]}};
function fixture() {
  return {schema_version:1,diagram_type:'explainer',meta:{id:'test-explainer',title:'How `<script>` works?',locale:'en'},answer:{summary:'Keep **the evidence** visible.'},panels:[{id:'panel-main',title:'What do we know?',blocks:[
    {id:'prose',type:'prose',text:'Untrusted `<img src=x onerror=alert(1)>` and [typical](typical:not measured here).'},
    {id:'list',type:'list',ordered:true,items:['First','Second']},
    {id:'callout',type:'callout',level:'warning',title:'Bounded warning',text:'Read the actual source.'},
    {id:'comparison',type:'comparison',columns:['A','B'],rows:[{id:'comparison-row',label:'Cost',cells:[{text:'Known',assessment:'good',verdict:'Low'},{text:'Unknown',assessment:'caution'}]}]},
    {id:'facts',type:'facts',entries:[{key:'Endpoint',value:'api → redis'}]},
    {id:'metric',type:'metric',label:'Capacity',value:3,limit:8,unit:'requests',typical:true,note:'Illustrative only'},
    {id:'steps',type:'steps',items:[{id:'write-step',text:'Write value',detail:'Preserve the directed link.',target:{diagram:'native-diagram',node:'api',edges:['write']}}]},
    {id:'native-diagram',type:'diagram',diagramType:'architecture',spec:{},changes:[{target:'api',change:'modified'}]},
    {id:'code',type:'code',source:'code-source',language:'js'},
    {id:'diff',type:'diff',text:'--- a/file\n+++ b/file\n@@ -7 +9 @@\n-old\n+<unsafe>',caption:'Literal changes'},
    {id:'image',type:'image',path:'example.png',alt:'Safe "image"',caption:'Contained asset'}
  ]}],sources:[source,{id:'external',title:'External',url:'https://example.org'},{id:'example',title:'Example'},{id:'inference',title:'Inference'},{id:'measurement',title:'Measured',text:'3 ms',method:'One local sample'}]};
}
const resources = () => ({preparedSources:{sources:{'code-source':{...source,revision:'abc123',text:'const value = "<actual>";\nreturn value;'},external:{title:'External',url:'https://example.org'},example:{title:'Example'},inference:{title:'Inference',text:'This is an inference'},measurement:{title:'Measured',text:'3 ms',method:'One local sample'}},assets:{image:{dataUrl:'data:image/png;base64,iVBORw0KGgo=',sha256:'asset-hash',bytes:8,mime:'image/png'}},dependencies:[]},preparedDiagrams:{diagrams:{'native-diagram':diagram},dependencies:[]}});

test('renderer: every shape remains statically readable and authored text cannot become markup',()=>{
  const html = renderExplainer(fixture(),resources()); const tree = parse(html);
  assert.ok(Buffer.byteLength(html.slice(0, html.indexOf('<meta charset='))) < 1024, 'charset must precede the software notices');
  const softwareNotice = all(tree,node=>attr(node,'id') === 'archify-software-notices')[0];
  assert.match(JSON.parse(text(softwareNotice)), /Apache License/);
  assert.equal(all(tree,node=>node.tagName === 'img').length,1);
  assert.equal(all(tree,node=>attr(node,'onerror')).length,0);
  assert.match(text(find(tree,'prose')),/Untrusted <img src=x onerror=alert\(1\)>/);
  assert.equal(text(all(tree,node=>node.tagName === 'h1')[0]),'How <script> works?');
  for(const block of fixture().panels[0].blocks) assert.ok(find(tree,block.id),`${block.type} missing`);
  assert.match(text(find(tree,'code')),/const value = "<actual>"/);
  const diffRows = all(find(tree,'diff'),node=>attr(node,'data-diff-kind'));
  assert.equal(attr(diffRows.find(row=>attr(row,'data-diff-kind') === 'removed'),'data-old-line'),'7');
  assert.equal(attr(diffRows.find(row=>attr(row,'data-diff-kind') === 'added'),'data-new-line'),'9');
  assert.match(text(find(tree,'diff')),/\+1 Added/);
  assert.match(text(find(tree,'diff')),/−1 Removed/);
  assert.match(text(find(tree,'diff')),/\+<unsafe>/);
  assert.match(text(all(tree,node=>attr(node,'class') === 'typical-footnotes')[0]),/not measured here/);
  assert.equal(all(tree,node=>attr(node,'id')).length,new Set(all(tree,node=>attr(node,'id')).map(node=>attr(node,'id'))).size);
});

test('renderer: canonical input, draft, child bytes and prepared bundle survive script-breaking contents',()=>{
  const input = fixture(); input.meta.title = '`</script><script>injected</script>`';
  const draft = '# draft\n</script>\n& literal text';
  const bundle = {sourceText:draft,document:input,...resources(),dependencies:[],digest:'prepared-digest'};
  const tree = parse(renderExplainer(input,{...resources(),sourceText:draft,preparedBundle:bundle}));
  assert.deepEqual(payload(tree,'archify-explainer-prepared').document,input);
  assert.equal(payload(tree,'archify-explainer-prepared').sourceText,draft);
  assert.deepEqual(payload(tree,'archify-explainer-prepared'),bundle);
  assert.equal(payload(tree,'archify-explainer-prepared').preparedDiagrams.diagrams['native-diagram'].html,nativeHtml);
  const manifest = payload(tree,'explainer-manifest');
  assert.equal(manifest.sourceSha256,sha(draft));
  assert.notEqual(manifest.revision,manifest.sourceSha256);
  assert.equal(manifest.documentSha256,sha(JSON.stringify(input)));
  assert.equal(manifest.children['native-diagram'].sha256,sha(nativeHtml));
  assert.equal(manifest.children['native-diagram'].bytes,Buffer.byteLength(nativeHtml));
  assert.equal(all(tree,node=>node.tagName === 'script' && !attr(node,'type')).length,1,'input must not create executable scripts');
});

test('renderer: resources fail closed and native previews preserve identity without leaking styles',()=>{
  assert.throws(()=>renderExplainer(fixture()),/Missing prepared native diagram/);
  const altered = resources(); altered.preparedDiagrams.diagrams['native-diagram'] = {...diagram,sha256:'false'};
  assert.throws(()=>renderExplainer(fixture(),altered),/Native child hash mismatch/);
  const tree = parse(renderExplainer(fixture(),resources()));
  assert.ok(find(tree,'preview-native-diagram-diagram-svg'));
  const preview = all(tree,node=>attr(node,'class')?.includes('diagram-preview'))[0];
  const styles = text(all(preview,node=>node.tagName === 'style')[0]);
  assert.match(styles,/\.preview-native-diagram\[data-theme="light"\]\{--native-ink:#123\}/);
  assert.match(styles,/\.preview-native-diagram:not\(\[data-theme\]\)\{--native-ink:#123\}/);
  assert.doesNotMatch(styles,/\.preview-native-diagram \[data-theme="light"\]/);
  assert.match(styles,/\.preview-native-diagram\[data-theme="dark"\]/);
  assert.doesNotMatch(styles,/height:100vh/);
  assert.equal(attr(all(tree,node=>attr(node,'data-diagram-link') === 'native-diagram')[0],'data-diagram-edges'),'["write"]');
});

test('renderer: no-script content includes scope, system theme and inert operation controls',()=>{
  const tree = parse(renderExplainer(fixture(),resources()));
  assert.equal(attr(all(tree,node=>node.tagName === 'html')[0],'data-theme'),undefined,'default must follow system even before JavaScript');
  assert.ok(find(tree,'answer'));
  const eligible = (node,ancestorInert=false,dialog=false) => {
    const inert = ancestorInert || attr(node,'class')?.split(' ').includes('interactive');
    const inDialog = dialog || node.tagName === 'dialog';
    if(['button','input','textarea'].includes(node.tagName)) assert.ok(inert || inDialog,`${node.tagName} ${attr(node,'data-option') || ''} would expose an inert noJS control`);
    (node.childNodes || []).forEach(child=>eligible(child,inert,inDialog));
  };
  eligible(tree);
  const previewStyles = text(all(tree,node=>node.tagName === 'style' && node.parentNode?.attrs?.some(attribute=>attribute.value.includes('diagram-preview')))[0]);
  assert.match(previewStyles,/@media\(prefers-color-scheme:dark\)/);
  assert.match(previewStyles,/@media print/);
  assert.equal(all(tree,node=>node.tagName === 'script' && attr(node,'type') === 'application/json').length,4,'prepared bundle, reader metadata and software notices');
});

test('renderer: multiple native diagrams retain independent preview IDs and original payload hashes',()=>{
  const input = fixture();
  input.panels.push({id:'second-panel',title:'What is the second view?',blocks:[{id:'second-diagram',type:'diagram',diagramType:'architecture',spec:{}}]});
  const prepared = resources(); prepared.preparedDiagrams.diagrams['second-diagram'] = {...diagram,spec:{meta:{title:'Second actual view'}}};
  const tree = parse(renderExplainer(input,prepared));
  assert.ok(find(tree,'preview-native-diagram-arrow'));
  assert.ok(find(tree,'preview-second-diagram-arrow'));
  assert.equal(all(tree,node=>attr(node,'id')).length,new Set(all(tree,node=>attr(node,'id')).map(node=>attr(node,'id'))).size);
  const bundle = payload(tree,'archify-explainer-prepared');
  assert.equal(bundle.preparedDiagrams.diagrams['native-diagram'].html,nativeHtml);
  assert.equal(bundle.preparedDiagrams.diagrams['second-diagram'].html,nativeHtml);
  const manifest = payload(tree,'explainer-manifest');
  assert.equal(Object.keys(manifest.children).length,2);
  assert.equal(manifest.children['native-diagram'].sha256,manifest.children['second-diagram'].sha256);
});

 test('renderer: content revision changes for frozen resources but ignores dependency filesystem relocation',()=>{
  const input = fixture(); const original = resources();
  const revision = values => payload(parse(renderExplainer(input,{...values,sourceText:'same authored draft'})),'explainer-manifest').revision;
  const initial = revision(original);
  const changedSource = resources(); changedSource.preparedSources.sources['code-source'].revision = 'different-git-revision';
  assert.notEqual(revision(changedSource),initial);
  const changedChild = resources(); const html = nativeHtml.replace('native','changed-native'); changedChild.preparedDiagrams.diagrams['native-diagram'] = {...diagram,html,sha256:sha(html),bytes:Buffer.byteLength(html)};
  assert.notEqual(revision(changedChild),initial);
  const changedImage = resources(); changedImage.preparedSources.assets.image.dataUrl += 'changed';
  assert.notEqual(revision(changedImage),initial);
  const relocated = resources(); relocated.preparedSources.dependencies = [{kind:'image',id:'image',sha256:'fixed-hash',bytes:10,path:'/one/location',mtime:1}];
  const same = resources(); same.preparedSources.dependencies = [{kind:'image',id:'image',sha256:'fixed-hash',bytes:10,path:'/another/location',mtime:9}];
  assert.equal(revision(relocated),revision(same));
  const reordered = resources(); reordered.preparedSources.sources = Object.fromEntries(Object.entries(reordered.preparedSources.sources).reverse());
  assert.equal(revision(reordered),initial);
  const reorderedDocument = Object.fromEntries(Object.entries(input).reverse());
  assert.equal(computeExplainerRevision({document:reorderedDocument,sourceText:'same authored draft',...original}),initial);
});

test('renderer: over-limit metrics disclose the excess and limit-only metrics imply no measurement',()=>{
  const input = fixture();
  input.panels[0].blocks = [{id:'overflow',type:'metric',label:'Requests',value:12,limit:10,unit:'requests',typical:true},{id:'capacity-only',type:'metric',label:'Capacity',limit:10,unit:'requests'}];
  const tree = parse(renderExplainer(input));
  const overflow = find(tree,'overflow');
  assert.equal(attr(all(overflow,node=>attr(node,'data-metric-status'))[0],'data-metric-status'),'over-limit');
  assert.match(text(overflow),/12requests/);
  assert.match(text(overflow),/Over limit by 2 requests/);
  assert.match(text(overflow),/Typical value/);
  assert.equal(all(find(tree,'capacity-only'),node=>node.tagName === 'meter').length,0);
  assert.match(text(find(tree,'capacity-only')),/Limit 10requests/);
  assert.equal(text(all(find(tree,'capacity-only'),node=>attr(node,'class') === 'metric-value')[0]),'Limit 10requests');
});

test('renderer: only Chinese pages get Chinese controls; other languages fall back to English',()=>{
  for (const [locale,expected] of [['es','Over limit by'],['ko','Over limit by'],['zh-TW','超限']]) {
    const input = fixture(); input.meta.locale = locale;
    input.panels[0].blocks = [{id:'overflow',type:'metric',label:'Requests',value:12,limit:10}];
    assert.match(text(find(parse(renderExplainer(input)),'overflow')),new RegExp(expected),locale);
  }
});

test('renderer: native diagram panels receive responsive space without changing the frozen native diagram',()=>{
  const input = fixture();
  input.panels.push({id:'text-only',title:'What stays in context?',blocks:[{id:'plain-only',type:'prose',text:'The narrative still provides the context.'}]});
  const tree = parse(renderExplainer(input,resources()));
  assert.ok(attr(find(tree,'panel-main'),'class').split(' ').includes('diagram-panel'));
  assert.ok(!attr(find(tree,'text-only'),'class').split(' ').includes('diagram-panel'));
  const bundle = payload(tree,'archify-explainer-prepared');
  assert.equal(bundle.preparedDiagrams.diagrams['native-diagram'].html,nativeHtml);
  assert.equal(bundle.preparedDiagrams.diagrams['native-diagram'].svg,diagram.svg);
  assert.equal(payload(tree,'explainer-manifest').children['native-diagram'].sha256,sha(nativeHtml));
});

test('renderer: native system-dark aliases exclude print rules and printing overrides the noJS dark selector',()=>{
  const prepared = resources();
  prepared.preparedDiagrams.diagrams['native-diagram'] = {...diagram,styles:diagram.styles+'<style>@media print{:root,[data-theme="dark"],[data-theme="light"]{--native-ink:#456}}</style>'};
  const tree = parse(renderExplainer(fixture(),prepared));
  const preview = all(tree,node=>attr(node,'class')?.split(' ').includes('diagram-preview'))[0];
  const styles = text(all(preview,node=>node.tagName === 'style')[0]);
  const darkAlias = styles.match(/@media\(prefers-color-scheme:dark\)\{([^}]+\{[^}]+\})\}/)[1];
  assert.match(darkAlias,/--native-ink:#eee/);
  assert.doesNotMatch(darkAlias,/--native-ink:#456/,'print declarations must not change screen-dark aliases');
  assert.match(styles,/@media print\{\.preview-native-diagram,\.preview-native-diagram\[data-theme\],\.preview-native-diagram:not\(\[data-theme\]\)\{/);
  assert.equal(payload(tree,'archify-explainer-prepared').preparedDiagrams.diagrams['native-diagram'].html,nativeHtml);
});

test('renderer: source markers number first appearances including blank labels and remain plain text',()=>{
 const input=fixture();input.answer={summary:'Read [second](source:external).',reasons:['Keep [](source:code-source) nearby.'],scope:'Scope [](source:external)'};input.panels[0].blocks=[{id:'text',type:'prose',text:'Again [second](source:external) and [](source:example).'}];
 const tree=parse(renderExplainer(input,resources()));const markers=all(tree,n=>n.tagName==='sup'&&attr(n,'class')==='cite');
 assert.deepEqual(markers.map(text),['1','2','1','1','3']);assert.deepEqual(markers.map(n=>attr(n.childNodes[0],'href')),['#source-external','#source-code-source','#source-external','#source-external','#source-example']);
 assert.ok(text(find(tree,'answer')).includes('Read second1.'));assert.deepEqual(all(tree,n=>n.tagName==='li'&&attr(n,'id')?.startsWith('source-')).map(n=>attr(n,'id')),['source-external','source-code-source','source-example','source-inference','source-measurement']);
 assert.equal(all(tree,n=>attr(n,'data-source-status')).length,0);assert.doesNotMatch(text(find(tree,'source-code-source')),/checked|verified/);
});

test('literal snippets render as copyable code and table corners keep their header',()=>{
  const input=fixture();input.panels[0].blocks.push({id:'snippet',type:'snippet',language:'bash',title:'Run tests',text:'echo "<b>"'});input.panels[0].blocks[3].labelColumn='Criterion';
  const tree=parse(renderExplainer(input,resources()));
  const block=find(tree,'snippet');
  assert.equal(text(all(block,node=>node.nodeName==='code'&&attr(node,'class')==='language-bash')[0]),'echo "<b>"');
  assert.ok(all(block,node=>attr(node,'data-copy')!==undefined).length);
  assert.match(text(all(block,node=>attr(node,'class')==='snippet-label')[0]),/Run tests/);
  assert.equal(text(all(find(tree,'comparison'),node=>node.nodeName==='th')[0]),'Criterion');
});

test('renderer: shared pages omit disposable native checker filenames but retain evidence',()=>{
  const prepared=resources();
  const check={ok:true,file:'/private/build-user/scratch/diagram.html',artifact:{sha256:diagram.sha256},composition:{profile:'standard'}};
  prepared.preparedDiagrams.diagrams['native-diagram']={...diagram,checks:{check}};
  const tree=parse(renderExplainer(fixture(),{...prepared,sourcePath:'/published/draft.json',pageDirectory:'/published'}));
  const frozen=payload(tree,'archify-explainer-prepared'),manifest=JSON.parse(text(find(tree,'explainer-manifest')));
  for(const saved of [frozen.preparedDiagrams.diagrams['native-diagram'].checks.check,manifest.children['native-diagram'].checks.check]){
    assert.equal('file' in saved,false);assert.equal(saved.ok,true);assert.deepEqual(saved.artifact,check.artifact);assert.deepEqual(saved.composition,check.composition);
  }
  assert.equal(prepared.preparedDiagrams.diagrams['native-diagram'].checks.check.file,check.file);
});


test('renderer: manifest warnings use the same portable locations as the prepared bundle',()=>{
  const diagnostics=[{code:'writing/test',severity:'warning',subject:{input:'/author/draft.md',output:'/published/page.html'}}];
  const tree=parse(renderExplainer(fixture(),{...resources(),diagnostics,sourcePath:'/author/draft.md',pageDirectory:'/published'}));
  const frozen=payload(tree,'archify-explainer-prepared'),manifest=JSON.parse(text(find(tree,'explainer-manifest')));
  assert.deepEqual(manifest.diagnostics,frozen.diagnostics);assert.equal(manifest.diagnostics[0].subject.input.replaceAll('\\','/'),'../author/draft.md');
});

test('renderer: Windows cross-volume source locations are omitted instead of exposed',()=>{
  const diagnostics=[{code:'writing/test',severity:'warning',subject:{input:'D:\\author\\draft.md'}}];
  const document=fixture(),sourceText=JSON.stringify(document),prepared=resources();
  const preparedBundle={...prepared,document,sourceText,diagnostics,sourcePath:'D:\\author\\draft.md',baseDir:'D:\\author',dependencies:[{kind:'image',id:'image',path:'D:\\author\\example.png'}]};
  const tree=parse(renderExplainer(document,{...prepared,sourceText,preparedBundle,diagnostics,pageDirectory:'C:\\published'}));
  const frozen=payload(tree,'archify-explainer-prepared'),manifest=JSON.parse(text(find(tree,'explainer-manifest')));
  assert.equal(frozen.sourcePath,null);assert.equal(frozen.baseDir,null);assert.equal(frozen.dependencies[0].path,null);assert.equal(manifest.diagnostics[0].subject.input,null);
});


test('renderer: page titles render validated inline content in reading order with plain browser text',()=>{
  const input=fixture();
  input.meta.title='Why `GET <key>` **now**? [Guide](source:external) [1 ms](typical:Illustrative only) [Details](block:panel-main) [API](node:native-diagram.api)';
  input.answer.summary='The [excerpt](source:code-source) follows the title.';
  const tree=parse(renderExplainer(input,resources())),heading=all(tree,node=>node.tagName==='h1')[0];
  const code=all(heading,node=>node.tagName==='code')[0];
  assert.ok(code,'the page heading must render its validated inline code');
  assert.equal(text(code),'GET <key>');
  assert.equal(text(all(heading,node=>node.tagName==='strong')[0]),'now');
  assert.equal(text(all(tree,node=>node.tagName==='title')[0]),'Why GET <key> now? Guide 1 ms Details API · Archify');
  assert.ok(all(heading,node=>attr(node,'href')==='#panel-main').length);
  assert.equal(attr(all(heading,node=>attr(node,'data-diagram-link')==='native-diagram')[0],'data-diagram-hash'),'focus=api');
  assert.equal(text(all(heading,node=>attr(node,'href')==='#source-external')[0]),'1');
  assert.equal(attr(find(tree,'source-external'),'value'),'1');
  assert.equal(attr(find(tree,'source-code-source'),'value'),'2');
  assert.ok(all(heading,node=>attr(node,'href')==='#explainer-typical-1').length);
  assert.match(text(find(tree,'explainer-typical-1')),/Illustrative only/);
  assert.match(text(find(tree,'explainer-typical-2')),/not measured here/);
  assert.deepEqual(payload(tree,'archify-explainer-prepared').document,input,'rendering must not rewrite the canonical title');
});
