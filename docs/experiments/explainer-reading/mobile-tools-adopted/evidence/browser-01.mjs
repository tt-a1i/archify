const fs=await import('node:fs/promises');const r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round40',task=await taskSpace(14),p=task.page('p1');
const rows=[];const settled=()=>p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
await fs.mkdir(r+'/screenshots',{recursive:true});
for(const arm of ['base','candidate'])for(const name of ['taskgroup-0','curl-0'])for(const width of [320,390,1440])for(const theme of ['light','dark']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/'+arm+'/'+name+'.html');await p.press('[data-theme-choice="'+theme+'"]','Enter');
 for(const style of ['clean','editorial','product','swiss']){
  await p.press('[data-style-toggle]','Enter');await p.press('[data-style-choice="'+style+'"]','Enter');await settled();await p.evaluate(()=>scrollTo(0,0));
  const metrics=await p.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,answerTop:document.querySelector('#answer').getBoundingClientRect().top,theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.style,controls:[...document.querySelectorAll('.tools button')].filter(e=>e.getBoundingClientRect().width).map(e=>({text:e.textContent.trim(),...e.getBoundingClientRect().toJSON()}))}));
  const menus=[];
  for(const menu of ['style','export']){
   await p.press('[data-'+menu+'-toggle]','Enter');await settled();await p.evaluate(()=>scrollTo(0,0));
   const state=await p.evaluate(menu=>{const box=document.querySelector('.'+menu+'-menu .menu-options');return {menu,...box.getBoundingClientRect().toJSON(),visible:!box.hidden,focusInside:box.contains(document.activeElement),pageWidth:document.documentElement.scrollWidth};},menu);
   if((width===320||width===390)&&style==='clean'&&theme===(name==='taskgroup-0'?'light':'dark')&&menu==='export'){const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/'+[arm,name,width,theme,menu].join('-')+'.png',Buffer.from(s.data,'base64'));}
   await p.keyboard.press('Escape');state.closed=await p.evaluate(menu=>({hidden:document.querySelector('.'+menu+'-menu .menu-options').hidden,focused:document.activeElement===document.querySelector('[data-'+menu+'-toggle]')}),menu);menus.push(state);
  }
  await p.evaluate(()=>{document.activeElement.blur();scrollTo(0,0);});await settled();
  if(style==='clean'&&theme==='light'&&(width===320||width===1440)){const s=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/'+[arm,name,width,theme,'top'].join('-')+'.png',Buffer.from(s.data,'base64'));}
  const fits=metrics.pageWidth===width&&metrics.controls.every(e=>e.left>=0&&e.right<=width+.1)&&menus.every(e=>e.visible&&e.left>=0&&e.right<=width+.1&&e.pageWidth===width&&e.focusInside&&e.closed.hidden&&e.closed.focused);
  rows.push({arm,name,width,theme,style,metrics,menus,fits});await fs.writeFile(r+'/browser-matrix.json',JSON.stringify(rows,null,2)+'\n');if(arm==='candidate'&&!fits)throw Error('candidate containment/focus failure '+JSON.stringify(rows.at(-1)));
 }
 console.log({arm,name,width,theme,complete:rows.length});
}
console.log({states:rows.length,baseFits:rows.filter(e=>e.arm==='base'&&e.fits).length,candidateFits:rows.filter(e=>e.arm==='candidate'&&e.fits).length});
