import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { extractFacts, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

// Run under ARCHIFY_GO / ARCHIFY_GO_BUILD to exercise real SDK combinations.
// Expected selection comes from the project's go command, not the helper.
test('Go project SDK controls release and target tags independently of helper compilation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-versions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sdk = spawnSync(process.env.ARCHIFY_GO || 'go', ['env', 'GOVERSION'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GOTOOLCHAIN: 'local', GOENV: 'off', GOWORK: 'off', GOROOT: '' },
  });
  assert.equal(sdk.status, 0, sdk.stderr);
  const version = sdk.stdout.trim(), minor = Number(/^go1\.(\d+)/.exec(version)[1]);
  const files = {
    'go.mod': 'module example.org/versions\ngo 1.18\ntoolchain go1.99.0\n',
    'entry.go': 'package versions\nimport "bytes"\ntype S struct{ bytes.Buffer }\nfunc (S) Work(){}\nfunc Entry(){S{}.Work(); Target(); Release()}\n',
    'target.go': '//go:build amd64.v1\n\npackage versions\nfunc Target(){}\n',
    'other.go': '//go:build !amd64.v1\n\npackage versions\nfunc WrongTarget(){}\n',
    'release.go': `//go:build go1.${minor}\n\npackage versions\nfunc Release(){}\n`,
    'future.go': `//go:build go1.${minor + 1}\n\npackage versions\nfunc TooNew(){}\n`,
    // A file's release constraint can raise its language version above go.mod.
    'language.go': '//go:build go1.22\n\npackage versions\nfunc NewLanguage(){for range 2 {}}\n',
  };
  for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(root, file), source);
  for (const stdlib of [true, false]) {
    const { facts } = extractFacts(root, { language: 'go', config: mergeConfig(loadConfig(), { go: { stdlib, goos: 'linux', goarch: 'amd64' } }) });
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
    assert.deepEqual(facts.files.map(f => f.path).sort(), ['entry.go', 'language.go', 'release.go', 'target.go']);
    assert.deepEqual(facts.calls.map(c => c.target?.name).sort(), ['Release', 'Target', 'Work']);
    assert.equal(facts.languageScope.loader.projectToolchain, version);
    assert.equal(facts.languageScope.build.releaseTags.at(-1), `go1.${minor}`);
    assert.ok(facts.languageScope.build.toolTags.includes('amd64.v1'));
    assert.ok(!facts.languageScope.build.toolTags.some(tag => tag.startsWith('arm64.')));
    assert.equal(facts.languageScope.loader.languageVersion, '1.18');
    if (process.env.ARCHIFY_TEST_GO_BUILD_VERSION) assert.equal(facts.languageScope.loader.toolchain, process.env.ARCHIFY_TEST_GO_BUILD_VERSION);
    if (stdlib) {
      assert.equal(facts.languageScope.standardLibrary.toolchain, version);
      assert.ok(facts.languageScope.standardLibrary.packages.some(p => p.path === 'bytes'));
      assert.equal(facts.languageScope.typing.errorCount, 0, JSON.stringify(facts.languageScope.typing));
    } else assert.ok(facts.languageScope.typing.errorCount > 0, 'SDK types stay unavailable in captured-only mode');
  }
  assert.equal(fs.readFileSync(path.join(root, 'go.mod'), 'utf8'), files['go.mod']);
  assert.equal(fs.existsSync(path.join(root, 'go.sum')), false);
  fs.writeFileSync(path.join(root, 'go.mod'), `module example.org/versions\ngo 1.${minor + 1}.0\n`);
  assert.throws(() => extractFacts(root, { language: 'go', config: loadConfig() }), error => {
    const diagnostic = error.diagnostics?.[0];
    return diagnostic?.code === 'extract/go-failed' && diagnostic.evidence.phase === 'project-analysis'
      && diagnostic.evidence.stderr.some(line => line.includes('GOTOOLCHAIN=local'));
  }, 'a newer project language must not silently upgrade the selected SDK');
});
