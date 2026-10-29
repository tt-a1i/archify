const fs=await import('node:fs/promises');
const root='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/rust-default',p=(await taskSpace(14)).page('p1'),rows=[];
await p.goto('file://'+root+'/candidate.html');
for(const width of [390,1440]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 for(const theme of ['light','dark']){
  await p.click(`[data-theme-choice="${theme}"]`);
  await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
  const row=await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,tables:[...document.querySelectorAll('table')].map(e=>({width:e.getBoundingClientRect().width,client:e.parentElement.clientWidth,scroll:e.parentElement.scrollWidth})),snippets:[...document.querySelectorAll('.snippet')].map(e=>({title:e.querySelector('figcaption')?.textContent,client:e.querySelector('pre').clientWidth,scroll:e.querySelector('pre').scrollWidth}))}));
  rows.push(row);
  const positions=width===390?[['top',0],['middle',900],['bottom',row.height-900]]:[['top',0],['bottom',row.height-900]];
  for(const [pos,y] of positions){await p.evaluate(y=>scrollTo(0,y),y);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${root}/screenshots/final-${width}-${theme}-${pos}.png`,Buffer.from(s.data,'base64'));}
 }
}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.click('[data-theme-choice="light"]');
await p.evaluate(()=>{window.capturedCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.capturedCopies.push(text)}});});
for(let i=0;i<3;i++){await p.click('[data-copy] >> nth='+i);await p.waitForFunction(n=>window.capturedCopies.length===n,i+1);}
const copied=await p.evaluate(()=>({mode:'Clipboard API writeText interception; not OS clipboard acceptance',copies:window.capturedCopies,rendered:[...document.querySelectorAll('.snippet pre code')].map(e=>e.textContent)}));
await fs.writeFile(root+'/evidence/final-copied-example.rs',copied.copies[0]);
await fs.writeFile(root+'/evidence/final-copy-check.json',JSON.stringify(copied,null,2)+'\n');
await p.press('[data-export-toggle]','Enter');
const wait=p.waitForEvent('download',{timeout:30000});await p.click('[data-export-image="png"]');const d=await wait;await d.saveAs(root+'/candidate-390-light.png');
await fs.writeFile(root+'/evidence/final-visual-metrics.json',JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows));
