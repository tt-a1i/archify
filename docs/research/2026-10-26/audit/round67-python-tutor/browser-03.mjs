console.log('startedAt',new Date().toISOString());
const task=await taskSpace(23); const page=task.page('p1');
console.log(await page.snapshot());
console.log('editables',await page.evaluate(()=>[...document.querySelectorAll('textarea,[contenteditable=true]')].map(e=>({tag:e.tagName,class:e.className,aria:e.getAttribute('aria-label'),parent:e.parentElement.className,grandparent:e.parentElement.parentElement.className,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}))));
console.log('finishedAt',new Date().toISOString());
