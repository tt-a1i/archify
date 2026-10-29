const fs=await import('node:fs/promises'),root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round20',p=(await taskSpace(14)).page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/jq-default/candidate.html');
await p.click('[data-theme-choice="light"]');
await p.evaluate(()=>{window.capturedCopies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.capturedCopies.push(text);}}});});
for(let i=0;i<5;i++){
 await p.click('[data-copy] >> nth='+i);
 await p.waitForFunction(n=>window.capturedCopies.length===n,i+1);
}
const copied=await p.evaluate(()=>({width:innerWidth,mode:'Clipboard API interception, not OS clipboard',copies:window.capturedCopies,rendered:[...document.querySelectorAll('.snippet pre code')].map(e=>e.textContent),buttons:[...document.querySelectorAll('[data-copy]')].map(e=>e.textContent)}));
await fs.writeFile(root+'/copied-commands.json',JSON.stringify(copied,null,2));
for(const width of [390,1440])for(const theme of ['light','dark']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.click('[data-theme-choice="'+theme+'"]');
 await p.evaluate(()=>{const e=document.querySelector('#stream');scrollTo(0,e.getBoundingClientRect().top+scrollY-12);});
 await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/final-'+width+'-'+theme+'-stream.png',Buffer.from(s.data,'base64'));
}
console.log(copied);
