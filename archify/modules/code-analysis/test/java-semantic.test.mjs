import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const command = process.env.ARCHIFY_JAVA || 'java';
const runtime = spawnSync(command, ['-version'], { encoding: 'utf8', timeout: 5000 });
const version = Number((runtime.stderr || runtime.stdout || '').match(/version "?(\d+)/)?.[1] || 0);
const hasJdk = runtime.status === 0 && version >= 17;

function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-java-semantic-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  return root;
}

function capture(root, semantic = true) {
  const config = loadConfig();
  config.java = { semantic, ...(semantic ? { release: 8 } : {}) };
  return extractFacts(root, { language: 'java', config }).facts;
}

test('Java semantic opt-in uses captured JDK bindings for instance, overloaded and abstract interface methods', t => {
  if (!hasJdk) return t.skip('JDK 17+ not installed for optional semantic coverage');
  const root = fixture(t, {
    'Api.java': `interface Action { void fire(); }
class Api { static void choose(String x) {} static void choose(int x) {} void instance() {} }
class Caller { void run(Action action, Api api) { Api.choose("x"); Api.choose(1); api.instance(); action.fire(); } }`,
  });
  const lexical = capture(root, false);
  assert.equal(lexical.callModel, 'java-static-lexical-v5');
  assert.ok(lexical.calls.every(call => !call.target));
  const facts = capture(root);
  assert.equal(facts.callModel, 'java-static-lexical-v6');
  assert.equal(facts.languageScope.semantic.mode, 'complete');
  assert.equal(facts.languageScope.semantic.release, 8);
  assert.equal(facts.languageScope.semantic.newTargets, 4);
  assert.deepEqual(facts.calls.map(call => call.target?.name), ['choose', 'choose', 'instance', 'fire']);
  assert.ok(facts.calls[0].target.column < facts.calls[1].target.column);
  assert.ok(facts.calls.every(call => call.resolution === 'java-compiler-source-method'));
  assert.ok(facts.methodDeclarations.some(declaration => declaration.name === 'fire'));
  assert.ok(!facts.functions.some(fn => fn.name === 'fire'));
  const question = buildQuestion({ root, entry: 'Api.java', facts, question: 'Where is fire declared?' });
  const abstractCall = question.calls.records.find(record => record.fact.target?.name === 'fire');
  assert.equal(abstractCall.targetNavigation.status, 'valid');
  assert.equal(abstractCall.targetNavigation.location.line, 1);
  const corrupted = structuredClone(facts);
  corrupted.methodDeclarations[0].sourceRange.sha256 = '0'.repeat(64);
  assert.ok(schemaErrors('raw-facts', corrupted).some(error => error.path === '/methodDeclarations/0/sourceRange'));
});

test('Java semantic opt-in requires the direct Maven route and preserves POM freshness', t => {
  if (!hasJdk) return t.skip('JDK 17+ not installed for optional semantic coverage');
  const root = fixture(t, {
    'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>probe</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging><modules><module>api</module><module>app</module></modules></project>',
    'api/pom.xml': '<project><modelVersion>4.0.0</modelVersion><parent><groupId>probe</groupId><artifactId>parent</artifactId><version>1</version></parent><artifactId>api</artifactId></project>',
    'app/pom.xml': '<project><modelVersion>4.0.0</modelVersion><parent><groupId>probe</groupId><artifactId>parent</artifactId><version>1</version></parent><artifactId>app</artifactId><dependencies><dependency><groupId>probe</groupId><artifactId>api</artifactId><version>1</version></dependency></dependencies></project>',
    'api/src/main/java/probe/api/Api.java': 'package probe.api; public class Api { public static void stat() {} public void instance() {} }',
    'app/src/main/java/probe/app/App.java': 'package probe.app; import probe.api.Api; public class App { void run() { Api.stat(); new Api().instance(); } }',
  });
  const facts = capture(root);
  assert.equal(facts.languageScope.semantic.mode, 'complete');
  assert.deepEqual(facts.calls.map(call => call.target?.name), ['stat', 'instance']);
  assert.ok(facts.calls.every(call => call.buildEvidence?.some(point => point.file === 'app/pom.xml')));
  const args = { root, entry: 'app/src/main/java/probe/app/App.java', facts, question: 'Where are the API calls?' };
  assert.ok(buildQuestion(args).calls.records.every(record => record.targetNavigation.status === 'valid'));
  const pom = path.join(root, 'app/pom.xml');
  fs.appendFileSync(pom, '<!-- changed -->');
  assert.ok(buildQuestion(args).calls.records.every(record => record.targetNavigation.status !== 'valid'));
  fs.writeFileSync(pom, fs.readFileSync(pom, 'utf8').replace(/<dependencies>.*<\/dependencies>/, ''));
  const absent = capture(root);
  assert.equal(absent.languageScope.semantic.rejectedTargets, 1);
  assert.ok(absent.calls.every(call => !call.target));
  assert.equal(absent.calls[0].reason, 'java-compiler-build-scope');
});

test('Java semantic opt-in falls back to JS facts when the local JDK is unavailable', t => {
  const root = fixture(t, { 'A.java': 'class A { static void yes() {} void run() { yes(); missing(); } }' });
  const original = process.env.ARCHIFY_JAVA;
  process.env.ARCHIFY_JAVA = path.join(root, 'not-a-jdk');
  try {
    const facts = capture(root);
    assert.equal(facts.callModel, 'java-static-lexical-v6');
    assert.equal(facts.languageScope.semantic.mode, 'unavailable');
    assert.deepEqual(facts.calls.map(call => call.target?.name || null), ['yes', null]);
  } finally {
    if (original === undefined) delete process.env.ARCHIFY_JAVA;
    else process.env.ARCHIFY_JAVA = original;
  }
  const invalid = loadConfig();
  invalid.java = { release: 8 };
  assert.throws(() => extractFacts(root, { language: 'java', config: invalid }), error => error.diagnostics?.[0]?.code === 'extract/java-config-invalid');
});
