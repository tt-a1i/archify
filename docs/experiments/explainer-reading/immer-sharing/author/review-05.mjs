const task = await taskSpace(14);
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:900,deviceScaleFactor:1,mobile:true});
console.log(await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 10 && e.clientWidth > 100).map(e => ({tag:e.tagName,cls:e.className,client:e.clientWidth,scroll:e.scrollWidth,top:e.getBoundingClientRect().top}))));
await page.evaluate(() => { const svg=[...document.querySelectorAll('svg')].find(e=>e.getBoundingClientRect().width>600); let p=svg.parentElement; while(p && p.scrollWidth<=p.clientWidth) p=p.parentElement; if(p) p.scrollLeft=p.scrollWidth; window.scrollTo(0,760); });
await page.screenshot({path:'/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/author/390-diagram-right.png'});
await page.evaluate(() => { document.querySelectorAll('pre').forEach(e=>e.scrollLeft=e.scrollWidth); window.scrollTo(0,1500); });
await page.screenshot({path:'/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/author/390-code-right.png'});
console.log(await page.evaluate(() => ({scrolls:[...document.querySelectorAll('pre')].map(e=>({left:e.scrollLeft,max:e.scrollWidth-e.clientWidth}))})));
