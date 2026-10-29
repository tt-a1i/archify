const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round32';
for(const arm of ['base','candidate'])for(const theme of ['light','dark']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/source-card-'+arm+'.html');await p.click('[data-theme-choice="'+theme+'"]');
 await p.evaluate(async()=>{await document.fonts.ready;document.querySelector('.cite a[href="#source-probe"]').scrollIntoView({block:'center'});});await p.focus('.cite a[href="#source-probe"] >> nth=0');
 await p.evaluate(async()=>{await Promise.allSettled(document.getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/settled-'+arm+'-'+theme+'.png',Buffer.from(shot.data,'base64'));
}
console.log({light:(await fs.readFile(r+'/settled-base-light.png')).equals(await fs.readFile(r+'/settled-candidate-light.png')),dark:(await fs.readFile(r+'/settled-base-dark.png')).equals(await fs.readFile(r+'/settled-candidate-dark.png'))});
