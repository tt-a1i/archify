console.log('startedAt',new Date().toISOString());
const task=await taskSpace(17); const page=task.page('p1');
await page.click('loc=css:a[aria-label="回归测试：缺失产物"]');
console.log(await page.snapshot());
console.log('visible source',await page.evaluate(()=>[...document.querySelectorAll('pre,code')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>e.innerText)));
console.log('finishedAt',new Date().toISOString());
