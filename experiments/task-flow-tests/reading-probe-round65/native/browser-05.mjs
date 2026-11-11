const task=await taskSpace(17); const page=task.page('p1');
await page.click('text="报告展示缺测原因" >> nth=0');
console.log(await page.snapshot({scope:'full_page'}));
await page.screenshot({path:'ARCHIVED_RUNTIME/native/report.png'});
