const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round26',p=(await taskSpace(14)).page('p1'),rows=[];
await fs.mkdir(root+'/screenshots',{recursive:true});
const cases=[['manual','/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/rust-default/author/answer.html'],['automatic',root+'/candidate-original.html']];
for(const [name,file] of cases){
 await p.goto('file://'+file);
 for(const width of [390,1440]){
  await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await p.click('[data-theme-choice="light"]');
  await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
  const row=await p.evaluate(()=>({width:innerWidth,theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,documentWidth:document.documentElement.scrollWidth,ids:[...document.querySelectorAll('[id]')].map(e=>e.id),rows:[...document.querySelectorAll('#observation tbody tr')].map(e=>({id:e.id,cells:[...e.children].map(c=>c.textContent)})),table:{width:document.querySelector('#observation table').getBoundingClientRect().width,client:document.querySelector('#observation .table-scroll').clientWidth}}));
  row.name=name;
  await p.evaluate(width=>scrollTo(0,width===390?document.querySelector('#observation table').getBoundingClientRect().top+scrollY-80:0),width);
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(shot.data,'base64');
  row.screenshotSha256=crypto.createHash('sha256').update(bytes).digest('hex');await fs.writeFile(`${root}/screenshots/${name}-${width}.png`,bytes);rows.push(row);
 }
}
const target=rows.find(r=>r.name==='automatic').rows[1].id;
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+root+'/candidate-original.html#'+target);
await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
const linked=await p.evaluate(()=>{const e=document.querySelector(':target'),r=e.getBoundingClientRect();return {hash:location.hash,id:e.id,cells:[...e.children].map(c=>c.textContent),top:r.top,bottom:r.bottom,height:innerHeight};});
const result={scope:'same visible author content, manual IDs versus automatic repeated-row IDs; original phone tables still need horizontal scrolling',rows,linked,pixelMatches:[390,1440].map(width=>({width,identical:rows.find(r=>r.name==='manual'&&r.width===width).screenshotSha256===rows.find(r=>r.name==='automatic'&&r.width===width).screenshotSha256}))};
if(rows.some(r=>r.ids.length!==new Set(r.ids).size))throw new Error('Duplicate DOM IDs');
if(linked.id!==target||linked.top<0||linked.top>=linked.height)throw new Error('Row link missed its visible target');
await fs.writeFile(root+'/browser-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pixelMatches:result.pixelMatches,linked,rowCounts:rows.map(r=>({name:r.name,width:r.width,rows:r.rows.length,table:r.table}))}));
