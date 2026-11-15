import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {captureAtomicOutput,captureRegularFileBinding,publishRegularFileBinding,releaseRegularFileBinding,removeOwnedRegularFile,quarantineRemoveRegularFileBinding} from '../renderers/shared/atomic-output.mjs';

export function writeStoryOutput(file,content,guard=()=>{},{createOnly=false,committed}={}){
  let descriptor,identity,binding,record,error;
  const failure=result=>{
    const message=(record?'Story output was published but cleanup failed':'Story output could not be published')
      +': '+(result.cleanupState?.code||result.reason?.code||result.status)
      +(result.recoveryDirectory?'; recovery directory: '+result.recoveryDirectory:'')
      +(result.recoveryFile?'; recovery file: '+result.recoveryFile:'');
    throw Object.assign(new Error(message),{archifyDiagnostics:[{
      code:'story/output-publication',severity:'error',message,subject:{output:file},
      evidence:{publication:record?'committed':'not-committed',reason:result.reason||result.status,
        ...(result.cleanupState?{cleanupState:result.cleanupState}:{}),
        ...(result.recoveryDirectory?{recoveryDirectory:result.recoveryDirectory}:{}),
        ...(result.recoveryFile?{recoveryFile:result.recoveryFile}:{}),
      },
      supportedFixes:[record?'Inspect the published output and any reported recovery paths before retrying.':'Check the output location and retry with a distinct writable path.'],
    }]});
  };
  guard();fs.mkdirSync(path.dirname(file),{recursive:true});
  const output=captureAtomicOutput(file);if(output.status!=='captured')failure(output);
  if(createOnly&&output.snapshot.target.kind!=='absent')throw Error('Draft output already exists; choose a new brief path.');
  const temporary=path.join(path.dirname(output.commitPath),'.archify-story-'+randomUUID()+'.tmp');
  const bytes=Buffer.byteLength(content),sha256=createHash('sha256').update(content).digest('hex');
  const closeCandidate=()=>{const open=descriptor;descriptor=undefined;if(open!==undefined)fs.closeSync(open);};
  const cleanup=operation=>{
    try{operation();}catch(cause){
      if(!error)error=cause;
      else{const message=' Cleanup: '+cause.message;error.message+=message;for(const diagnostic of error.archifyDiagnostics||[])diagnostic.message+=message;}
    }
  };
  try{
    descriptor=fs.openSync(temporary,'wx',output.mode??0o666);const stat=fs.fstatSync(descriptor,{bigint:true});identity={device:stat.dev,inode:stat.ino};
    fs.writeFileSync(descriptor,content);if(output.mode!==null)fs.fchmodSync(descriptor,output.mode);closeCandidate();
    guard();
    const candidate=captureRegularFileBinding(temporary,{subject:'story-candidate',expectedIdentity:identity,expectedBytes:bytes,expectedSha256:sha256});
    if(candidate.status!=='captured')failure(candidate);binding=candidate.binding;
    const published=publishRegularFileBinding(binding,temporary,output.snapshot,{subject:'story-candidate'});
    if(!['committed','committed-with-warning'].includes(published.status))failure(published);
    // A release error does not undo publication. Keep ownership available for rollback.
    record={file:output.commitPath,identity,bytes,sha256};committed?.push(record);
    if(published.status==='committed-with-warning')failure(published);
  }catch(cause){
    error=cause;
  }finally{
    cleanup(closeCandidate);
    if(binding)cleanup(()=>{const released=releaseRegularFileBinding(binding);if(released.status!=='released')failure(released);});
    if(identity)cleanup(()=>{const removed=removeOwnedRegularFile(temporary,identity,{subject:'story-candidate'});if(!['removed','absent','preserved'].includes(removed.status))failure(removed);});
  }
  if(error)throw error;
  return record;
}

export function rollbackStoryOutput(output){
  const owned=captureRegularFileBinding(output.file,{subject:'story-companion',expectedIdentity:output.identity,expectedBytes:output.bytes,expectedSha256:output.sha256});
  if(owned.status!=='captured')return {status:owned.reason?.systemCode==='ENOENT'?'absent':['different','unsupported'].includes(owned.status)?'preserved':owned.status};
  let removal,released;
  try{removal=quarantineRemoveRegularFileBinding(owned.binding,output.file,{subject:'story-companion'});}
  finally{released=releaseRegularFileBinding(owned.binding);}
  return {...removal,...(released.status!=='released'?{release:released}:{})};
}
