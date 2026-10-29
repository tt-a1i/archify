const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round34';
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/candidate-2.html');await p.click('[data-theme-choice="light"]');
await p.focus('[data-open-diagram="graph"]');await p.press('[data-open-diagram="graph"]','Enter');
await p.waitForFunction(()=>document.querySelector('#diagram-dialog')?.dataset.nativeReady==='true',undefined,{timeout:15000});
console.log(await p.snapshot());
const state=await p.evaluate(()=>({dialog:document.querySelector('#diagram-dialog').outerHTML.slice(0,18000),prepared:JSON.parse(document.querySelector('#archify-explainer-prepared').textContent)}));
await fs.writeFile(r+'/viewer-initial.json',JSON.stringify(state,null,2)+'\n');
const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/viewer-initial.png',Buffer.from(shot.data,'base64'));
await p.keyboard.press('Escape');console.log(await p.evaluate(()=>({closed:!document.querySelector('#diagram-dialog').open,active:document.activeElement.outerHTML})));
