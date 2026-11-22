import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createOwnedTempDirectory } from '../../../renderers/shared/owned-temp-directory.mjs';

const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
const hash = contents => createHash('sha256').update(contents).digest('hex');
const marker = 'pinned-source-only-518c';
const api = [
  "import { calculate } from './lib/math.js';",
  'export function handle(value) {',
  '  // ' + marker,
  '  return calculate(value);',
  '}',
].join('\n') + '\n';

async function fixture(t) {
  const scratch = createOwnedTempDirectory('archify-wiki-test-');
  t.after(() => scratch.cleanup());
  const root = path.join(scratch.path, 'repository'), scope = 'pkg';
  fs.mkdirSync(path.join(root, scope, 'lib'), { recursive: true });
  const git = (...args) => {
    const result = spawnSync('git', [
      '-c', 'core.hooksPath=' + path.join(scratch.path, 'empty-hooks'),
      '-c', 'user.name=Wiki Test', '-c', 'user.email=wiki-test@example.invalid', '-c', 'commit.gpgsign=false',
      ...args,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  git('remote', 'add', 'origin', 'https://github.com/example/wiki-fixture.git');
  fs.writeFileSync(path.join(root, scope, 'handler.js'), api);
  fs.writeFileSync(path.join(root, scope, 'lib', 'math.js'), 'export function calculate(x) { return x * 2; }\n');
  fs.writeFileSync(path.join(root, 'outside.js'), 'export const outside = "outside-source-marker";\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Pinned wiki source');
  const revision = git('rev-parse', 'HEAD');
  const run = (outName, extra = [], selected = revision) => {
    const out = path.join(scratch.path, outName);
    const result = spawnSync(process.execPath, [
      cli, 'code-analysis', 'wiki', root, '--commit', selected, '--language', 'ts', '--scope', scope,
      '--out', out, '--json', ...extra,
    ], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined);
    return { out, status: result.status, body: JSON.parse(result.stdout), stderr: result.stderr };
  };
  return { root, scope, revision, git, run, scratch: scratch.path };
}

test('wiki CLI creates a deterministic scoped report and never reads the working tree', async t => {
  const { root, scope, revision, run } = await fixture(t);
  fs.writeFileSync(path.join(root, scope, 'handler.js'), 'throw new Error("dirty-worktree-marker");\n');
  const result = run('wiki');
  assert.equal(result.status, 0, JSON.stringify(result.body));
  const read = name => fs.readFileSync(path.join(result.out, name), 'utf8');
  const manifest = JSON.parse(read('wiki.json'));
  assert.deepEqual(manifest.repository, {
    revision, scope, url: 'https://github.com/example/wiki-fixture', snapshotId: manifest.repository.snapshotId,
  });
  assert.equal(manifest.coverage.files.analyzed, 2);
  assert.deepEqual(manifest.modules.flatMap(module => module.fileIndex).sort(), ['pkg/handler.js', 'pkg/lib/math.js']);
  const citation = manifest.citations.find(entry => entry.path === 'pkg/handler.js' && entry.startLine === 2);
  assert.ok(citation, JSON.stringify(manifest.citations));
  assert.equal(citation.sha256, hash(api.trimEnd().split('\n').slice(1).join('\n')));
  assert.equal(citation.url, 'https://github.com/example/wiki-fixture/blob/' + revision + '/pkg/handler.js#L2-L5');
  assert.ok(read('index.html').includes('id="wiki-search"'));
  const embedded = /<script id="wiki-markdown" type="application\/json">([^<]+)<\/script>/.exec(read('index.html'));
  assert.ok(embedded);
  assert.equal(JSON.parse(embedded[1]), read('wiki.md'));
  assert.ok(read('atlas.html').includes('id="bauify-atlas-data"'));
  for (const name of ['index.html', 'wiki.md', 'wiki.json', 'atlas.html']) {
    assert.doesNotMatch(read(name), /pinned-source-only-518c|dirty-worktree-marker|outside-source-marker/);
    if (name !== 'wiki.json') assert.equal(manifest.artifacts[name].sha256, hash(read(name)));
  }

  const duplicate = run('second');
  assert.equal(duplicate.status, 0, JSON.stringify(duplicate.body));
  assert.equal(fs.readFileSync(path.join(duplicate.out, 'wiki.json'), 'utf8'), read('wiki.json'));
});

test('wiki rejects changed citations and preserves previous output while opt-in excerpts stay in HTML', async t => {
  const { revision, scope, scratch, git, root, run } = await fixture(t);
  git('remote', 'set-url', 'origin', 'https://github.com@non-github.invalid/example/fixture.git');
  const narrative = path.join(scratch, 'guide.json');
  const guide = {
    schemaVersion: 1, revision, scope,
    sections: [{
      title: 'Host guide </script><script>globalThis.wikiProbe=true</script>',
      text: '[unsafe](javascript:wikiProbe()) <img src=x onerror=wikiProbe()>',
      citations: [{ path: 'pkg/handler.js', startLine: 3, endLine: 3, sha256: hash(api.split('\n')[2]) }],
    }],
  };
  const save = value => fs.writeFileSync(narrative, JSON.stringify(value));
  save(guide);
  const render = (out, options = []) => run(out, ['--narrative', narrative, ...options]);
  const valid = render('valid', ['--include-source']);
  assert.equal(valid.status, 0, JSON.stringify(valid.body));
  const previous = fs.readFileSync(path.join(valid.out, 'wiki.json'), 'utf8');
  const html = fs.readFileSync(path.join(valid.out, 'index.html'), 'utf8');
  assert.match(html, /pinned-source-only-518c/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;globalThis.wikiProbe/);
  assert.doesNotMatch(html, /<script>globalThis\.wikiProbe|<img src=x|\bhref="javascript:/);
  assert.doesNotMatch(previous, /pinned-source-only-518c|non-github\.invalid/);
  assert.equal(JSON.parse(previous).repository.url, null);
  const markdown = fs.readFileSync(path.join(valid.out, 'wiki.md'), 'utf8');
  assert.doesNotMatch(markdown, /\]\(javascript:|<img src=x|pinned-source-only-518c/);
  assert.match(markdown, /&lt;img src=x/);
  assert.doesNotMatch(fs.readFileSync(path.join(valid.out, 'atlas.html'), 'utf8'), /pinned-source-only-518c/);

  const check = (out, value, code) => {
    save(value);
    const failure = render(out);
    assert.equal(failure.status, 2);
    assert.equal(failure.body.diagnostics[0].code, code);
    assert.equal(fs.existsSync(failure.out), false);
  };
  const section = guide.sections[0], citation = section.citations[0];
  const replace = citation => ({ ...guide, sections: [{ ...section, citations: [citation] }] });
  const missing = run('missing-object', [], 'b'.repeat(40));
  assert.equal(missing.status, 2);
  assert.equal(missing.body.diagnostics[0].code, 'drift/invalid-pin');
  assert.equal(fs.existsSync(missing.out), false);
  check('wrong-commit', { ...guide, revision: 'a'.repeat(40) }, 'wiki/narrative-invalid');
  check('outside-scope', replace({ ...citation, path: 'outside.js' }), 'wiki/narrative-invalid');
  check('wrong-range', replace({ ...citation, endLine: 30 }), 'wiki/citation-invalid');
  check('wrong-digest', replace({ ...citation, sha256: '0'.repeat(64) }), 'wiki/citation-invalid');

  fs.writeFileSync(path.join(root, scope, 'handler.js'), api.replace(marker, 'changed-source'));
  git('add', '.');
  git('commit', '--quiet', '-m', 'Changed the cited line');
  const newer = git('rev-parse', 'HEAD');
  save({ ...guide, revision: newer });
  const changed = run('changed', ['--narrative', narrative], newer);
  assert.equal(changed.status, 2);
  assert.equal(changed.body.diagnostics[0].code, 'wiki/citation-invalid');
  assert.equal(fs.existsSync(changed.out), false);

  const existing = render('valid');
  assert.equal(existing.status, 2);
  assert.equal(existing.body.diagnostics[0].code, 'wiki/output-invalid');
  assert.equal(fs.readFileSync(path.join(valid.out, 'wiki.json'), 'utf8'), previous);
});
