const fs=await import('node:fs/promises'),assert=(await import('node:assert/strict')).default;
const r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round31',repo='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify',p=(await taskSpace(14)).page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+r+'/candidate-390-light.png');
const image=await p.evaluate(async()=>{let i=document.querySelector('img');await i.decode();document.body.style.margin='0';i.style.cssText='display:block;width:390px;max-width:none;height:auto;margin:0';return {width:i.naturalWidth,height:i.naturalHeight};});
for (const [name,y] of [['top',0],['middle',850],['bottom',99999]]) {await p.evaluate(y=>scrollTo(0,y),y);const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/export-'+name+'.png',Buffer.from(shot.data,'base64'));}
await p.goto('file://'+repo+'/docs/experiments/explainer-reading/index.html#openrsync');
const states=[];
for(const version of [0,1]) {await p.click('#versions button >> nth='+version);for(const width of [390,1440]) {await p.click('[data-width="'+width+'"]');const state=await p.evaluate(()=>({title:document.querySelector('#case-title').textContent,src:document.querySelector('iframe').src,open:document.querySelector('#open-link').href,width:document.querySelector('iframe').style.width,report:document.querySelector('#source-link').getAttribute('href'),cases:document.querySelectorAll('.case').length}));assert.equal(state.src,state.open);assert.equal(state.width,width+'px');assert.equal(state.cases,15);assert.equal(state.report,'openrsync-slash/README.md');assert.ok(state.src.endsWith(version===0?'openrsync-slash/candidate.html':'openrsync-slash/author/answer.html'));states.push(state);}}
await fs.writeFile(r+'/export-index-check.json',JSON.stringify({image,states},null,2)+'\n');
console.log({image,indexStates:states.length,caseCount:15});
