import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ChromeVisualBrowser,findChrome} from '../bin/visual-check.mjs';
import {fittedNodeFontSize} from '../renderers/shared/text-fit.mjs';

const testDir=path.dirname(fileURLToPath(import.meta.url));

// Public synthetic labels deliberately exercise a maximum-width participant.
// This fixture carries no application-specific source or private repository.
test('sequence headers reserve an icon/brand rail without shrinking or changing literal labels', async t=>{
  const chrome=findChrome();
  if(!chrome){t.skip('Chrome is unavailable; this is not a browser pass');return;}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-sequence-header-'));
  const spec={schema_version:1,diagram_type:'sequence',meta:{title:'Sequence header clearance regression',quality_profile:'standard',column_fit:'spread',viewBox:[1700,600]},participants:[
    {id:'transfer',type:'backend',label:'Cloud File Transfer (CFTS)',sublabel:'Transfer participant'},
    {id:'without-context',type:'external',label:'Cloud File Transfer (CFTS)'},
    {id:'branded',type:'database',label:'Redis',sublabel:'Cache participant',brand:'redis'},
  ],messages:[{id:'request',from:'transfer',to:'without-context',y:200,label:'Exact request'},{id:'reply',from:'without-context',to:'transfer',y:250,label:'Exact reply',variant:'return'}]};
  const input=path.join(dir,'input.json'),output=path.join(dir,'output.html');
  fs.writeFileSync(input,JSON.stringify(spec));
  const rendered=spawnSync(process.execPath,[path.resolve(testDir,'../bin/archify.mjs'),'deliver','sequence',input,output,'--quality','standard','--json'],{encoding:'utf8',maxBuffer:16*1024*1024});
  assert.equal(rendered.status,0,rendered.stderr||rendered.stdout);
  const browser=new ChromeVisualBrowser(chrome);
  try{
    const session=await browser.sessionPromise,send=(method,params={})=>browser.cdp.send(method,params,session,30000);
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!r.exceptionDetails,r.exceptionDetails?.exception?.description);return r.result?.value;};
    for(const [width,height]of [[1440,900],[2048,1320]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:pathToFileURL(output).href});
      let ready=false;for(let i=0;i<300;i++){if(await evaluate('!!window.Archify?.view')){ready=true;break;}await new Promise(r=>setTimeout(r,25));}assert(ready,'Viewer did not initialize');
      for(const theme of ['light','dark'])for(const scale of [.75,1,3]){
        await evaluate(`(async()=>{await document.fonts.ready;if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.getElementById('btn-theme').click();if(Archify.motionGovernor.mode()!=='still')document.getElementById('btn-motion').click();Archify.view.centerAt(850,110,{scale:${scale},instant:true});await Archify.readerLayout.whenStable();await Archify.viewerChromeLayout.whenStable();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
        const rows=await evaluate(`(()=>{const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return [...document.querySelectorAll('g[data-node-id]')].map(n=>({id:n.dataset.nodeId,label:n.dataset.nodeLabel,box:box(n.querySelector('rect')),text:box(n.querySelector('text[data-node-label]')),sigil:box(n.querySelector('[data-semantic-sigil]')),brand:n.querySelector('.brand-mark')?box(n.querySelector('.brand-mark')):null,context:[...n.querySelectorAll('text')].filter(e=>!e.hasAttribute('data-node-label')).map(box),font:Number(n.querySelector('text[data-node-label]').getAttribute('font-size'))}));})()`);
        assert.deepEqual(rows.map(r=>r.label),spec.participants.map(p=>p.label));
        assert(rows.find(r=>r.id==='branded').brand,'Brand fixture must actually render its mark');
        for(const row of rows){
          const where=`${width}x${height}/${theme}/${scale}/${row.id}`,overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.x,b.x)+.01&&Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y)+.01;
          assert(!overlap(row.text,row.sigil),where+': semantic sigil overlaps label');
          if(row.brand)assert(!overlap(row.text,row.brand),where+': brand mark overlaps label');
          assert(row.text.x>=row.box.x-.1&&row.text.right<=row.box.right+.1&&row.text.y>=row.box.y-.1&&row.text.bottom<=row.box.bottom+.1,where+': label escapes header');
          assert.equal(row.font,fittedNodeFontSize(row.label,row.brand?142:190,11,8),where+': original fitted label font must be unchanged');
          for(const context of row.context)assert(context.bottom<=row.box.bottom+.1,where+': context escapes header');
        }
      }
    }
  }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});
