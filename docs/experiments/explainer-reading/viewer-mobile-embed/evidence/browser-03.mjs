const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round35';
// Reopen after every process's viewport reset, preserving the same task and page.
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file:///Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/networkx-path/candidate.html');await p.click('[data-theme-choice="light"]');await p.click('[data-open-diagram="graph"]');await p.waitForFunction(()=>document.querySelector('#diagram-dialog').dataset.nativeReady==='true',undefined,{timeout:15000});
const before=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/before-zoom.png',Buffer.from(before.data,'base64'));
await p.press('[data-view="out"]','Enter');
const after=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/after-zoom.png',Buffer.from(after.data,'base64'));console.log(await p.snapshot());
