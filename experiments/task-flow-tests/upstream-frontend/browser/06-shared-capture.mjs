const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log('missing',await page.evaluate(()=>({url:location.href,text:document.body.innerText,nodes:[...document.querySelectorAll('[data-node]')].map(x=>({id:x.getAttribute('data-node'),tag:x.tagName,classes:x.className,text:x.innerText}))})));
await page.screenshot({path:'/Users/tsk/.codex/worktrees/lab-task-flow-tests/archify/experiments/task-flow-tests/upstream-frontend/images/shared-missing.png'});
await page.click('button[title="Flows (1)"]');
await page.click('[data-flow="delivered"] .flow-title');
await page.click('button[title="Graph (2)"]');
console.log(await page.snapshot());
