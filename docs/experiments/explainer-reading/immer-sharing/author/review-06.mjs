const task = await taskSpace(14);
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:900,deviceScaleFactor:1,mobile:true});
await page.evaluate(() => {window.scrollTo(0,760); const e=document.querySelector('.diagram-preview'); e.scrollLeft=1000;});
console.log(await page.evaluate(() => {const e=document.querySelector('.diagram-preview'); return {left:e.scrollLeft,max:e.scrollWidth-e.clientWidth,style:document.documentElement.dataset.style,theme:document.documentElement.dataset.theme};}));
await page.screenshot({path:'/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/author/390-diagram-right-verified.png'});
