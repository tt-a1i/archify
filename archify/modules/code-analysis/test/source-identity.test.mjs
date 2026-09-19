import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { extractFacts, buildGraph, evaluateGraph, overlayHtml } from '../lib/analysis.mjs';

for (const language of ['ts', 'py']) {
  test(`${language}: dirty and untracked sources retain truthful identity and captured snippets`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-identity-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    git('remote', 'add', 'origin', 'https://github.com/example/fixture.git');
    const ext = language === 'ts' ? 'mjs' : 'py';
    const a = `a.${ext}`, b = `b.${ext}`, added = `new.${ext}`;
    fs.writeFileSync(path.join(root, a), language === 'ts' ? "import './b.mjs';\n" : 'import b\n');
    fs.writeFileSync(path.join(root, b), '');
    git('add', '.'); git('commit', '-qm', 'Fixture');
    const head = git('rev-parse', 'HEAD');
    const clean = extractFacts(root, { language });
    assert.equal(clean.facts.repository.sourceKind, 'working-tree');
    const source = language === 'ts' ? "import './new.mjs';\n" : 'import new\n';
    fs.writeFileSync(path.join(root, a), source);
    fs.writeFileSync(path.join(root, added), language === 'ts' ? "import './a.mjs';\n" : 'import a\n');
    const { facts, config } = extractFacts(root, { language });
    assert.equal(facts.repository.revision, null);
    assert.equal(facts.repository.baseRevision, head);
    assert.notEqual(facts.repository.snapshotId, clean.facts.repository.snapshotId);
    assert.ok(facts.imports.some(i => i.from === a && i.to === added));
    assert.ok(facts.imports.some(i => i.from === added && i.to === a));
    const graph = buildGraph(facts, config);
    const findings = evaluateGraph(graph, config, facts);
    assert.throws(() => evaluateGraph(graph, config, clean.facts), /do not match/);
    // Later edits must not change the source text paired with these findings.
    fs.writeFileSync(path.join(root, a), '// changed after extraction\n');
    fs.unlinkSync(path.join(root, added));
    const result = overlayHtml({
      ir: { components: [{ id: 'app', label: 'App' }] }, graph, facts,
      findings: findings.diagnostics, map: { app: graph.modules.map(m => m.id) }, sourceRoot: root,
      html: '<body><div class="toolbar"></div><svg><g data-node-id="app"></g></svg></body>',
    });
    const payload = JSON.parse(result.html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
    assert.equal(payload.snippets[a].lines[0], source.trim());
    assert.ok(payload.snippets[added], 'removed source remains available from the extraction');
    const script = result.html.match(/id="bauify-script">([\s\S]*?)<\/script>/)[1];
    const start = script.indexOf('  function repoBase(');
    assert.ok(start >= 0);
    const end = script.indexOf('\n  function ', start + 1);
    const repoBase = new Function('data', script.slice(start, end) + ';return repoBase;')({ repository: { ...payload.repository, revision: head } });
    assert.equal(repoBase(), null, 'working-tree results never claim commit links');
  });
}

test('non-Git extraction preserves working-tree source navigation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-no-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.mjs'), 'export const value = 1;\n');
  const { facts } = extractFacts(root, { language: 'ts' });
  assert.equal(facts.repository.revision, null);
  assert.equal(facts.repository.baseRevision, null);
  assert.equal(facts.repository.sourceKind, 'working-tree');
  assert.equal(facts.files[0].sourceText, 'export const value = 1;\n');
});
