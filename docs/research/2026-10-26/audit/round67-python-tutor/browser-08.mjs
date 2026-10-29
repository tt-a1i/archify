console.log('startedAt',new Date().toISOString());
const task=await taskSpace(23); const page=task.page('p1'); const fs=await import('node:fs/promises');
await page.click('loc=role:button[name="Next >"]',{label:'Run shared inner mutation'});
await page.waitForFunction(()=>document.body.innerText.includes('Step 5 of 6'));
const dom=await page.evaluate(()=>({code:document.querySelector('#pyCodeOutput').innerText,stackHeapText:document.querySelector('#stackHeapTable').innerText,stackHeapHtml:document.querySelector('#stackHeapTable').outerHTML,nearbyControls:document.querySelector('#pyCodeOutputDiv').parentElement.innerText}));
await fs.writeFile('ARCHIVED_RAW_ROOT/after-mutation.dom.json',JSON.stringify(dom,null,2)+'\n');
console.log('state',dom); await page.screenshot({path:'ARCHIVED_RAW_ROOT/after-mutation.png'});
console.log('finishedAt',new Date().toISOString());
