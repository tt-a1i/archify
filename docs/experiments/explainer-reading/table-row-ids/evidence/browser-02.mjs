const fs=await import('node:fs/promises'),assert=(await import('node:assert/strict')).default;
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round26';
const repo='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify',p=(await taskSpace(14)).page('p1'),results=[];
for(const [name,file] of [['repository',repo+'/docs/experiments/explainer-reading/table-row-ids/candidate.html'],['package',root+'/package-original.html']]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto('file://'+file+'#row-2adcbbed7320');
 await p.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const state=await p.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id),t=document.querySelector(':target');return {id:t?.id,cells:[...t.children].map(c=>c.textContent),top:t.getBoundingClientRect().top,unique:ids.length===new Set(ids).size,rows:[...document.querySelectorAll('#observation tbody tr')].map(e=>({id:e.id,cells:[...e.children].map(c=>c.textContent)}))};});
 assert.equal(state.id,'row-2adcbbed7320');assert.equal(state.unique,true);assert.equal(state.rows.length,5);assert.ok(state.top>=0&&state.top<900);assert.deepEqual(state.cells,['Some(7)','unwrap_or_else(|| fallback())','7','不执行']);results.push({name,...state});
}
assert.deepEqual(results[0].rows,results[1].rows);
await fs.writeFile(root+'/package-browser.json',JSON.stringify({ok:true,scope:'repository and extracted-package artifacts, 390 px row-link navigation and row integrity',results},null,2)+'\n');
console.log({ok:true,pages:results.map(x=>({name:x.name,id:x.id,top:x.top,unique:x.unique,rows:x.rows.length}))});
