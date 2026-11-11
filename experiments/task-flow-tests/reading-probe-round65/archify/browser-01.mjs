console.log('startedAt', new Date().toISOString());
const task = await taskSpace(17);
const page = task.page('p1');
await page.goto('http://127.0.0.1:8882/final/review.html');
console.log('info', await page.info());
console.log('viewport', await page.evaluate(() => ({width:innerWidth,height:innerHeight,devicePixelRatio})));
console.log(await page.snapshot({scope:'full_page'}));
console.log('finishedAt', new Date().toISOString());
