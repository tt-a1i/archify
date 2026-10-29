const fs=await import('node:fs/promises');
const root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round24';
const p=(await taskSpace(14)).page('p1');
await fs.mkdir(root+'/screenshots',{recursive:true});
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
await p.goto('file://'+root+'/author/answer.html');
console.log(await p.snapshot());
