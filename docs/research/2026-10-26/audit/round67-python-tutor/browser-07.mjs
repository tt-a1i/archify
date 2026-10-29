console.log('startedAt',new Date().toISOString());
const task=await taskSpace(23); const page=task.page('p1'); const fs=await import('node:fs/promises');
for(let i=0;i<3;i++)await page.click('loc=role:button[name="Next >"]',{label:'Advance original program step'});
await page.waitForFunction(()=>document.body.innerText.includes('Step 4 of 6'));
const dom=await page.evaluate(()=>({code:document.querySelector('#pyCodeOutput').innerText,stackHeapText:document.querySelector('#stackHeapTable').innerText,stackHeapHtml:document.querySelector('#stackHeapTable').outerHTML,nearbyControls:document.querySelector('#pyCodeOutputDiv').parentElement.innerText}));
await fs.writeFile('ARCHIVED_RAW_ROOT/after-copy.dom.json',JSON.stringify(dom,null,2)+'\n');
console.log('stackHeap',dom.stackHeapText); console.log(await page.snapshot());
await page.screenshot({path:'ARCHIVED_RAW_ROOT/after-copy.png'});
console.log('finishedAt',new Date().toISOString());
