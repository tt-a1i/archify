import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {ChromeVisualBrowser,findChrome} from '../bin/visual-check.mjs';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'pr381-storage-'));
const html='<!doctype html><title>Native storage only</title><p>No application scripts</p>';
const file=path.join(scratch,'probe.html');fs.writeFileSync(file,html);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
for (const kind of ['file-navigate','file-same-url','file-reload','http-navigate']) {
 const b=new ChromeVisualBrowser(findChrome());
 try {
  const session=await b.sessionPromise;const send=(m,p={})=>b.cdp.send(m,p,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const url=kind.startsWith('file')?pathToFileURL(file).href:`http://127.0.0.1:${server.address().port}/probe.html`;
  const load=async i=>{const loaded=b.cdp.waitFor('Page.loadEventFired',session);await send(kind==='file-reload'&&i>0?'Page.reload':'Page.navigate',kind==='file-reload'&&i>0?{}:{url:url+'?theme=dark&navigation='+(kind==='file-same-url'?0:i)});await loaded;};
  await load(0);await run("localStorage.setItem('probe','still')");const observations=[];
  for(let i=1;i<=20;i++){await load(i);observations.push(await run("localStorage.getItem('probe')"));}
  console.log(JSON.stringify({kind,version:await b.cdp.send('Browser.getVersion'),observations}));
 }finally{await b.close();}
}
}finally{await new Promise(r=>server.close(r));fs.rmSync(scratch,{recursive:true,force:true});}
