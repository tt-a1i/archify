(()=>{
  function start(){
    const payload=JSON.parse(document.querySelector('#archify-story-payload').textContent),root=document.documentElement;
    const motion=document.querySelector('#btn-motion'),label=document.querySelector('#motion-label'),diagram=document.querySelector('.diagram-container'),exportMenu=document.querySelector('#export-menu');
    if(!motion||!diagram||!exportMenu||!window.Archify?.motionGovernor)throw Error('The native Viewer does not provide the story entry points.');
    const messages=payload.messages[Archify.locale]||payload.messages.en;
    for(const [key,value]of Object.entries(messages))if(!Object.hasOwn(archifyI18nData.messages,key))archifyI18nData.messages[key]=value;
    let page,player,loading,view='native',resumeNative,wasPlaying=false,scrubbing=false,job,statusTimer,controlFrame,viewVersion=0;
    const nativeInert=diagram.inert;
    const decode=()=>page??=new TextDecoder().decode(Uint8Array.from(atob(payload.html),c=>c.charCodeAt(0)));
    const element=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
    const panel=element('section','story-panel');panel.lang='en';panel.hidden=true;panel.setAttribute('aria-label','Story');diagram.after(panel);
    const cards=document.querySelector('#reader-rail > .cards')||document.querySelector('.container > .cards'),cardsHome=document.createComment('Native notes position');
    function showNotes(active){
      if(active&&cards&&!cardsHome.isConnected){cards.before(cardsHome);cards.classList.replace('cards','story-notes');panel.after(cards);}
      else if(!active&&cardsHome.isConnected){cards.classList.replace('story-notes','cards');cardsHome.replaceWith(cards);}
    }
    function appearance(){
      const style=getComputedStyle(diagram.querySelector('svg')||root);
      return {theme:root.dataset.theme,preset:root.dataset.preset,variables:Object.fromEntries([...style].filter(key=>key.startsWith('--')&&!/^--(?:archify|flow)-/.test(key)).map(key=>[key,style.getPropertyValue(key)])),titleFont:getComputedStyle(document.querySelector('.header h1')||root).fontFamily};
    }
    let playerAppearance;
    function syncAppearance(){
      const win=player?.contentWindow;if(!win?.storyReady)return;
      const next=appearance(),key=JSON.stringify(next);if(key===playerAppearance)return;
      win.Story.setAppearance(next);playerAppearance=key;
    }
    const appearanceObserver=new MutationObserver(syncAppearance);
    appearanceObserver.observe(root,{attributes:true,attributeFilter:['data-theme','data-preset','style','class']});
    if(diagram.querySelector('svg'))appearanceObserver.observe(diagram.querySelector('svg'),{attributes:true,attributeFilter:['data-theme','data-preset','style','class']});
    const controls=element('div','story-panel-controls'),play=element('button','','Play'),range=element('input'),clock=element('span','story-panel-clock','0:00'),sound=element('button','','Sound on');
    range.type='range';range.min=0;range.step=1/60;range.value=0;range.setAttribute('aria-label','Story playback position');
    play.type=sound.type='button';sound.setAttribute('aria-pressed','true');controls.append(play,range,clock,sound);panel.append(controls);
    for(const control of [play,range,sound])control.disabled=true;
    const modes=Archify.motionGovernor.capable?['live','still','story']:['still','story'];
    const selectedMode=()=>view==='story'?'story':Archify.motionGovernor.mode();
    const nextMode=()=>modes[(modes.indexOf(selectedMode())+1)%modes.length];
    motion.hidden=false;
    const modeLabel=mode=>viewerText(mode==='story'?'viewer.story.label':'viewer.motion.'+mode);
    function refresh(){
      const selected=selectedMode();label.textContent=modeLabel(selected);
      motion.setAttribute('aria-label',viewerText('viewer.story.switch',{view:label.textContent}));motion.setAttribute('aria-pressed',String(selected!=='still'));motion.title=viewerText('viewer.story.next',{view:modeLabel(nextMode())});motion.disabled=false;
    }
    motion.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();Archify.exportMenu.close(false);Archify.preset?.close(false);setView(nextMode(),{persist:true}).catch(showError);},true);
    new MutationObserver(refresh).observe(root,{attributes:true,attributeFilter:['data-motion']});
    function loadFrame(frame,frozenAppearance,render=false){
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('The story could not initialize.')),15000);
        frame.addEventListener('load',async()=>{
          try{
            const win=frame.contentWindow;await win.document.fonts.ready;
            for(let i=0;i<200&&!win.storyReady;i++)await new Promise(r=>setTimeout(r,20));
            if(!win.storyReady)throw Error('The story could not initialize.');win.Story.pause();win.Story.setAppearance(frozenAppearance||appearance());clearTimeout(timer);resolve(win);
          }catch(error){clearTimeout(timer);reject(error);}
        },{once:true});
        let html=decode().replace('<body>','<body class="export">');
        if(render)html=html.replace('<html ','<html data-motion-render ');
        frame.srcdoc=html;
      });
    }
    async function ensurePlayer(){
      if(loading)return loading;
      player=element('iframe');player.title='Diagram story';player.allow='autoplay';loading=loadFrame(player);panel.prepend(player);
      try{const win=await loading;range.max=win.Story.duration;for(const control of [play,range,sound])control.disabled=false;return win;}catch(error){player.remove();player=undefined;loading=undefined;throw error;}
    }
    async function setView(next,{persist=false}={}){
      if(!['live','still','story'].includes(next))throw Error('Unknown Viewer mode.');
      const version=++viewVersion;
      if(next==='story'){
        if(view!=='story')diagram.style.setProperty('--story-native-width',diagram.getBoundingClientRect().width+'px');
        view='story';resumeNative??=Archify.motionGovernor.suspend('story');diagram.inert=true;root.setAttribute('data-story-active','true');panel.hidden=false;showNotes(true);refresh();
        try{await ensurePlayer();if(version!==viewVersion)return state();syncAppearance();cancelAnimationFrame(controlFrame);controlFrame=requestAnimationFrame(tick);}catch(error){if(version!==viewVersion)return state();await setView('still');throw error;}
      }else{
        if(loading)await loading.catch(()=>{});if(version!==viewVersion)return state();
        if(document.fullscreenElement===panel)await document.exitFullscreen();cancelAnimationFrame(controlFrame);
        player?.contentWindow?.Story?.pause();view='native';panel.hidden=true;showNotes(false);root.removeAttribute('data-story-active');diagram.inert=nativeInert;resumeNative?.();resumeNative=undefined;Archify.motionGovernor.setMode(next,{persist});refresh();
      }
      return state();
    }
    const format=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
    function state(){const story=player?.contentWindow?.Story,metrics=story?.metrics();return {view,playing:!!metrics?.playing,time:metrics?.audioTime||0,duration:story?.duration||0,sound:metrics?.sound??true};}
    function tick(){
      if(view==='story'&&player?.contentWindow?.storyReady){const s=state();if(!scrubbing)range.value=s.time;play.textContent=s.playing?'Pause':'Play';clock.textContent=format(s.time)+' / '+format(s.duration);sound.textContent=s.sound?'Sound on':'Sound off';sound.setAttribute('aria-pressed',String(s.sound));}
      if(view==='story')controlFrame=requestAnimationFrame(tick);
    }
    play.onclick=async()=>{try{const win=await ensurePlayer();if(win.Story.metrics().playing)win.Story.pause();else await win.Story.play();}catch(error){showError(error);}};
    const beginScrub=()=>{if(scrubbing)return;scrubbing=true;wasPlaying=state().playing;player?.contentWindow?.Story?.pause();};
    range.onpointerdown=beginScrub;range.oninput=()=>{beginScrub();player?.contentWindow?.Story?.seek(Number(range.value));};
    range.onchange=()=>{scrubbing=false;if(wasPlaying)player.contentWindow.Story.play();wasPlaying=false;};
    range.onpointercancel=()=>{scrubbing=false;wasPlaying=false;};
    sound.onclick=()=>{const story=player.contentWindow.Story;story.setSound(!story.metrics().sound);};
    document.addEventListener('keydown',event=>{
      if(view!=='story'||event.target.closest('input,textarea,button,[contenteditable="true"]'))return;
      if(event.code==='Space'){event.preventDefault();event.stopImmediatePropagation();play.click();}
      if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();const story=player?.contentWindow?.Story;story?.pause();story?.seek(state().time+(event.key==='ArrowLeft'?-2:2));}
    },true);
    document.querySelector('#btn-present')?.addEventListener('click',event=>{if(view!=='story')return;event.preventDefault();event.stopImmediatePropagation();(document.fullscreenElement?document.exitFullscreen():panel.requestFullscreen()).catch(showError);},true);
    const section=element('div','export-menu-section'),videoButton=element('button'),videoCopy=element('span','export-item-copy');
    section.lang='en';section.setAttribute('role','group');section.setAttribute('aria-label','Story');videoButton.type='button';videoButton.dataset.action='story-video';videoButton.setAttribute('role','menuitem');videoButton.tabIndex=-1;
    videoCopy.append(element('strong','','Story video'),element('small','hint','1080p · 60 fps'));videoButton.append(videoCopy);section.append(videoButton);exportMenu.append(section);
    const nativeVideo=exportMenu.querySelector('[data-format="webm"]');if(nativeVideo)videoButton.style.setProperty('--story-export-icon',getComputedStyle(nativeVideo,'::before').maskImage);
    const status=element('div','story-export-status'),statusText=element('span'),cancel=element('button','','Cancel');status.lang='en';status.setAttribute('role','status');status.hidden=true;cancel.type='button';status.append(statusText,cancel);document.body.append(status);cancel.onclick=()=>job?.abort();
    function message(text,cancellable=false){clearTimeout(statusTimer);status.hidden=false;statusText.textContent=text;cancel.hidden=!cancellable;if(!cancellable)statusTimer=setTimeout(()=>status.hidden=true,6000);}
    function showError(error){message(error.name==='AbortError'?'Export cancelled.':error.message||String(error));}
    async function render(kind,options={}){
      if(job)throw Error('A story export is already running.');job=new AbortController();const controller=job,frame=element('iframe','story-render-frame');frame.title='Story export';frame.setAttribute('aria-hidden','true');
      videoButton.disabled=true;message(kind==='video'?'Preparing story video · 1080p · 60 fps…':'Exporting story image…',true);
      const sourceTime=options.time??state().time,ready=loadFrame(frame,appearance(),true);document.body.append(frame);
      try{
        const win=await ready;win.Story.setSound(false);
        const blob=kind==='video'?await win.StoryExport.video({...options,signal:controller.signal,onProgress:event=>{message('Exporting story video · '+Math.round(event.fraction*100)+'% · 1080p · 60 fps',true);options.onProgress?.(event);}}):await win.StoryExport.image({time:sourceTime,signal:controller.signal,format:kind});
        root.dataset.lastStoryExportFormat=kind==='video'?'webm':kind;root.dataset.lastStoryExportWidth='1920';root.dataset.lastStoryExportHeight='1080';root.dataset.lastStoryExportFps=kind==='video'?'60':'0';root.dataset.lastStoryExportBytes=blob.size;
        message('Story '+(kind==='video'?'video':'image')+' exported.');return new Blob([blob],{type:blob.type});
      }catch(error){showError(error);throw error;}
      finally{frame.remove();job=undefined;videoButton.disabled=false;}
    }
    async function downloadVideo(){
      Archify.exportMenu.close(true);const blob=await render('video'),url=URL.createObjectURL(blob),link=element('a');
      link.href=url;link.download=document.title.replace(/[<>:"/\\|?*]/g,'-').slice(0,80)+'-story.webm';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return blob;
    }
    videoButton.onclick=()=>{if(!videoButton.disabled)downloadVideo().catch(showError);};
    Archify.story={setView,state,seek:time=>player?.contentWindow?.Story?.seek(time),play:async()=>{await setView('story');if(view==='story')return player.contentWindow.Story.play();},pause:()=>player?.contentWindow?.Story?.pause(),setSound:on=>player?.contentWindow?.Story?.setSound(on),exportVideo:options=>render('video',options),exportPNG:options=>render('png',options),cancelExport:()=>job?.abort(),defaults:{width:1920,height:1080,fps:60}};
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
