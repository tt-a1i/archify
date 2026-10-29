const fs=await import('node:fs/promises'),root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round18',p=(await taskSpace(14)).page('p1'),out=[];
await fs.mkdir(root+'/screens',{recursive:true});
const cases=[...['pie','bar','latency','dense'].flatMap(c=>['base','width-332','width-292'].map(a=>[c,a,390])),['pie','width-332',320],['pie','width-332',1440]];
for(const [c,a,width] of cases){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+root+'/pages/'+c+'-'+a+'.html');await p.click('[data-theme-choice="light"]');
 await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const row=await p.evaluate(()=>{const f=document.querySelector('.chart'),s=f.querySelector('svg');return{theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,pageWidth:document.documentElement.scrollWidth,svgWidth:s.getBoundingClientRect().width,panelHeight:f.closest('.panel').getBoundingClientRect().height,labels:[...s.querySelectorAll('text')].filter(e=>!['transparent','rgba(0, 0, 0, 0)'].includes(getComputedStyle(e).fill)).map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent,px:parseFloat(getComputedStyle(e).fontSize)*Math.hypot(e.getScreenCTM().a,e.getScreenCTM().b),x:r.x,y:r.y,width:r.width,height:r.height};})};});out.push({case:c,variant:a,width,...row});
 await p.evaluate(()=>{const f=document.querySelector('.chart');scrollTo(0,Math.max(0,f.getBoundingClientRect().top+scrollY-70));});
 const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(root+'/screens/'+c+'-'+a+'-'+width+'.png',Buffer.from(shot.data,'base64'));
}
await fs.writeFile(root+'/browser-01.json',JSON.stringify(out,null,2));console.log(out.map(x=>({case:x.case,variant:x.variant,width:x.width,style:x.style,svgWidth:x.svgWidth,panelHeight:x.panelHeight,min:Math.min(...x.labels.map(l=>l.px))})));
