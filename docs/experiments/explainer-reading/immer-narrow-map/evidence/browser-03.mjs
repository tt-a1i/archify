const fs=await import('node:fs/promises'),r='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round49',p=(await taskSpace(14)).page('p1'),rows=[];
for(const width of [390,1440]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await p.goto('file://'+r+'/exports/candidate-'+width+'.png');const info=await p.evaluate(async width=>{const img=document.querySelector('img');await img.decode();document.body.style.margin='0';img.style.cssText='width:'+width+'px;max-width:none;height:auto;';return{naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,displayHeight:img.getBoundingClientRect().height};},width);
 const positions=width===390?[0,650,1250,1850,info.displayHeight-900]:[0,450,info.displayHeight-900];
 for(let i=0;i<positions.length;i++){await p.evaluate(y=>scrollTo(0,y),positions[i]);const shot=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(r+'/screenshots/export-'+width+'-'+i+'.png',Buffer.from(shot.data,'base64'));}
 rows.push({width,...info,positions});
}await fs.writeFile(r+'/export-inspection.json',JSON.stringify(rows,null,2)+'\n');console.log(rows);
