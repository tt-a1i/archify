globalThis.StoryExport=(()=>{
  const width=1920,height=1080,fps=60;
  const videoBitrate=14000000,audioBitrate=192000,maxBufferedBytes=512*1024*1024,reserveBytes=32*1024*1024;
  const svgProps=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','stroke-miterlimit','vector-effect','paint-order','stop-color','stop-opacity','text-anchor','dominant-baseline','r'];
  const commonProps=['opacity','visibility','transform','transform-origin','transform-box','filter','clip-path','mask-image','display','font-family','font-size','font-weight','letter-spacing','color'];
  const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
  function abort(signal){if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');}
  function canvas(){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
  function captureStage(){
    const serializer=new XMLSerializer(),style=document.createElement('style');
    const fonts=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].filter(rule=>rule.type===CSSRule.FONT_FACE_RULE).map(rule=>rule.cssText);}catch{return [];}});
    style.textContent=fonts.join('\n')+'\n'+document.querySelector('#story-style').textContent;
    const styles=serializer.serializeToString(style),rootStyle=getComputedStyle(document.documentElement);
    const variables=[...rootStyle].filter(key=>key.startsWith('--')).map(key=>key+':'+rootStyle.getPropertyValue(key)).join(';');
    return async(target,time)=>{
      Story.seek(time,false);
      const root=document.querySelector('.stage'),copy=root.cloneNode(true),sources=[root,...root.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
      for(let i=0;i<sources.length;i++){
        const source=sources[i],node=copies[i],computed=getComputedStyle(source);
        for(const key of [...commonProps,...(source.namespaceURI==='http://www.w3.org/2000/svg'?svgProps:[])]){
          const value=computed.getPropertyValue(key).replace(/url\(["']?[^)#]*#([^)'" ]+)["']?\)/g,'url(#$1)');
          node.style.setProperty(key,value,'important');
        }
        node.style.setProperty('animation','none','important');node.style.setProperty('transition','none','important');
      }
      copy.style.position='relative';copy.style.width=width+'px';copy.style.height=height+'px';copy.style.margin='0';copy.style.borderRadius=getComputedStyle(root).borderRadius;copy.style.boxShadow=getComputedStyle(root).boxShadow;
      const wrapper=document.createElementNS('http://www.w3.org/1999/xhtml','div');wrapper.setAttribute('style',variables+';font-family:'+getComputedStyle(root).fontFamily);wrapper.append(copy);
      const markup='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><foreignObject width="100%" height="100%">'+styles+serializer.serializeToString(wrapper)+'</foreignObject></svg>';
      const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);
      try{await image.decode();target.getContext('2d').drawImage(image,0,0,width,height);}finally{image.src='';}
    };
  }
  async function image({time=0,signal,format='png'}={}){
    if(!['png','jpeg','webp'].includes(format))throw Error('Unsupported presentation image format.');
    abort(signal);const target=canvas();await captureStage()(target,time);abort(signal);
    return new Promise((resolve,reject)=>target.toBlob(blob=>blob?.type==='image/'+format?resolve(blob):reject(Error('The browser cannot encode this image format.')),'image/'+format,.95));
  }
  async function video({start=0,seconds=Story.duration-start,signal,onProgress=()=>{}}={}){
    if(!Number.isFinite(start)||!Number.isFinite(seconds)||start<0||seconds<=0||start+seconds>Story.duration+.001)throw Error('Invalid export range.');
    const samples=Math.ceil(seconds*48000),pcmBytes=samples*2*4,encodedRate=(videoBitrate+audioBitrate)/8;
    if(reserveBytes+pcmBytes+seconds*encodedRate>maxBufferedBytes)throw Error('Video export exceeds the supported buffer budget; choose a shorter range.');
    if(typeof VideoEncoder==='undefined'||typeof AudioEncoder==='undefined')throw Error('Video export needs a browser with WebCodecs video and audio encoding.');
    const vc={codec:'vp09.00.41.08',width,height,framerate:fps,bitrate:videoBitrate,latencyMode:'quality'},ac={codec:'opus',sampleRate:48000,numberOfChannels:2,bitrate:audioBitrate};
    if(!(await VideoEncoder.isConfigSupported(vc)).supported||!(await AudioEncoder.isConfigSupported(ac)).supported)throw Error('This browser does not support the required video or audio encoder.');
    abort(signal);Story.pause();Story.setSound(false);
    const target=canvas(),capture=captureStage(),video=[],audio=[];let failure,opusHead,encodedBytes=0;
    const save=(list,chunk)=>{
      if(failure)return;encodedBytes+=chunk.byteLength;
      if(reserveBytes+pcmBytes+encodedBytes>maxBufferedBytes){failure=Error('Video export exceeded the supported buffer budget; choose a shorter range.');return;}
      const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);list.push({timestamp:chunk.timestamp,key:chunk.type==='key',data:new Blob([data])});
    };
    const ve=new VideoEncoder({output:chunk=>save(video,chunk),error:error=>failure=error});
    const ae=new AudioEncoder({output:(chunk,metadata)=>{save(audio,chunk);if(metadata?.decoderConfig?.description)opusHead=new Uint8Array(metadata.decoderConfig.description).slice();},error:error=>failure=error});
    try{
      ve.configure(vc);ae.configure(ac);
      const frames=Math.ceil(seconds*fps);
      for(let index=0;index<frames;index++){
        abort(signal);if(failure)throw failure;
        await capture(target,start+index/fps);abort(signal);
        const timestamp=Math.round(index*1e6/fps),next=Math.round((index+1)*1e6/fps),frame=new VideoFrame(target,{timestamp,duration:next-timestamp});
        try{ve.encode(frame,{keyFrame:index%(fps*2)===0});}finally{frame.close();}
        while(ve.encodeQueueSize>3){abort(signal);if(failure)throw failure;await yieldTask();}
        onProgress({fraction:(index+1)/frames*.94,frame:index+1,frames});await yieldTask();
      }
      await ve.flush();abort(signal);if(failure)throw failure;
      const sound=StorySound.renderer(Story.duration,Story.audioCues,start)(samples/48000);
      for(let at=0;at<samples;at+=960){
        abort(signal);if(failure)throw failure;const count=Math.min(960,samples-at),data=new Float32Array(count*2);
        for(let channel=0;channel<2;channel++)data.set(sound.channels[channel].subarray(at,at+count),channel*count);
        const frame=new AudioData({format:'f32-planar',sampleRate:sound.rate,numberOfFrames:count,numberOfChannels:2,timestamp:Math.round(at*1e6/sound.rate),data});
        try{ae.encode(frame);}finally{frame.close();}
        while(ae.encodeQueueSize>16){abort(signal);if(failure)throw failure;await yieldTask();}
      }
      await ae.flush();abort(signal);if(failure)throw failure;
      const blob=StoryWebM.mux({width,height,fps,duration:seconds,video,audio,opusHead});onProgress({fraction:1,frame:frames,frames});return blob;
    }finally{if(ve.state!=='closed')ve.close();if(ae.state!=='closed')ae.close();target.width=target.height=1;}
  }
  return {defaults:{width,height,fps},image,png:options=>image({...options,format:'png'}),video};
})();
