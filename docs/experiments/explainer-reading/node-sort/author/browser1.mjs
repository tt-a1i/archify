const task = await taskSpace(14);
const page = task.page('p1');
await page.goto('file:///Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round45/author/answer.html');
console.log(await page.snapshot());
