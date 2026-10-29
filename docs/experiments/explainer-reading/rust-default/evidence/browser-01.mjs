const fs=await import('node:fs/promises');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round25',p=(await taskSpace(14)).page('p1');
await fs.mkdir(root+'/screenshots',{recursive:true});
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+root+'/author/answer.html');
await p.click('[data-theme-choice="light"]');
await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
const m=await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,tables:[...document.querySelectorAll('table')].map(e=>({width:e.getBoundingClientRect().width,client:e.parentElement.clientWidth,scroll:e.parentElement.scrollWidth,top:e.getBoundingClientRect().top+scrollY})),snippets:[...document.querySelectorAll('.snippet')].map(e=>({code:e.querySelector('code').textContent,scroll:e.querySelector('pre').scrollWidth,client:e.querySelector('pre').clientWidth})),panels:[...document.querySelectorAll('.panel')].map(e=>({id:e.id,top:e.getBoundingClientRect().top+scrollY,height:e.getBoundingClientRect().height}))}));
for(const [label,y] of [['top',0],['table',m.tables[0].top-80],['bottom',m.height-900]]){
 await p.evaluate(y=>scrollTo(0,y),y);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+`/screenshots/author-390-light-${label}.png`,Buffer.from(s.data,'base64'));
}
await fs.writeFile(root+'/author-390.json',JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify(m));
