const fs=await import('node:fs/promises'),crypto=await import('node:crypto'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round27',p=(await taskSpace(14)).page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+r+'/attempts/candidate-2.html');
await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
const data=await p.evaluate(()=>({width:innerWidth,panels:[...document.querySelectorAll('.panel')].map(e=>({id:e.id,fixed:e.dataset.spanFixed,className:e.className,inlineStyle:e.getAttribute('style'),gridColumn:getComputedStyle(e).gridColumn,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})),source:JSON.parse(document.querySelector('#archify-explainer-prepared').textContent).source}));
await fs.writeFile(r+'/fixed-span-observation.json',JSON.stringify(data,null,2)+'\n');console.log(data);
