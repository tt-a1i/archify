const fs=await import('node:fs/promises'),root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round21',p=(await taskSpace(14)).page('p1');
await fs.mkdir(root+'/screens',{recursive:true});
const cases=[['jq-matrix','jq-default/author/answer.html'],['gzip-matrix','gzip-size/author/answer.html'],['jq-two-column','jq-default/candidate.html']],results=[];
for(const [id,file] of cases){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/'+file);
 await p.click('[data-theme-choice="light"]');await p.press('.style-menu [aria-haspopup]','Enter');await p.press('[data-style-choice="editorial"]','Enter');
 await p.waitForFunction(()=>document.documentElement.dataset.style==='editorial');await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const initial=await p.evaluate(()=>{const w=document.querySelector('.table-scroll'),last=w.querySelector('thead th:last-child'),wr=w.getBoundingClientRect(),lr=last.getBoundingClientRect();return {userAgent:navigator.userAgent,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,scrollWidth:w.scrollWidth,clientWidth:w.clientWidth,tabIndex:w.tabIndex,explicitTabIndex:w.getAttribute('tabindex'),ariaLabel:w.getAttribute('aria-label'),lastHeader:last.textContent,lastHeaderRight:lr.right,clipRight:wr.right,lastColumnFullyVisible:lr.right<=wr.right+1,tableText:w.textContent};});
 await p.evaluate(()=>{const w=document.querySelector('.table-scroll');scrollTo(0,w.getBoundingClientRect().top+scrollY-50);});
 const before=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/'+id+'-before.png',Buffer.from(before.data,'base64'));
 await p.focus('[data-theme-choice="system"]');const trace=[];let reached=false;
 for(let n=1;n<=70;n++){
  await p.keyboard.press('Tab');
  const active=await p.evaluate(()=>{const e=document.activeElement;return {tag:e.tagName,id:e.id,classes:typeof e.className==='string'?e.className:'',text:e.textContent?.slice(0,80),theme:e.getAttribute('data-theme-choice'),isTable:e.classList.contains('table-scroll')};});trace.push({step:n,...active});
  if(active.isTable){reached=true;break;}if(n>1&&active.theme==='system')break;
 }
 let after=null;
 if(reached){for(let n=0;n<8;n++)await p.keyboard.press('ArrowRight');await p.waitForFunction(()=>document.querySelector('.table-scroll').scrollLeft>0,undefined,{timeout:5000});
  after=await p.evaluate(()=>{const w=document.querySelector('.table-scroll'),last=w.querySelector('thead th:last-child'),wr=w.getBoundingClientRect(),lr=last.getBoundingClientRect();return {activeTable:document.activeElement===w,scrollLeft:w.scrollLeft,maxScroll:w.scrollWidth-w.clientWidth,lastHeaderRight:lr.right,clipRight:wr.right,lastColumnFullyVisible:lr.right<=wr.right+1};});
  const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/'+id+'-after-arrow.png',Buffer.from(shot.data,'base64'));
 }
 const result={id,file,initial,trace,reached,after};results.push(result);await fs.writeFile(root+'/baseline-keyboard.json',JSON.stringify(results,null,2));console.log({id,initial,reached,steps:trace.length,after});
}
