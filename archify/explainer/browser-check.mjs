import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scanHtml } from './check.mjs';

export const EXPLAINER_VIEWPORTS = Object.freeze([Object.freeze({width:1280,height:900}),Object.freeze({width:1440,height:900})]);
async function evaluate(browser, expression, awaitPromise=false) {
  let result;try {result=await browser.cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise},await browser.sessionPromise);}catch(error){error.message += ` Inspector stage: ${expression.slice(0,100)}`;throw error;}
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const expression = fn => `(${fn.toString()})()`;

function measureNativePreviews() {
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const visible=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&r.width>0&&r.height>0;};
  return Array.from(document.querySelectorAll('.diagram-preview svg')).map(svg=>{
    const block=svg.closest('[data-block-type]'),panel=block.closest('.panel'),preview=svg.closest('.diagram-preview');
    const prose=panel.querySelector('.block-prose > p')||document.querySelector('.block-prose > p'),body=parseFloat(getComputedStyle(prose||panel.querySelector('.panel-body')||block).fontSize);
    const texts=Array.from(svg.querySelectorAll('text')).filter(e=>e.textContent.trim()&&visible(e)).map(e=>{const m=e.getScreenCTM(),sum=m.a*m.a+m.b*m.b+m.c*m.c+m.d*m.d,det=m.a*m.d-m.b*m.c,scale=Math.sqrt(Math.max(0,(sum-Math.sqrt(Math.max(0,sum*sum-4*det*det)))/2));return {text:e.textContent.trim(),size:parseFloat(getComputedStyle(e).fontSize)*scale/(e.closest('[data-edge-id]')?.7:1)};});
    const minimum=texts.length?Math.min(...texts.map(t=>t.size)):null,bounds=rect(preview),svgBounds=rect(svg);
    const nodes=Array.from(svg.querySelectorAll('[data-node-id]')).filter(visible).map(e=>({id:e.dataset.nodeId,...rect(e)}));
    const outside=nodes.filter(n=>n.left<bounds.left-1||n.right>bounds.right+1||n.top<bounds.top-1||n.bottom>bounds.bottom+1);
    return {component:block.id,minimum,body,ratio:minimum===null?null:minimum/body,smallest:texts.find(t=>t.size===minimum),rect:{width:svgBounds.width,height:svgBounds.height},computed:{width:getComputedStyle(svg).width,height:getComputedStyle(svg).height},fit:preview.dataset.diagramFit,requiredWidth:Number(preview.dataset.diagramRequiredWidth)||null,minimumText:Number(preview.dataset.diagramMinimumText)||null,minWidth:svg.style.minWidth,viewBox:svg.getAttribute('viewBox'),preview:bounds,scrollWidth:preview.scrollWidth,clientWidth:preview.clientWidth,nodes,outsidePreview:outside};
  });
}

/** Actual CSS/CTM geometry of the current native previews, including live resize. */
export async function inspectNativePreviewLayout(browser) {return evaluate(browser,expression(measureNativePreviews));}

async function measurePublicHtml(nativeClipping=true) {
  const visible=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&r.width>0&&r.height>0;};
  const owner=e=>e.closest('[data-block-type],.panel')?.id || e.id || e.tagName.toLowerCase();
  const domPath=e=>{const parts=[];for(let p=e;p;p=p.parentElement){const tag=p.localName,peers=p.parentElement?Array.from(p.parentElement.children).filter(c=>c.localName===tag):[p];parts.unshift(`${tag}:nth-of-type(${peers.indexOf(p)+1})`);}return parts.join(' > ');};
  const identity=e=>({stableComponent:domPath(e),text:(e.textContent||'').trim().slice(0,160),label:e.getAttribute('aria-label')||e.getAttribute('title')||'',href:e.getAttribute('href')||null});
  const ancestors=e=>{const result=[];for(let p=e.parentElement;p;p=p.parentElement)result.push(p);return result;};
  const regions=Array.from(document.querySelectorAll('body *')).filter(visible);
  // Chrome computes the actual containing-block/clip chain. Expanding only the
  // observer root exposes off-viewport boxes while retaining every local clip,
  // including SVG, nested scrollers, transforms and out-of-flow descendants.
  const extent=Math.ceil(regions.reduce((maximum,e)=>{const r=e.getBoundingClientRect();return Math.max(maximum,Math.abs(r.left),Math.abs(r.right),Math.abs(r.top),Math.abs(r.bottom));},Math.max(innerWidth,innerHeight,document.documentElement.scrollWidth,document.documentElement.scrollHeight)))+1;
  const intersections=nativeClipping?await new Promise((resolve,reject)=>{
    if(!regions.length){resolve(new Map());return;}
    const entries=new Map();let observer;
    const timeout=setTimeout(()=>{observer.disconnect();reject(new Error('Native clipping measurement did not complete.'));},2000);
    observer=new IntersectionObserver(batch=>{for(const entry of batch)entries.set(entry.target,entry);if(entries.size===regions.length){clearTimeout(timeout);observer.disconnect();resolve(entries);}},{root:null,rootMargin:`${extent}px`});
    regions.forEach(e=>observer.observe(e));
  }):new Map();
  const overflows=(nativeClipping?regions:[]).filter(e=>{const r=intersections.get(e).intersectionRect;return r.width>0&&r.height>0&&(r.left<-1||r.right>innerWidth+1);}).slice(0,20).map(e=>{const entry=intersections.get(e),r=entry.intersectionRect;return {...identity(e),component:owner(e),tag:e.tagName,left:r.left,right:r.right,bounds:{left:entry.boundingClientRect.left,right:entry.boundingClientRect.right}};});
  const localClipping=(nativeClipping?regions:[]).filter(e=>{const entry=intersections.get(e),r=entry.boundingClientRect,i=entry.intersectionRect;const style=getComputedStyle(e),ownCrop=(['hidden','clip'].includes(style.overflowX)&&e.scrollWidth>e.clientWidth+1)||(['hidden','clip'].includes(style.overflowY)&&e.scrollHeight>e.clientHeight+1);return (ownCrop||i.width<r.width-1||i.height<r.height-1)&&(Array.from(e.childNodes).some(n=>n.nodeType===3&&n.textContent.trim())||e.matches('a[href],button,input,select,textarea,[role=button],[role=link]'));}).map(e=>{
    const clips=ancestors(e).filter(p=>{const s=getComputedStyle(p);return ['auto','scroll','hidden','clip'].includes(s.overflowX)||['auto','scroll','hidden','clip'].includes(s.overflowY)||s.clipPath!=='none'||s.clip!=='auto'||/(?:paint|strict|content)/.test(s.contain);}).map(p=>{const s=getComputedStyle(p),b=p.getBoundingClientRect(),t=e.getBoundingClientRect(),cropX=t.left<b.left-1||t.right>b.right+1,cropY=t.top<b.top-1||t.bottom>b.bottom+1;return {...identity(p),overflowX:s.overflowX,overflowY:s.overflowY,scrollableX:['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+1,scrollableY:['auto','scroll'].includes(s.overflowY)&&p.scrollHeight>p.clientHeight+1,nonScrollableClip:(cropX&&['hidden','clip'].includes(s.overflowX))||(cropY&&['hidden','clip'].includes(s.overflowY))||s.clipPath!=='none'||s.clip!=='auto'||((cropX||cropY)&&/(?:paint|strict|content)/.test(s.contain))};});
    const entry=intersections.get(e),r=entry.boundingClientRect,i=entry.intersectionRect,scrollable=clips.some(c=>c.scrollableX||c.scrollableY),ownStyle=getComputedStyle(e),ownCrop=(['hidden','clip'].includes(ownStyle.overflowX)&&e.scrollWidth>e.clientWidth+1)||(['hidden','clip'].includes(ownStyle.overflowY)&&e.scrollHeight>e.clientHeight+1),nonScrollable=ownCrop||clips.some(c=>c.nonScrollableClip);
    return {...identity(e),component:owner(e),tag:e.tagName,access:scrollable?(nonScrollable?'mixed-scroll-and-clipping':'manual-scroll'):'clipped-no-manual-scroll',ownContentClipped:ownCrop,actionable:e.matches('a[href],button,input,select,textarea,[role=button],[role=link]'),keyboardReachability:'not-measured-by-clipping',bounds:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},painted:{left:i.left,right:i.right,top:i.top,bottom:i.bottom,width:i.width,height:i.height},clipAncestors:clips};
  });
  const refs=Array.from(document.querySelectorAll('a[href^="#"]')).filter(e=>e.getAttribute('href').length>1).filter(e=>{let id=e.getAttribute('href').slice(1);try{id=decodeURIComponent(id);}catch{}return !document.getElementById(id);}).map(e=>({...identity(e),component:owner(e)}));
  const ids=new Set(),duplicateIds=[];document.querySelectorAll('[id]').forEach(e=>{if(ids.has(e.id))duplicateIds.push(e.id);ids.add(e.id);});
  const controls=Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[onclick],[tabindex]')).filter(e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&r.width>0&&r.height>0&&!e.disabled&&e.type!=='hidden'&&!e.closest('[inert]');});
  const keyboardIssues=controls.filter(e=>e.tabIndex<0 || (!['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY'].includes(e.tagName)&&!['button','link'].includes(e.getAttribute('role')))).map(e=>({...identity(e),component:owner(e),tag:e.tagName,reason:'An active control is outside sequential keyboard focus or lacks its semantic role.'}));
  controls.forEach((e,i)=>{e.setAttribute('data-qa-key',String(i));e.setAttribute('data-qa-path',domPath(e));});
  const occluded=controls.filter(e=>{const r=e.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&!e.contains(hit)&&!hit.contains(e);}).map(e=>({...identity(e),component:owner(e),tag:e.tagName}));
  const texts=regions.filter(e=>Array.from(e.childNodes).some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({...identity(e),component:owner(e),fontSize:(function(){const size=parseFloat(getComputedStyle(e).fontSize);if(typeof e.getScreenCTM!=='function')return size;const m=e.getScreenCTM();if(!m)return size;const sum=m.a*m.a+m.b*m.b+m.c*m.c+m.d*m.d,det=m.a*m.d-m.b*m.c;return size*Math.sqrt(Math.max(0,(sum-Math.sqrt(Math.max(0,sum*sum-4*det*det)))/2));})()}));
  const smallText=texts.filter(e=>e.fontSize<10);
  const staticReading=Array.from(document.querySelectorAll('.answer-panel,.typical-footnotes li')).map(e=>({component:owner(e),visible:visible(e),text:e.textContent.trim()}));
  const background=getComputedStyle(document.body).backgroundColor || getComputedStyle(document.documentElement).backgroundColor;
  return {measurementMethod:{version:'public-html-qa-v2',clipping:nativeClipping?'native-intersection-observer-expanded-root':'not-measured-script-execution-disabled',clippingMeasured:nativeClipping,clipCoverage:nativeClipping?'native-clip-chain':'not-measured-script-disabled',documentExtentMeasured:true,rootMargin:nativeClipping?extent:null,limits:['Axis-aligned element intersections; does not inspect pixels, shadows, masks or visual quality.','Local clipping access classification uses ancestor axis-aligned bounds; mixed clips and non-rectangular clipping need human review. Keyboard traversal is separate.']},staticReading,innerWidth,innerHeight,scrollWidth:Math.ceil(document.documentElement.scrollWidth),scrollHeight:Math.ceil(document.documentElement.scrollHeight),overflowElements:overflows,localClipping,references:refs,duplicateIds,keyboardIssues,controlCount:controls.length,occluded,smallText,bodyText:document.body.innerText,background,resolvedTheme:document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'),panels:Array.from(document.querySelectorAll('.panel,[data-block-type]')).map(e=>({id:e.id,visible:visible(e),text:e.innerText})),interactiveVisible:document.querySelectorAll('.interactive').length ? Array.from(document.querySelectorAll('.interactive')).filter(visible).map(owner):[]};
}

async function keyboardTraversal(browser, controlCount) {
  const session=await browser.sessionPromise;
  await evaluate(browser,"(function(){document.activeElement.blur();window.scrollTo(0,0);})()");
  const reached=new Set();
  // Radio groups intentionally expose one tab stop; Arrow keys reach siblings.
  const record=async()=>{const state=await evaluate(browser,"({key:document.activeElement?.dataset.qaKey,radio:document.activeElement?.type==='radio',name:document.activeElement?.name})");if(state?.key!==undefined)reached.add(state.key);return state;};
  const arrowGroups=new Set();
  for(let i=0;i<controlCount+3;i++) {
    await browser.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
    await browser.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);
    const state=await record();
    if(state.radio&&!arrowGroups.has(state.name)) {
      arrowGroups.add(state.name);
      const siblings=await evaluate(browser,`document.querySelectorAll('input[type=radio][name="${state.name}"][data-qa-key]').length`);
      for(let step=0;step<siblings;step++) {for(const type of ['keyDown','keyUp'])await browser.cdp.send('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},session);await record();}
    }
  }
  const missing=await evaluate(browser,`Array.from(document.querySelectorAll('[data-qa-key]')).filter(e=>!${JSON.stringify([...reached])}.includes(e.dataset.qaKey)).map(e=>({key:e.dataset.qaKey,stableComponent:e.dataset.qaPath,text:e.textContent.trim().slice(0,160),href:e.getAttribute('href')||null,tag:e.tagName,component:e.closest('[data-block-type],.panel')?.id||e.id||e.tagName.toLowerCase(),label:e.getAttribute('aria-label')||e.textContent.trim()||e.name,tabIndex:e.tabIndex,type:e.type,reason:'This active control was not reached by Tab or native radio ArrowRight navigation.'}))`);
  return {count:controlCount,reached:reached.size,missing,ok:reached.size===controlCount};
}

export async function inspectPublicHtml(browser,{artifactPath,width=1440,height=900,theme='light',themeControl='query',javascript=true,media='screen',keyboard=true,screenshotPath,writeScreenshot}={}) {
  const session=await browser.sessionPromise;
  const errors=[];
  let clearStorage;
  if(!['query','system'].includes(themeControl))throw new Error('themeControl must be query or system.');
  const unsubscribe=browser.cdp.subscribe?.(message=>{
    if(message.sessionId!==session)return;
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '));
    if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')errors.push(message.params.entry.text);
  });
  try {
    await browser.cdp.send('Page.bringToFront',{},session);
    await browser.cdp.send('Log.enable',{},session);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
    await browser.cdp.send('Emulation.setEmulatedMedia',{media,features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]},session);
    await browser.cdp.send('Emulation.setScriptExecutionDisabled',{value:!javascript},session);
    const url=pathToFileURL(artifactPath);if(themeControl==='query')url.searchParams.set('theme',theme);else clearStorage=await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'try {localStorage.clear();sessionStorage.clear();} catch {}'},session);
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);loaded.catch(()=>{});
    const navigation=await browser.cdp.send('Page.navigate',{url:url.href},session);if(navigation.errorText)throw new Error(navigation.errorText);await loaded;
    if(themeControl==='system'&&!javascript)await evaluate(browser,"(function(){try{localStorage.clear();sessionStorage.clear();return true;}catch{return false;}})()");
    // Inspector evaluation works with page JavaScript disabled; it does not run
    // or repair the artifact's reader. Font readiness is separate from reader JS.
    const fontStart=Date.now();let fontStatus;
    do {fontStatus=await evaluate(browser,"(function(){void document.body.offsetHeight;return document.fonts.status;})()");if(fontStatus==='loaded')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-fontStart<5000);
    const fontReadiness={status:fontStatus,waitMs:Date.now()-fontStart};
    await new Promise(resolve=>setTimeout(resolve,50));
    const metrics=await evaluate(browser,`(${measurePublicHtml.toString()})(${javascript})`,true);
    metrics.fontReadiness=fontReadiness;metrics.themeControl=themeControl;metrics.navigationUrl=url.href;
    if(javascript&&keyboard)metrics.keyboardTraversal=await keyboardTraversal(browser,metrics.controlCount);
    metrics.consoleErrors=errors;
    if(screenshotPath) {
      await evaluate(browser,'window.scrollTo(0,0)');
      const result=await browser.cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},session,20000);
      if(!result.data)throw new Error('Chrome returned an empty screenshot.');
      const bytes=Buffer.from(result.data,'base64');if(writeScreenshot)writeScreenshot(bytes);else fs.writeFileSync(screenshotPath,bytes,{flag:'wx'});
    }
    return metrics;
  } finally {unsubscribe?.();if(clearStorage)await browser.cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:clearStorage.identifier},session);await browser.cdp.send('Emulation.setScriptExecutionDisabled',{value:false},session);}
}

export async function inspectNativeViewer(browser) {
  const parent=await browser.cdp.send('Page.getFrameTree',{},await browser.sessionPromise);
  const targets=await browser.cdp.send('Target.getTargets');
  const target=targets.targetInfos.find(t=>t.type==='iframe'&&t.parentId===parent.frameTree.frame.id&&t.url.startsWith('about:srcdoc'));
  if(!target)return {available:false,errors:[]};
  const attached=await browser.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const errors=[];
  const stop=browser.cdp.subscribe?.(m=>{if(m.sessionId!==attached.sessionId)return;if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));});
  try {
    await browser.cdp.send('Runtime.enable',{},attached.sessionId);
    const result=await browser.cdp.send('Runtime.evaluate',{expression:"({ready:document.readyState,visibility:document.visibilityState,href:location.href,active:document.querySelector('svg[data-focus-active]')?.dataset.focusActive||'',nodes:[...new Set(Array.from(document.querySelectorAll('[data-focus-selected]')).map(e=>e.dataset.nodeId).filter(Boolean))],edges:[...new Set(Array.from(document.querySelectorAll('[data-edge-id][data-focus-match]')).map(e=>e.dataset.edgeId))],hasViewer:Boolean(window.Archify?.focus),preset:document.documentElement.dataset.preset||'',badges:['.header-row','.diagram-container'].map(s=>{const e=document.querySelector(s);return e?getComputedStyle(e,'::after').display:'absent';})})",returnByValue:true},attached.sessionId);
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
    return {available:true,targetId:target.targetId,...result.result.value,errors};
  } finally {stop?.();await browser.cdp.send('Target.detachFromTarget',{sessionId:attached.sessionId});}
}

async function press(browser,key) {const session=await browser.sessionPromise;const codes={Enter:13,Escape:27,' ':32};for(const type of ['keyDown','keyUp'])await browser.cdp.send('Input.dispatchKeyEvent',{type,key,code:key===' '?'Space':key,windowsVirtualKeyCode:codes[key],...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})},session);await evaluate(browser,'new Promise(resolve=>setTimeout(resolve,0))',true);}
async function activate(browser,selector,key='Enter') {const exists=await evaluate(browser,`(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.scrollIntoView({block:'center'});e.focus();return document.activeElement===e;})()`);if(!exists)return false;await press(browser,key);return true;}

export async function inspectExplainerBrowser(browser,options) {
  if (browser.resetPage) await browser.resetPage();
  const interactionErrors=[];
  const session=await browser.sessionPromise;
  const stop=browser.cdp.subscribe?.(message=>{if(message.sessionId!==session)return;if(message.method==='Runtime.exceptionThrown')interactionErrors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')interactionErrors.push(message.params.args.map(a=>a.value??a.description).join(' '));});
  try {
  const clear=await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'try {localStorage.clear();} catch {}'},session);
  let metrics;try{metrics=await inspectPublicHtml(browser,options);}finally{await browser.cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:clear.identifier},session);}
  const failures=[];
  const check=(name,ok,reason,component='reader',measurement)=>{if(!ok)failures.push({name,reason,component,...(measurement?{measurement}:{})});};
  const diagram=await evaluate(browser,"document.querySelector('[data-block-type=steps] [data-diagram-link]')?.dataset.diagramLink || document.querySelector('[data-diagram-link]')?.dataset.diagramLink || document.querySelector('[data-open-diagram]')?.dataset.openDiagram || null");
  if(diagram) {
    const selector=await evaluate(browser,"document.querySelector('[data-block-type=steps] [data-diagram-link]')?'[data-block-type=steps] [data-diagram-link]':document.querySelector('[data-diagram-link]')?'[data-diagram-link]':'[data-open-diagram]'");
    check('diagram-keyboard',await activate(browser,selector),'Diagram link cannot be activated by keyboard.',diagram);
    for(let attempt=0;attempt<30;attempt++) {if(await evaluate(browser,"Boolean(document.querySelector('#diagram-dialog')?.dataset.nativeFocus)"))break;await new Promise(resolve=>setTimeout(resolve,100));}
    const frame=await evaluate(browser,"(function(){const d=document.querySelector('#diagram-dialog'),f=d.querySelector('iframe');return {open:d.open,frame:Boolean(f),sandbox:f?.getAttribute('sandbox'),loaded:d.dataset.nativeLoaded,ready:d.dataset.nativeReady,loadingHidden:d.querySelector('.dialog-loading')?.hidden,visible:document.visibilityState,frameRect:f?{width:f.getBoundingClientRect().width,height:f.getBoundingClientRect().height}:null,error:d.querySelector('.dialog-loading')?.textContent};})()");
    check('diagram-viewer',frame.open&&frame.frame,'Diagram activation did not open the canonical Viewer.',diagram,frame);
    const focus=await evaluate(browser,`(function(){const link=document.querySelector(${JSON.stringify(selector)}),hash=link.dataset.diagramHash||'',edges=JSON.parse(link.dataset.diagramEdges||'[]'),bundle=JSON.parse(document.getElementById('archify-explainer-prepared').textContent),child=bundle.preparedDiagrams.diagrams[link.dataset.diagramLink||link.dataset.openDiagram],nodes=hash.startsWith('focus=')?[decodeURIComponent(hash.slice(6))]:hash.startsWith('route=')?hash.slice(6).split('~').map(decodeURIComponent):[...new Set((child.semantic?.edges||[]).filter(e=>edges.includes(e.id)).flatMap(e=>[e.from,e.to]))];let actual;try{actual=JSON.parse(document.querySelector('#diagram-dialog').dataset.nativeFocus||'null');}catch{}return {component:link.closest('[data-block-type]')?.id||link.dataset.diagramLink,nodes,edges,actual,frame:{ready:document.querySelector('#diagram-dialog').dataset.nativeReady,loaded:document.querySelector('#diagram-dialog').dataset.nativeLoaded,loadingHidden:document.querySelector('#diagram-dialog .dialog-loading').hidden}};})()`);
    const native=await inspectNativeViewer(browser);
    metrics.nativeViewer=native;
    interactionErrors.push(...native.errors);
    if(focus.nodes.length||focus.edges.length)check('diagram-focus',native.available&&native.ready==='complete'&&native.hasViewer&&Boolean(native.active)&&focus.nodes.length===native.nodes?.length&&focus.nodes.every(id=>native.nodes?.includes(id))&&(!focus.edges.length||focus.edges.length===native.edges?.length)&&focus.edges.every(id=>native.edges?.includes(id)),'The canonical Viewer did not focus the step’s exact nodes and edges.',focus.component,{...focus,dialog:frame,native});
    await press(browser,'Escape');
  }
  const nativeText=await inspectNativePreviewLayout(browser);
  for(const entry of nativeText){check('diagram-fit',entry.fit!=='insufficient'&&entry.scrollWidth<=entry.clientWidth+1&&entry.outsidePreview.length===0,'The native preview cannot fit its complete graph at the required text size.',entry.component,entry);check('diagram-text',entry.minimum!==null&&entry.minimum>=10&&(options.width<1440||entry.ratio>=0.75),'Native diagram text is below its viewport reading floor (10px; 75% of body at 1440).',entry.component,entry);}
  metrics.nativeText=nativeText;
  metrics.interactionFailures=failures;
  const noJavaScript=[];
  for(const theme of ['light','dark']) {if(browser.resetPage)await browser.resetPage();noJavaScript.push({theme,metrics:await inspectPublicHtml(browser,{...options,theme,javascript:false,keyboard:false,screenshotPath:undefined})});}
  if(browser.resetPage)await browser.resetPage();
  const print=await inspectPublicHtml(browser,{...options,theme:'light',media:'print',keyboard:false,screenshotPath:undefined});
  metrics.noJavaScript=noJavaScript.map(({theme,metrics:entry})=>({theme,ok:entry.panels.length>0&&entry.panels.every(p=>p.visible&&p.text.trim())&&entry.staticReading.every(p=>p.visible&&p.text)&&entry.interactiveVisible.length===0&&noJavaScript[0].metrics.background!==noJavaScript[1].metrics.background,panels:entry.panels,interactiveVisible:entry.interactiveVisible,background:entry.background,measurementMethod:entry.measurementMethod,fontReadiness:entry.fontReadiness}));
  const typical=await evaluate(browser,"({links:Array.from(document.querySelectorAll('.typical-ref')).map(e=>e.getAttribute('href')),notes:Array.from(document.querySelectorAll('.typical-footnotes li')).map(e=>({id:e.id,text:e.textContent,visible:getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0}))})");
  metrics.print={ok:print.panels.length>0&&print.panels.every(p=>p.visible&&p.text.trim())&&print.interactiveVisible.length===0&&print.staticReading.every(p=>p.visible&&p.text)&&typical.links.every(link=>typical.notes.some(note=>link==='#'+note.id&&note.visible&&note.text.trim())),panels:print.panels,interactiveVisible:print.interactiveVisible,typical,measurementMethod:print.measurementMethod,fontReadiness:print.fontReadiness};
  metrics.consoleErrors=[...new Set([...metrics.consoleErrors,...interactionErrors,...noJavaScript.flatMap(x=>x.metrics.consoleErrors),...print.consoleErrors])];
  return metrics;
  } finally {stop?.();}
}

export function explainerObservation({width,height,theme,metrics}) {
  const overflowX=metrics.scrollWidth>metrics.innerWidth+1||metrics.overflowElements.length>0;
  return {...metrics,width,height,theme,overflowX,overflowY:metrics.scrollHeight>metrics.innerHeight,verticalScrollAccepted:!overflowX,ok:!overflowX,readabilityOk:metrics.smallText.length===0,viewerChromeOk:metrics.occluded.length===0};
}
export function explainerObservationDiagnostics({artifact,allObservations}) {
  const diagnostics=[];
  let locations=new Map(),sourceInput;
  try {
    const parsed=scanHtml(fs.readFileSync(artifact,'utf8'));
    locations=new Map(parsed.elements.filter(e=>e.attrs.id).map(e=>[e.attrs.id,e.line]));
    const payload=parsed.scripts.find(s=>s.attrs.id==='archify-explainer-prepared');
    if(payload) {const bundle=JSON.parse(payload.text);sourceInput=bundle.sourcePath;bundle.document.panels.forEach((panel,index)=>{locations.set(panel.id,bundle.sourceMap?.[`/panels/${index}`]?.line||locations.get(panel.id)||1);panel.blocks.forEach((block,j)=>locations.set(block.id,bundle.sourceMap?.[`/panels/${index}/blocks/${j}`]?.line||locations.get(block.id)||1));});}
  }catch{}
  for(const entry of allObservations) {
    const failures=[...(entry.overflowX?[{name:'horizontal-overflow',reason:'Rendered content exceeds the horizontal viewport.',component:entry.overflowElements[0]?.component || 'document'}]:[]),...entry.keyboardIssues.map(x=>({name:'keyboard',...x})),...(entry.keyboardTraversal&&!entry.keyboardTraversal.ok?entry.keyboardTraversal.missing.map(m=>({name:'keyboard-traversal',reason:`${m.reason} ${m.tag} ${m.label}`,component:m.component})):[]),...entry.consoleErrors.map(reason=>({name:'console-error',reason,component:'reader'})),...entry.references.map(x=>({name:'reference',reason:`Unresolved reference ${x.href}.`,component:x.component})),...entry.duplicateIds.map(id=>({name:'duplicate-id',reason:`Duplicate DOM ID ${id}.`,component:'document'})),...entry.smallText.map(x=>({name:'readability',reason:`Rendered text is ${x.fontSize}px, below 10px.`,component:x.component})),...entry.occluded.map(x=>({name:'control-occluded',reason:'Another element covers an active control.',component:x.component})),...(entry.interactionFailures || []),...entry.noJavaScript.filter(x=>!x.ok).map(x=>({name:'no-javascript',reason:`Static reading content or inactive controls fail with JavaScript disabled (${x.theme}).`,component:'document'})),...(!entry.print.ok?[{name:'print',reason:'Print hides necessary reading content or displays inactive controls.',component:'document'}]:[])];
    if(entry.resolvedTheme!==entry.theme)failures.push({name:'theme',reason:`Requested ${entry.theme}; resolved ${entry.resolvedTheme}.`,component:'theme'});
    for(const fail of failures)diagnostics.push({code:`explainer/browser-${fail.name}`,severity:'error',message:fail.reason,subject:{artifact,...(sourceInput?{input:sourceInput}:{}),line:locations.get(fail.component)||1,component:fail.component,viewport:{width:entry.width,height:entry.height,theme:entry.theme}},evidence:{reason:fail.reason,example:repairExample(fail.name),...(fail.measurement?{measurement:fail.measurement}:{})},supportedFixes:[repairExample(fail.name)]});
  }
  return diagnostics;
}
function repairExample(name) {return name==='horizontal-overflow'?'Use min-width:0 and bounded horizontal scrolling for tables or code.':name.startsWith('keyboard')?'Use a native button/link/input with visible focus and keyboard activation.':name==='no-javascript'||name==='print'?'Keep canonical content visible and hide interactive controls in no-JavaScript and print styles.':name==='diagram-text'?'Increase the diagram panel span until projected node text reaches 75% of body text.':'Repair the reported component and re-render the source.';}
