const fs=await import('node:fs/promises');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round24',p=(await taskSpace(14)).page('p1'),rows=[];
await p.goto('file://'+root+'/reviewed/candidate.html');
for(const width of [390,1440]){
  await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  for(const theme of ['light','dark']){
    await p.click(`[data-theme-choice="${theme}"]`);
    await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
    const row=await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,panels:[...document.querySelectorAll('.panel')].map(e=>({title:e.querySelector('h2,h3')?.textContent,height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top+scrollY,bottom:e.getBoundingClientRect().bottom+scrollY})),tables:[...document.querySelectorAll('table')].map(e=>({width:e.getBoundingClientRect().width,client:e.parentElement.clientWidth,scroll:e.parentElement.scrollWidth}))}));
    for(const [pos,y] of [['top',0],['bottom',Math.max(0,row.height-900)]]){
      await p.evaluate(y=>scrollTo(0,y),y);
      await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await fs.writeFile(`${root}/screenshots/candidate-${width}-${theme}-${pos}.png`,Buffer.from(s.data,'base64'));
    }
    rows.push(row);
  }
}
await fs.writeFile(root+'/candidate-visual-metrics.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows));
