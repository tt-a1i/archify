const fs=await import('node:fs/promises');
const root='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/pie-reading',p=(await taskSpace(14)).page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+root+'/candidate-390-light.png');
const dimensions=await p.evaluate(async()=>{const i=document.querySelector('img');await i.decode();document.body.style.margin='0';i.style.cssText='display:block;width:390px;height:auto;max-width:none;';return {naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,displayHeight:i.getBoundingClientRect().height};});
for(const [pos,y] of [['top',0],['middle',700],['bottom',dimensions.displayHeight-900]]){
 await p.evaluate(y=>scrollTo(0,y),y);
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await fs.writeFile(root+`/screenshots/export-390-${pos}.png`,Buffer.from(s.data,'base64'));
}
await fs.writeFile(root+'/evidence/export-image.json',JSON.stringify(dimensions,null,2)+'\n');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+root+'/../index.html#pie');
await p.evaluate(()=>{window.pieFrameLoads=0;document.querySelector('iframe').addEventListener('load',()=>window.pieFrameLoads++);});
const views=[];
for(const version of [2,1]){
 const old=await p.evaluate(()=>window.pieFrameLoads);
 await p.click(`#versions button:nth-child(${version})`);
 await p.waitForFunction(old=>window.pieFrameLoads>old,old);
 views.push(await p.evaluate(()=>({title:document.querySelector('#case-title').textContent,frame:document.querySelector('iframe').src,open:document.querySelector('#open-link').href,selected:[...document.querySelectorAll('#versions button')].find(b=>b.getAttribute('aria-pressed')==='true').textContent,loads:window.pieFrameLoads})));
}
await p.click('[data-width="1440"]');
views.push(await p.evaluate(()=>({previewWidth:document.querySelector('iframe').style.width,scaleNote:document.querySelector('#scale-note').textContent})));
await p.click('[data-width="390"]');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
views.push(await p.evaluate(()=>({outerWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth,caseCount:document.querySelectorAll('.case').length,previewWidth:document.querySelector('iframe').style.width,caseTitle:document.querySelector('#case-title').textContent})));
await fs.writeFile(root+'/evidence/index-check.json',JSON.stringify({views,allNewLoadsHaveMatchingLinks:views.filter(v=>v.frame).every(v=>v.frame===v.open)},null,2)+'\n');
console.log(JSON.stringify({dimensions,views}));
console.log(await p.snapshot());
