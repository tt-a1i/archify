const task = await taskSpace(14);
const page = task.page('p1');
await page.reload();
await page.click('loc=role:button[name="浅色"]');
await page.click('loc=css:button[aria-label="样式"]');
await page.click('loc=role:menuitemradio[name="杂志"]');
for (const [width,height,name] of [[1440,900,'final-desktop'],[390,844,'final-mobile']]) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  console.log(name,await page.evaluate(() => ({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,style:document.documentElement.dataset.style,theme:document.documentElement.dataset.theme,table:[...document.querySelectorAll('table')].map(e=>({client:e.parentElement.clientWidth,scroll:e.parentElement.scrollWidth}))})));
  await page.screenshot({path:`/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round45/author/${name}.png`,fullPage:true});
}
console.log(await page.info());
