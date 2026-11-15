import { containsExplainerSecret } from './sources.mjs';

const EXAMPLE = '@@ -1,2 +1,2 @@\n unchanged\n-old value\n+new value';

function sourceLines(text) {
  const result=[];
  for (const match of text.matchAll(/([^\n]*)(\n|$)/gu)) {
    if (!match[0]) continue;
    const crlf=match[2] && match[1].endsWith('\r');
    result.push({raw:crlf?match[1].slice(0,-1):match[1],ending:crlf?'\r\n':match[2]});
  }
  return result;
}

function fileName(value) {
  let name=value.split('\t')[0];
  if (name.startsWith('"') && name.endsWith('"')) {
    try { name=JSON.parse(name); } catch { name=name.slice(1,-1); }
  }
  if (name==='/dev/null') return null;
  return name.replace(/^[ab]\//u,'');
}

/** Parse unified diff without rewriting its literal bytes. Fragment line numbers stay null.
 * File paths identify credential syntax only; this parser performs no filesystem reads.
 */
export function parseExplainerDiff(text, {line=1,component='diff',input,panelId,path} = {}) {
  if (typeof text!=='string') throw new TypeError('Diff input must be a string');
  const rows=[],diagnostics=[],counts={added:0,removed:0,context:0,hunks:0,files:0};
  let hunk=null,oldPath=null,newPath=null,fileIndex=-1,oldHeader=false,newHeader=false,oldHeaderLine=line,lastBody=null,markerFor=null;
  let format='fragment';
  const groups=new Map();
  function fail(code,sourceLine,reason,example=EXAMPLE) {
    diagnostics.push({code:`explainer/diff-${code}`,severity:'error',message:reason,
      subject:{line:sourceLine,column:1,component,...(input?{input}:{}),...(panelId?{panelId}:{}),...(path?{path}:{})},
      evidence:{reason,example},supportedFixes:[`Use a valid unified diff, for example:\n${example}`]});
  }
  function finishHunk() {
    if (!hunk) return;
    if (hunk.usedOld!==hunk.oldCount || hunk.usedNew!==hunk.newCount) fail('hunk-count',hunk.sourceLine,
      `Hunk declares ${hunk.oldCount} old and ${hunk.newCount} new lines, but contains ${hunk.usedOld} old and ${hunk.usedNew} new lines.`);
    hunk=null;
  }
  function startFile() {
    if(oldHeader&&!newHeader)fail('header-order',oldHeaderLine,'An old-file header needs its matching new-file header.','--- a/file.txt\n+++ b/file.txt\n'+EXAMPLE);
    finishHunk();fileIndex++;counts.files++;oldPath=null;newPath=null;oldHeader=false;newHeader=false;lastBody=null;markerFor=null;format='unified';
  }
  function row(kind,value,index,extra={}) {
    const entry={kind,raw:value.raw,text:value.raw,ending:value.ending,sourceLine:line+index,oldLine:null,newLine:null,...extra};
    const knownPath=kind==='removed' ? oldPath||newPath : newPath||oldPath;
    if (knownPath) entry.filePath=knownPath;
    if (kind==='header'||kind==='hunk') {lastBody=null;markerFor=null;}
    rows.push(entry);return entry;
  }
  const values=sourceLines(text);
  for (const [index,value] of values.entries()) {
    const raw=value.raw,sourceLine=line+index;
    if (/^(?:diff --(?:cc|combined)\b|@@@)/u.test(raw)) {finishHunk();fail('combined',sourceLine,'Combined merge diffs are unsupported. Provide a two-way unified diff.');row('header',value,index);continue;}
    if (/^(?:GIT binary patch|Binary files .+ differ|literal \d+$|delta \d+$)/u.test(raw)) {finishHunk();fail('binary',sourceLine,'Binary patches are unsupported. Describe the binary change separately.');row('header',value,index);continue;}
    if (raw.startsWith('diff --git ')) {
      if(!/^diff --git .+ .+$/u.test(raw))fail('header',sourceLine,'A git diff header must identify old and new paths.','diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n'+EXAMPLE);
      startFile();row('header',value,index);continue;
    }
    if (raw.startsWith('@@')) {
      finishHunk();format='unified';
      const match=raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:[ \t].*)?$/u);
      if (!match) {fail('hunk-header',sourceLine,'A hunk header requires old and new start/count ranges.');row('hunk',value,index);continue;}
      const [oldStart,oldCount,newStart,newCount]=[match[1],match[2]??'1',match[3],match[4]??'1'].map(Number);
      const valid=[oldStart,oldCount,newStart,newCount].every(Number.isSafeInteger)
        && Number.isSafeInteger(oldStart+oldCount)&&Number.isSafeInteger(newStart+newCount)
        && (oldCount===0||oldStart>=1)&&(newCount===0||newStart>=1);
      if(!valid){fail('hunk-range',sourceLine,'Hunk ranges must use safe nonnegative integers; a nonempty range starts at line 1 or later.');row('hunk',value,index);continue;}
      counts.hunks++;hunk={oldStart,oldCount,newStart,newCount,usedOld:0,usedNew:0,sourceLine};lastBody=null;markerFor=null;
      row('hunk',value,index,{oldStart,oldCount,newStart,newCount});continue;
    }
    // Once the declared hunk is complete, a file header belongs to the next file.
    // Within an unfinished hunk, +++/--- remain ordinary additions/removals.
    const within=hunk&&(hunk.usedOld<hunk.oldCount||hunk.usedNew<hunk.newCount);
    if(!within && /^--- /u.test(raw)) {
      finishHunk();if(oldHeader&&newHeader)startFile();else if(fileIndex<0)startFile();
      oldPath=fileName(raw.slice(4));oldHeader=true;oldHeaderLine=sourceLine;newHeader=false;row('header',value,index);continue;
    }
    if(!within && /^\+\+\+ /u.test(raw)) {
      finishHunk();format='unified';if(!oldHeader)fail('header-order',sourceLine,'A new-file header needs its preceding old-file header.','--- a/file.txt\n+++ b/file.txt\n'+EXAMPLE);
      newPath=fileName(raw.slice(4));newHeader=true;row('header',value,index);continue;
    }
    if (/^(?:index |(?:new file|deleted file|old|new) mode |(?:similarity|dissimilarity) index |(?:rename|copy) (?:from|to) )/u.test(raw)) {
      finishHunk();format='unified';
      const valid=/^index [a-fA-F0-9]{1,64}\.\.[a-fA-F0-9]{1,64}(?: [0-7]{6})?$/u.test(raw)
        ||/^(?:new file|deleted file|old|new) mode [0-7]{6}$/u.test(raw)
        ||/^(?:rename|copy) (?:from|to) .+$/u.test(raw)
        ||(/^(?:similarity|dissimilarity) index (\d+)%$/u.test(raw)&&Number(raw.match(/(\d+)%$/u)[1])<=100);
      if(!valid)fail('header',sourceLine,'This git metadata header is malformed.','diff --git a/file.txt b/file.txt\nindex 1234567..abcdef0 100644\n--- a/file.txt\n+++ b/file.txt\n'+EXAMPLE);
      row('header',value,index);lastBody=null;markerFor=null;continue;
    }
    if(raw==='\\ No newline at end of file') {
      if(!lastBody||markerFor===lastBody)fail('newline-marker',sourceLine,'A no-newline marker must immediately follow one content row and cannot repeat for that row.','@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file');
      row('no-newline',value,index,{...(lastBody?{forLine:lastBody.sourceLine}:{})});markerFor=lastBody;continue;
    }
    const kind=raw.startsWith('+')?'added':raw.startsWith('-')?'removed':raw.startsWith(' ')?'context':null;
    if(!kind) {fail('row',sourceLine,'Diff content rows must start with a space, + or -.');row('header',value,index);lastBody=null;markerFor=null;continue;}
    const entry=row(kind,value,index,{text:raw.slice(1)});counts[kind]++;
    if(hunk) {
      if(kind!=='added')entry.oldLine=hunk.oldStart+hunk.usedOld++;
      if(kind!=='removed')entry.newLine=hunk.newStart+hunk.usedNew++;
    }
    lastBody=entry;markerFor=null;
    if(!groups.has(fileIndex))groups.set(fileIndex,[]);groups.get(fileIndex).push(entry);
  }
  finishHunk();
  if(oldHeader&&!newHeader)fail('header-order',rows.at(-1)?.sourceLine||line,'An old-file header needs its matching new-file header.','--- a/file.txt\n+++ b/file.txt\n'+EXAMPLE);
  if(!rows.length)fail('empty',line,'A diff must contain content or a standard git metadata change.');
  // Scan the whole authored content and pinpoint a matching row when possible.
  // The shared scanner owns credential rules; diagnostics never quote rejected bytes.
  for(const group of groups.values()) {
    const knownPaths=[...new Set(group.map(entry=>entry.filePath).filter(Boolean))];
    const combined=group.map(entry=>entry.text).join('\n');
    if((knownPaths.length?knownPaths:[undefined]).some(knownPath=>containsExplainerSecret(combined,knownPath))) {
      const matched=group.find(entry=>containsExplainerSecret(entry.text,entry.filePath));
      fail('secret',matched?.sourceLine||group[0].sourceLine,'The diff contains a credential or sensitive secret value. Remove or redact it before rendering.','-const timeout = 100;\n+const timeout = 200;');
    }
  }
  return {rows,counts,diagnostics,format};
}
