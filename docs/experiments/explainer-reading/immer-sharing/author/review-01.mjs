const task = await taskSpace(14);
const page = task.page('p1');
await page.goto('file:///Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/author/answer.html');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log(await page.snapshot({scope:'full_page'}));
console.log(await page.evaluate(() => ({width:innerWidth,height:innerHeight,bodyHeight:document.documentElement.scrollHeight,theme:document.documentElement.outerHTML.slice(0,300)})));
await page.screenshot({path:'/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round48/author/1440-top.png'});
