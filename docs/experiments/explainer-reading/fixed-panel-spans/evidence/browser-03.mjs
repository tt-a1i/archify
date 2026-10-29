const fs=await import('node:fs/promises'),crypto=await import('node:crypto'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round28',p=(await taskSpace(14)).page('p1'),results=[];
for(const name of ['thread','native-explicit'])for(const variant of ['base','candidate']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await p.goto(`file://${r}/${variant}/${name}.html`);await p.evaluate(()=>document.querySelector('[data-style-choice="editorial"]').click());
 for(const theme of ['light','dark']){
  await p.click(`[data-theme-choice="${theme}"]`);await p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));scrollTo(0,0);});
  const state=await p.evaluate(()=>({theme:document.documentElement.dataset.theme,panels:[...document.querySelectorAll('.panel')].map(e=>({id:e.id,fixed:e.dataset.spanFixed,column:getComputedStyle(e).gridColumn,height:e.getBoundingClientRect().height,clipped:e.scrollHeight>e.clientHeight+1})),native:[...document.querySelectorAll('.diagram-preview')].map(e=>({fit:e.dataset.diagramFit,required:e.dataset.diagramRequiredWidth,width:e.clientWidth})),notices:[...document.querySelectorAll('.diagram-fit-status')].map(e=>({hidden:e.hidden,text:e.textContent}))}));
  const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(shot.data,'base64');await fs.writeFile(`${r}/screenshots/settled-${variant}-${name}-${theme}.png`,bytes);results.push({name,variant,...state,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
}
await fs.writeFile(r+'/settled-native-check.json',JSON.stringify(results,null,2)+'\n');console.log(results);
