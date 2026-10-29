const fs=await import('node:fs/promises');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round27',p=(await taskSpace(14)).page('p1');
await fs.mkdir(root+'/screenshots',{recursive:true});
await p.goto('file://'+root+'/attempts/candidate-2.html');const results=[];
for(const width of [390,1440])for(const theme of ['light','dark']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.click('[data-theme-choice="'+theme+'"]');
 await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 results.push(await p.evaluate(()=>({width:innerWidth,theme:document.documentElement.dataset.theme,height:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,panels:[...document.querySelectorAll('.panel')].map(e=>({id:e.id,height:e.getBoundingClientRect().height})),overflow:[...document.querySelectorAll('.table-scroll,.snippet pre,.snippet-code,.diagram-frame')].map(e=>({tag:e.tagName,classes:e.className,width:e.clientWidth,scrollWidth:e.scrollWidth}))})));
 for(const pos of ['top','middle','bottom']){await p.evaluate(pos=>scrollTo(0,pos==='top'?0:pos==='middle'?document.documentElement.scrollHeight/2-450:document.documentElement.scrollHeight),pos);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${root}/screenshots/candidate-2-${width}-${theme}-${pos}.png`,Buffer.from(shot.data,'base64'));}
}
await fs.writeFile(root+'/candidate-2-metrics.json',JSON.stringify(results,null,2)+'\n');console.log(results);
