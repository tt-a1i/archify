const fs=await import('node:fs/promises');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round25',p=(await taskSpace(14)).page('p1'),rows=[];
for(const [name,path] of [['author','author/answer.html'],['candidate','reviewed/candidate.html']]){
 await p.goto('file://'+root+'/'+path);
 for(const width of [390,1440]){
  await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  for(const theme of ['light','dark']){
   await p.click(`[data-theme-choice="${theme}"]`);
   await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
   const row=await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,panels:[...document.querySelectorAll('.panel')].map(e=>({id:e.id,height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top+scrollY})),tables:[...document.querySelectorAll('table')].map(e=>({width:e.getBoundingClientRect().width,client:e.parentElement.clientWidth,scroll:e.parentElement.scrollWidth})),snippets:[...document.querySelectorAll('.snippet')].map(e=>({title:e.querySelector('figcaption')?.textContent,code:e.querySelector('pre code').textContent,client:e.querySelector('pre').clientWidth,scroll:e.querySelector('pre').scrollWidth}))}));
   row.name=name;rows.push(row);
   for(const [pos,y] of [['top',0],['bottom',row.height-900]]){
    await p.evaluate(y=>scrollTo(0,y),y);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await fs.writeFile(`${root}/screenshots/${name}-${width}-${theme}-${pos}.png`,Buffer.from(shot.data,'base64'));
   }
  }
 }
}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.click('[data-theme-choice="light"]');
await p.evaluate(()=>{window.capturedCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.capturedCopies.push(text);}}});});
for(let i=0;i<3;i++){await p.click('[data-copy] >> nth='+i);await p.waitForFunction(n=>window.capturedCopies.length===n,i+1);}
const copied=await p.evaluate(()=>({mode:'Clipboard API writeText interception; not OS clipboard acceptance',copies:window.capturedCopies,rendered:[...document.querySelectorAll('.snippet pre code')].map(e=>e.textContent)}));
await fs.writeFile(root+'/copied-example.rs',copied.copies[0]);
await fs.writeFile(root+'/copy-check.json',JSON.stringify(copied,null,2)+'\n');
await fs.writeFile(root+'/visual-metrics.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows.map(({name,width,theme,height,scrollWidth,tables,snippets})=>({name,width,theme,height,scrollWidth,tables,snippets:snippets.map(({title,client,scroll})=>({title,client,scroll}))}))));
