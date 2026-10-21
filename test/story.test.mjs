import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {scanStory,buildStory,draftStory} from '../archify/story/tool.mjs';
import {compileBrief,draftBrief} from '../archify/story/story-plan.mjs';
import {writeStoryOutput,rollbackStoryOutput} from '../archify/story/output.mjs';
import {fixture as repositoryFixture} from './helpers/repository-evidence-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),skill=path.join(root,'archify'),cli=path.join(skill,'bin/archify.mjs');
const cases={architecture:'web-app-rendered.html',workflow:'workflow-agent-tool-call-rendered.html',sequence:'sequence-cache-miss-request.html',dataflow:'dataflow-product-analytics.html',lifecycle:'lifecycle-agent-run.html',erd:'erd-orders-rendered.html',class:'class-payments-rendered.html',tree:'tree-payment-platform-rendered.html',timeline:'timeline-payment-incident-rendered.html',waterfall:'waterfall-checkout-request-rendered.html'};
const native=path.join(skill,'examples',cases.workflow);
function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-story-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fileSymlink(t,target,file){
  try{fs.symlinkSync(target,file,'file');return true;}
  catch(error){
    if(!['EPERM','EACCES'].includes(error.code))throw error;
    t.skip('File symlinks unavailable: '+error.code);return false;
  }
}
function run(args,cwd,entry=cli){return spawnSync(process.execPath,[entry,'story',...args,'--json'],{cwd,encoding:'utf8',env:{...process.env,NODE_PATH:'',ARCHIFY_UPDATE_CHECK_DISABLED:'1'},maxBuffer:8*1024*1024});}
function brief(facts){const edge=facts.edges[0];return {version:2,title:'Explain the native handoff',intro:'Establish the complete diagram.',outro:'Return to its original context.',scenes:[{title:'Read this relationship',points:[{anchor:edge?.to||facts.nodes[0].id,...(edge?{via:edge.id}:{}),title:'Explain the selected point',text:'Describe the responsibility shown by this source relationship.'}]}]};}
function embedded(html){return Buffer.from(JSON.parse(/id="archify-story-payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]).html,'base64').toString('utf8');}

test('public story draft returns source identities and attach preserves the entire native document',t=>{
  const dir=workspace(t),plan=path.join(dir,'讲解 brief.json'),output=path.join(dir,'enhanced.html');
  const source=fs.readFileSync(native,'utf8'),draft=run(['draft',native,plan],dir);assert.equal(draft.status,0,draft.stderr+draft.stdout);
  const receipt=JSON.parse(draft.stdout),facts=JSON.parse(fs.readFileSync(receipt.sourceMap,'utf8'));
  assert.equal(receipt.ok,true);assert.ok(facts.nodes.length);assert.ok(facts.edges.every(edge=>facts.nodes.some(node=>node.id===edge.from)&&facts.nodes.some(node=>node.id===edge.to)));
  fs.writeFileSync(plan,JSON.stringify(brief(facts)));
  const attached=run(['attach',native,plan,output],dir);assert.equal(attached.status,0,attached.stderr+attached.stdout);assert.equal(JSON.parse(attached.stdout).ok,true);
  const html=fs.readFileSync(output,'utf8'),start=html.indexOf('<style id="archify-story-attachment-style">');
  assert.equal(html.slice(0,start)+html.slice(html.lastIndexOf('</body>')),source);
  assert.equal(fs.readFileSync(native,'utf8'),source);
  const payload=JSON.parse(/id="story-data">([\s\S]*?)<\/script>/.exec(embedded(html))[1]);
  assert.match(embedded(html),/<html lang="en"/);
  assert.deepEqual(payload.facts.nodes.map(node=>node.id),facts.nodes.map(node=>node.id));
  assert.deepEqual(payload.facts.edges.map(edge=>[edge.id,edge.from,edge.to]),facts.edges.map(edge=>[edge.id,edge.from,edge.to]));
  assert.ok(payload.plan.shots.filter(shot=>shot.preset==='establish').every(shot=>shot.duration<=6));
  const repeat=run(['attach',output,plan,path.join(dir,'again.html')],dir);assert.equal(repeat.status,1);assert.match(repeat.stdout,/original|already contains a story/);
});

test('public story commands preserve inputs and prior output on bad IDs, paths and arguments',t=>{
  const dir=workspace(t),source=path.join(dir,'source.html'),plan=path.join(dir,'brief.json'),output=path.join(dir,'last-good.html');fs.copyFileSync(native,source);
  const facts=scanStory(source);fs.writeFileSync(plan,JSON.stringify(brief(facts)));fs.writeFileSync(output,'previous artifact');
  for(const args of [['attach',source,plan,source],['attach',source,plan,plan],['attach',source,plan,path.join(dir,'wrong.txt')],['attach',source,plan,output,'--unsupported'],['attach',source,plan,output,'--repo-root']]){
    const before=[source,plan,output].map(file=>fs.readFileSync(file)),failed=run(args,dir);assert.equal(failed.status,1,failed.stdout);assert.equal(JSON.parse(failed.stdout).ok,false);assert.ok(JSON.parse(failed.stdout).diagnostics[0].code);
    for(const [index,file]of [source,plan,output].entries())assert.deepEqual(fs.readFileSync(file),before[index]);
  }
  const hardlink=path.join(dir,'source-alias.html');fs.linkSync(source,hardlink);assert.equal(run(['attach',source,plan,hardlink],dir).status,1);
  const invalid=brief(facts);invalid.scenes[0].points[0].anchor='missing-node';fs.writeFileSync(plan,JSON.stringify(invalid));
  const failed=run(['attach',source,plan,output],dir);assert.equal(failed.status,1);assert.match(JSON.parse(failed.stdout).diagnostics[0].message,/Unknown point anchor/);assert.equal(fs.readFileSync(output,'utf8'),'previous artifact');
  fs.writeFileSync(plan,JSON.stringify(brief(facts)));assert.equal(run(['attach',source,plan,output],dir).status,0);assert.notEqual(fs.readFileSync(output,'utf8'),'previous artifact');
  assert.deepEqual(fs.readFileSync(source),fs.readFileSync(hardlink));assert.ok(fs.readdirSync(dir).every(name=>!name.endsWith('.tmp')));
});

test('draft refuses existing files and scan fails closed on conflicting native metadata',t=>{
  const dir=workspace(t),target=path.join(dir,'brief.json'),map=path.join(dir,'brief.source.json');fs.writeFileSync(map,'existing map');
  assert.equal(run(['draft',native,target],dir).status,1);assert.equal(fs.existsSync(target),false);assert.equal(fs.readFileSync(map,'utf8'),'existing map');
  const source=fs.readFileSync(native,'utf8'),first=scanStory(native).nodes[0].id,input=path.join(dir,'ambiguous.html');
  fs.writeFileSync(input,source.replace('</svg>',`<g data-node-id="${first}"></g></svg>`));
  assert.equal(run(['scan',input],dir).status,1);
  fs.writeFileSync(input,'<html><body><p>No native diagram</p></body></html>');assert.equal(run(['scan',input],dir).status,1);
  fs.writeFileSync(input,Buffer.from([0xff,0xfe,0x00]));assert.equal(run(['scan',input],dir).status,1);
});

test('attachment uses the HTML body boundary instead of script or comment literals',t=>{
  const dir=workspace(t),input=path.join(dir,'source.html'),file=path.join(dir,'brief.json'),output=path.join(dir,'enhanced.html');
  const original=fs.readFileSync(native,'utf8'),closing=original.lastIndexOf('</body>');
  const before=original.slice(0,closing).replace('<html lang="en"','<html lang="fr"').replace('</head>','<script>window.bodyLiteral="</BoDy >";</script></head>');
  const after=original.slice(closing)+'<!-- A trailing example: </body> -->';
  fs.writeFileSync(input,before+after);fs.writeFileSync(file,JSON.stringify(brief(scanStory(input))));
  const result=run(['attach',input,file,output],dir);assert.equal(result.status,0,result.stdout+result.stderr);
  const html=fs.readFileSync(output,'utf8'),at=html.indexOf('<style id="archify-story-attachment-style">');
  assert.ok(html.slice(0,at)===before,'the addon starts after the complete native body content');assert.ok(html.endsWith(after));
  assert.match(embedded(html),/<html lang="fr"/);
  assert.equal(scanStory(output).nodes.length,scanStory(input).nodes.length);
});

test('non-object briefs have actionable diagnostics and preserve existing output',t=>{
  const dir=workspace(t),file=path.join(dir,'brief.json'),output=path.join(dir,'enhanced.html');fs.writeFileSync(output,'previous artifact');
  for(const value of [null,[],true,1,'brief']){
    fs.writeFileSync(file,JSON.stringify(value));const result=run(['attach',native,file,output],dir);
    assert.equal(result.status,1);assert.match(JSON.parse(result.stdout).diagnostics[0].message,/brief must be a JSON object/);
    assert.equal(fs.readFileSync(output,'utf8'),'previous artifact');
  }
});

test('story accent accepts literal hex colors and rejects CSS declarations without replacing output',t=>{
  const dir=workspace(t),file=path.join(dir,'brief.json'),output=path.join(dir,'enhanced.html'),plan=brief(scanStory(native));
  for(const value of ['#fff;display:none','#fff;background:url(https://example.invalid/image)','red;display:none','not-a-color','#12','#12345',null,12]){
    fs.writeFileSync(output,'previous artifact');fs.writeFileSync(file,JSON.stringify({...plan,accent:value}));
    const result=run(['attach',native,file,output],dir);
    assert.equal(result.status,1,'invalid accent must fail before publication');assert.match(JSON.parse(result.stdout).diagnostics[0].message,/Accent.*hex color/);
    assert.equal(fs.readFileSync(output,'utf8'),'previous artifact');
  }
  for(const accent of ['#AbC','#AbC8','#477bbe','#477bbecc']){
    fs.writeFileSync(file,JSON.stringify({...plan,accent}));const result=run(['attach',native,file,output],dir);
    assert.equal(result.status,0,result.stdout);assert.ok(embedded(fs.readFileSync(output,'utf8')).includes('style="--accent:'+accent+'"'));
  }
});

test('the brief link remains a file URL for reserved characters and scheme-like filenames',t=>{
  const dir=workspace(t),output=path.join(dir,'story.html'),plan=brief(scanStory(native));
  const names=['notes #100% 中文.json'];
  if(process.platform!=='win32')names.push('javascript:parent.document.documentElement.dataset.pwned=({json:1}).json');
  for(const name of names){
    const file=path.join(dir,name);fs.writeFileSync(file,JSON.stringify(plan));buildStory(native,file,output);
    const page=embedded(fs.readFileSync(output,'utf8')),href=/<a href="([^"]+)">Story brief/.exec(page)[1],url=new URL(href,pathToFileURL(output));
    assert.equal(url.protocol,'file:');assert.equal(url.hash,'');assert.equal(url.search,'');assert.equal(fileURLToPath(url),file);
  }
  const parent=path.join(dir,'brief.json'),nested=path.join(dir,'output','story.html');fs.writeFileSync(parent,JSON.stringify(plan));buildStory(native,parent,nested);
  const href=/<a href="([^"]+)">Story brief/.exec(embedded(fs.readFileSync(nested,'utf8')))[1];
  assert.equal(fileURLToPath(new URL(href,pathToFileURL(nested))),parent,'a parent-directory brief stays reachable');
});

test('a failed brief publication rolls back its owned source map so the draft can be retried',t=>{
  const dir=workspace(t),file=path.join(dir,'brief.json'),map=path.join(dir,'brief.source.json'),destination=path.join(dir,'missing','brief.json');
  if(!fileSymlink(t,destination,file))return;
  const failed=run(['draft',native,file],dir);assert.equal(failed.status,1);assert.equal(fs.existsSync(map),false,'a failed pair must not leave its companion behind');
  assert.ok(fs.lstatSync(file).isSymbolicLink(),'the caller-owned alias stays intact');
  fs.mkdirSync(path.dirname(destination));const retried=run(['draft',native,file],dir);assert.equal(retried.status,0,retried.stdout+retried.stderr);assert.ok(fs.existsSync(map));
});

test('companion rollback preserves a replacement or an in-place edit by another writer',t=>{
  const dir=workspace(t);
  for(const replace of [false,true]){
    const file=path.join(dir,replace?'replaced.json':'edited.json'),output=writeStoryOutput(file,'owned map');
    if(replace)fs.renameSync(file,file+'.old');fs.writeFileSync(file,'new owner');
    assert.equal(rollbackStoryOutput(output).status,'preserved');assert.equal(fs.readFileSync(file,'utf8'),'new owner');
  }
});

test('draft failure retains its publication error when releasing the rollback handle fails',t=>{
  const dir=workspace(t),file=path.join(dir,'brief.json'),map=path.join(dir,'brief.source.json');
  if(!fileSymlink(t,path.join(dir,'missing','brief.json'),file))return;
  const rename=fs.renameSync.bind(fs),close=fs.closeSync.bind(fs);let rollingBack=false,failed=false;
  t.mock.method(fs,'renameSync',(from,to)=>{const result=rename(from,to);if(path.basename(from)==='brief.source.json')rollingBack=true;return result;});
  t.mock.method(fs,'closeSync',descriptor=>{close(descriptor);if(rollingBack&&!failed){failed=true;throw Object.assign(Error('Injected close failure'),{code:'EIO'});}});
  assert.throws(()=>draftStory(native,file),error=>/parent-inspection-failed/.test(error.message)&&/rollback.*removed.*release/i.test(error.message));
  assert.equal(failed,true);assert.equal(fs.existsSync(map),false);
});

test('a failed candidate close preserves the original error and removes the temporary file',t=>{
  const dir=workspace(t),file=path.join(dir,'story.html');fs.writeFileSync(file,'previous artifact');
  const open=fs.openSync.bind(fs),close=fs.closeSync.bind(fs);let candidate,failed=false;
  t.mock.method(fs,'openSync',(name,...args)=>{const descriptor=open(name,...args);if(args[0]==='wx'&&path.basename(String(name)).startsWith('.archify-story-'))candidate=descriptor;return descriptor;});
  t.mock.method(fs,'closeSync',descriptor=>{close(descriptor);if(descriptor===candidate&&!failed){failed=true;throw Object.assign(Error('Candidate close failed'),{code:'EIO'});}});
  assert.throws(()=>writeStoryOutput(file,'new artifact'),error=>error.code==='EIO'&&error.message==='Candidate close failed');
  assert.equal(failed,true);assert.equal(fs.readFileSync(file,'utf8'),'previous artifact');assert.deepEqual(fs.readdirSync(dir),['story.html']);
});

test('draft rollback includes either file committed before a handle release fails',async t=>{
  for(const name of ['brief.source.json','brief.json'])await t.test(name,t=>{
    const dir=workspace(t),file=path.join(dir,'brief.json'),map=path.join(dir,'brief.source.json'),published=path.join(dir,name);
    const open=fs.openSync.bind(fs),close=fs.closeSync.bind(fs);let binding,failed=false;
    t.mock.method(fs,'openSync',(name,...args)=>{const descriptor=open(name,...args);if(args[0]!=='wx'&&path.basename(String(name)).startsWith('.archify-story-'))binding=descriptor;return descriptor;});
    t.mock.method(fs,'closeSync',descriptor=>{close(descriptor);if(descriptor===binding&&fs.existsSync(published)&&!failed){failed=true;throw Object.assign(Error('Published handle close failed'),{code:'EIO'});}});
    assert.throws(()=>draftStory(native,file),error=>/was published but cleanup failed/.test(error.message)&&error.archifyDiagnostics[0].evidence.publication==='committed');
    assert.equal(failed,true);assert.deepEqual(fs.readdirSync(dir),[],'the failed draft leaves neither owned output nor staging files');
    t.mock.restoreAll();draftStory(native,file);assert.ok(fs.existsSync(file));assert.ok(fs.existsSync(map));
  });
});

test('committed publication warnings retain the new output and report cleanup and recovery state',async t=>{
  for(const fault of ['release','backup'])await t.test(fault,t=>{
    const dir=workspace(t),file=path.join(dir,'output.html'),committed=[];fs.writeFileSync(file,'previous');
    const open=fs.openSync.bind(fs),close=fs.closeSync.bind(fs),rename=fs.renameSync.bind(fs);let previous,injected=false;
    t.mock.method(fs,'openSync',(name,...args)=>{const descriptor=open(name,...args);if(path.basename(String(name))==='output.html')previous=descriptor;return descriptor;});
    t.mock.method(fs,'closeSync',descriptor=>{close(descriptor);if(fault==='release'&&descriptor===previous&&!injected&&fs.readFileSync(file,'utf8')==='next'){injected=true;throw Object.assign(Error('Previous handle release failed'),{code:'EIO'});}});
    t.mock.method(fs,'renameSync',(from,to)=>{if(fault==='backup'&&path.basename(String(from))==='previous'&&!injected&&fs.readFileSync(file,'utf8')==='next'){injected=true;throw Object.assign(Error('Previous backup cleanup failed'),{code:'EIO'});}return rename(from,to);});
    let failure;try{writeStoryOutput(file,'next',()=>{},{committed});}catch(error){failure=error;}
    assert.equal(injected,true);assert.ok(failure,'a committed cleanup warning must reach the caller');
    assert.match(failure.message,/was published but cleanup failed/);
    const diagnostic=failure.archifyDiagnostics[0];assert.equal(diagnostic.code,'story/output-publication');
    assert.equal(diagnostic.evidence.publication,'committed');assert.equal(diagnostic.evidence.cleanupState.systemCode,'EIO');
    assert.equal(committed.length,1,'ownership is retained before reporting a post-commit failure');assert.equal(fs.readFileSync(file,'utf8'),'next');
    if(fault==='backup'){
      assert.ok(fs.existsSync(diagnostic.evidence.recoveryDirectory));assert.equal(fs.readFileSync(diagnostic.evidence.recoveryFile,'utf8'),'previous');
      assert.ok(fs.existsSync(path.join(diagnostic.evidence.recoveryDirectory,'publication-recovery-v1.json')));
      assert.ok(failure.message.includes(diagnostic.evidence.recoveryDirectory),'the plain CLI error includes the retained recovery directory');
      assert.ok(failure.message.includes(diagnostic.evidence.recoveryFile),'the plain CLI error includes the retained previous output');
    }
  });
});

test('streamed soundtrack blocks preserve samples and cues across a block boundary',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(skill,'story/story-audio.js'),'utf8'),context);
  const sound=context.StorySound,cues=[{kind:'move',at:3.7,duration:1},{kind:'local',at:3.8,duration:1.1},{kind:'enter',at:4,duration:.5}],duration=4.75;
  const whole=sound.render(duration,cues),next=sound.renderer(duration,cues),parts=[next(4),next(4)];
  for(let channel=0;channel<2;channel++)assert.deepEqual(Buffer.concat(parts.map(part=>Buffer.from(part.channels[channel].buffer))),Buffer.from(whole.channels[channel].buffer));
  assert.equal(next(4).channels[0].length,0);
  assert.equal(sound.renderer(100000,cues,99990)(4).channels[0].length,4*48000,'a late seek only synthesizes the requested window');
});

test('all ten native families retain their source notation and valid default actions',t=>{
  const dir=workspace(t);
  for(const [type,name]of Object.entries(cases)){
    const input=path.join(skill,'examples',name),facts=scanStory(input),plan=brief(facts),file=path.join(dir,type+'.json'),output=path.join(dir,type+'.html');fs.writeFileSync(file,JSON.stringify(plan));
    buildStory(input,file,output);assert.equal(fs.existsSync(output),true);
    assert.ok(facts.nodes.length,type);if(['erd','class','tree','timeline','waterfall'].includes(type))assert.equal(facts.defaultAction,'relation',type);
    if(type==='erd')assert.ok(facts.edges.every(edge=>edge.ends));if(type==='class')assert.ok(facts.edges.every(edge=>edge.kind));
    if(type==='timeline')assert.ok(facts.nodes.every(node=>node.at&&Number.isFinite(node.timeMs)));
    if(type==='waterfall')assert.ok(facts.nodes.every(node=>Number.isFinite(node.timing.duration)));
  }
  const facts={title:'Static relationship',defaultAction:'relation',nodes:[{id:'a'},{id:'b'}],edges:[{id:'link',from:'a',to:'b'}]},plan=brief(facts);plan.scenes[0].points.push({...plan.scenes[0].points[0],anchor:'a'});
  assert.equal(compileBrief(plan,facts).shots[1].annotations.length,2);
  assert.deepEqual(draftBrief(facts).scenes.flatMap(scene=>scene.points.map(point=>point.anchor)),['a','b']);
});

test('authored figure captions and code references reach the presentation with pinned source ranges',t=>{
  const dir=workspace(t),repo=repositoryFixture(),input=path.join(dir,'source.html'),file=path.join(dir,'brief.json'),output=path.join(dir,'enhanced.html');
  execFileSync(process.execPath,[cli,'render','architecture',repo.input,input,'--repo-root',repo.root]);
  const facts=scanStory(input),plan=brief(facts),point=plan.scenes[0].points[0];
  point.anchor=facts.nodes.find(node=>node.sources.length).id;
  point.figureCaption='This connection separates accepting the request from storing its result.';
  point.code={fromLine:1,toLine:3,emphasis:[2]};fs.writeFileSync(file,JSON.stringify(plan));
  const missingRoot=run(['attach',input,file,output],dir);
  assert.equal(missingRoot.status,1,'a requested excerpt must not be silently dropped');assert.match(missingRoot.stdout,/--repo-root/);assert.equal(fs.existsSync(output),false);
  fs.writeFileSync(path.join(repo.root,'src/router.js'),'Uncommitted text must not be quoted.\n');
  const attached=run(['attach',input,file,output,'--repo-root',repo.root],dir);assert.equal(attached.status,0,attached.stdout+attached.stderr);
  const payload=JSON.parse(/id="story-data">([\s\S]*?)<\/script>/.exec(embedded(fs.readFileSync(output,'utf8')))[1]),note=payload.plan.shots[1].annotations[0];
  assert.equal(note.figureCaption,point.figureCaption);assert.equal(note.excerpt.revision,repo.revision);
  assert.deepEqual(note.excerpt.lines.map(line=>line.text),['export function route(input) {','  return input.kind;','}']);assert.equal(note.excerpt.lines[1].emphasis,true);
  const previous=fs.readFileSync(output);point.code.toLine=4;fs.writeFileSync(file,JSON.stringify(plan));
  assert.equal(run(['attach',input,file,output,'--repo-root',repo.root],dir).status,1);assert.deepEqual(fs.readFileSync(output),previous);
});

test('a package-only copy runs the full story chain outside the repository without dependencies',t=>{
  const dir=workspace(t),pack=path.join(dir,'package'),outside=path.join(dir,'outside');fs.mkdirSync(outside);
  fs.cpSync(skill,pack,{recursive:true,filter:file=>!path.relative(skill,file).split(path.sep).some(part=>part==='node_modules'||part==='test'||part.startsWith('.validator-check-'))});
  assert.equal(fs.existsSync(path.join(pack,'node_modules')),false);
  const entry=path.join(pack,'bin/archify.mjs'),input=path.join(pack,'examples',cases.workflow),plan=path.join(outside,'brief.json'),output=path.join(outside,'story.html');
  const draft=run(['draft',input,plan],outside,entry);assert.equal(draft.status,0,draft.stderr+draft.stdout);
  const facts=JSON.parse(fs.readFileSync(JSON.parse(draft.stdout).sourceMap,'utf8'));fs.writeFileSync(plan,JSON.stringify(brief(facts)));
  const attached=run(['attach',input,plan,output],outside,entry);assert.equal(attached.status,0,attached.stderr+attached.stdout);assert.ok(embedded(fs.readFileSync(output,'utf8')).includes(facts.nodes[0].label));
  fs.writeFileSync(output,'previous standalone output');fs.unlinkSync(path.join(pack,'story/native-motion.js'));
  assert.equal(run(['attach',input,plan,output],outside,entry).status,1);assert.equal(fs.readFileSync(output,'utf8'),'previous standalone output');
});
