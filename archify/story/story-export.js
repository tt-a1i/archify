globalThis.StoryExport=(()=>{
  const width=1920,height=1080,fps=60,framesPerRead=4,frameBytes=width*height*4;
  const videoBitrate=14000000,audioBitrate=192000,maxBufferedBytes=512*1024*1024,reserveBytes=32*1024*1024;
  const svgProps=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','stroke-miterlimit','vector-effect','paint-order','stop-color','stop-opacity','text-anchor','dominant-baseline','r'];
  const commonProps=['opacity','visibility','transform','transform-origin','transform-box','filter','clip-path','mask-image','display','font-family','font-size','font-weight','letter-spacing','color'];
  const allSvgProps=[...commonProps,...svgProps],htmlFrozen=new Set([...commonProps,'animation','transition']),svgFrozen=new Set([...allSvgProps,'animation','transition']);
  function abort(signal){if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');}
  function canvas(rows=1){const c=document.createElement('canvas');c.width=width;c.height=height*rows;return c;}
  function captureStage(){
    const serializer=new XMLSerializer(),style=document.createElement('style');
    let grouped=typeof CSSLayerBlockRule!=='undefined';
    const fonts=[...document.styleSheets].flatMap(sheet=>{try{const rules=[...sheet.cssRules];if(rules.some(rule=>/\[\s*style\b/i.test(rule.cssText)))grouped=false;return rules.filter(rule=>rule.type===CSSRule.FONT_FACE_RULE).map(rule=>rule.cssText);}catch{grouped=false;return [];}});
    style.textContent=fonts.join('\n')+'\n'+document.querySelector('#story-style').textContent;
    const styles=serializer.serializeToString(style),rootStyle=getComputedStyle(document.documentElement);
    const variables=[...rootStyle].filter(key=>key.startsWith('--')).map(key=>key+':'+rootStyle.getPropertyValue(key)).join(';');
    return async(target,time,offset=0)=>{
      Story.seek(time,false);
      const root=document.querySelector('.stage'),copy=root.cloneNode(true),sources=[root,...root.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
      const share=grouped&&!sources.some(node=>node.hasAttribute('data-archify-capture')),groups=new Map();
      for(let i=0;i<sources.length;i++){
        const source=sources[i],node=copies[i],computed=getComputedStyle(source),svg=source.namespaceURI==='http://www.w3.org/2000/svg';
        let css=share?'':(node.getAttribute('style')||'')+';';
        for(const key of svg?allSvgProps:commonProps){
          const value=computed.getPropertyValue(key).replace(/url\(["']?[^)#]*#([^)'" ]+)["']?\)/g,'url(#$1)');
          css+=key+':'+value+'!important;';
        }
        css+='animation:none!important;transition:none!important;';
        if(share){
          let id=groups.get(css);if(id===undefined){id=groups.size;groups.set(css,id);}
          for(const key of [...node.style])if((svg?svgFrozen:htmlFrozen).has(key)||key.startsWith('animation-')||key.startsWith('transition-'))node.style.removeProperty(key);
          node.setAttribute('data-archify-capture',id);
        }else node.setAttribute('style',css);
      }
      copy.style.position='relative';copy.style.width=width+'px';copy.style.height=height+'px';copy.style.margin='0';copy.style.borderRadius=getComputedStyle(root).borderRadius;copy.style.boxShadow=getComputedStyle(root).boxShadow;
      const wrapper=document.createElementNS('http://www.w3.org/1999/xhtml','div');wrapper.setAttribute('style',variables+';font-family:'+getComputedStyle(root).fontFamily);wrapper.append(copy);
      let shared='';
      if(share){
        // The first important layer preserves frozen values without repeating them on every node.
        const layer=document.createElementNS('http://www.w3.org/2000/svg','style');
        layer.textContent='@layer{'+[...groups].map(([css,id])=>'[data-archify-capture="'+id+'"]{'+css+'}').join('')+'}';shared=serializer.serializeToString(layer);
      }
      const markup='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'">'+shared+'<foreignObject width="100%" height="100%">'+styles+serializer.serializeToString(wrapper)+'</foreignObject></svg>';
      const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);
      try{await image.decode();const context=target.getContext('2d',{willReadFrequently:false});context.clearRect(0,offset,width,height);context.drawImage(image,0,offset,width,height);}finally{image.src='';}
    };
  }
  async function image({time=0,signal,format='png'}={}){
    if(!['png','jpeg','webp'].includes(format))throw Error('Unsupported presentation image format.');
    abort(signal);const target=canvas();await captureStage()(target,time);abort(signal);
    return new Promise((resolve,reject)=>target.toBlob(blob=>blob?.type==='image/'+format?resolve(blob):reject(Error('The browser cannot encode this image format.')),'image/'+format,.95));
  }
  const formats={
    mp4:{videoCodec:'avc1.64002a',audioCodec:'mp4a.40.2'},
    webm:{videoCodec:'vp09.00.41.08',audioCodec:'opus'},
  };
  async function encode({start=0,seconds=Story.duration-start,signal,onProgress=()=>{},format='mp4'}={},writer){
    const selected=Object.hasOwn(formats,format)&&formats[format];if(!selected)throw Error('Choose MP4 or WebM.');
    if(!Number.isFinite(start)||!Number.isFinite(seconds)||start<0||seconds<=0||start+seconds>Story.duration+.001)throw Error('Invalid export range.');
    const samples=Math.ceil(seconds*48000),frames=Math.ceil(seconds*fps);
    if(!writer&&reserveBytes+seconds*(videoBitrate+audioBitrate)/8>maxBufferedBytes)throw Error('Video export exceeds the supported buffer budget for in-memory output; save directly to a file or choose a shorter range.');
    if(typeof VideoEncoder==='undefined'||typeof AudioEncoder==='undefined')throw Error('Video export needs a browser with WebCodecs video and audio encoding.');
    const vc={codec:selected.videoCodec,width,height,framerate:fps,bitrate:videoBitrate,latencyMode:'quality',...(format==='mp4'?{avc:{format:'avc'}}:{})},ac={codec:selected.audioCodec,sampleRate:48000,numberOfChannels:2,bitrate:audioBitrate};
    if(!(await VideoEncoder.isConfigSupported(vc)).supported||!(await AudioEncoder.isConfigSupported(ac)).supported)throw Error(format==='mp4'?'This browser cannot encode H.264 and AAC for MP4. Try Chrome or Edge on Windows/macOS.':'This browser cannot encode VP9 and Opus for WebM.');
    abort(signal);Story.pause();Story.setSound(false);
    const target=canvas(framesPerRead),capture=captureStage();let video,audio,mux,failure,wake;
    const check=()=>{abort(signal);if(failure)throw failure;},failed=error=>{failure??=error;wake?.();};
    const collect=track=>(chunk,metadata)=>{if(failure||signal?.aborted)return;try{mux.add(track,chunk,metadata);}catch(error){failed(error);}};
    const cancel=()=>{if(video&&video.state!=='closed')video.close();if(audio&&audio.state!=='closed')audio.close();wake?.();};
    async function drain(encoder){
      check();
      while(encoder.encodeQueueSize>=4){
        await new Promise(resolve=>{
          const ready=()=>{encoder.removeEventListener('dequeue',ready);if(wake===ready)wake=undefined;resolve();};
          wake=ready;encoder.addEventListener('dequeue',ready,{once:true});
          if(failure||signal?.aborted||encoder.state==='closed'||encoder.encodeQueueSize<4)ready();
        });check();
      }
      await mux.drain();
    }
    try{
      mux=StoryContainer.open({format,width,height,fps,frames,samples,duration:seconds,audioBitrate,writer,maxBytes:maxBufferedBytes,check});
      video=new VideoEncoder({output:collect('video'),error:failed});audio=new AudioEncoder({output:collect('audio'),error:failed});
      signal?.addEventListener('abort',cancel,{once:true});check();video.configure(vc);audio.configure(ac);
      const sound=StorySound.renderer(Story.duration,Story.audioCues,start);let audioAt=0;
      for(let base=0;base<frames;base+=framesPerRead){
        const count=Math.min(framesPerRead,frames-base);
        for(let offset=0;offset<count;offset++){
          check();await capture(target,start+(base+offset)/fps,offset*height);
        }
        check();
        // Amortize GPU readback across a small, fixed number of frames.
        const pixels=target.getContext('2d').getImageData(0,0,width,height*count).data;
        for(let index=base;index<base+count;index++){
          check();
          // Keep both tracks near the same time so the muxer need not retain an entire track.
          if(audioAt<samples&&audioAt/48000<=index/fps){
            const count=Math.min(12000,samples-audioAt),block=sound(count/48000),data=new Float32Array(count*2);
            for(let channel=0;channel<2;channel++)data.set(block.channels[channel],channel*count);
            const sample=new AudioData({format:'f32-planar',sampleRate:48000,numberOfChannels:2,numberOfFrames:count,timestamp:Math.round(audioAt*1e6/48000),data});
            try{audio.encode(sample);}finally{sample.close();}audioAt+=count;await drain(audio);
          }
          const timestamp=Math.round(index*1e6/fps),next=Math.round((index+1)*1e6/fps),at=(index-base)*frameBytes;
          const frame=new VideoFrame(pixels.subarray(at,at+frameBytes),{format:'RGBA',codedWidth:width,codedHeight:height,timestamp,duration:next-timestamp,colorSpace:{primaries:'bt709',transfer:'iec61966-2-1',matrix:'rgb',fullRange:true}});
          try{video.encode(frame,{keyFrame:index%(fps*2)===0});}finally{frame.close();}await drain(video);
          onProgress({fraction:(index+1)/frames*.98,frame:index+1,frames});
        }
      }
      await video.flush();check();await audio.flush();check();
      const result=await mux.finish();check();onProgress({fraction:1,frame:frames,frames});return result;
    }catch(error){
      check();throw error;
    }finally{signal?.removeEventListener('abort',cancel);cancel();await mux?.settle();target.width=target.height=1;}
  }
  return {defaults:{width,height,fps,format:'mp4'},image,png:options=>image({...options,format:'png'}),video:options=>encode(options),writeVideo:(writer,options)=>encode(options,writer)};
})();
