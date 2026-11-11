const task=await taskSpace(17); const page=task.page('p1');
await page.click('text="回归测试：缺失产物"');
console.log(await page.snapshot({scope:'full_page'}));
