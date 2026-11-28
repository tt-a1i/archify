const fs=await import('node:fs/promises');
const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
const before=await page.evaluate(()=>({url:location.href,text:document.body.innerText,tables:[...document.querySelectorAll('table')].map(t=>({classes:t.className,text:t.innerText,html:t.outerHTML.slice(0,300)}))}));
await fs.writeFile('/Users/tsk/.codex/worktrees/lab-task-flow-tests/archify/experiments/task-flow-tests/upstream-frontend/browser/inspector-code.json',JSON.stringify(before,null,2)+'\n');
await page.screenshot({path:'/Users/tsk/.codex/worktrees/lab-task-flow-tests/archify/experiments/task-flow-tests/upstream-frontend/images/inspector-code.png'});
await page.click('@820');
console.log(await page.snapshot());
