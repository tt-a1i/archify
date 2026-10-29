const fs=await import('node:fs/promises'),assert=(await import('node:assert/strict')).default;
const r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round28',repo='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify',p=(await taskSpace(14)).page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+repo+'/docs/experiments/explainer-reading/git-diff-endpoints/candidate.html');await p.click('[data-theme-choice="light"]');
await p.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled(document.getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.__copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copies.push(text)}});});
const expected=await p.evaluate(()=>document.querySelector('.snippet pre code').textContent);await p.click('[data-copy]');
const copies=await p.evaluate(()=>window.__copies);assert.deepEqual(copies,[expected]);
await fs.writeFile(r+'/copied-commands.sh',copies[0]);await fs.writeFile(r+'/copy-check.json',JSON.stringify({ok:true,scope:'actual copy button, Clipboard.writeText payload intercepted; OS permissions not exercised',payload:copies[0]},null,2)+'\n');
await p.press('[data-export-toggle]','Enter');const pending=p.waitForEvent('download',{timeout:30000});await p.click('[data-export-image="png"]');const download=await pending;await download.saveAs(r+'/candidate-390-light.png');
console.log({copyMatched:true,png:r+'/candidate-390-light.png'});
