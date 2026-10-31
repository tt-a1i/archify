console.log('startedAt',new Date().toISOString());
const task=await taskSpace(17); const page=task.page('p1');
await page.mouse.move(370,650); await page.mouse.wheel(0,600);
console.log(await page.snapshot());
console.log('screenshot',await page.screenshot({path:'ARCHIVED_RUNTIME/archify/other-paths.png'}));
console.log('finishedAt',new Date().toISOString());
