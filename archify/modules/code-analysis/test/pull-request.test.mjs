import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { parsePullRequest, preparePullRequest, normalizeScope, resolveLocalPullRequest } from '../lib/pull-request.mjs';
import { materializeTree } from '../lib/git-sources.mjs';
import { startAnalysisView, parseArgs } from '../bin/serve.mjs';
import { prepareAnalysisView } from '../bin/prepare.mjs';

const payload = html => JSON.parse(html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
const git = (root,args) => execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-pr-native-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'repo');fs.mkdirSync(root);git(root,['init']);
  const write=(file,text)=>fs.writeFileSync(path.join(root,file),text);
  const commit=()=>{git(root,['add','.']);git(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);return git(root,['rev-parse','HEAD']);};
  write('a.ts',"import { b } from './b'; export function a(x:boolean){return b();}\n");
  write('b.ts',"import { a } from './a'; export function b(){return a(true);}\n");
  write('removed.ts','export const previous=1;\n');
  const base=commit();
  write('a.ts',"import { b } from './b'; export function a(x:boolean){"+'if(x)return b();'.repeat(25)+"return 0;}\n");
  write('b.ts','export function b(){return 1;}\n');
  write('added.ts','export function added(){return 2;}\n');
  fs.unlinkSync(path.join(root,'removed.ts'));
  const sdkManifest = 'node_modules/typescript/package.json';
  fs.mkdirSync(path.dirname(path.join(root, sdkManifest)), { recursive: true });
  write(sdkManifest, JSON.stringify({ name: 'typescript', version: '99.0.0' }));
  git(root, ['add', '-f', sdkManifest]);
  const head=commit();
  const files=[{filename:'a.ts',status:'modified'},{filename:'b.ts',status:'modified'},{filename:'added.ts',status:'added'},{filename:'removed.ts',status:'removed'},{filename:sdkManifest,status:'added'}];
  const meta={number:42,title:'native PR flow',state:'open',changed_files:files.length,base:{sha:base,ref:'main'},head:{sha:head},updated_at:'2026-11-14T05:02:16Z'};
  let fail=false;
  const fetchJSON=async route=>{if(fail)throw Error('simulated capture failure');return route.includes('/files?')?files:route.includes('/compare/')?{merge_base_commit:{sha:base}}:meta;};
  const dependencies={preparePRSources:options=>preparePullRequest(options,{fetchJSON})};
  const args=['--pr','https://github.com/example/project/pull/42','--locale','zh-CN'];
  return {dir,root,base,head,args,dependencies,fail:()=>{fail=true;}};
}

test('PR options reuse native grammar and reject ambiguous sources',()=>{
  assert.equal(parseArgs(['repo','--out','out','--pr','42']).options['--pr'],'42');
  assert.throws(()=>parseArgs(['repo','--out','out','--repository','a/b']),/requires --pr/);
  assert.throws(() => parseArgs(['repo', '--out', 'out', '--base', '123']), /provided together/);
  assert.throws(() => parseArgs(['repo', '--out', 'out', '--base', '123', '--head', '456', '--pr', '42']), /either/);
  assert.deepEqual(parsePullRequest('https://github.com/a/b/pull/42'),{repository:'a/b',number:42,url:'https://github.com/a/b/pull/42'});
  for(const value of ['https://elsewhere.test/a/b/pull/42','https://github.com/a/b/pull/42?token=secret','42; echo test'])assert.throws(()=>parsePullRequest(value));
  for(const scope of ['../outside','/absolute','src/../outside','src\\file','.git/objects'])assert.throws(()=>normalizeScope(scope));
});

test('partial Git capture requests only selected blobs and preserves their exact bytes',async t=>{
  const f=fixture(t),cache=path.join(f.dir,'cache'),target=path.join(f.dir,'captured');
  git(f.root,['config','uploadpack.allowFilter','true']);
  fs.mkdirSync(path.join(f.root,'src'));fs.writeFileSync(path.join(f.root,'src/b with spaces.bin'),Buffer.from([0,1,10,255]));git(f.root,['add','.']);git(f.root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','binary']);
  const sha=git(f.root,['rev-parse','HEAD']);
  git(f.dir,['clone','--bare','--no-local','--filter=blob:none',pathToFileURL(f.root).href,cache]);
  const outside=git(f.root,['rev-parse','HEAD:a.ts']);
  assert.throws(()=>git(cache,['cat-file','-e',outside]));
  await materializeTree({cache,sha,scope:'src',target,blobSource:f.root});
  assert.deepEqual(fs.readFileSync(path.join(target,'b with spaces.bin')),Buffer.from([0,1,10,255]));
  assert.throws(()=>git(cache,['cat-file','-e',outside]),'unrelated blobs remain unfetched');
});

test('offline PR preparation uses native findings, localization, source markers and tasks',async t=>{
  const f=fixture(t),out=path.join(f.dir,'out'),dirtyBefore=git(f.root,['status','--porcelain']);
  const result=await prepareAnalysisView([f.root,'--out',out,...f.args],f.dependencies);
  const data=payload(fs.readFileSync(result.html,'utf8'));
  assert.equal(result.diagram,null);assert.equal(data.ui.locale,'zh-CN');assert.equal(data.ui.mode,'standalone');
  assert.equal(data.pullRequest.baseSHA,f.base);assert.equal(data.pullRequest.headSHA,f.head);
  assert.equal(data.repository.sourceKind,'git-tree');assert.equal(data.repository.revision,f.head);
  assert.equal(data.overview.review.comparison.comparable,true);assert.ok(data.overview.review.comparison.notDetected.length>0);
  for(const id of data.overview.priorities) assert.ok(['new','evidence-changed'].includes(data.findings.find(f=>f.id===id).review.since));
  assert.ok(data.snippets['a.ts'].changes.modified.length>0);
  assert.match(data.pullRequest.beforeSources['b.ts'].lines.join('\n'),/import/);
  assert.ok(data.pullRequest.changes.some(c=>c.path==='removed.ts'&&c.status==='removed'));
  assert.match(result.resume.command,/--pr https:\/\/github.com\/example\/project\/pull\/42/);
  assert.ok(Object.keys(data.tasks).length>0);
  for(const item of Object.values(data.tasks))assert.equal(item.task.source.gitHead,f.head);
  assert.equal(git(f.root,['status','--porcelain']),dirtyBefore);
  assert.equal(git(f.root,['rev-parse','HEAD']),f.head);
});

test('live PR analysis verifies tasks against captured head, retains merge-base on review and preserves good results after failure',async t=>{
  const f=fixture(t),view=await startAnalysisView([f.root,'--out',path.join(f.dir,'out'),...f.args],f.dependencies);
  t.after(()=>{view.server.closeAllConnections();view.server.close();});
  const post=(route,input,refresh=false)=>fetch(view.url+route,{method:'POST',headers:{Origin:view.url,'X-Analysis-Token':view.token,'Content-Type':'application/json',...(refresh?{'X-Analysis-Refresh':'1'}:{})},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await fetch(view.url+'/analyze',{method:'POST'})).status,403);
  const analyzed=await post('/analyze');assert.equal(analyzed.status,200,await analyzed.clone().text());
  const html=await analyzed.text(),data=payload(html),finding=data.findings[0];assert.ok(finding);
  // Mutable local edits must neither replace PR evidence nor invalidate pinned tasks.
  fs.writeFileSync(path.join(f.root,'a.ts'),'not the PR head anymore\n');
  const task=await post('/task',{ids:[finding.id],expected:{[finding.id]:finding.reviewTarget}});
  assert.equal(task.status,200,await task.clone().text());assert.equal((await task.json()).task.evidence.status,'valid');
  const review=await post('/review',{action:'accept',id:finding.id,expected:finding.reviewTarget,reason:'existing PR scope'});
  assert.equal(review.status,200,await review.clone().text());const saved=await review.json();
  assert.equal(payload(saved.html).pullRequest.baseSHA,f.base);assert.equal(payload(saved.html).overview.review.comparison.comparable,true);
  const last=fs.readFileSync(path.join(view.out,'analysis/repo.analysis.html'),'utf8');
  f.fail();const failed=await post('/analyze',null,true);assert.equal(failed.status,500);
  assert.equal(fs.readFileSync(path.join(view.out,'analysis/repo.analysis.html'),'utf8'),last);
});

test('pinned CLI reviews an exact base and head with renamed source and preserves the last complete report', t => {
  const f = fixture(t);
  const source = fs.readFileSync(path.join(f.root, 'b.ts'), 'utf8');
  git(f.root, ['mv', 'b.ts', 'renamed source.ts']);
  fs.writeFileSync(path.join(f.root, 'notes.md'), '# Captured note\n');
  const commit = message => {
    git(f.root, ['add', '.']);
    git(f.root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message]);
    return git(f.root, ['rev-parse', 'HEAD']);
  };
  const head = commit('Rename');
  fs.writeFileSync(path.join(f.root, 'renamed source.ts'), 'uncommitted content\n');
  const out = path.join(f.dir, 'pinned');
  const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
  const invoke = (repo, base, head) => {
    const result = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', repo, '--base', base, '--head', head,
      '--language', 'ts', '--out', out], { encoding: 'utf8', windowsHide: true, timeout: 90000 });
    assert.ifError(result.error);
    return { status: result.status, receipt: JSON.parse(result.stdout) };
  };
  const result = invoke(f.root, f.head, head);
  assert.equal(result.status, 0, JSON.stringify(result.receipt));
  const original = fs.readFileSync(result.receipt.html, 'utf8');
  const { pullRequest: pr, snippets } = payload(original);
  assert.equal(pr.local, true);
  assert.equal(pr.baseSHA, f.head);
  assert.equal(pr.headSHA, head);
  assert.deepEqual(pr.changedFiles.slice().sort((a, b) => a.status.localeCompare(b.status)), [
    { path: 'notes.md', previousPath: null, status: 'added', additions: null, deletions: null },
    { path: 'renamed source.ts', previousPath: 'b.ts', status: 'renamed', additions: null, deletions: null },
  ]);
  assert.deepEqual(snippets['notes.md'].lines, ['# Captured note']);
  assert.equal(pr.beforeSources['b.ts'].lines.join('\n') + '\n', source);
  assert.equal(snippets['renamed source.ts'].lines.join('\n') + '\n', source);
  assert.ok(pr.impact.records.some(record => record.kind === 'dependency-removed' && record.from === 'a.ts' && record.to === 'b.ts'));
  assert.match(pr.markdown, /b\.ts → renamed source\.ts/);
  assert.ok(pr.markdown.includes(f.head) && pr.markdown.includes(head));
  assert.doesNotMatch(pr.markdown, /export function/);
  assert.match(result.receipt.resume.command, new RegExp('--base ' + f.head + ' --head ' + head));
  assert.equal(fs.readFileSync(path.join(f.root, 'renamed source.ts'), 'utf8'), 'uncommitted content\n');

  const missingCommit = invoke(f.root, f.head, 'a'.repeat(40));
  assert.equal(missingCommit.status, 2);
  assert.equal(missingCommit.receipt.diagnostics[0].code, 'pr/local-object-missing');
  assert.equal(missingCommit.receipt.diagnostics[0].subject.side, 'head');

  const partial = path.join(f.dir, 'partial');
  git(f.root, ['config', 'uploadpack.allowFilter', 'true']);
  git(f.dir, ['clone', '--no-checkout', '--no-local', '--filter=blob:none', pathToFileURL(f.root).href, partial]);
  const oid = git(f.root, ['rev-parse', f.head + ':b.ts']);
  assert.throws(() => git(partial, ['cat-file', '-e', oid]), 'precondition: source is promised but missing');
  const missingBlob = invoke(partial, f.head, head);
  assert.equal(missingBlob.status, 2);
  assert.equal(missingBlob.receipt.diagnostics[0].code, 'pr/local-object-missing');
  assert.equal(missingBlob.receipt.diagnostics[0].subject.side, 'base');
  assert.throws(() => git(partial, ['cat-file', '-e', oid]), 'no automatic fetch happened');
  assert.equal(fs.readFileSync(result.receipt.html, 'utf8'), original);
  assert.equal(fs.readdirSync(out).some(name => name.startsWith('analysis.next-')), false);
});


test('pinned reviews reject a scope absent from both trees', async t => {
  const f = fixture(t);
  await assert.rejects(preparePullRequest({ root: f.root, out: path.join(f.dir, 'bad-scope'), scope: 'not-a-directory', local: { base: f.base, head: f.head } }),
    error => error.diagnostics?.some(diagnostic => diagnostic.code === 'pr/scope-invalid' && diagnostic.subject.scope === 'not-a-directory' && diagnostic.supportedFixes.length > 0));
});

test('scoped pinned preflight identifies a missing tree and gives root recovery guidance', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'subdir'));
  await assert.rejects(resolveLocalPullRequest(path.join(f.root, 'subdir'), f.base, f.head, 'missing'),
    error => error.diagnostics?.some(d => d.code === 'pr/scope-invalid' && d.supportedFixes.some(fix => fix.includes('--scope .'))));
  const root = await resolveLocalPullRequest(path.join(f.root, 'subdir'), f.base, f.head, '.');
  assert.equal(root.scope, '.');

  git(f.root, ['config', 'uploadpack.allowFilter', 'true']);
  const partial = path.join(f.dir, 'treeless');
  git(f.dir, ['clone', '--no-checkout', '--no-local', '--filter=tree:0', pathToFileURL(f.root).href, partial]);
  const tree = git(f.root, ['rev-parse', f.base + '^{tree}']);
  assert.throws(() => git(partial, ['cat-file', '-e', tree]), 'precondition: base tree is missing');
  await assert.rejects(resolveLocalPullRequest(partial, f.base, f.head, 'src'),
    error => error.diagnostics?.some(d => d.code === 'pr/local-object-missing' && d.subject.side === 'base' && d.evidence.commit === f.base && d.supportedFixes.length));
  assert.throws(() => git(partial, ['cat-file', '-e', tree]), 'preflight must not fetch the tree');
});

test('scoped local preparation reuses each preflight tree listing', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'src'));
  fs.writeFileSync(path.join(f.root, 'src', 'sample.ts'), 'export const sample = 1;\n');
  git(f.root, ['add', 'src']);
  git(f.root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'scoped']);
  const head = git(f.root, ['rev-parse', 'HEAD']);
  const trace = path.join(f.dir, 'git-trace.log');
  const previous = process.env.GIT_TRACE;
  process.env.GIT_TRACE = trace;
  try {
    const result = await preparePullRequest({ root: f.root, out: path.join(f.dir, 'scoped-out'), scope: 'src', local: { base: head, head } });
    assert.deepEqual(result.manifests.base.files.map(item => item.path), ['sample.ts']);
    assert.equal(fs.readFileSync(path.join(result.roots.head, 'sample.ts'), 'utf8'), 'export const sample = 1;\n');
  } finally {
    if (previous === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = previous;
  }
  const invocations = fs.readFileSync(trace, 'utf8').split('\n').filter(line => /built-in: git ls-tree\b/.test(line));
  assert.equal(invocations.length, 2, 'one preflight listing per pinned side; materialization does not re-scan');
});
