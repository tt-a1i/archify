const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round32';
const records=[];
for(const size of [{width:390,height:480},{width:1440,height:480},{width:390,height:900}]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:false});await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/openrsync-slash/candidate.html');
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().map(a=>a.finished));});
 await p.evaluate(()=>{let a=document.querySelector('.cite a[href="#source-probe"]');a.scrollIntoView({block:'center'});});
 await p.focus('.cite a[href="#source-probe"] >> nth=0');
 const result=await p.evaluate(()=>({card:document.querySelector('.source-card').getBoundingClientRect().toJSON(),source:document.querySelector('.source-card').textContent,opener:document.activeElement.getBoundingClientRect().toJSON(),scrollY,height:innerHeight,documentHeight:document.documentElement.scrollHeight}));records.push({...size,...result});
 const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/source-card-base-'+size.width+'x'+size.height+'.png',Buffer.from(shot.data,'base64'));
}
await fs.writeFile(r+'/source-card-base.json',JSON.stringify(records,null,2)+'\n');console.log(records.map(x=>({width:x.width,height:x.height,card:x.card,opener:x.opener.top})));console.log(await p.snapshot());
