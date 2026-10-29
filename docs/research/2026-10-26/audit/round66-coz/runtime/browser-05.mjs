console.log('startedAt',new Date().toISOString());
const task=await taskSpace(19); const page=task.page('p1');
await page.click('@15');
await page.waitForFunction(()=>document.body.innerText.includes('main.c:73'));
console.log(await page.snapshot({scope:'full_page'}));
console.log('dom',await page.evaluate(()=>({range:[...document.querySelectorAll('input[type=range]')].map(e=>({id:e.id,value:e.value,min:e.min,max:e.max,step:e.step})),headings:[...document.querySelectorAll('h1,h2,h3,h4')].map(e=>({tag:e.tagName,class:e.className,text:e.innerText})),svg:[...document.querySelectorAll('svg')].map(e=>({class:e.getAttribute('class'),circles:e.querySelectorAll('circle').length}))})));
await page.screenshot({path:'ARCHIVED_RUNTIME/minimum-10.png'});
console.log('finishedAt',new Date().toISOString());
