const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.screenshot({path:'/Users/tsk/.codex/worktrees/lab-task-flow-tests/archify/experiments/task-flow-tests/upstream-frontend/images/shared-flows.png'});
await page.click('[data-flow="missing"] .flow-title');
console.log(await page.snapshot());
