import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ChromeVisualBrowser,findChrome} from '../archify/bin/visual-check.mjs';

const skill=fileURLToPath(new URL('../archify/',import.meta.url)),chrome=process.env.ARCHIFY_CHROME?findChrome():null;
test('attachment preserves localized native state labels and localizes the Story transition',{
  skip:chrome?false:'Set ARCHIFY_CHROME for the real-browser story check.',
},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-story-locale-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session,30000);
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.text);return r.result?.value;};
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});
  const navigate=async file=>{const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(file).href});await loaded;};
  const locales=[['zh-CN','讲解','切换视图：'],['zh-TW','講解','切換檢視：'],['es','Recorrido','Cambiar vista: '],['ko','해설','보기 전환: '],['ar','الشرح','تبديل العرض: '],['en','Story','Switch view: '],['fr','Story','Switch view: ']];
  for(const [locale,storyLabel,switchPrefix] of locales){
    const model=JSON.parse(fs.readFileSync(path.join(skill,'examples/agent-tool-call.workflow.json'),'utf8'));model.meta.locale=locale;
    if(locale==='fr')model.meta.translations={'viewer.motion.live':'Animé','viewer.motion.still':'Fixe'};
    const input=path.join(dir,locale+'.json'),source=path.join(dir,locale+'.html'),brief=path.join(dir,locale+'-brief.json'),output=path.join(dir,locale+'-story.html'),cli=path.join(skill,'bin/archify.mjs');
    fs.writeFileSync(input,JSON.stringify(model));execFileSync(process.execPath,[cli,'render','workflow',input,source],{stdio:'pipe'});
    execFileSync(process.execPath,[cli,'story','draft',source,brief,'--json']);
    const plan=JSON.parse(fs.readFileSync(brief,'utf8'));plan.intro='Context';plan.outro='Recap';for(const scene of plan.scenes)for(const point of scene.points)point.text='Node explanation.';
    fs.writeFileSync(brief,JSON.stringify(plan));execFileSync(process.execPath,[cli,'story','attach',source,brief,output,'--json']);
    await navigate(source);await evaluate('localStorage.removeItem("archify-motion");Archify.motionGovernor.setMode("still",{persist:false})');
    const expected=await evaluate('({locale:Archify.locale,still:viewerText("viewer.motion.still"),live:viewerText("viewer.motion.live")})');
    await navigate(output);
    const read='({label:document.querySelector("#motion-label").textContent,aria:document.querySelector("#btn-motion").getAttribute("aria-label"),title:document.querySelector("#btn-motion").title})';
    let state=await evaluate(read);assert.equal(state.label,expected.still,locale+' retains its native Still label before Story opens');assert.equal(state.aria,switchPrefix+expected.still);
    await evaluate('Archify.story.setView("live")');state=await evaluate(read);assert.equal(state.label,expected.live);assert.equal(state.aria,switchPrefix+expected.live);
    await evaluate('Archify.story.setView("story")');state=await evaluate(read);assert.equal(state.label,storyLabel);assert.equal(state.aria,switchPrefix+storyLabel);assert.ok(state.title.includes(expected.live));
    const chapters=await evaluate(`(()=>{const win=document.querySelector('.story-panel iframe').contentWindow;win.Story.seek(0);const opening=win.document.querySelector('.chapter').textContent;win.Story.seek(win.Story.duration-.1);return [opening,win.document.querySelector('.chapter').textContent];})()`);
    assert.match(chapters[0],/^01 \/ \d+$/,locale+' has a language-neutral opening');assert.match(chapters[1],/^\d+ \/ \d+$/,locale+' has a language-neutral closing');
    await evaluate('Archify.story.setView("still")');assert.equal((await evaluate(read)).label,expected.still);
  }
});
test('a public story attaches once, follows native appearance and retains source notes and exports',{
  skip:chrome?false:'Set ARCHIFY_CHROME for the real-browser story check.',
},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-story-browser-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source.html'),plan=path.join(dir,'brief.json'),output=path.join(dir,'enhanced.html'),cli=path.join(skill,'bin/archify.mjs');
  execFileSync(process.execPath,[cli,'render','workflow',path.join(skill,'examples/agent-tool-call.workflow.json'),source]);
  // Existing native files may carry unconditional reduced-motion rules.
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('</head>','<style>@media (prefers-reduced-motion: reduce){.ambient-edge-flow{--test-motion-policy:legacy;display:none!important;animation:none!important;}svg[data-animation="trace"] [data-animate]{animation:none!important;}}</style></head>'));
  const receipt=JSON.parse(execFileSync(process.execPath,[cli,'story','draft',source,plan,'--json'],{encoding:'utf8'})),facts=JSON.parse(fs.readFileSync(receipt.sourceMap,'utf8')),branches=facts.edges.filter(edge=>edge.from==='approval');
  fs.writeFileSync(plan,JSON.stringify({version:2,title:'Explain one source handoff',intro:'Establish its context.',outro:'Return to the complete graph.',scenes:[{title:'Read the selected relationship',points:[{anchor:'approval',via:branches.map(edge=>edge.id),title:'Follow this handoff',text:'The explanation uses the native relationship and its original endpoints.',figureCaption:'The original endpoints retain their direction.'}]}]}));
  execFileSync(process.execPath,[cli,'story','attach',source,plan,output,'--json']);
  const longPlan=path.join(dir,'long-brief.json'),longOutput=path.join(dir,'long-story.html'),longBrief=JSON.parse(fs.readFileSync(plan,'utf8'));longBrief.scenes[0].points[0].seconds=100000;
  fs.writeFileSync(longPlan,JSON.stringify(longBrief));execFileSync(process.execPath,[cli,'story','attach',source,longPlan,longOutput,'--json']);
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise,errors=[];
  browser.cdp.subscribe(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);});
  const send=(method,params={})=>browser.cdp.send(method,params,session,30000);
  async function evaluate(expression,awaitPromise=false){const result=await send('Runtime.evaluate',{expression,awaitPromise,returnByValue:true,userGesture:true});assert.equal(result.exceptionDetails,undefined,result.exceptionDetails?.exception?.description);return result.result?.value;}
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']});
  await send('Emulation.setDeviceMetricsOverride',{width:981,height:815,deviceScaleFactor:1,mobile:false});
  const motionState=`win=>{const doc=win.document,rule=[...doc.styleSheets].flatMap(sheet=>[...sheet.cssRules]).find(rule=>rule.cssRules?.[0]?.style?.getPropertyValue('--test-motion-policy')==='legacy');return {render:doc.documentElement.hasAttribute('data-motion-render'),reduced:win.Archify.motionGovernor.reducedMotion(),mode:win.Archify.motionGovernor.mode(),media:rule?.media.mediaText,transfers:[...doc.querySelectorAll('.ambient-edge-flow')].flatMap(flow=>flow.getAnimations()).length};}`;
  const reducedPolicy={render:false,reduced:true,mode:'still',media:'(prefers-reduced-motion: reduce)',transfers:0};
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const sourceLoaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(source).href});await sourceLoaded;
  await evaluate('Archify.motionGovernor.setMode("live",{persist:false});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);
  assert.deepEqual(await evaluate(`(${motionState})(window)`),reducedPolicy,'the unenhanced interactive Viewer retains reduced-motion CSS and suppresses native transfers');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(output).href});await loaded;
  await evaluate('document.fonts.ready',true);
  const snapshot='[...document.querySelectorAll(".diagram-container > svg [data-node-id],.diagram-container > svg [data-edge-from]")].map(node=>[node.dataset.nodeId,node.dataset.edgeId,node.dataset.edgeFrom,node.dataset.edgeTo])';
  const original=await evaluate(snapshot);assert.equal(await evaluate('document.querySelectorAll("iframe").length'),0);
  const exportsBefore=await evaluate('[...document.querySelectorAll("#export-menu [data-format]")].map(button=>[button.dataset.format,button.textContent,button.hidden,button.disabled])');
  await evaluate('window.nativeNotes=document.querySelector("#reader-rail > .cards");Archify.story.setView("live")',true);
  await evaluate('document.querySelector("#btn-motion").click()');assert.equal(await evaluate('Archify.motionGovernor.mode()'),'still');
  const loadingControls=await evaluate('document.querySelector("#btn-motion").click();[...document.querySelectorAll(".story-panel-controls button,.story-panel-controls input")].map(control=>control.disabled)');
  assert.ok(loadingControls.every(Boolean),'playback controls wait until the story is ready');
  await evaluate('(async()=>{for(let i=0;i<300&&!document.querySelector(".story-panel iframe")?.contentWindow?.storyReady;i++)await new Promise(resolve=>setTimeout(resolve,20));if(!document.querySelector(".story-panel iframe")?.contentWindow?.storyReady)throw Error("Story did not initialize");Archify.story.setSound(false);Archify.story.seek(8);})()',true);
  assert.equal(await evaluate('document.querySelector(".story-notes")===window.nativeNotes'),true);
  assert.equal(await evaluate('[...document.querySelectorAll(".story-panel-controls button,.story-panel-controls input")].some(control=>control.disabled)'),false);
  const chapters=await evaluate(`(()=>{const win=document.querySelector('.story-panel iframe').contentWindow,read=()=>win.document.querySelector('.chapter').textContent;win.Story.seek(0);const opening=read();win.Story.seek(win.Story.duration-.1);const closing=read();win.Story.seek(8);return {opening,closing,scene:read()};})()`);
  assert.equal(chapters.opening,'01 / 03');assert.equal(chapters.closing,'03 / 03');assert.equal(chapters.scene,'02 / 03 — Read the selected relationship','authored scene labels remain visible');
  assert.equal(await evaluate('document.querySelector(".story-panel iframe").contentDocument.querySelector(".figure-caption").textContent'),'The original endpoints retain their direction.');
  assert.equal(await evaluate('document.querySelector(".story-panel iframe").contentDocument.documentElement.lang'),'en');
  assert.equal(await evaluate('document.querySelector(".story-panel iframe").contentWindow.Story.plan.eyebrow'),'ARCHIFY');
  assert.equal(await evaluate('document.querySelector(".story-panel iframe").contentDocument.querySelector(".branch-figure").getAttribute("aria-label")'),'Connections from one node');
  for(const preset of ['classic','signal-flow','blueprint','editorial'])for(const theme of ['light','dark']){
    await evaluate(`document.querySelector('[data-preset-value="${preset}"]').click();if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('#btn-theme').click();`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);
    const state=await evaluate('(()=>{const win=document.querySelector(".story-panel iframe").contentWindow,doc=win.document,shape=win.getComputedStyle(doc.querySelector(".note-diagram [data-figure-node-id]")),id=doc.querySelector(".note-diagram [data-figure-node-id]").dataset.figureNodeId,native=getComputedStyle(document.querySelector(`.diagram-container > svg [data-node-id="${id}"] rect[data-animate="node"]`));return {preset:doc.documentElement.dataset.preset,theme:doc.documentElement.dataset.theme,time:win.Story.metrics().audioTime,source:[native.fill,native.stroke],figure:[shape.fill,shape.stroke]};})()');
    assert.equal(state.preset,preset);assert.equal(state.theme,theme);assert.equal(state.time,8);assert.deepEqual(state.source,state.figure);
  }
  const scrub=await evaluate('(()=>{const range=document.querySelector(".story-panel input");range.dispatchEvent(new Event("pointerdown"));range.value=9;range.dispatchEvent(new Event("input"));range.dispatchEvent(new Event("change"));return Archify.story.state().time;})()');assert.equal(scrub,9);
  const png=await evaluate('(async()=>{const task=Archify.story.exportPNG({time:9});document.querySelector("[data-preset-value=classic]").click();if(document.documentElement.dataset.theme!=="light")document.querySelector("#btn-theme").click();const image=await createImageBitmap(await task),canvas=document.createElement("canvas");canvas.width=canvas.height=1;canvas.getContext("2d").drawImage(image,0,0);const pixel=[...canvas.getContext("2d").getImageData(0,0,1,1).data];return {width:image.width,height:image.height,pixel};})()',true);
  assert.equal(png.width,1920);assert.equal(png.height,1080);assert.ok(Math.max(...png.pixel.slice(0,3))<70,'export retains the dark appearance selected when it started');
  const video=await evaluate(`(async()=>{
    const blob=await Archify.story.exportVideo({start:0,seconds:.5}),url=URL.createObjectURL(blob),video=document.createElement('video');
    try{
      video.muted=true;video.src=url;
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Story video decode timed out')),5000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Error('Story video could not be decoded'));};});
      const stream=video.captureStream(),audioTracks=stream.getAudioTracks().length;
      for(const track of stream.getTracks())track.stop();
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));
      return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,audioTracks,base64:btoa(binary)};
    }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
  })()`,true);
  assert.equal(video.width,1920);assert.equal(video.height,1080);assert.ok(Math.abs(video.duration-.5)<.05,'export contains the requested video interval');
  assert.equal(video.audioTracks,1,'the playable video retains its audio track');
  if(process.env.ARCHIFY_FFMPEG){
    const file=path.join(dir,'story.webm');fs.writeFileSync(file,Buffer.from(video.base64,'base64'));
    const decoded=spawnSync(process.env.ARCHIFY_FFMPEG,['-v','error','-i',file,'-map','0:a:0','-f','f32le','-ac','2','-ar','48000','-'],{timeout:15000});
    assert.equal(decoded.status,0,decoded.stderr?.toString());assert.equal(decoded.stderr.toString(),'','the audio timeline decodes without timestamp errors');const sound=decoded.stdout;
    assert.ok(Math.abs(sound.length/(48000*2*4)-.5)<.05,'the exported stereo audio decodes for the requested interval');
    assert.ok(sound.some(byte=>byte!==0),'the exported soundtrack contains sound');
  }
  await evaluate('Archify.exportMenu.run("svg")',true);assert.equal(await evaluate('document.documentElement.dataset.lastExportCanonical'),'true');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#export-menu [data-format]")].map(button=>[button.dataset.format,button.textContent,button.hidden,button.disabled])'),exportsBefore);
  assert.equal(await evaluate('[...document.querySelectorAll("#export-menu button")].at(-1).dataset.action'),'story-video');
  await evaluate('Archify.story.setView("live")',true);assert.deepEqual(await evaluate(snapshot),original);assert.equal(await evaluate('document.querySelector("#reader-rail > .cards")===window.nativeNotes'),true);
  await evaluate('Promise.all([Archify.story.setView("story"),Archify.story.setView("still")])',true);assert.equal(await evaluate('Archify.story.state().view'),'native');
  await evaluate('Promise.all([Archify.story.play(),Archify.story.setView("still")])',true);
  assert.equal(await evaluate('Archify.story.state().view'),'native');assert.equal(await evaluate('Archify.story.state().playing'),false,'switching away cancels a pending play request');
  await evaluate('Archify.story.setView("story")',true);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);
  const cameraSamples=`(()=>{const win=document.querySelector('.story-panel iframe').contentWindow,start=win.Story.shots[1].start;return {first:win.Story.seek(start+.1).camera,next:win.Story.seek(start+.8).camera,wash:win.document.querySelector('.transition-light').style.opacity,duration:win.Story.duration};})()`;
  const normal=await evaluate(cameraSamples);assert.notDeepEqual(normal.first,normal.next,'ordinary playback interpolates its camera');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',true);
  const reduced=await evaluate(cameraSamples);assert.deepEqual(reduced.first,reduced.next,'reduced-motion playback cuts directly to the target');assert.equal(reduced.wash,'0');assert.equal(reduced.duration,normal.duration);
  await evaluate('Archify.story.setView("live")',true);
  assert.deepEqual(await evaluate(`(${motionState})(window)`),reducedPolicy,'the enhanced native Viewer also respects reduced motion when Live is requested');
  await evaluate('Archify.story.setView("story")',true);
  assert.deepEqual(await evaluate(`(${motionState})(document.querySelector('.story-panel iframe').contentWindow)`),reducedPolicy,'interactive Story playback keeps its original reduced-motion policy');
  const rendered=await evaluate(`(async()=>{
    let result;await Archify.story.exportVideo({seconds:.1,onProgress:()=>{
      if(result)return;const win=document.querySelector('.story-render-frame').contentWindow,start=win.Story.shots[1].start;
      Object.defineProperty(win.document,'hidden',{configurable:true,get:()=>true});win.document.dispatchEvent(new win.Event('visibilitychange'));
      result={first:win.Story.seek(start+.1).camera,next:win.Story.seek(start+.8).camera,wash:win.document.querySelector('.transition-light').style.opacity,
        ...(${motionState})(win)};
    }});return result;
  })()`,true);
  assert.notDeepEqual(rendered.first,rendered.next,'export keeps authored camera motion despite the viewer preference');assert.ok(Number(rendered.wash)>0);
  assert.ok(rendered.transfers>0,'export retains native connection animations under reduced motion and hidden-document suspension');assert.equal(rendered.mode,'live');
  assert.equal(rendered.render,true);assert.equal(rendered.reduced,false);assert.equal(rendered.media,'not all','the export override belongs to its isolated stylesheet');
  assert.equal(await evaluate('document.querySelectorAll(".story-render-frame").length'),0,'the export context is removed after completion');
  assert.deepEqual(await evaluate(`(${motionState})(window)`),reducedPolicy,'export leaves the parent Viewer and its stylesheet unchanged');
  assert.deepEqual(await evaluate(`(${motionState})(document.querySelector('.story-panel iframe').contentWindow)`),reducedPolicy,'export leaves interactive Story playback and its stylesheet unchanged');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate('localStorage.setItem("archify-motion","live");Archify.story.setView("still")',true);
  assert.equal(await evaluate('localStorage.getItem("archify-motion")'),'live','programmatic changes do not overwrite a saved reader preference');
  await evaluate('document.querySelector("#btn-motion").click()');await evaluate('Archify.story.setView("story")',true);
  await evaluate('document.querySelector("#btn-motion").click()');
  assert.equal(await evaluate('localStorage.getItem("archify-motion")'),'live','clicking from Story to Live saves the preference');
  await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))',true);await evaluate('document.querySelector("#btn-motion").click()');
  assert.equal(await evaluate('localStorage.getItem("archify-motion")'),null,'clicking Still clears the saved Live preference');
  const reloaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.reload');await reloaded;
  assert.equal(await evaluate('Archify.motionGovernor.mode()'),'still','the reader selection survives reload');
  const longLoaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(longOutput).href});await longLoaded;
  await evaluate('Archify.story.setView("story")',true);
  const rejected=await evaluate(`(async()=>{
    Archify.story.seek(8);const task=Archify.story.exportVideo();Archify.story.cancelExport();
    try{await task;return {message:'Unexpected success'};}catch(error){return {message:error.message,frames:document.querySelectorAll('.story-render-frame').length,time:Archify.story.state().time};}
  })()`,true);
  assert.match(rejected.message,/supported buffer budget/,'oversized export is rejected before cancellation or frame encoding');assert.equal(rejected.frames,0);assert.equal(rejected.time,8);
  const supported=await evaluate(`(async()=>{
    const task=Archify.story.exportVideo({seconds:110});Archify.story.cancelExport();
    try{await task;return 'Unexpected success';}catch(error){return error.name;}
  })()`,true);
  assert.equal(supported,'AbortError','a normal full-story range passes preflight without encoding in this cancellation probe');
  const audio=await evaluate(`(async()=>{
    const win=document.querySelector('.story-panel iframe').contentWindow,allocations=[],starts=[],sources=[];
    let refill;const refilled=new Promise(resolve=>refill=resolve);
    const ArrayType=win.Float32Array;win.Float32Array=new Proxy(ArrayType,{construct(target,args){if(typeof args[0]==='number'&&args[0]>48000*30)throw Error('Unbounded soundtrack allocation');return Reflect.construct(target,args);}});
    const proto=win.AudioContext.prototype,createBuffer=proto.createBuffer,createSource=proto.createBufferSource;
    proto.createBuffer=function(channels,length,rate){allocations.push(length/rate);if(length>rate*4)throw Error('Unbounded playback buffer');return createBuffer.call(this,channels,length,rate);};
    proto.createBufferSource=function(){const source=createSource.call(this),start=source.start.bind(source);sources.push(source);source.start=(at,...args)=>{starts.push(at);const result=start(at,...args);if(starts.length===3)refill();return result;};return source;};
    win.Story.seek(8);win.Story.setSound(true);await win.Story.play();
    let timeout;try{await Promise.race([refilled,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Audio buffers were not replenished')),8000))]);}finally{clearTimeout(timeout);}
    const playing=win.Story.metrics().audioPlaying;win.Story.pause();
    const count=allocations.length;await new Promise(resolve=>setTimeout(resolve,100));const stopped=sources.every(source=>source.buffer===null);
    win.Story.seek(99990);await win.Story.play();const latePlaying=win.Story.metrics().audioPlaying;win.Story.pause();
    return {allocations,starts:starts.slice(0,count),playing,latePlaying,stopped,afterPause:allocations.length-count};
  })()`,true);
  assert.equal(audio.playing,true);assert.equal(audio.latePlaying,true);assert.equal(audio.stopped,true);
  assert.ok(audio.allocations.every(seconds=>seconds<=4));assert.ok(audio.starts.length>=3,'playback replenishes its scheduled buffers');
  for(let i=1;i<audio.starts.length;i++)assert.ok(Math.abs(audio.starts[i]-audio.starts[i-1]-4)<.00001,'adjacent audio blocks share the same clock boundary');
  assert.equal(audio.afterPause,2,'only the explicit late-seek play allocates after pause');
  const lateVideo=await evaluate(`(async()=>{
    const player=document.querySelector('.story-panel iframe').contentWindow;
    const expected=player.StorySound.renderer(player.Story.duration,player.Story.audioCues,1800)(.1);
    let peak=0,comparedSamples=0,maxSampleError=0;const blob=await Archify.story.exportVideo({start:1800,seconds:.1,onProgress:()=>{
      const win=document.querySelector('.story-render-frame').contentWindow;
      if(win.audioAllocationProbe)return;win.audioAllocationProbe=true;
      const ArrayType=win.Float32Array;win.Float32Array=new Proxy(ArrayType,{construct(target,args){
        if(typeof args[0]==='number'){peak=Math.max(peak,args[0]);if(args[0]>48000*30)throw Error('Export synthesized an unused prefix');}
        return Reflect.construct(target,args);
      }});
      const encode=win.AudioEncoder.prototype.encode;
      win.AudioEncoder.prototype.encode=function(frame){
        const offset=Math.round(frame.timestamp*frame.sampleRate/1e6);
        for(let channel=0;channel<frame.numberOfChannels;channel++){
          const samples=new win.Float32Array(frame.numberOfFrames);frame.copyTo(samples,{planeIndex:channel,format:'f32-planar'});
          for(let index=0;index<samples.length;index++)maxSampleError=Math.max(maxSampleError,Math.abs(samples[index]-expected.channels[channel][offset+index]));
          comparedSamples+=samples.length;
        }
        return encode.call(this,frame);
      };
    }});
    const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
    return {peak,bytes:blob.size,base64,comparedSamples,maxSampleError};
  })()`,true);
  assert.ok(lateVideo.bytes>0);assert.ok(lateVideo.peak<=48000*30,'late exports keep the fixed music bed and requested audio window bounded');
  assert.equal(lateVideo.comparedSamples,4800*2);assert.ok(lateVideo.maxSampleError<=1e-6,'partial export preserves the preview soundtrack instead of fading at the clip boundary: '+lateVideo.maxSampleError);
  if(process.env.ARCHIFY_FFMPEG){
    const file=path.join(dir,'late-story.webm');fs.writeFileSync(file,Buffer.from(lateVideo.base64,'base64'));
    const decoded=spawnSync(process.env.ARCHIFY_FFMPEG,['-v','error','-i',file,'-map','0:a:0','-f','f32le','-ac','2','-ar','48000','-'],{timeout:15000});
    assert.equal(decoded.status,0,decoded.stderr?.toString());assert.equal(decoded.stderr.toString(),'');assert.ok(Math.abs(decoded.stdout.length/(48000*2*4)-.1)<.03);assert.ok(decoded.stdout.some(byte=>byte!==0));
  }
  assert.deepEqual(errors,[]);
});

test('flowless guides stay out of the story opening clock',{
  skip:chrome?false:'Set ARCHIFY_CHROME for the real-browser story check.',
},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-story-opening-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.join(skill,'bin/archify.mjs');
  const waterfall=fs.readFileSync(path.join(skill,'examples/waterfall-checkout-request-rendered.html'),'utf8');
  const svgEnd=waterfall.indexOf('</svg>',waterfall.indexOf('data-waterfall-ui'));
  // A late card plus one long unanimated guide crosses the 6s opening only when that guide is counted.
  const extended=waterfall.slice(0,svgEnd)+'<g id="node-late" data-node-id="late" data-node-label="Late span"><rect x="20" y="250" width="40" height="14" data-animate="node" style="--step:20"/></g><path data-edge-from="request" data-edge-to="late" data-edge-key="9" d="M 20 260 H 620" fill="none" stroke="#888"/>'+waterfall.slice(svgEnd);
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise,errors=[];
  browser.cdp.subscribe(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);});
  const send=(method,params={})=>browser.cdp.send(method,params,session,30000);
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});assert.equal(result.exceptionDetails,undefined,result.exceptionDetails?.exception?.description);return result.result?.value;};
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  async function attach(name,html){
    const source=path.join(dir,name+'.html'),plan=path.join(dir,name+'.json'),output=path.join(dir,name+'-story.html');
    fs.writeFileSync(source,html);execFileSync(process.execPath,[cli,'story','draft',source,plan,'--json']);
    const brief=JSON.parse(fs.readFileSync(plan,'utf8'));brief.intro='Open the diagram.';brief.outro='Return to the whole diagram.';brief.opening='fit';
    for(const scene of brief.scenes)for(const point of scene.points)point.text='Explain this source point.';
    fs.writeFileSync(plan,JSON.stringify(brief));execFileSync(process.execPath,[cli,'story','attach',source,plan,output,'--json']);
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(output).href});await loaded;
    return evaluate(`(async()=>{await Archify.story.setView('story');const win=document.querySelector('.story-panel iframe').contentWindow;if(!win.storyReady)throw Error('Story did not initialize');const opening=win.Story.shots[0].motion.opening;return {rate:opening.rate,span:opening.span,wireStart:opening.wireStart};})()`);
  }
  const bundled=await attach('waterfall',waterfall);
  assert.equal(bundled.rate,1,'the bundled waterfall opening stays on the node clock');
  assert.equal(bundled.span,bundled.wireStart,'waterfall guides without a transfer do not extend the opening');
  const stretched=await attach('stretched',extended);
  assert.equal(stretched.rate,1,'a long flowless guide does not speed up the opening');
  assert.equal(stretched.span,stretched.wireStart);
  const traced=await attach('workflow',fs.readFileSync(path.join(skill,'examples/workflow-agent-tool-call-rendered.html'),'utf8'));
  assert.ok(Number.isFinite(traced.rate)&&traced.rate>=1,'native transfers keep a finite opening rate');
  assert.ok(traced.span>traced.wireStart,'native transfers still extend the opening clock');
  assert.deepEqual(errors,[]);
});
