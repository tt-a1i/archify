import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {ChromeVisualBrowser} from '../../archify/bin/visual-check.mjs';
import {createServer} from './serve.mjs';

const chrome=process.env.ARCHIFY_CHROME;if(!chrome)throw Error('Set ARCHIFY_CHROME to a Chrome executable');
const dir=new URL('./demo/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=new ChromeVisualBrowser(chrome,{spawnImpl:(cmd,args,options)=>spawn(cmd,['--use-angle=swiftshader','--enable-unsafe-swiftshader',...args],options)});
try{
  const session=await browser.sessionPromise,send=(m,p={})=>browser.cdp.send(m,p,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result?.value;};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(const city of ['shanghai','paris'])for(const [name,view,scene] of [['flow','flow','journey'],['overview','3d','journey'],['day-1','3d','day-1']]){
    // Force document navigation between views; hash-only navigation has no load event.
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?destination=${city}&view=${view}&demo=${name}#scene=${scene}`});await loaded;
    let ready=false;for(let i=0;i<150;i++){if(await run(`Boolean(window.Archify?.travel3d&&${view==='3d'?`Archify.travel3d.state().active&&Archify.travel3d.state().scene==='${scene}'&&${scene==='journey'?'true':'Archify.travel3d.state().detailBuildings>0'}`:"document.body.dataset.travelView==='flow'"})`)){ready=true;break;}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Demo did not load: '+city+'/'+name);
    await run('(async()=>{await document.fonts.ready;for(let i=0;i<35;i++)await new Promise(requestAnimationFrame)})()');
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(new URL(`${city}-${name}.png`,dir),Buffer.from(shot.data,'base64'));console.log(`${city}-${name}.png`);
  }
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
