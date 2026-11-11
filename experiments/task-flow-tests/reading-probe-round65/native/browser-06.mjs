const task=await taskSpace(17); const page=task.page('p1');
console.log('VISIBLE CODE', await page.evaluate(() => [...document.querySelectorAll('tr')].map(x=>x.innerText).filter(x=>x.includes('defects') || x.includes('JSON.stringify'))));
await page.click('text="产物已交付：沿用历史评分"');
console.log(await page.snapshot({scope:'full_page'}));
