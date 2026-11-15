import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseExplainerDiff} from '../archify/explainer/diff.mjs';
import {parseExplainer} from '../archify/explainer/parse.mjs';
import {validateExplainer} from '../archify/explainer/validate.mjs';

const reconstruction=result=>result.rows.map(row=>row.raw+row.ending).join('');

test('real git unified diff preserves bytes, real line numbers, file changes and git numstat counts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-diff-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'});
  try {
    git('init','--quiet');
    fs.writeFileSync(path.join(dir,'sample.txt'),'first\nold\nlast\n');
    fs.writeFileSync(path.join(dir,'no-newline.txt'),'old');
    fs.writeFileSync(path.join(dir,'removed.txt'),'gone\n');
    git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture');
    fs.writeFileSync(path.join(dir,'sample.txt'),'first\nnew\nlast\nextra\n');
    fs.writeFileSync(path.join(dir,'no-newline.txt'),'new');
    fs.unlinkSync(path.join(dir,'removed.txt'));
    fs.writeFileSync(path.join(dir,'added.txt'),'fresh\n');git('add','-N','added.txt');
    const literal=git('diff','--no-ext-diff','--no-color','--no-renames','--unified=2');
    const result=parseExplainerDiff(literal);
    assert.deepEqual(result.diagnostics,[]);assert.equal(reconstruction(result),literal);assert.equal(result.format,'unified');
    const numstat=git('diff','--numstat').trim().split('\n').map(line=>line.split('\t').slice(0,2).map(Number));
    assert.equal(result.counts.added,numstat.reduce((sum,row)=>sum+row[0],0));assert.equal(result.counts.removed,numstat.reduce((sum,row)=>sum+row[1],0));
    assert.equal(result.counts.files,4);assert.equal(result.rows.filter(row=>row.kind==='no-newline').length,2);
    const sample=result.rows.filter(row=>row.filePath==='sample.txt');
    const removed=sample.find(row=>row.kind==='removed');assert.equal(removed.text,'old');assert.equal(removed.oldLine,2);assert.equal(removed.newLine,null);
    const added=sample.filter(row=>row.kind==='added');assert.deepEqual(added.map(row=>[row.text,row.oldLine,row.newLine]),[['new',null,2],['extra',null,4]]);
    assert.equal(result.rows.find(row=>row.filePath==='added.txt'&&row.kind==='added').newLine,1);
    assert.equal(result.rows.find(row=>row.filePath==='removed.txt'&&row.kind==='removed').oldLine,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('simple diff fragments retain CRLF and never invent old or new line numbers',()=>{
  const literal=' context\r\n-old\r\n+new';const result=parseExplainerDiff(literal,{line:20});assert.deepEqual(result.diagnostics,[]);assert.equal(reconstruction(result),literal);assert.equal(result.format,'fragment');assert.deepEqual(result.counts,{added:1,removed:1,context:1,hunks:0,files:0});
  assert.ok(result.rows.every(row=>row.oldLine===null&&row.newLine===null));assert.deepEqual(result.rows.map(row=>row.sourceLine),[20,21,22]);
});

test('hunk ranges support zero-count insertions and deletions plus implicit count one',()=>{
  for(const [literal,expected]of [
    ['@@ -0,0 +1,2 @@\n+first\n+second\n',[[null,1],[null,2]]],
    ['@@ -1,2 +0,0 @@\n-first\n-second\n',[[1,null],[2,null]]],
    ['@@ -12 +14 @@ function\n-old\n+new\n',[[12,null],[null,14]]],
  ]) {const result=parseExplainerDiff(literal);assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.rows.filter(row=>['added','removed'].includes(row.kind)).map(row=>[row.oldLine,row.newLine]),expected);}
});

test('hunk size mismatches, illegal rows and ranges produce actionable original-line diagnostics',()=>{
  const cases=[
    ['@@ -1,2 +1,2 @@\n-old\n+new','hunk-count',30],
    ['@@ -1 +1 @@\n unchanged\n+extra','hunk-count',30],
    ['@@ -0 +1 @@\n-old\n+new','hunk-range',30],
    ['@@ -9007199254740992 +1 @@\n-old\n+new','hunk-range',30],
    ['@@ -1 +1@@\n-old\n+new','hunk-header',30],
    ['@@ -1 +1 @@\nold\n+new','row',31],
    ['\\ No newline at end of file','newline-marker',30],
    ['-old\n\\ No newline at end of file\n\\ No newline at end of file','newline-marker',32],
    ['+++ b/file.txt\n+new','header-order',30],
    ['diff --git a/f b/f\nindex invalid','header',31],
  ];
  for(const [literal,code,line]of cases) {
    const result=parseExplainerDiff(literal,{line:30,input:'change.md',panelId:'review',path:'/panels/0/blocks/0/text'});const issue=result.diagnostics.find(issue=>issue.code===`explainer/diff-${code}`);assert.ok(issue,literal);assert.equal(issue.subject.line,line,literal);assert.equal(issue.subject.component,'diff');assert.equal(issue.subject.input,'change.md');assert.ok(issue.evidence.reason);assert.ok(issue.evidence.example);assert.ok(issue.supportedFixes.length);assert.equal(reconstruction(result),literal,'even rejected syntax is not silently rewritten');
  }
});

test('binary and combined diffs are rejected explicitly instead of being interpreted as text changes',()=>{
  for(const [literal,code]of [['diff --cc file\n@@@ -1,1 -1,1 +1,1 @@@','combined'],['diff --git a/picture.png b/picture.png\nBinary files a/picture.png and b/picture.png differ','binary'],['GIT binary patch\nliteral 4\nAAAA','binary']]) {
    const result=parseExplainerDiff(literal);assert.ok(result.diagnostics.some(issue=>issue.code===`explainer/diff-${code}`));assert.equal(reconstruction(result),literal);
  }
});

test('git mode and rename-only metadata stay valid without invented content line numbers',()=>{
  const literal='diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\ndiff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n';const result=parseExplainerDiff(literal);assert.deepEqual(result.diagnostics,[]);assert.equal(result.counts.files,2);assert.equal(result.counts.hunks,0);assert.ok(result.rows.every(row=>row.oldLine===null&&row.newLine===null));assert.equal(reconstruction(result),literal);
});

test('diff validation uses the shared secret scanner without leaking rejected values',()=>{
  const credential='example-private-credential';
  for(const literal of [
    `+const api_key = "${credential}";`,
    '+-----BEGIN PRIVATE KEY-----',
    `diff --git a/config.yaml b/config.yaml\n--- a/config.yaml\n+++ b/config.yaml\n@@ -0,0 +1 @@\n+api_key: ${credential}`,
  ]) {const result=parseExplainerDiff(literal,{line:10});const issue=result.diagnostics.find(issue=>issue.code==='explainer/diff-secret');assert.ok(issue);assert.ok(!JSON.stringify(result.diagnostics).includes(credential));assert.ok(!JSON.stringify(result.diagnostics).includes('BEGIN PRIVATE'));}
  assert.deepEqual(parseExplainerDiff('-const timeout = 100;\n+const timeout = 200;').diagnostics,[]);
});

test('fenced diff source locations use actual content lines and preserve internal CRLF',()=>{
  const source='# Review\r\n\r\nApply the stated change.\r\n\r\n## What changed? {#review}\r\n\r\n@diff id=change\r\n```diff\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n```\r\n';
  const parsed=parseExplainer(source,{inputPath:'review.md'});assert.ok(parsed.document,JSON.stringify(parsed.diagnostics));const block=parsed.document.panels[0].blocks[0];assert.equal(block.text,'@@ -1 +1 @@\r\n-old\r\n+new');assert.equal(parsed.sourceMap['/panels/0/blocks/0/text'].line,9);assert.equal(validateExplainer(parsed.document,{sourceMap:parsed.sourceMap}).ok,true);
  const broken=parseExplainer(source.replace('-old\r\n','old\r\n'),{inputPath:'review.md'});const validated=validateExplainer(broken.document,{sourceMap:broken.sourceMap,inputPath:'review.md'});assert.equal(validated.ok,false);assert.equal(validated.diagnostics.find(issue=>issue.code==='explainer/diff-row').subject.line,10);assert.equal(validated.diagnostics.find(issue=>issue.code==='explainer/diff-row').subject.component,'diff');
});

test('hunk content resembling file headers is counted as literal removed and added data',()=>{
  const literal='--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n--- old value\n+++ new value\n';const result=parseExplainerDiff(literal);assert.deepEqual(result.diagnostics,[]);assert.deepEqual(result.rows.filter(row=>row.kind==='removed'||row.kind==='added').map(row=>[row.kind,row.text,row.oldLine,row.newLine]),[['removed','-- old value',1,null],['added','++ new value',null,1]]);assert.equal(reconstruction(result),literal);
});

test('a renamed file retains the old credential syntax for removed lines',()=>{
  const literal='diff --git a/config.yaml b/notes.txt\n--- a/config.yaml\n+++ b/notes.txt\n@@ -1 +1 @@\n-api_key: example-private-credential\n+Public notes';
  const result=parseExplainerDiff(literal);assert.equal(result.rows.find(row=>row.kind==='removed').filePath,'config.yaml');assert.equal(result.rows.find(row=>row.kind==='added').filePath,'notes.txt');assert.ok(result.diagnostics.some(issue=>issue.code==='explainer/diff-secret'));assert.ok(!JSON.stringify(result.diagnostics).includes('example-private-credential'));
});
