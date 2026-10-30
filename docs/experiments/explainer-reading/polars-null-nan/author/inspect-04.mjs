const task = await taskSpace(14);
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
console.log(JSON.stringify(await page.evaluate(() => { const p=document.querySelector('pre'); const before={client:p.clientWidth,scroll:p.scrollWidth,overflow:getComputedStyle(p).overflowX,left:p.scrollLeft}; p.scrollLeft=p.scrollWidth; return {before,after:p.scrollLeft}; })));
console.log('screenshot',await page.screenshot({path:'/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round46/author/screen-390-code-scrolled.png',fullPage:true}));
console.log('page',await page.info());
