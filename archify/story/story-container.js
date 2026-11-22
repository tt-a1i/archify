globalThis.StoryContainer=(()=>{
  const text=value=>new TextEncoder().encode(value),zeros=count=>new Uint8Array(count);
  const concat=parts=>{const out=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;};
  const join=(...parts)=>concat(parts);
  function number(value,width){let v=BigInt(value);const out=zeros(width);for(let i=width-1;i>=0;i--){out[i]=Number(v&255n);v>>=8n;}if(v!==0n)throw Error('Container integer exceeds its field.');return out;}
  const u16=value=>number(value,2),u32=value=>number(value,4),u64=value=>number(value,8);
  const box=(type,...data)=>{const payload=join(...data);return join(u32(payload.length+8),text(type),payload);};
  const full=(type,version,flags,...data)=>box(type,number(version,1),number(flags,3),...data);
  const matrix=join(u32(65536),zeros(12),u32(65536),zeros(12),u32(1073741824));
  const description=value=>value?new Uint8Array(value.buffer||value,value.byteOffset||0,value.byteLength).slice():null;
  const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);

  function sink({writer,start,maxBytes,check}){
    let position=start,buffer=zeros(1048576),used=0,pendingBytes=0,error,tail=Promise.resolve();const parts=[];
    function queue(at,data){
      if(!writer){parts.push(new Blob([data]));return;}
      pendingBytes+=data.length;
      tail=tail.then(async()=>{check();if(error)throw error;await writer.write({type:'write',position:at,data});})
        .catch(reason=>{error??=reason;}).finally(()=>{pendingBytes-=data.length;});
    }
    function flush(){if(!used)return;const data=buffer.subarray(0,used),at=position-used;buffer=zeros(1048576);used=0;queue(at,data);}
    function append(data){
      check();if(error)throw error;
      if(!Number.isSafeInteger(position+data.length)||(!writer&&position+data.length>maxBytes))throw Error('Video exceeds the in-memory buffer budget; save to a file or select a shorter range.');
      for(let at=0;at<data.length;){const count=Math.min(buffer.length-used,data.length-at);buffer.set(data.subarray(at,at+count),used);at+=count;used+=count;position+=count;if(used===buffer.length)flush();}
    }
    async function drain(force=false){if(force||pendingBytes>=2097152)await tail;check();if(error)throw error;}
    async function finish(header,type){
      if(header.length!==start)throw Error('Container header has an invalid size.');flush();await drain(true);
      if(writer){queue(0,header);await drain(true);return {type,size:position};}
      return new Blob([header,...parts],{type});
    }
    async function settle(){await tail;buffer=zeros(0);parts.length=0;}
    return {append,drain,finish,settle,get position(){return position;}};
  }

  function aacFrameSize(data){
    let at=0;const read=count=>{let value=0;for(let i=0;i<count;i++){if(at>=data.length*8)throw Error('Incomplete AAC configuration.');value=value*2+((data[at>>3]>>(7-(at++&7)))&1);}return value;};
    const type=read(5),index=read(4),rate=index===15?read(24):[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350][index],channels=read(4);
    if(type!==2||rate!==48000||channels!==2)throw Error('The encoder must provide AAC-LC stereo at 48 kHz.');return read(1)?960:1024;
  }
  function mp4(options){
    const {width,height,fps,frames,samples=0}=options,withAudio=options.audio!==false,movieScale=1000000,videoScale=fps*1000;
    // Reserve the fast-start index so encoded samples can stream directly to their final offsets.
    const reserve=8192+frames*32+(withAudio?(Math.ceil(samples/960)+16)*20:0);
    if(!Number.isSafeInteger(reserve)||reserve>4294967295)throw Error('The video timeline is too large for the MP4 index.');
    const ftyp=box('ftyp',text('mp42'),u32(0),text('mp42isomiso2avc1')),start=ftyp.length+reserve+16,output=sink({...options,start});
    const video=[],audio=[],seen=new Set();let avc,aac,color,audioUnit=1024;
    function add(track,chunk,metadata){
      if(track!=='video'&&!withAudio)return;
      const next=description(metadata?.decoderConfig?.description),previous=track==='video'?avc:aac;
      if(next){if(previous&&!same(previous,next))throw Error('The encoder changed its configuration during export.');if(track==='video'){avc=next;color=metadata.decoderConfig.colorSpace;}else{aac=next;audioUnit=aacFrameSize(next);}}
      const data=zeros(chunk.byteLength);chunk.copyTo(data);const record={timestamp:chunk.timestamp,offset:output.position,size:data.length,key:chunk.type==='key'};
      if(track==='video'){
        const index=Math.round(chunk.timestamp*fps/1e6);
        if(index<0||index>=frames||seen.has(index)||Math.abs(chunk.timestamp-index*1e6/fps)>2)throw Error('The video encoder changed the requested frame cadence.');
        seen.add(index);record.pts=index*1000;video.push(record);
      }else audio.push(record);
      output.append(data);
    }
    const table=(type,rows)=>full(type,0,0,u32(rows.length),concat(rows));
    function sampleTable(records,entry,durations,offsets){
      const sizes=full('stsz',0,0,u32(0),u32(records.length),concat(records.map(record=>u32(record.size))));
      const wide=records.some(record=>record.offset>4294967295),locations=table(wide?'co64':'stco',records.map(record=>(wide?u64:u32)(record.offset)));
      const groups=[];for(const duration of durations){const last=groups.at(-1);if(last?.value===duration)last.count++;else groups.push({count:1,value:duration});}
      const timing=table('stts',groups.map(group=>join(u32(group.count),u32(group.value))));
      const composition=[];if(offsets?.some(value=>value!==0)){
        const runs=[];for(const value of offsets){const last=runs.at(-1);if(last?.value===value)last.count++;else runs.push({count:1,value});}
        composition.push(table('ctts',runs.map(run=>join(u32(run.count),u32(run.value)))));
      }
      const sync=records===video?[table('stss',records.flatMap((record,index)=>record.key?[u32(index+1)]:[]))]:[];
      return box('stbl',full('stsd',0,0,u32(1),entry),timing,...composition,table('stsc',[join(u32(1),u32(1),u32(1))]),sizes,locations,...sync);
    }
    function track(id,records,entry,scale,durations,mediaTime,duration,offsets){
      const isVideo=id===1,mediaDuration=durations.reduce((sum,value)=>sum+value,0)+(isVideo?mediaTime:0);
      const tkhd=full('tkhd',1,7,u64(0),u64(0),u32(id),u32(0),u64(duration),zeros(8),u16(0),u16(0),u16(isVideo?0:256),u16(0),matrix,u32(isVideo?width*65536:0),u32(isVideo?height*65536:0));
      const edits=box('edts',full('elst',1,0,u32(1),u64(duration),u64(mediaTime),u16(1),u16(0)));
      const mdhd=full('mdhd',1,0,u64(0),u64(0),u32(scale),u64(mediaDuration),u16(0x55c4),u16(0));
      const handler=full('hdlr',0,0,u32(0),text(isVideo?'vide':'soun'),zeros(12),text(isVideo?'Archify video\0':'Archify audio\0'));
      const info=isVideo?full('vmhd',0,1,zeros(8)):full('smhd',0,0,zeros(4));
      const references=box('dinf',full('dref',0,0,u32(1),full('url ',0,1)));
      return box('trak',tkhd,edits,box('mdia',mdhd,handler,box('minf',info,references,sampleTable(records,entry,durations,offsets))));
    }
    const descriptor=(tag,data)=>{let size=data.length,parts=[size&127];while(size>>=7)parts.unshift((size&127)|128);return join(number(tag,1),new Uint8Array(parts),data);};
    async function finish(){
      if(video.length!==frames||!video[0]?.key||!avc||(withAudio&&(!audio.length||!aac))){
        throw Error(withAudio?'The encoder did not produce complete video and audio tracks.':'The encoder did not produce a complete video track.');
      }
      // Encoder callbacks are in decode order. Composition offsets and the edit preserve presentation order.
      const shift=video.reduce((max,record,index)=>Math.max(max,index*1000-record.pts),0),offsets=video.map((record,index)=>record.pts+shift-index*1000);
      const compressor=zeros(32);compressor[0]=7;compressor.set(text('Archify'),1);
      const colors={bt709:1,'iec61966-2-1':13,rgb:0},colr=color?[box('colr',text('nclx'),u16(colors[color.primaries]??2),u16(colors[color.transfer]??2),u16(colors[color.matrix]??2),number(color.fullRange?128:0,1))]:[];
      const videoEntry=box('avc1',zeros(6),u16(1),zeros(16),u16(width),u16(height),u32(72*65536),u32(72*65536),u32(0),u16(1),compressor,u16(24),u16(65535),box('avcC',avc),...colr);
      const videoDuration=Math.round(frames/fps*movieScale);
      const tracks=[track(1,video,videoEntry,videoScale,video.map(()=>1000),shift,videoDuration,offsets)];
      let duration=videoDuration;
      if(withAudio){
        const priming=Math.max(0,-Math.round(audio[0].timestamp*48000/1e6));
        if(audio[0].timestamp>21||audio.some((record,index)=>Math.abs(record.timestamp-(index*audioUnit-priming)*1e6/48000)>2))throw Error('The AAC encoder changed the audio timeline.');
        if(audio.length*audioUnit<samples+priming)throw Error('The AAC track is incomplete.');
        const decoder=descriptor(4,join(number(64,1),number(21,1),zeros(3),u32(options.audioBitrate),u32(options.audioBitrate),descriptor(5,aac)));
        const esds=full('esds',0,0,descriptor(3,join(u16(2),number(0,1),decoder,descriptor(6,number(2,1)))));
        const audioEntry=box('mp4a',zeros(6),u16(1),zeros(8),u16(2),u16(16),zeros(4),u32(48000*65536),esds);
        const audioDuration=Math.round(samples/48000*movieScale);
        duration=Math.max(videoDuration,audioDuration);
        // The audio edit removes encoder priming and trims the final padded packet to the requested duration.
        tracks.push(track(2,audio,audioEntry,48000,audio.map(()=>audioUnit),priming,audioDuration));
      }
      const mvhd=full('mvhd',1,0,u64(0),u64(0),u32(movieScale),u64(duration),u32(65536),u16(256),zeros(10),matrix,zeros(24),u32(withAudio?3:2));
      const moov=box('moov',mvhd,...tracks);
      const padding=reserve-moov.length;if(padding<8)throw Error('The MP4 index exceeded its header reservation.');
      const header=join(ftyp,moov,box('free',zeros(padding-8)),u32(1),text('mdat'),u64(output.position-start+16));
      return output.finish(header,'video/mp4');
    }
    return {add,finish,drain:output.drain,settle:output.settle};
  }

  function webm(options){
    const withAudio=options.audio!==false;
    const bytes=value=>{let width=1;while(BigInt(value)>=(1n<<BigInt(width*8)))width++;return number(value,width);};
    const size=(value,width)=>{if(!width){width=1;while(BigInt(value)>=(1n<<BigInt(width*7))-1n)width++;}return number(BigInt(value)|(1n<<BigInt(width*7)),width);};
    const element=(id,data)=>join(bytes(id),size(data.length),data),group=(id,...parts)=>element(id,join(...parts));
    const uint=(id,value,width)=>element(id,width?number(value,width):bytes(value)),string=(id,value)=>element(id,text(value));
    const float=(id,value)=>{const data=zeros(8);new DataView(data.buffer).setFloat64(0,value);return element(id,data);};
    const seek=(id,position)=>group(0x4dbb,element(0x53ab,bytes(id)),uint(0x53ac,position,8));
    const header=group(0x1a45dfa3,uint(0x4286,1),uint(0x42f7,1),uint(0x42f2,4),uint(0x42f3,8),string(0x4282,'webm'),uint(0x4287,4),uint(0x4285,2));
    const segmentStart=header.length+12,start=16384,output=sink({...options,start}),queues={video:[],audio:[]},cues=[];
    let opus,origin,videoCount=0,audioCount=0,lastVideo=-Infinity,lastAudio=-Infinity;
    function emit(){
      if(!withAudio){
        if(origin===undefined){if(!queues.video.length)return;origin=Math.min(0,queues.video[0].timestamp);}
        while(queues.video.length)write('video',queues.video.shift());
        return;
      }
      if(origin===undefined){if(!queues.video.length||!queues.audio.length)return;origin=Math.min(0,queues.video[0].timestamp,queues.audio[0].timestamp);}
      while(queues.video.length&&queues.audio.length){const track=queues.video[0].timestamp<=queues.audio[0].timestamp?'video':'audio';write(track,queues[track].shift());}
    }
    function write(track,packet){
      const at=Math.round(packet.timestamp-origin),head=new Uint8Array([track==='video'?129:130,0,0,packet.key?128:0]);
      if(track==='video'&&packet.key)cues.push(group(0xbb,uint(0xb3,at),group(0xb7,uint(0xf7,1),uint(0xf1,output.position-segmentStart))));
      output.append(group(0x1f43b675,uint(0xe7,at),element(0xa3,join(head,packet.data))));
    }
    function add(track,chunk,metadata){
      if(track==='audio'){
        if(!withAudio)return;
        const next=description(metadata?.decoderConfig?.description);if(next){if(opus&&!same(opus,next))throw Error('The Opus encoder changed its configuration.');opus=next;}
        if(chunk.timestamp<=lastAudio)throw Error('The Opus encoder changed the audio timeline.');lastAudio=chunk.timestamp;audioCount++;
      }else{
        if(chunk.timestamp<=lastVideo||Math.abs(chunk.timestamp-videoCount*1e6/options.fps)>2)throw Error('The VP9 encoder changed the video timeline.');lastVideo=chunk.timestamp;videoCount++;
      }
      const data=zeros(chunk.byteLength);chunk.copyTo(data);queues[track].push({timestamp:chunk.timestamp,key:chunk.type==='key',data});emit();
    }
    async function finish(){
      if(videoCount!==options.frames||(withAudio&&(!audioCount||!opus||opus.length<19))){
        throw Error(withAudio?'The encoder did not produce complete VP9 and Opus tracks.':'The encoder did not produce a complete VP9 video track.');
      }
      if(origin===undefined)throw Error('The WebM timeline is empty.');
      while(queues.video.length||(withAudio&&queues.audio.length)){const track=!withAudio||!queues.audio.length||queues.video.length&&queues.video[0].timestamp<=queues.audio[0].timestamp?'video':'audio';write(track,queues[track].shift());}
      const cuePosition=output.position-segmentStart;output.append(element(0x1c53bb6b,concat(cues)));
      const info=group(0x1549a966,uint(0x2ad7b1,1000),float(0x4489,options.duration*1e6),string(0x4d80,'Archify Story'),string(0x5741,'Archify Story'));
      const video=group(0xae,uint(0xd7,1),uint(0x73c5,1),uint(0x83,1),uint(0x9c,0),string(0x86,'V_VP9'),uint(0x23e383,Math.round(1e9/options.fps)),group(0xe0,uint(0xb0,options.width),uint(0xba,options.height)));
      const trackEntries=[video];
      if(withAudio){
        const skip=new DataView(opus.buffer,opus.byteOffset,opus.byteLength).getUint16(10,true);
        trackEntries.push(group(0xae,uint(0xd7,2),uint(0x73c5,2),uint(0x83,2),uint(0x9c,0),string(0x86,'A_OPUS'),element(0x63a2,opus),uint(0x56aa,Math.round(skip/48000*1e9)),uint(0x56bb,80000000),group(0xe1,float(0xb5,48000),uint(0x9f,2))));
      }
      const tracks=group(0x1654ae6b,...trackEntries),seekHead=(a,b)=>group(0x114d9b74,seek(0x1549a966,a),seek(0x1654ae6b,b),seek(0x1c53bb6b,cuePosition)),empty=seekHead(0,0),head=seekHead(empty.length,empty.length+info.length);
      const padding=start-segmentStart-head.length-info.length-tracks.length;if(padding<9)throw Error('The WebM header exceeded its reservation.');
      const prefix=join(header,bytes(0x18538067),size(output.position-segmentStart,8),head,info,tracks,bytes(0xec),size(padding-9,8),zeros(padding-9));
      return output.finish(prefix,'video/webm');
    }
    return {add,finish,drain:output.drain,settle:output.settle};
  }
  return {open:options=>{if(!['mp4','webm'].includes(options.format))throw Error('Unsupported container format.');return options.format==='mp4'?mp4(options):webm(options);}};
})();
