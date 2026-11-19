import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {captureAtomicOutput,captureRegularFileBinding,publishRegularFileBinding,releaseRegularFileBinding,removeOwnedRegularFile,quarantineRemoveRegularFileBinding,verifyAtomicOutput} from '../renderers/shared/atomic-output.mjs';

export function writeStoryOutput(file,content,guard=()=>{},{createOnly=false,committed,fallbackMode,expectedPreviousSha256,expectedPreviousBytes}={}){
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
    const mode=output.mode??fallbackMode;
    descriptor=fs.openSync(temporary,'wx',mode??0o666);const stat=fs.fstatSync(descriptor,{bigint:true});identity={device:stat.dev,inode:stat.ino};
    fs.writeFileSync(descriptor,content);if(mode!==undefined)fs.fchmodSync(descriptor,mode);closeCandidate();
    guard();
    const candidate=captureRegularFileBinding(temporary,{subject:'story-candidate',expectedIdentity:identity,expectedBytes:bytes,expectedSha256:sha256});
    if(candidate.status!=='captured')failure(candidate);binding=candidate.binding;
    const published=publishRegularFileBinding(binding,temporary,output.snapshot,{subject:'story-candidate',expectedPreviousSha256,expectedPreviousBytes});
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

// Keep the old bytes available until every SVG from this invocation is published.
// Both the legacy HTML bridge and the multi-view compiler use this boundary.
export function publishStorySvgOutputs(files, guard, render) {
  if (files.length === 1) return render((file, content) => writeStoryOutput(file, content, () => guard(file)));

  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const expected = new Map();
  const original = new Map();
  const previous = new Map();
  const committed = [];
  const backups = [];
  let recoveryDirectory;

  const removeBackups = () => {
    for (const backup of backups) {
      const result = rollbackStoryOutput(backup);
      if (!['removed', 'absent'].includes(result.status) || result.release) {
        throw new Error('Could not clean recovery copy: ' + backup.file);
      }
    }
    if (recoveryDirectory) fs.rmdirSync(recoveryDirectory);
  };

  const verifyOutput = ({ snapshot, sha256 }) => {
    if (verifyAtomicOutput(snapshot).status !== 'match'
      || (sha256 && digest(fs.readFileSync(snapshot.slot.commitPath)) !== sha256)) {
      throw new Error('Story SVG output changed during publication: ' + snapshot.requestedPath);
    }
  };

  try {
    for (const file of files) {
      guard(file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const captured = captureAtomicOutput(file);
      if (captured.status !== 'captured') throw new Error('Story SVG output cannot be published: ' + file);
      const { commitPath, mode, snapshot } = captured;
      const bytes = snapshot.target.kind === 'file' ? fs.readFileSync(commitPath) : null;
      const state = { snapshot, sha256: bytes === null ? undefined : digest(bytes), byteLength: bytes?.length, mode };
      original.set(file, state);
      expected.set(file, state);
      if (bytes === null) continue;

      recoveryDirectory ??= fs.mkdtempSync(path.join(path.dirname(commitPath), '.archify-story-recovery-'));
      const backup = path.join(recoveryDirectory, 'prior-' + previous.size + '.svg');
      writeStoryOutput(backup, bytes, undefined, { createOnly: true, committed: backups, fallbackMode: mode });
      previous.set(commitPath, { requestedPath: file, bytes, mode });
    }

    render((file, content) => {
      const initial = original.get(file);
      const published = writeStoryOutput(file, content, () => {
        guard(file);
        verifyOutput(initial);
      }, { committed, expectedPreviousSha256: initial.sha256, expectedPreviousBytes: initial.byteLength });
      const captured = captureAtomicOutput(file);
      if (captured.status !== 'captured' || captured.commitPath !== published.file
        || captured.snapshot.target.device !== published.identity.device
        || captured.snapshot.target.inode !== published.identity.inode) {
        throw new Error('Story SVG output changed during publication: ' + file);
      }
      expected.set(file, { snapshot: captured.snapshot, sha256: published.sha256 });
    });
    for (const file of files) guard(file);
    for (const state of expected.values()) verifyOutput(state);
  } catch (error) {
    const cause = error.archifyDiagnostics ?? error.code ?? error.message;
    const failures = [];
    for (const record of committed.reverse()) {
      try {
        const removed = rollbackStoryOutput(record);
        if (removed.status !== 'removed') throw new Error('Output was not removed: ' + record.file);
        const prior = previous.get(record.file);
        if (prior) writeStoryOutput(record.file, prior.bytes, () => guard(prior.requestedPath),
          { createOnly: true, fallbackMode: prior.mode });
        if (removed.release) throw new Error('Could not release output during restore: ' + record.file);
      } catch (failure) {
        failures.push(failure.message);
      }
    }
    // A failed write may also have failed to restore that same destination
    // inside the single-file publisher, before it had any commit to record.
    for (const [file, { snapshot, sha256, mode }] of original) {
      try {
        const now = captureAtomicOutput(file);
        if (now.status !== 'captured' || now.commitPath !== snapshot.slot.commitPath
          || now.snapshot.target.kind !== snapshot.target.kind || now.mode !== mode
          || (sha256 && digest(fs.readFileSync(now.commitPath)) !== sha256)) {
          failures.push('Previous output could not be verified: ' + file);
        }
      } catch (failure) {
        failures.push(failure.message);
      }
    }
    if (!failures.length) {
      try { removeBackups(); } catch (failure) { failures.push(failure.message); }
    }
    const restoration = failures.length ? 'incomplete' : 'complete';
    if (failures.length) {
      error.message += ' Recovery incomplete: ' + failures.join('; ');
      if (recoveryDirectory) error.message += '; recovery directory: ' + recoveryDirectory;
    }
    error.archifyDiagnostics = [{
      code: 'story/svg-publication', severity: 'error', message: error.message, subject: { outputs: files },
      evidence: {
        cause, restoration,
        ...(failures.length && recoveryDirectory ? { recoveryDirectory, recoveryFiles: backups.map(backup => backup.file) } : {}),
      },
      supportedFixes: [failures.length
        ? 'Inspect any reported recovery copies before retrying.'
        : 'Check output permissions and retry; previous outputs were restored.'],
    }];
    throw error;
  }

  try { removeBackups(); } catch (error) {
    error.message = 'SVG outputs were published, but recovery cleanup failed: ' + error.message
      + '; recovery directory: ' + recoveryDirectory;
    error.archifyDiagnostics = [{
      code: 'story/svg-recovery-cleanup', severity: 'error', message: error.message, subject: { outputs: files },
      evidence: { publication: 'committed', recoveryDirectory },
      supportedFixes: ['Inspect the published outputs before removing the reported recovery directory.'],
    }];
    throw error;
  }
}
