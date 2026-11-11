const task=await taskSpace(17); const page=task.page('p1');
await page.click('@18');
console.log(await page.snapshot({scope:'full_page'}));
