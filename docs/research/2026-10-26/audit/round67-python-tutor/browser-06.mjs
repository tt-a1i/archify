console.log('startedAt',new Date().toISOString());
const task=await taskSpace(23); const page=task.page('p1');
await page.click('@16');
await page.waitForFunction(()=>document.body.innerText.includes('Frames')&&document.body.innerText.includes('Objects'));
console.log(await page.snapshot());
console.log('renderedStructure',await page.evaluate(()=>[...document.querySelectorAll('table,svg')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,id:e.id,class:e.getAttribute('class'),parentId:e.parentElement.id,parentClass:e.parentElement.className})).slice(0,30)));
console.log('finishedAt',new Date().toISOString());
