const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round32';
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/candidate-390-light.png');
const image=await p.evaluate(async()=>{const i=document.querySelector('img');await i.decode();document.body.style.margin='0';i.style.cssText='display:block;width:390px;max-width:none;height:auto;margin:0';return {width:i.naturalWidth,height:i.naturalHeight};});
for(const [name,y]of [['top',0],['middle',850],['bottom',99999]]){await p.evaluate(y=>scrollTo(0,y),y);const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/export-'+name+'.png',Buffer.from(shot.data,'base64'));}
await fs.writeFile(r+'/export-check.json',JSON.stringify(image,null,2)+'\n');console.log(image);
