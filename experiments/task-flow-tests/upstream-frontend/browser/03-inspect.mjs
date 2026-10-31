const task = await taskSpace(3), page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log(await page.evaluate(()=>({buttons:[...document.querySelectorAll('button')].map(x=>({text:x.innerText,title:x.title,classes:x.className,parent:x.parentElement.parentElement.getAttribute('data-flow')})),flows:[...document.querySelectorAll('[data-flow]')].map(x=>({id:x.getAttribute('data-flow'),text:x.innerText}))})));
