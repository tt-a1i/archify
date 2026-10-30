const task = await taskSpace(14);
const page = task.page('p1');
await page.click('loc=role:button[name="浅色"]');
await page.click('loc=css:button[aria-label="样式"]');
console.log(await page.snapshot());
