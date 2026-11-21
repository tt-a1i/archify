import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {captureAtomicOutput,captureRegularFileBinding,publishRegularFileBinding,releaseRegularFileBinding,removeOwnedRegularFile,quarantineRemoveRegularFileBinding,verifyAtomicOutput} from '../renderers/shared/atomic-output.mjs';
import { canonicalFuturePath } from '../renderers/shared/output-path.mjs';
import { sameLocation } from '../renderers/shared/path-semantics.mjs';

function verifyStoryOutputSlot(snapshot) {
  const canonicalPath = canonicalFuturePath(snapshot.requestedPath);
  // path-contract-allow: lexical-capability -- Keep the canonical path captured for this write.
  if (canonicalPath !== snapshot.slot.commitPath) {
    return { status: 'different', reason: { code: 'write-slot-changed' } };
  }
  return verifyAtomicOutput(snapshot);
}

export function writeStoryOutput(file,content,guard=()=>{},{
  createOnly=false,committed,fallbackMode,expectedPreviousSha256,expectedPreviousBytes,expectedSnapshot,
}={}){
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
  const verifyExpectedSlot=()=>{
    if(!expectedSnapshot)return;
    const result=verifyStoryOutputSlot(expectedSnapshot);
    if(result.status!=='match')failure(result);
  };
  guard();
  verifyExpectedSlot();
  if(!expectedSnapshot)fs.mkdirSync(path.dirname(file),{recursive:true});
  const output=expectedSnapshot
    ? {snapshot:expectedSnapshot,commitPath:expectedSnapshot.slot.commitPath,mode:expectedSnapshot.target.mode??null}
    : captureAtomicOutput(file);
  if(!expectedSnapshot&&output.status!=='captured')failure(output);
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
    verifyExpectedSlot();
    const published=publishRegularFileBinding(binding,temporary,output.snapshot,{subject:'story-candidate',expectedPreviousSha256,expectedPreviousBytes});
    if(!['committed','committed-with-warning'].includes(published.status))failure(published);
    // A release error does not undo publication. Keep ownership available for rollback.
    record={file:output.commitPath,requestedPath:output.snapshot.requestedPath,identity,mode:candidate.mode,bytes,sha256};committed?.push(record);
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

function inspectStorySvgOutput(snapshot, { expected, includeContent = false } = {}) {
  const { target, slot, requestedPath } = snapshot;
  const captured = captureRegularFileBinding(slot.commitPath, {
    subject: 'story-svg-output',
    expectedIdentity: { device: target.device, inode: target.inode },
    expectedMode: target.mode,
    ...(expected ? { expectedSha256: expected.sha256, expectedBytes: expected.bytes } : {}),
    includeContent,
  });
  if (captured.status !== 'captured') {
    throw new Error(`Could not verify Story SVG output "${requestedPath}" (${captured.reason.code}).`);
  }
  const released = releaseRegularFileBinding(captured.binding);
  if (released.status !== 'released') {
    throw new Error(`Could not release Story SVG output "${requestedPath}" (${released.reason.code}).`);
  }
  return captured.content;
}

// Keep the original slot and any final symlink while updating the file identity.
function withOutputTarget(snapshot, record) {
  const target = record ? { kind: 'file', ...record.identity, mode: record.mode } : { kind: 'absent' };
  const requestedEntry = snapshot.requestedEntry.entryType === 'symbolic-link'
    ? snapshot.requestedEntry
    : record ? { kind: 'existing', entryType: 'file', ...record.identity } : { kind: 'absent' };
  return { ...snapshot, requestedEntry, target };
}

function verifyStorySvgOutput(snapshot, content) {
  if (verifyStoryOutputSlot(snapshot).status !== 'match') {
    throw new Error('Story SVG output changed during publication: ' + snapshot.requestedPath);
  }
  if (content) inspectStorySvgOutput(snapshot, { expected: content });
}

function vacantStorySvgOutput(snapshot) {
  const commitPath = canonicalFuturePath(snapshot.requestedPath);
  // An absent filename can have a different spelling on a case-insensitive filesystem.
  // Match it against the original physical slot before allowing restoration.
  const vacant = {
    ...withOutputTarget(snapshot),
    slot: { ...snapshot.slot, commitPath, name: path.basename(commitPath) },
  };
  verifyStorySvgOutput(vacant);
  if (sameLocation(commitPath, snapshot.slot.commitPath).status !== 'match') {
    throw new Error('Story SVG output changed during restoration: ' + snapshot.requestedPath);
  }
  return vacant;
}

// Both the legacy HTML bridge and the multi-view compiler use this boundary.
export function publishStorySvgOutputs(files, guard, render) {
  if (files.length === 1) return render((file, content) => writeStoryOutput(file, content, () => guard(file)));

  const original = new Map();
  const committed = [];
  let recoveryDirectory;

  const removeBackups = () => {
    for (const { backups } of original.values()) {
      const [backup] = backups;
      if (!backup) continue;
      const result = rollbackStoryOutput(backup);
      const removed = ['removed', 'absent'].includes(result.status);
      if (removed) backups.length = 0;
      if (!removed || result.release) {
        throw new Error('Could not clean recovery copy: ' + backup.file);
      }
    }
    if (recoveryDirectory) fs.rmdirSync(recoveryDirectory);
  };

  const reportRecovery = error => {
    if (!recoveryDirectory) return {};
    const recoveryFiles = [...original.values()].flatMap(({ snapshot, backups }) => backups.map(backup => ({
      backup: backup.file, requestedPath: snapshot.requestedPath, target: snapshot.slot.commitPath,
    })));
    error.message += '\nRecovery directory "' + recoveryDirectory + '".';
    for (const { backup, requestedPath, target } of recoveryFiles) {
      error.message += `\nRecovery copy "${backup}" for "${requestedPath}" (resolved target "${target}").`;
    }
    return { recoveryDirectory, recoveryFiles };
  };

  try {
    for (const [index, file] of files.entries()) {
      guard(file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const captured = captureAtomicOutput(file);
      if (captured.status !== 'captured') throw new Error('Story SVG output cannot be published: ' + file);
      const { mode, snapshot } = captured;
      const content = snapshot.target.kind === 'file' ? inspectStorySvgOutput(snapshot, { includeContent: true }) : null;
      const originalOutput = { snapshot, content, expected: snapshot, published: null, backups: [] };
      original.set(file, originalOutput);
      if (!content) continue;

      // Keep recovery copies independent of a destination directory that may move.
      recoveryDirectory ??= fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-recovery-'));
      const backup = path.join(recoveryDirectory, 'prior-' + index + '.svg');
      writeStoryOutput(backup, content.buffer, undefined, {
        createOnly: true, committed: originalOutput.backups, fallbackMode: mode,
      });
    }

    render((file, content) => {
      const output = original.get(file);
      const published = writeStoryOutput(file, content, () => guard(file), {
        committed, expectedSnapshot: output.snapshot,
        expectedPreviousSha256: output.content?.sha256, expectedPreviousBytes: output.content?.bytes,
      });
      output.expected = withOutputTarget(output.snapshot, published);
      output.published = published;
    });
    for (const file of files) guard(file);
    for (const output of original.values()) {
      verifyStorySvgOutput(output.expected, output.published ?? output.content);
    }
  } catch (error) {
    const cause = error.archifyDiagnostics ?? error.code ?? error.message;
    const failures = [];
    for (const record of committed.reverse()) {
      try {
        const output = original.get(record.requestedPath);
        verifyStorySvgOutput(withOutputTarget(output.snapshot, record));
        const removed = rollbackStoryOutput(record);
        if (removed.status !== 'removed') throw new Error('Output was not removed: ' + record.file);
        const vacant = vacantStorySvgOutput(output.snapshot);
        const restored = output.content && writeStoryOutput(record.requestedPath, output.content.buffer,
          () => guard(record.requestedPath), {
            createOnly: true, fallbackMode: output.snapshot.target.mode, expectedSnapshot: vacant,
          });
        output.expected = restored
          ? withOutputTarget(vacant, { ...restored, mode: output.snapshot.target.mode })
          : vacant;
        if (removed.release) throw new Error('Could not release output during restore: ' + record.file);
      } catch (failure) {
        failures.push(failure.message);
      }
    }
    // A failed write may also have failed to restore that same destination
    // inside the single-file publisher, before it had any commit to record.
    for (const [file, { expected, content }] of original) {
      try {
        verifyStorySvgOutput(expected, content);
      } catch (failure) {
        failures.push(`Previous output could not be verified: ${file} (${failure.message})`);
      }
    }
    if (!failures.length) {
      try { removeBackups(); } catch (failure) { failures.push(failure.message); }
    }
    const validationDiagnostics = error.diagnostics?.length ? error.archifyDiagnostics ?? error.diagnostics : [];
    if (validationDiagnostics.length && !failures.length) throw error;

    const restoration = failures.length ? 'incomplete' : 'complete';
    if (failures.length) error.message += '\nRecovery incomplete.\n' + failures.join('\n');
    const recovery = failures.length ? reportRecovery(error) : {};
    error.archifyDiagnostics = [...validationDiagnostics, {
      code: 'story/svg-publication', severity: 'error', message: error.message, subject: { outputs: files },
      evidence: { cause, restoration, ...recovery },
      supportedFixes: [failures.length
        ? 'Inspect any reported recovery copies before retrying.'
        : 'Check output permissions and retry; previous outputs were restored.'],
    }];
    throw error;
  }

  try { removeBackups(); } catch (error) {
    error.message = 'SVG outputs were published. Recovery cleanup failed: ' + error.message;
    const recovery = reportRecovery(error);
    error.archifyDiagnostics = [{
      code: 'story/svg-recovery-cleanup', severity: 'error', message: error.message, subject: { outputs: files },
      evidence: { publication: 'committed', ...recovery },
      supportedFixes: ['Inspect the published outputs before removing the reported recovery directory.'],
    }];
    throw error;
  }
}
