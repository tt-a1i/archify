const fs=await import('node:fs/promises');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round17';
const t=await taskSpace(14),p=t.page('p1'),rows=[];
await fs.mkdir(root+'/screens',{recursive:true});
for(const chart of ['pie','bar','latency'])for(const width of [390,1440])for(const arm of ['base','candidate']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto('file://'+root+'/pages/'+chart+'-'+arm+'.html');
 await p.click('[data-theme-choice="light"]');
 await p.press('.style-menu [aria-haspopup]','Enter'); await p.press('[data-style-choice="clean"]','Enter');
 await p.waitForFunction(()=>document.documentElement.dataset.theme==='light'&&document.documentElement.dataset.style==='clean');
 await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const metrics=await p.evaluate(()=>{
  const f=document.querySelector('.chart'),s=f.querySelector('svg'),v=f.querySelector('.chart-viewport'),h=f.querySelector('.chart-fit-status');
  return {pageWidth:document.documentElement.scrollWidth,svgWidth:s.getBoundingClientRect().width,viewBox:s.getAttribute('viewBox'),viewport:v?{client:v.clientWidth,scroll:v.scrollWidth,tab:v.tabIndex,fit:v.dataset.chartFit}:null,hint:h?{hidden:h.hidden,text:h.textContent}:null,panelHeight:f.closest('.panel').getBoundingClientRect().height,labels:[...s.querySelectorAll('text')].filter(x=>getComputedStyle(x).fill!=='transparent'&&getComputedStyle(x).fill!=='rgba(0, 0, 0, 0)').map(x=>({text:x.textContent,px:parseFloat(getComputedStyle(x).fontSize)*Math.hypot(x.getScreenCTM().a,x.getScreenCTM().b)}))};
 });
 rows.push({chart,width,arm,theme:'light',...metrics});
 await p.evaluate(()=>{const f=document.querySelector('.chart');scrollTo(0,Math.max(0,f.getBoundingClientRect().top+scrollY-80));});
 const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/'+chart+'-'+arm+'-'+width+'.png',Buffer.from(shot.data,'base64'));
 if(width===390&&arm==='candidate'){
  await p.click('[data-theme-choice="dark"]');
  await p.evaluate(()=>{const f=document.querySelector('.chart');scrollTo(0,Math.max(0,f.getBoundingClientRect().top+scrollY-80));});
  const dark=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/'+chart+'-candidate-390-dark.png',Buffer.from(dark.data,'base64'));
 }
}
await fs.writeFile(root+'/browser-02.json',JSON.stringify(rows,null,2));
console.log(rows.map(({chart,width,arm,pageWidth,svgWidth,viewport,labels})=>({chart,width,arm,pageWidth,svgWidth,viewport,minimum:Math.min(...labels.map(x=>x.px))})));
