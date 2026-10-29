console.log('startedAt',new Date().toISOString());
const task=await taskSpace(19); const page=task.page('p1');
await page.click('@1');
console.log(await page.snapshot({scope:'full_page'}));
console.log('inputs',await page.evaluate(()=>[...document.querySelectorAll('input')].map(e=>({type:e.type,id:e.id,ariaLabel:e.getAttribute('aria-label')}))));
console.log('scripts',await page.evaluate(()=>[...document.scripts].filter(e=>e.src).map(e=>e.src)));
console.log('finishedAt',new Date().toISOString());
