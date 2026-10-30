const task = await taskSpace(14);
const page = task.page('p1');
await page.click('loc=role:menuitemradio[name="杂志"]');
for (const width of [1440,390]) {
 await page.cdp('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:width===390});
 await page.evaluate(() => window.scrollTo(0,0));
 const metrics = await page.evaluate(() => ({width:innerWidth,height:innerHeight,total:document.documentElement.scrollHeight,style:document.documentElement.dataset.style,theme:document.documentElement.dataset.theme,scrolls:[...document.querySelectorAll('pre,table,svg')].map(e=>({tag:e.tagName,client:e.clientWidth,scroll:e.scrollWidth,rect:e.getBoundingClientRect().toJSON()}))}));
 console.log(width,JSON.stringify(metrics));
 const count = Math.ceil(metrics.total / 800);
 for(let i=0;i<count;i++){ await page.evaluate(y=>window.scrollTo(0,y),i*800); await page.screenshot({path:`/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/author/${width}-${i}.png`}); }
}
