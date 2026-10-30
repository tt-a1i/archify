const task = await taskSpace(14);
const page = task.page('p1');
await page.click('@700');
for (const width of [390,1440]) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  console.log('width',width,JSON.stringify(await page.evaluate(() => ({theme:document.documentElement.outerHTML.slice(0,500),doc:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},elements:[...document.querySelectorAll('table,pre')].map(e=>({tag:e.tagName,client:e.clientWidth,scroll:e.scrollWidth,parentClient:e.parentElement.clientWidth,parentScroll:e.parentElement.scrollWidth,overflow:getComputedStyle(e.parentElement).overflowX}))}))));
  console.log('screenshot',await page.screenshot({path:`/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round46/author/screen-${width}.png`,fullPage:true}));
}
