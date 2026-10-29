const fs=await import('node:fs/promises'),p=(await taskSpace(14)).page('p1'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round33';
for(const [name,width,positions]of [['candidate-api-1440-open',1440,[['top',0]]],['candidate-api-390-open',390,[['top',0],['middle',850],['bottom',99999]]],['base-repeat-api-390-open',390,[['top',0]]]]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/'+name+'.png');await p.evaluate(async w=>{const i=document.querySelector('img');await i.decode();document.body.style.margin='0';i.style.cssText='display:block;width:'+w+'px;max-width:none;height:auto;margin:0';},width);
 for(const [part,y]of positions){await p.evaluate(y=>scrollTo(0,y),y);const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/view-'+name+'-'+part+'.png',Buffer.from(shot.data,'base64'));}
}
console.log({inspectedImages:3,pixelCaptures:5});
