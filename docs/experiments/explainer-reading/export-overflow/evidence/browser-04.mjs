const fs=await import('node:fs/promises'),root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round21',p=(await taskSpace(14)).page('p1'),rows=[];
for(const [id,file] of [['gzip','gzip-size/author/answer.html'],['control','jq-default/candidate.html']]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/'+file);await p.click('[data-theme-choice="light"]');await p.focus('[data-theme-choice="auto"]');
 let trace=[];
 for(let i=1;i<=70;i++){await p.keyboard.press('Tab');const e=await p.evaluate(()=>({table:document.activeElement.classList.contains('table-scroll'),theme:document.activeElement.getAttribute('data-theme-choice'),tag:document.activeElement.tagName,cls:document.activeElement.className}));trace.push(e);if(e.table||(i>1&&e.theme==='auto'))break;}
 const reached=trace.at(-1).table;
 if(reached)for(let i=0;i<8;i++)await p.keyboard.press('ArrowRight');
 const read=()=>p.evaluate(()=>{const w=document.querySelector('.table-scroll'),e=w.querySelector('thead th:last-child');return {width:innerWidth,active:document.activeElement.className,scrollLeft:w.scrollLeft,maxScroll:w.scrollWidth-w.clientWidth,lastRight:e.getBoundingClientRect().right,clipRight:w.getBoundingClientRect().right};});
 const beforeCapture=await read();
 const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/'+id+'-after-frame.png',Buffer.from(shot.data,'base64'));
 const afterCapture=await read();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const afterFrames=await read();
 rows.push({id,file,reached,trace,beforeCapture,afterCapture,afterFrames});await fs.writeFile(root+'/frame-observation.json',JSON.stringify(rows,null,2));console.log({id,reached,steps:trace.length,beforeCapture,afterCapture,afterFrames});
}
