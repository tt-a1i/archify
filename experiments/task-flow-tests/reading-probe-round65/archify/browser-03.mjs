console.log('startedAt',new Date().toISOString());
const task=await taskSpace(17); const page=task.page('p1');
await page.click('loc=css:a[aria-label="沿同一张图比较路径与测试声明"]');
console.log(await page.snapshot());
console.log('screenshot',await page.screenshot({path:'ARCHIVED_RUNTIME/archify/paths.png'}));
console.log('finishedAt',new Date().toISOString());
