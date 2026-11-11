const task = await taskSpace(17);
const page = task.page('p1');
await page.goto('http://127.0.0.1:8882/upstream-cli/native/final.html');
console.log('INFO', JSON.stringify(await page.info()));
console.log('VIEWPORT', JSON.stringify(await page.evaluate(() => ({width:innerWidth,height:innerHeight,devicePixelRatio}))));
console.log(await page.snapshot({scope:'full_page'}));
