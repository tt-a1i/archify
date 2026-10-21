// WebM uses microsecond timestamps so offline frames retain their exact cadence.
globalThis.StoryWebM=(()=>{
  const bytes=id=>{const a=[];do{a.unshift(id%256);id=Math.floor(id/256);}while(id);return new Uint8Array(a);};
  function size(value){let n=1;while(value>=2**(7*n)-1)n++;const out=new Uint8Array(n);for(let i=n-1;i>=0;i--){out[i]=value%256;value=Math.floor(value/256);}out[0]|=1<<(8-n);return out;}
  const element=(id,data)=>new Blob([bytes(id),size(data.size??data.byteLength),data]);
  const group=(id,children)=>element(id,new Blob(children));
  function uint(id,value,width){const data=width?new Uint8Array(width):bytes(value);if(width)for(let i=width-1;i>=0;i--){data[i]=value%256;value=Math.floor(value/256);}return element(id,data);}
  const str=(id,text)=>element(id,new TextEncoder().encode(text));
  function float(id,value){const a=new Uint8Array(8);new DataView(a.buffer).setFloat64(0,value);return element(id,a);}
  const seek=(id,position)=>group(0x4dbb,[element(0x53ab,bytes(id)),uint(0x53ac,position,8)]);
  function mux({width,height,fps,duration,video,audio,opusHead}){
    const header=group(0x1a45dfa3,[uint(0x4286,1),uint(0x42f7,1),uint(0x42f2,4),uint(0x42f3,8),str(0x4282,'webm'),uint(0x4287,4),uint(0x4285,2)]);
    const info=group(0x1549a966,[uint(0x2ad7b1,1000),float(0x4489,duration*1e6),str(0x4d80,'Archify Story'),str(0x5741,'Archify Story')]);
    const tracks=[group(0xae,[uint(0xd7,1),uint(0x73c5,1),uint(0x83,1),uint(0x9c,0),str(0x86,'V_VP9'),uint(0x23e383,Math.round(1e9/fps)),group(0xe0,[uint(0xb0,width),uint(0xba,height)])])];
    if(audio.length){
      if(!opusHead||opusHead.length<19)throw Error('The audio encoder did not provide an Opus header.');
      const skip=new DataView(opusHead.buffer,opusHead.byteOffset,opusHead.byteLength).getUint16(10,true);
      tracks.push(group(0xae,[uint(0xd7,2),uint(0x73c5,2),uint(0x83,2),uint(0x9c,0),str(0x86,'A_OPUS'),element(0x63a2,opusHead),uint(0x56aa,Math.round(skip/48000*1e9)),uint(0x56bb,80000000),group(0xe1,[float(0xb5,48000),uint(0x9f,2)])]));
    }
    const trackData=group(0x1654ae6b,tracks);
    const seekHead=positions=>group(0x114d9b74,[seek(0x1549a966,positions[0]),seek(0x1654ae6b,positions[1]),seek(0x1c53bb6b,positions[2])]);
    const emptyHead=seekHead([0,0,0]);
    let position=emptyHead.size+info.size+trackData.size;
    const cues=[],clusters=[],chunks=[...video.map(c=>({...c,track:1})),...audio.map(c=>({...c,track:2}))].sort((a,b)=>a.timestamp-b.timestamp||a.track-b.track);
    const origin=chunks.reduce((min,chunk)=>Math.min(min,chunk.timestamp),0);
    for(let i=0;i<chunks.length;){
      const time=Math.max(0,Math.round(chunks[i].timestamp-origin)),blocks=[];
      while(i<chunks.length&&Math.round(chunks[i].timestamp-origin)-time<30000){
        const chunk=chunks[i++],at=Math.round(chunk.timestamp-origin),head=new Uint8Array(4);head[0]=0x80|chunk.track;new DataView(head.buffer).setInt16(1,at-time);head[3]=chunk.key?0x80:0;
        blocks.push(group(0xa3,[head,chunk.data]));
        if(chunk.track===1&&chunk.key)cues.push(group(0xbb,[uint(0xb3,at),group(0xb7,[uint(0xf7,1),uint(0xf1,position)])]));
      }
      const cluster=group(0x1f43b675,[uint(0xe7,time),...blocks]);clusters.push(cluster);position+=cluster.size;
    }
    const cueData=group(0x1c53bb6b,cues),head=seekHead([emptyHead.size,emptyHead.size+info.size,position]);
    return new Blob([header,group(0x18538067,[head,info,trackData,...clusters,cueData])],{type:'video/webm'});
  }
  return {mux};
})();
