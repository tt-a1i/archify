console.log('startedAt',new Date().toISOString());
const task=await taskSpace(23); const page=task.page('p1');
const fs=await import('node:fs/promises');
const code=await fs.readFile('ARCHIVED_RAW_ROOT/probe.py','utf8');
await page.focus('@15'); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.paste(code);
console.log('renderedEditor',await page.evaluate(()=>document.querySelector('.ace_editor').innerText));
console.log(await page.snapshot());
console.log('finishedAt',new Date().toISOString());
