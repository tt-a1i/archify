import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SaxesParser} from 'saxes';
import {scanStory} from '../archify/story/tool.mjs';
import {compileBrief} from '../archify/story/story-plan.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const native=path.join(root,'archify/examples/workflow-agent-tool-call-rendered.html');
const cli=path.join(root,'archify/bin/archify.mjs');
function sample(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-story-svg-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source.html'),brief=path.join(dir,'brief.json'),output=path.join(dir,'story.svg');
  fs.copyFileSync(native,source);
  const edge=scanStory(source).edges[0];
  const plan={version:2,title:'Change <A> & B',intro:'First frame explains the intent.',outro:'Finish with the verified scope.',scenes:[
    {title:'First relationship',points:[{anchor:edge.to,via:edge.id,title:'Follow the request',text:'The selected relationship carries the request.'}]},
    {title:'Second responsibility',points:[{anchor:edge.from,title:'Inspect the caller',text:'Keep the caller and the evidence visible.'}]}
  ]};
  fs.writeFileSync(brief,JSON.stringify(plan));
  return {dir,source,brief,output,plan};
}
function run(s,output=s.output){return spawnSync(process.execPath,[cli,'story','svg',s.source,s.brief,output,'--json'],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'}});}
function xml(file){
  const parser=new SaxesParser({xmlns:true}),tags=[],texts=[];
  parser.on('error',error=>{throw error;});
  parser.on('opentag',tag=>tags.push(tag));parser.on('text',value=>texts.push(value));
  parser.write(fs.readFileSync(file,'utf8')).close();
  return {tags,text:texts.join(' ')};
}
test('story SVG and its first frame are standalone XML with the actual compiled scenes',t=>{
  const s=sample(t),result=run(s);assert.equal(result.status,0,result.stderr+result.stdout);
  const receipt=JSON.parse(result.stdout),animated=xml(s.output),still=xml(s.output.replace(/\.svg$/,'.still.svg'));
  for(const document of [animated,still]){
    assert.equal(document.tags[0].local,'svg');assert.equal(document.tags[0].uri,'http://www.w3.org/2000/svg');
    assert.match(document.text,/Change <A> & B/);assert.match(document.text,/First frame explains the intent/);
    const ids=document.tags.map(tag=>tag.attributes.id?.value).filter(Boolean);assert.equal(new Set(ids).size,ids.length,'SVG IDs remain unique');
  }
  for(const text of ['First relationship','Follow the request','Second responsibility','Inspect the caller','Finish with the verified scope'])assert.ok(animated.text.includes(text),text);
  assert.doesNotMatch(still.text,/Second responsibility/,'static output is the first frame, not stacked hidden scenes');
  assert.ok(receipt.duration>0);assert.equal(receipt.scenes,2);
  assert.equal(fs.readdirSync(s.dir).some(name=>name.startsWith('.archify-')),false);
});
test('story SVG validates both outputs against input aliases before publishing anything',t=>{
  for(const target of ['primary-source','primary-brief','still-source','still-brief']){
    const s=sample(t),alias=target.startsWith('primary')?s.output:s.output.replace(/\.svg$/,'.still.svg');
    fs.linkSync(target.endsWith('source')?s.source:s.brief,alias);
    const before=[s.source,s.brief].map(file=>fs.readFileSync(file));const result=run(s);
    assert.equal(result.status,1,target);assert.equal(JSON.parse(result.stdout).diagnostics[0].code,'output/input-alias');
    for(const [index,file] of [s.source,s.brief].entries())assert.deepEqual(fs.readFileSync(file),before[index]);
  }
});
test('story SVG rejects remote and local resource dependencies without replacing existing exports',t=>{
  for(const href of ['//example.invalid/tracker.png','relative.png','file:///tmp/image.png','https://example.invalid/image.png']){
    const s=sample(t);fs.writeFileSync(s.source,fs.readFileSync(s.source,'utf8').replace(/(<svg\b[^>]*>)/,'$1<image href="'+href+'"/>'));
    fs.writeFileSync(s.output,'last good animation');fs.writeFileSync(s.output.replace(/\.svg$/,'.still.svg'),'last good still');
    const result=run(s);assert.equal(result.status,1,href);assert.match(JSON.parse(result.stdout).diagnostics[0].message,/resource|self-contained/i);
    assert.equal(fs.readFileSync(s.output,'utf8'),'last good animation');assert.equal(fs.readFileSync(s.output.replace(/\.svg$/,'.still.svg'),'utf8'),'last good still');
  }
});
test('story SVG preserves unrelated temporary-looking files and rejects invalid briefs before writes',t=>{
  const s=sample(t),unrelated=path.join(s.dir,'.story.svg.html');fs.writeFileSync(unrelated,'unrelated user file');
  assert.equal(run(s).status,0);assert.equal(fs.readFileSync(unrelated,'utf8'),'unrelated user file');
  const before=[s.output,s.output.replace(/\.svg$/,'.still.svg')].map(file=>fs.readFileSync(file));
  fs.writeFileSync(s.brief,JSON.stringify({...s.plan,scenes:[]}));assert.equal(run(s).status,1);
  for(const [index,file]of [s.output,s.output.replace(/\.svg$/,'.still.svg')].entries())assert.deepEqual(fs.readFileSync(file),before[index]);
});

test('story SVG keeps recovery copies and reports them in JSON when publication and restoration both fail',t=>{
  const s=sample(t),physical=path.join(s.dir,'physical'),alias=path.join(s.dir,'alias');
  fs.mkdirSync(physical);
  fs.symlinkSync(physical,alias,process.platform==='win32'?'junction':'dir');
  s.output=path.join(alias,'story.svg');
  const still=s.output.replace(/\.svg$/,'.still.svg'),hook=path.join(s.dir,'fault.mjs');
  const destination=path.join(fs.realpathSync(path.dirname(s.output)),path.basename(s.output));
  const trace=path.join(s.dir,'faults.txt');
  fs.writeFileSync(s.output,'previous animation');fs.writeFileSync(still,'previous still');
  fs.writeFileSync(hook,`import fs from 'node:fs';import path from 'node:path';
const link=fs.linkSync,open=fs.openSync;let failed=false;
const trace=${JSON.stringify(trace)};
function inject(stage){fs.appendFileSync(trace,stage+'\\n');throw Object.assign(Error('injected '+stage+' failure'),{code:'EIO'});}
fs.linkSync=function(from,to,...args){if(!failed&&path.resolve(to)===${JSON.stringify(destination)}){failed=true;inject('publication');}return link.call(this,from,to,...args);};
fs.openSync=function(file,flags,...args){if(failed&&flags==='wx'&&/^\\.archify-story-[a-f0-9-]+\\.tmp$/.test(path.basename(String(file))))inject('restoration');return open.call(this,file,flags,...args);};`);
  const runFaulted=(...options)=>{
    fs.writeFileSync(trace,'');
    const result=spawnSync(process.execPath,['--import',pathToFileURL(hook).href,cli,'story','svg',s.source,s.brief,s.output,...options],{encoding:'utf8',env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'}});
    assert.equal(fs.readFileSync(trace,'utf8'),'publication\nrestoration\n',result.stderr+result.stdout);
    return result;
  };
  const result=runFaulted('--json');
  assert.equal(result.status,1);const diagnostic=JSON.parse(result.stdout).diagnostics[0];
  assert.equal(diagnostic.code,'story/svg-publication');assert.equal(diagnostic.evidence.restoration,'incomplete');
  assert.match(diagnostic.message,/restoration failure/);assert.ok(fs.statSync(diagnostic.evidence.recoveryDirectory).isDirectory());
  const copies=diagnostic.evidence.recoveryFiles.map(file=>fs.readFileSync(file,'utf8'));
  assert.ok(copies.includes('previous animation'));assert.ok(copies.includes('previous still'));
  assert.equal(fs.readFileSync(s.output,'utf8'),'previous animation');
  fs.writeFileSync(still,'previous still');
  const plain=runFaulted();
  assert.equal(plain.status,1);assert.match(plain.stderr,/Recovery incomplete/);assert.match(plain.stderr,/recovery directory:/);
});

test('story SVG keeps all caption and field content, wraps long headings, and permits ordinary path labels',t=>{
  const s=sample(t);s.plan.title='W'.repeat(100);s.plan.scenes[0].points[0].figureCaption='The local figure explains the request.';
  fs.writeFileSync(s.brief,JSON.stringify(s.plan));fs.writeFileSync(s.source,fs.readFileSync(s.source,'utf8').replace(/data-node-label="[^"]*"/,'data-node-label="C:\\repo\\module"'));
  const result=run(s);assert.equal(result.status,0,result.stderr+result.stdout);
  const animated=xml(s.output);assert.match(animated.text,/The local figure explains the request/);
  assert.ok(animated.tags.some(tag=>tag.local==='svg'&&tag.attributes['data-theme']?.value==='light'));
  assert.doesNotMatch(fs.readFileSync(s.output,'utf8'),/<text[^>]*>W{100}<\/text>/);
  const legacy=compileBrief(s.plan,scanStory(s.source));legacy.shots[1].annotations[0].fields=[{label:'Ownership',detail:'Verified at the caller'}];
  fs.writeFileSync(s.brief,JSON.stringify(legacy));assert.equal(run(s).status,0);
  assert.match(xml(s.output).text,/Ownership: Verified at the caller/);
});

test('story SVG preserves transformed ancestors and source IDs without drawing separate focus copies',t=>{
  const s=sample(t),content=fs.readFileSync(s.source,'utf8').replace(/(<svg\b[^>]*>)/,'$1<g transform="translate(10 10)"><g id="focus-0"></g>').replace('</svg>','</g></svg>');
  fs.writeFileSync(s.source,content);assert.equal(run(s).status,0);
  const document=xml(s.output),ids=document.tags.map(tag=>tag.attributes.id?.value).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length);assert.ok(ids.includes('native-focus-0'));
  assert.ok(document.tags.some(tag=>tag.attributes.transform?.value==='translate(10 10)'));
  assert.ok(document.tags.filter(tag=>tag.local==='use').every(tag=>tag.attributes.href?.value==='#story-native'));
});
