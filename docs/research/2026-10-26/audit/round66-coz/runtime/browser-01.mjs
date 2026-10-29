console.log('startedAt',new Date().toISOString());
const task=await taskSpace('Archify research 20261026');
console.log({spaceId:task.spaceId});
const page=task.page('p1');
await page.goto('https://coz-profiler.github.io/coz-ui/');
console.log('viewport',await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio})));
console.log(await page.snapshot({scope:'full_page'}));
console.log('finishedAt',new Date().toISOString());
