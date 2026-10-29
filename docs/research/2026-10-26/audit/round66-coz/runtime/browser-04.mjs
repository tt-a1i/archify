console.log('startedAt',new Date().toISOString());
const task=await taskSpace(19); const page=task.page('p1');
console.log('info',await page.info());
console.log(await page.snapshot({scope:'full_page'}));
console.log('input',await page.evaluate(()=>[...document.querySelectorAll('input')].map(e=>({id:e.id,type:e.type,value:e.type==='file'?undefined:e.value,files:e.files?[...e.files].map(f=>({name:f.name,size:f.size})):undefined}))));
console.log('finishedAt',new Date().toISOString());
