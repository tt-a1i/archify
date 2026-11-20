const task = await taskSpace(3), page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.goto('http://127.0.0.1:18745/experiments/task-flow-tests/upstream-frontend/pages/shared.html');
console.log(await page.snapshot());
