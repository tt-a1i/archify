const fs=await import('node:fs/promises');
const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
const root="/Users/tsk/.codex/worktrees/lab-task-flow-tests/archify/experiments/task-flow-tests/upstream-frontend";
const records=[];
async function read(){
 return await page.evaluate(()=>({url:location.href,title:document.title,
  nodes:[...document.querySelectorAll('.cy-overlay .gn')].map(x=>{const r=x.getBoundingClientRect();return {text:x.innerText,classes:x.className,rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*10)/10)};}),
  text:document.body.innerText}));
}
for(const mode of ['shared','legacy-only','occurrences']){
 await page.goto('http://127.0.0.1:18745/experiments/task-flow-tests/upstream-frontend/pages/'+mode+'.html');
 for(const flow of ['missing','delivered','omitted-link']){
  await page.click('button[title="Flows (1)"]');
  await page.click('[data-flow="'+flow+'"] .flow-title');
  await page.click('button[title="Graph (2)"]');
  let last='',stable=0,observation;
  for(let i=0;i<30;i++){
   observation=await read();const geometry=JSON.stringify(observation.nodes);
   stable=geometry===last&&observation.nodes.length>0?stable+1:0;last=geometry;
   if(stable>=2)break;
   await page.waitForTimeout(150);
  }
  if(stable<2)throw new Error('DOM geometry did not settle: '+mode+'/'+flow);
  const testCount=observation.nodes.filter(n=>n.text.includes('回归测试：缺失产物')).length;
  const expected=mode==='shared'||(mode==='occurrences'&&flow==='missing')?1:0;
  if(testCount!==expected||observation.text.includes('The account matches the diff')||observation.text.includes('Invalid Date'))throw new Error('unexpected fixture state '+mode+'/'+flow);
  const name=mode+'-'+flow;
  await page.screenshot({path:root+'/images/'+name+'.png'});
  const record={mode,flow,testCount,expected,nodeCount:observation.nodes.length,...observation};
  await fs.writeFile(root+'/browser/'+name+'.json',JSON.stringify(record,null,2)+'\n');
  records.push({mode,flow,testCount,nodeCount:observation.nodes.length});
 }
}
console.log(JSON.stringify(records,null,2));
