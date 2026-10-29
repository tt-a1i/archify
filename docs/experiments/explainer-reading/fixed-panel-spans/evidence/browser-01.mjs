const fs=await import('node:fs/promises'),crypto=await import('node:crypto'),assert=(await import('node:assert/strict')).default;
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round28',p=(await taskSpace(14)).page('p1'),results=[];
await fs.mkdir(root+'/screenshots',{recursive:true});
for(const name of ['git-explicit','git-auto','rust','jq','thread','pie','native'])for(const variant of ['base','candidate']){
 await p.goto(`file://${root}/${variant}/${name}.html`);
 await p.evaluate(()=>document.querySelector('[data-style-choice="editorial"]').click());
 for(const width of [390,1440])for(const theme of ['light','dark']){
  await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.click(`[data-theme-choice="${theme}"]`);
  await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));await p.evaluate(()=>scrollTo(0,0));
  const row=await p.evaluate(()=>({width:innerWidth,theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,documentWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,panels:[...document.querySelectorAll('.panel')].map(e=>{const b=e.getBoundingClientRect();return {id:e.id,fixed:e.dataset.spanFixed||null,column:getComputedStyle(e).gridColumn,x:b.x,y:b.y,width:b.width,height:b.height,clipped:e.scrollHeight>e.clientHeight+1};}),localScroll:[...document.querySelectorAll('.table-scroll,.diff-scroll,.snippet pre')].map(e=>({className:e.className,width:e.clientWidth,scroll:e.scrollWidth,text:e.textContent})),text:document.querySelector('#board').textContent}));
  row.name=name;row.variant=variant;
  if(theme==='light'||name==='git-explicit'||name==='thread'){
   const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(shot.data,'base64');row.screenshotSha256=crypto.createHash('sha256').update(bytes).digest('hex');await fs.writeFile(`${root}/screenshots/${variant}-${name}-${width}-${theme}.png`,bytes);
  }results.push(row);
 }
}
const comparisons=[];for(const base of results.filter(r=>r.variant==='base')){const c=results.find(r=>r.variant==='candidate'&&r.name===base.name&&r.width===base.width&&r.theme===base.theme);assert.equal(c.text,base.text);const automatic=!base.panels.some(p=>p.fixed);if(automatic)assert.deepEqual(c.panels,base.panels);if(base.width===390)assert.deepEqual(c.panels,base.panels);comparisons.push({name:base.name,width:base.width,theme:base.theme,automatic,panelsIdentical:JSON.stringify(c.panels)===JSON.stringify(base.panels),baseHeight:base.height,candidateHeight:c.height,pngBytesIdentical:base.screenshotSha256?c.screenshotSha256===base.screenshotSha256:null});}
await fs.writeFile(root+'/browser-comparison.json',JSON.stringify({results,comparisons},null,2)+'\n');console.log(comparisons);
