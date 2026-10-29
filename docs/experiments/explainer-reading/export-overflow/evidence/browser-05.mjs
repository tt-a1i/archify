const fs=await import('node:fs/promises'),root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round21',p=(await taskSpace(14)).page('p1');await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/gzip-size/author/answer.html');await p.focus('.table-scroll');
const rows=[];
for(let i=0;i<3;i++){
 await p.cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,nativeVirtualKeyCode:124});await p.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,nativeVirtualKeyCode:124});
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 rows.push({index:i,normal:await p.evaluate(()=>({left:document.querySelector('.table-scroll').scrollLeft,active:document.activeElement.className})),protocol:await p.cdp('Runtime.evaluate',{expression:'JSON.stringify({left:document.querySelector(".table-scroll").scrollLeft,active:document.activeElement.className,lastRight:document.querySelector("thead th:last-child").getBoundingClientRect().right})',returnByValue:true})});
}
await fs.writeFile(root+'/raw-key-observation.json',JSON.stringify(rows,null,2));console.log(rows);
const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/gzip-raw-arrow.png',Buffer.from(shot.data,'base64'));
await p.press('[data-export-toggle]','Enter');console.log(await p.snapshot());
