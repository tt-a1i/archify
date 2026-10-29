const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round33';
for(const state of ['closed','open']){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/api-1440-'+state+'.png');
 await p.evaluate(async()=>{const i=document.querySelector('img');await i.decode();document.body.style.margin='0';i.style.cssText='display:block;width:1440px;max-width:none;height:auto;margin:0';});
 const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/view-api-1440-'+state+'.png',Buffer.from(shot.data,'base64'));
}
