console.log('startedAt',new Date().toISOString());
const task=await taskSpace(19); const page=task.page('p1');
const point=await page.evaluate(()=>{const p=[...document.querySelectorAll('div.plot')].find(e=>e.innerText.split('\n')[0]==='sqlite3.c:14853');const c=p.querySelectorAll('circle')[5];const r=c.getBoundingClientRect();return {plot:p.innerText.split('\n')[0],circleIndex:5,circles:p.querySelectorAll('circle').length,x:r.x+r.width/2,y:r.y+r.height/2};});
console.log('target',point);
await page.mouse.move(point.x,point.y,{label:'Inspect native curve point'});
console.log(await page.snapshot());
await page.screenshot({path:'ARCHIVED_RUNTIME/point-14853.png'});
console.log('finishedAt',new Date().toISOString());
