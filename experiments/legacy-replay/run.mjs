#!/usr/bin/env node
// Offline, deterministic characterization of recovered counterexamples; no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const read = relative => fs.readFileSync(path.join(here, relative));
const fixture = JSON.parse(read('fixtures/scenarios.json'));
const argv = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!['--delivery', '--presets', '--out'].includes(argv[i]) || !argv[i + 1]) {
    throw new Error('usage: node run.mjs --delivery CHECKOUT --presets CHECKOUT [--out RESULTS.json]');
  }
  if (options[argv[i]]) throw new Error(`Duplicate option ${argv[i]}`);
  options[argv[i]] = path.resolve(argv[i + 1]);
}
assert.ok(options['--delivery'] && options['--presets'], 'Both pinned checkouts are required');
const git = (root, args, extra = {}) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...extra,
}).trim();
const inputs = ['run.mjs', 'fixtures/scenarios.json', 'fixtures/provenance.json',
  ...['hono', 'fastapi', 'hugo'].flatMap(name => [
    `fixtures/external/${name}-map.json`, `fixtures/external/${name}-map.ownership.json`,
  ])];
for (const record of JSON.parse(read('fixtures/provenance.json'))) {
  assert.equal(sha(read(record.file)), record.sha256, `Recovered input changed: ${record.file}`);
}
const output = {
  schemaVersion: 1,
  purpose: 'Pinned behavior characterization; known counterexamples are not product acceptance passes.',
  runtime: { node: process.version, git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim() },
  inputs: Object.fromEntries(inputs.sort().map(file => [file, sha(read(file))])),
  revisions: {},
};

function characterize(id, actual, expected) {
  assert.deepEqual(actual, expected, `Characterization changed: ${id}`);
  return { id, actual, expected, matchesSnapshot: true };
}
function subset(object, keys) { return Object.fromEntries(keys.filter(k => k in object).map(k => [k, object[k]])); }
function cliProbes(checkout, profile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-legacy-replay-'));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'),
    GIT_AUTHOR_NAME: 'Replay Fixture', GIT_AUTHOR_EMAIL: 'replay@example.test',
    GIT_COMMITTER_NAME: 'Replay Fixture', GIT_COMMITTER_EMAIL: 'replay@example.test',
    GIT_AUTHOR_DATE: '2026-09-09T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-09T00:00:00Z' };
  const g = (...args) => git(root, args, { env });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const json = value => `${JSON.stringify(value, null, 2)}\n`;
  function run(args, outName) {
    const result = spawnSync(process.execPath, [path.join(checkout, 'archify/bin/archify.mjs'), 'locate',
      ...args, '--map', path.join(root, 'map.architecture.json'), '--out', path.join(root, outName),
      '--repo-root', root, '--json'], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
    assert.ifError(result.error);
    let receipt;
    try { receipt = JSON.parse(result.stdout); }
    catch { throw new Error(`${profile} ${outName}: CLI did not return JSON (exit ${result.status})`); }
    return { exit: result.status, ok: receipt.ok, mapDeltaStatus: receipt.mapDelta?.status || null,
      diagnosticCodes: (receipt.diagnostics || []).map(d => d.code),
      blocking: receipt.review?.blocking || [],
      files: fs.existsSync(path.join(root, outName)) ? fs.readdirSync(path.join(root, outName)).sort() : [] };
  }
  try {
    g('init', '--initial-branch=fixture');
    g('config', 'commit.gpgsign', 'false');
    g('commit', '--allow-empty', '-m', 'empty baseline');
    const empty = g('rev-parse', 'HEAD');
    write('bin/cli.mjs', 'console.log(1)\n'); write('src/main.mjs', 'export const n = 1;\n');
    write('map.architecture.json', json(fixture.cliMap));
    write('map.architecture.ownership.json', json(fixture.cliOwnership));
    g('add', '.'); g('commit', '-m', 'add map and product inputs');
    const added = g('rev-parse', 'HEAD');
    const addResult = run([`${empty}..${added}`], 'added-output');
    const lintResult = run(['--lint', added], 'lint-output');
    // Output directories are intentionally outside the Git index.
    write('bin/cli.mjs', 'console.log(2)\n'); g('add', 'bin/cli.mjs'); g('commit', '-m', 'change CLI');
    const changed = g('rev-parse', 'HEAD');
    const rangeResult = run([`${added}..${changed}`], 'range-output');
    const rangeHtml = fs.readFileSync(path.join(root, 'range-output/locate.html'), 'utf8');
    return { git: { empty, added, changed }, addedMap: addResult, lint: lintResult, ordinaryRange: rangeResult,
      standaloneRangeContainsSvg: /<svg\b/i.test(rangeHtml) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const profile of ['delivery', 'presets']) {
  const checkout = options[`--${profile}`];
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), fixture.pins[profile], `${profile} checkout must match the pinned revision`);
  assert.equal(git(checkout, ['status', '--porcelain', '--untracked-files=all', '--', 'archify']), '', `${profile} packaged source must be clean`);
  const tracked = git(checkout, ['ls-files', '--', 'archify']).split('\n').filter(Boolean);
  const source = Object.fromEntries(tracked.sort().map(file => [file, sha(fs.readFileSync(path.join(checkout, file)))]));
  // Import only from each verified checkout. The exact packaged tree and files used are identified below.
  const ownership = await import(pathToFileURL(path.join(checkout, 'archify/locate/ownership.mjs')).href);
  const glob = await import(pathToFileURL(path.join(checkout, 'archify/locate/glob.mjs')).href);
  const locate = await import(pathToFileURL(path.join(checkout, 'archify/locate/locate.mjs')).href);
  const observations = [];
  for (const row of fixture.glob) {
    const contains = glob.subsumes(row.parent, row.child);
    observations.push(characterize(`glob:${row.parent}=>${row.child}`, contains, row[profile]));
    if (row.witness) {
      assert.equal(glob.matchesGlob(row.child, row.witness), true, 'Counterexample must match child');
      assert.equal(glob.matchesGlob(row.parent, row.witness), false, 'Counterexample must be outside parent');
    }
    const failures = ownership.validateChildOwnershipSubset(
      { components: [{ id: 'parent', globs: [row.parent] }] }, 'parent',
      { components: [{ id: 'child', globs: [row.child] }] });
    observations.push(characterize(`subset:${row.parent}=>${row.child}`, failures.map(f => f.code), contains ? [] : ['locate/ownership-not-subset']));
  }
  const presetExpansion = ownership.OWNERSHIP_PRESETS || null;
  for (const row of fixture.presets) {
    const plain = { components: [{ id: 'all', globs: [] }] };
    observations.push(characterize(`unowned:${row.path}:${row.preset}`, ownership.classifyPath(row.path, plain), { state: 'uncovered' }));
    if (presetExpansion) {
      const declared = { ...plain, presets: [row.preset] };
      observations.push(characterize(`preset:${row.path}:${row.preset}`, ownership.classifyPath(row.path, declared),
        row.presetState === 'excluded' ? { state: 'excluded', matchedGlob: `preset:${row.preset}` } : { state: 'uncovered' }));
      observations.push(characterize(`owner-precedence:${row.path}:${row.preset}`, ownership.classifyPath(row.path,
        { ...declared, components: [{ id: 'all', globs: ['**'] }] }), { state: 'touched', componentId: 'all', matchedGlob: '**' }));
    }
  }
  for (const [name, rows] of Object.entries(fixture.external)) {
    const sidecar = JSON.parse(read(`fixtures/external/${name}-map.ownership.json`));
    const map = JSON.parse(read(`fixtures/external/${name}-map.json`));
    assert.deepEqual(new Set(sidecar.components.map(c => c.id)), new Set(map.components.map(c => c.id)));
    for (const row of rows) observations.push(characterize(`recovered-${name}:${row.path}`,
      subset(ownership.classifyPath(row.path, sidecar), ['state', 'componentId']), row.expected));
  }
  const receipt = locate.locateRange({ ...fixture.sourceReceipt, base: 'a'.repeat(40), head: 'b'.repeat(40) });
  observations.push(characterize('citation-is-not-ownership',
    { files: receipt.files.map(f => subset(f, ['path', 'state'])), components: receipt.components.map(c => subset(c, ['id', 'state'])), review: receipt.review },
    { files: [{ path: 'archify/migrations/workflow-v2.mjs', state: 'uncovered' }], components: [{ id: 'core', state: 'untouched' }],
      review: { required: false, blocking: [], advisory: ['files_uncovered'] } }));
  if (presetExpansion) {
    const parent = { presets: ['docs', 'tests'], components: [{ id: 'parent', globs: ['src/**'] }] };
    const child = { presets: ['docs'], components: [{ id: 'child', globs: [] }] };
    const inherited = ownership.inheritParentExcluded(parent, child);
    observations.push(characterize('fewer-child-presets:direct-versus-projected',
      { direct: ownership.classifyPath('src/fixtures/product.js', child), projected: ownership.classifyPath('src/fixtures/product.js', inherited) },
      { direct: { state: 'uncovered' }, projected: { state: 'excluded', matchedGlob: 'preset:tests' } }));
  }
  const cli = cliProbes(checkout, profile);
  assert.equal(cli.ordinaryRange.exit, 0); assert.equal(cli.lint.exit, 0);
  assert.equal(cli.addedMap.exit, profile === 'delivery' ? 0 : 1);
  assert.equal(cli.addedMap.mapDeltaStatus, profile === 'delivery' ? 'added' : null);
  assert.deepEqual(cli.lint.files, profile === 'delivery' ? ['locate.html', 'locate.receipt.json'] : ['locate.receipt.json']);
  assert.equal(cli.standaloneRangeContainsSvg, profile === 'delivery');
  output.revisions[profile] = {
    commit: fixture.pins[profile], packagedTree: git(checkout, ['rev-parse', 'HEAD:archify']),
    packagedSourceManifestSha256: sha(JSON.stringify(source)),
    keySourceSha256: Object.fromEntries(['archify/locate/glob.mjs', 'archify/locate/ownership.mjs', 'archify/locate/locate.mjs',
      'archify/locate/cli.mjs', 'archify/locate/locate-html.mjs', 'archify/bin/archify.mjs'].map(file => [file, source[file]])),
    presetExpansionSha256: presetExpansion ? sha(JSON.stringify(presetExpansion)) : null,
    presetExpansion, observations, cli,
  };
}
const serialized = `${JSON.stringify(output, null, 2)}\n`;
assert.equal(serialized.includes(options['--delivery']), false, 'Result must not embed checkout paths');
assert.equal(serialized.includes(options['--presets']), false, 'Result must not embed checkout paths');
if (options['--out']) {
  fs.mkdirSync(path.dirname(options['--out']), { recursive: true });
  fs.writeFileSync(options['--out'], serialized);
} else process.stdout.write(serialized);
process.stderr.write(`Characterized ${Object.values(output.revisions).reduce((n, r) => n + r.observations.length, 0)} fixed observations and 6 CLI runs; no model or human benefit measured.\n`);
