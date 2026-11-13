import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { extractFacts, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { analyzeGo } from '../extract/go/worker.mjs';

function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-loading-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ 'go.mod': 'module example.org/app\ngo 1.18\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const capture = (root, extra = {}) => extractFacts(root, { language: 'go', config: mergeConfig(loadConfig(), extra) }).facts;

test('Go official loading respects captured boundaries and records versioned tool evidence', t => {
  const root = fixture(t, {
    'go.mod': 'module (\n "example.org/\\x61pp"\n)\n\ngo 1.18\nreplace other.org/dependency => ../uncaptured\n',
    'lib/work.go': 'package lib\nfunc Work(){}\n',
    'entry.go': 'package app\nimport "example.org/app/lib"\nfunc Entry(){lib.Work(); Hidden()}\n',
    'hidden.go': 'package app\nfunc Hidden(){}\n',
  });
  const before = fs.readFileSync(path.join(root, 'go.mod'), 'utf8');
  const facts = capture(root, { exclude: ['hidden.go'], go: { stdlib: false } });
  assert.equal(facts.repository.adapter, 'go-packages@0.52.0');
  assert.equal(facts.callModel, 'go-source-direct-v6');
  assert.equal(facts.languageScope.module, 'example.org/app');
  assert.equal(facts.languageScope.loader.mode, 'captured-go-types');
  assert.equal(facts.languageScope.loader.projectCodeExecuted, false);
  assert.ok(facts.languageScope.loader.toolModules.every(m => m.sum.startsWith('h1:')));
  assert.equal(facts.languageScope.loader.projectToolchain, facts.languageScope.build.toolchain);
  assert.equal(facts.calls[0].target.file, 'lib/work.go');
  assert.equal(facts.calls[1].resolution, 'unresolved');
  assert.equal(fs.readFileSync(path.join(root, 'go.mod'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'go.sum')), false);
  assert.ok(!facts.files.some(file => file.path === 'hidden.go'));
  const missing = structuredClone(facts); delete missing.languageScope.loader;
  assert.ok(schemaErrors('raw-facts', missing).some(e => e.message.includes('loader scope')));
  const wrongMode = structuredClone(facts); wrongMode.languageScope.loader.mode = 'go-packages';
  assert.ok(schemaErrors('raw-facts', wrongMode).some(e => e.message.includes('SDK type scope')));
  const noSDK = structuredClone(facts); delete noSDK.languageScope.loader.projectToolchain;
  assert.ok(schemaErrors('raw-facts', noSDK).some(e => e.message.includes('separate project SDK')));
  noSDK.repository.adapterRevision = 8;
  assert.deepEqual(schemaErrors('raw-facts', noSDK), [], 'existing v6 captures remain readable');
  const wrongSDK = structuredClone(facts); wrongSDK.languageScope.loader.projectToolchain = 'go1.25.9';
  wrongSDK.languageScope.build.toolchain = 'go1.26.2';
  assert.ok(schemaErrors('raw-facts', wrongSDK).some(e => e.message.includes('project SDK must match')));
  for (const version of [4, 5]) {
    const historical = structuredClone(facts);
    delete historical.languageScope.loader;
    historical.languageScope.standardLibrary.projectCommands = false;
    historical.repository.adapter = version === 4 ? 'go-parser@1.26.2' : 'gopls@0.21.1';
    historical.callModel = `go-source-direct-v${version}`;
    if (version === 5) historical.languageScope.gopls = { version: 'v0.21.1', toolchain: 'go1.26.2', queries: { requested: 2, failed: 0, errors: [] }, scope: 'captured-root-module', languageVersion: '1.18', dependencies: 'not-loaded', network: 'disabled', projectCodeExecuted: false };
    assert.deepEqual(schemaErrors('raw-facts', historical), []);
    const result = buildQuestion({ root, facts: historical, entry: 'entry.go', symbol: 'Entry', question: 'Read saved capture' });
    assert.equal(result.calls.coverage, 'available');
    assert.equal(result.calls.records[0].targetNavigation.status, 'valid');
  }
});

test('Go both loading modes enforce declared and implicit module language versions', t => {
  const root = fixture(t, { 'go.mod': 'module example.org/app\ngo 1.17\n', 'entry.go': 'package app\nfunc Work[T any](x T) T { return x }\n' });
  for (const stdlib of [true, false]) {
    const facts = capture(root, { go: { stdlib } });
    assert.equal(facts.functions[0].name, 'Work');
    assert.equal(facts.languageScope.loader.languageVersion, '1.17');
    assert.ok(facts.languageScope.typing.errors.some(error => /go1\.18/.test(error)));
  }
  fs.writeFileSync(path.join(root, 'go.mod'), 'module example.org/app\n');
  const implicit = capture(root, { go: { stdlib: false } });
  assert.equal(implicit.languageScope.loader.languageVersion, '1.16');
  assert.ok(implicit.languageScope.typing.errorCount > 0);
});

test('Go mixed package names keep inventory but cannot manufacture reliable bindings', t => {
  const root = fixture(t, { 'a.go': 'package a\nfunc Work(){}\n', 'b.go': 'package b\nfunc Entry(){ Work() }\n' });
  for (const stdlib of [true, false]) {
    const facts = capture(root, { go: { stdlib } });
    assert.equal(facts.functions.length, 2);
    assert.equal(facts.calls[0].resolution, 'unresolved');
    assert.ok(facts.languageScope.typing.errorCount > 0);
  }
});

test('Go test variants preserve concrete receiver identity across imported packages', t => {
  const root = fixture(t, {
    'lib/work.go': 'package lib\ntype S struct{}\nfunc (S) Work(){}\n',
    'lib/internal_test.go': 'package lib\nimport "testing"\nfunc TestLocal(t *testing.T){S{}.Work()}\n',
    'dep/use.go': 'package dep\nimport "example.org/app/lib"\nfunc Entry(){lib.S{}.Work()}\n',
    'lib/external_test.go': 'package lib_test\nimport ("testing"; "example.org/app/lib"; "example.org/app/dep")\nfunc TestForeign(t *testing.T){dep.Entry();lib.S{}.Work()}\n',
  });
  const facts = capture(root);
  assert.equal(facts.calls.length, 4);
  assert.ok(facts.calls.every(c => c.target));
  assert.equal(facts.calls.filter(c => c.target.name === 'Work').length, 3);
  assert.equal(facts.languageScope.typing.errorCount, 0);
  assert.deepEqual(facts.languageScope.typing.externalPackagesNotLoaded, []);
});

test('Go source module names do not classify SDK exports or generated test runners', t => {
  for (const module of ['app', 'example.org/app.test']) {
    const root = fixture(t, { 'go.mod': `module ${module}\ngo 1.18\n`, 'entry.go': 'package app\nfunc Work(){}\nfunc Entry(){Work()}\n' });
    const facts = capture(root);
    assert.equal(facts.calls[0].target.name, 'Work');
    assert.ok(!facts.languageScope.standardLibrary.packages.some(p => p.path === module));
  }
});

test('Go unavailable offline helper dependencies fail visibly before analyzing the project', t => {
  const root = fixture(t, { 'entry.go': 'package app\nfunc Work(){}\n' });
  const cache = path.join(root, 'empty-modcache'); fs.mkdirSync(cache);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/check.mjs', import.meta.url)), root, '--language', 'go', '--json'], {
    encoding: 'utf8', env: { ...process.env, GOMODCACHE: cache, GOPROXY: 'off', GOSUMDB: 'off' }, timeout: 30000,
  });
  assert.equal(result.status, 2);
  const diagnostic = JSON.parse(result.stdout).diagnostics[0];
  assert.equal(diagnostic.code, 'extract/go-failed');
  assert.equal(diagnostic.evidence.phase, 'helper-build');
  assert.ok(diagnostic.supportedFixes.some(fix => fix.includes('module cache')));
  assert.equal(fs.existsSync(path.join(root, 'go.sum')), false);
});

test('Go worker rejects old SDKs and bounds stalled descendants, crashes and invalid output', async t => {
  const root = fixture(t);
  // A tiny native fake tool exercises the same process-group behavior on Unix
  // and Windows, without a shell-specific executable wrapper.
  const source = `package main
import("encoding/json";"fmt";"io";"os";"os/exec";"runtime";"time")
func main(){
 if len(os.Args)>1 && os.Args[1]=="env"{v:=runtime.Version();if os.Getenv("ARCHIFY_TEST_OLD_GO")=="1"{v="go1.24.9"};json.NewEncoder(os.Stdout).Encode(map[string]string{"GOROOT":runtime.GOROOT(),"GOVERSION":v});return}
 if len(os.Args)>1 && os.Args[1]=="list"{fmt.Print(runtime.GOOS+"|"+runtime.GOARCH+"|go1.1|");return}
 if len(os.Args)>1 && os.Args[1]=="build"{for i,a:=range os.Args{if a=="-o"{p,_:=os.Executable();b,_:=os.ReadFile(p);os.WriteFile(os.Args[i+1],b,0755);return}}}
 if len(os.Args)>1 && os.Args[1]=="child"{for{time.Sleep(time.Second)}}
 b,_:=io.ReadAll(os.Stdin);r:=map[string]interface{}{};json.Unmarshal(b,&r)
 mode:=r["probeMode"].(string);marker:=r["marker"].(string)
 evidence:=map[string]interface{}{"root":r["root"],"parent":os.Getpid()}
 if mode=="hang"{p,_:=os.Executable();c:=exec.Command(p,"child");c.Stdout=os.Stdout;c.Stderr=os.Stderr;c.Start();evidence["child"]=c.Process.Pid}
 b,_=json.Marshal(evidence);os.WriteFile(marker,b,0644)
 if mode=="crash"{os.Exit(9)};if mode=="invalid"{fmt.Print("invalid JSON");return};for{time.Sleep(time.Second)}
}`;
  const file = path.join(root, 'tool.go'); fs.writeFileSync(file, source);
  const command = path.join(root, process.platform === 'win32' ? 'tool.exe' : 'tool');
  const built = spawnSync(process.env.ARCHIFY_GO || 'go', ['build', '-o', command, file], { encoding: 'utf8', env: { ...process.env, GO111MODULE: 'off', GOOS: '', GOARCH: '', GOFLAGS: '', GOTOOLCHAIN: 'local' } });
  assert.equal(built.status, 0, built.stderr);
  const old = process.env.ARCHIFY_TEST_OLD_GO;
  process.env.ARCHIFY_TEST_OLD_GO = '1';
  try {
    await assert.rejects(analyzeGo({ moduleText: 'module example.org/app\ngo 1.18\n' }, { command }), error => error.code === 'go-unavailable' && error.evidence.version === 'go1.24.9');
  } finally {
    if (old === undefined) delete process.env.ARCHIFY_TEST_OLD_GO; else process.env.ARCHIFY_TEST_OLD_GO = old;
  }
  await assert.rejects(analyzeGo({ moduleText: 'module example.org/app\ngo 1.18\n' }, { command, buildCommand: path.join(root, 'missing-builder') }), error => error.code === 'go-unavailable' && error.evidence.phase === 'helper-build');
  for (const [mode, code] of [['hang', 'go-timeout'], ['crash', 'go-failed'], ['invalid', 'go-output-invalid']]) {
    const marker = path.join(root, `${mode}.json`), started = Date.now();
    await assert.rejects(analyzeGo({ moduleText: 'module example.org/app\ngo 1.18\n', probeMode: mode, marker }, { command, buildCommand: command, timeoutMs: mode === 'hang' ? 1500 : 10000 }), { code });
    assert.ok(Date.now() - started < 15000);
    const evidence = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(fs.existsSync(evidence.root), false);
    for (const pid of [evidence.parent, evidence.child].filter(Boolean)) {
      // An orphan already in Z state has exited; some Linux container init
      // processes delay reaping it even though it cannot execute or hold files.
      let exited = false;
      for (let attempt = 0; attempt < 40 && !exited; attempt++) {
        try { process.kill(pid, 0); } catch (cause) { if (cause.code === 'ESRCH') exited = true; else throw cause; }
        if (!exited && process.platform !== 'win32') exited = /^Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
        if (!exited) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(exited, `descendant ${pid} must exit`);
    }
  }
});
