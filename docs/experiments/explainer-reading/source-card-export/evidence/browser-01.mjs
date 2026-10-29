const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round33';
const observations=[];
for(const width of [1440,390]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/source-card-viewport/candidate.html');await p.click('[data-theme-choice="light"]');
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().map(a=>a.finished));window.__exportObservations=[];document.addEventListener('click',e=>{if(e.target.closest('[data-export-image]'))window.__exportObservations.push({cardHidden:document.querySelector('.source-card').hidden,cardTop:document.querySelector('.source-card').getBoundingClientRect().top,at:performance.now()});},true);});
 await p.focus('.cite a[href="#source-probe"] >> nth=0');const before=await p.evaluate(()=>({cardHidden:document.querySelector('.source-card').hidden,at:performance.now()}));
 await p.press('[data-export-toggle]','Enter');const pending=p.waitForEvent('download',{timeout:30000});await p.click('[data-export-image="png"]');const download=await pending;await download.saveAs(r+'/ui-'+width+'.png');const during=await p.evaluate(()=>window.__exportObservations);observations.push({width,before,during});
}
await fs.writeFile(r+'/ui-observations.json',JSON.stringify(observations,null,2)+'\n');console.log(observations);
