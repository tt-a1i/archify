const fs=await import('node:fs/promises'),root='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round20',p=(await taskSpace(14)).page('p1'),rows=[];
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await p.click('#versions button >> nth=1');await p.waitForFunction(()=>document.querySelector('iframe').getAttribute('src')==='jq-default/author/answer.html');
rows.push(await p.evaluate(()=>({action:'author',frame:document.querySelector('iframe').getAttribute('src'),open:document.querySelector('#open-link').getAttribute('href')})));
await p.click('#versions button >> nth=0');await p.click('[data-width="1440"]');await p.waitForFunction(()=>document.querySelector('iframe').style.width==='1440px');
rows.push(await p.evaluate(()=>({action:'candidate-desktop',frame:document.querySelector('iframe').getAttribute('src'),frameWidth:document.querySelector('iframe').style.width,note:document.querySelector('#scale-note').textContent,caseCount:document.querySelectorAll('.case').length})));
await p.click('[data-width="390"]');await p.waitForFunction(()=>document.querySelector('iframe').style.width==='390px');
rows.push(await p.evaluate(()=>({action:'candidate-phone',frame:document.querySelector('iframe').getAttribute('src'),frameWidth:document.querySelector('iframe').style.width,note:document.querySelector('#scale-note').textContent})));
await fs.writeFile(root+'/index-interaction.json',JSON.stringify(rows,null,2));console.log(rows);
