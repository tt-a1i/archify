import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../bin/preview.mjs';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { verifyRepositoryEvidence } from '../renderers/shared/repository-evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-repo-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'router.js'), 'export function route(input) {\n  return input.kind;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'store.js'), 'export const store = new Map();\n');
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'git@github.com:example/evidence-repo.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  const revision = git(root, 'rev-parse', 'HEAD');

  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  diagram.meta.repository = {
    url: 'https://github.com/example/evidence-repo',
    revision,
  };
  diagram.components[0].sources = [
    { path: 'src/router.js', line: 1, end_line: 3, label: 'Request router' },
    { path: 'src/store.js', line: 1 },
  ];
  const input = path.join(root, 'diagram.architecture.json');
  fs.writeFileSync(input, JSON.stringify(diagram, null, 2));
  return { root, revision, diagram, input };
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function evidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'verified evidence payload missing');
  return JSON.parse(match[1]);
}

function internalStructurePayload(html) {
  const matches = [...html.matchAll(/<script id="archify-internal-structure-data" type="application\/json">([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length, 1, 'expected one internal structure payload');
  const chunks = JSON.parse(matches[0][1]);
  assert.ok(Array.isArray(chunks) && chunks.length > 0, 'internal structure payload must be chunked');
  return JSON.parse(chunks.join(''));
}

test('repository-backed internal structure delivers one source-linked payload outside canonical SVG', () => {
  const data = fixture();
  data.diagram.components[0].sources = [{
    id: 'route-entry',
    role: 'export',
    path: 'src/router.js',
    line: 1,
    end_line: 3,
    symbol: 'route',
  }];
  data.diagram.components[0].internal_structure = {
    sources: data.diagram.components[0].sources,
    items: [
      { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: 'Application sources.' },
      { id: 'route-interface', domain: 'code', kind: 'function', label: 'route', parent: 'src', signature: 'route(input)', summary: 'Accepts one input and returns its kind.', source_refs: ['route-entry'] },
    ],
    relations: [],
  };
  delete data.diagram.components[0].sources;
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const output = path.join(data.root, 'internal-structure.html');

  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  const payload = internalStructurePayload(html);
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(Object.keys(payload.nodes), ['users']);
  assert.deepEqual(payload.nodes.users.items[1].sourceRefs, ['route-entry']);
  assert.equal(payload.nodes.users.items[1].signature, 'route(input)');
  assert.equal(evidencePayload(html).nodes.users[0].id, 'route-entry');
  assert.equal(evidencePayload(html).nodes.users[0].symbolLocated, true);
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /Routes accepted input|route-interface|src\/router\.js/);
});

function attachRepositoryInternalStructure(data, source, {
  summaryText = 'Routes accepted input by its kind.',
  itemText = 'Accepts one input and returns its kind.',
} = {}) {
  delete data.diagram.components[0].sources;
  data.diagram.components[0].internal_structure = {
    sources: [source],
    items: [
      { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: summaryText },
      { id: 'route-constraint', domain: 'code', kind: 'function', label: 'route', parent: 'src', summary: itemText, source_refs: [source.id] },
    ],
    relations: [],
  };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
}

test('internal structure source symbols resolve in the selected range at the pinned revision', () => {
  const data = fixture();
  attachRepositoryInternalStructure(data, {
    id: 'route-entry',
    role: 'definition',
    symbol: 'route',
    path: 'src/router.js',
    line: 1,
    end_line: 1,
  });
  fs.writeFileSync(path.join(data.root, 'src', 'router.js'), 'export function renamed(input) {\n  return input.kind;\n}\n');
  const output = path.join(data.root, 'pinned-symbol.html');

  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const source = evidencePayload(fs.readFileSync(output, 'utf8')).nodes.users[0];
  assert.deepEqual({
    id: source.id,
    role: source.role,
    symbol: source.symbol,
    line: source.line,
    endLine: source.endLine,
    symbolLocated: source.symbolLocated,
  }, {
    id: 'route-entry',
    role: 'definition',
    symbol: 'route',
    line: 1,
    endLine: 1,
    symbolLocated: true,
  });
});

test('internal structure source symbols fail closed when missing from the pinned selected range', () => {
  for (const { name, symbol, line, endLine, editWorkingTree } of [
    { name: 'missing', symbol: 'missingRoute', line: 1, endLine: 3 },
    {
      name: 'worktree-only',
      symbol: 'worktreeOnly',
      editWorkingTree: "export function worktreeOnly(input) {\n  return input.kind;\n}\n",
    },
    { name: 'outside-range', symbol: 'route', line: 2, endLine: 2 },
  ]) {
    const data = fixture();
    attachRepositoryInternalStructure(data, {
      id: 'route-entry',
      role: 'definition',
      symbol,
      path: 'src/router.js',
      ...(line ? { line } : {}),
      ...(endLine ? { end_line: endLine } : {}),
    });
    if (editWorkingTree) fs.writeFileSync(path.join(data.root, 'src', 'router.js'), editWorkingTree);
    const output = path.join(data.root, `${name}.html`);
    fs.writeFileSync(output, 'trusted previous artifact');

    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, `${name} unexpectedly verified`);
    const receipt = JSON.parse(result.stdout);
    assert.ok(receipt.diagnostics.some(({ code }) => code === 'repository-evidence/symbol-missing'), result.stdout);
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
});

test('internal structure source symbols use Unicode token boundaries instead of substring matches', () => {
  for (const { name, content, symbol } of [
    { name: 'ascii-suffix-of-unicode-identifier', content: 'export const πroute = true;\n', symbol: 'route' },
    { name: 'unicode-prefix-of-longer-identifier', content: 'export const 处理器扩展 = true;\n', symbol: '处理器' },
  ]) {
    const data = fixture();
    fs.writeFileSync(path.join(data.root, 'src', 'router.js'), content);
    git(data.root, 'add', 'src/router.js');
    git(data.root, 'commit', '-m', name);
    data.diagram.meta.repository.revision = git(data.root, 'rev-parse', 'HEAD');
    attachRepositoryInternalStructure(data, {
      id: 'route-entry',
      role: 'definition',
      symbol,
      path: 'src/router.js',
      line: 1,
      end_line: 1,
    });
    const output = path.join(data.root, `${name}.html`);
    fs.writeFileSync(output, 'trusted previous artifact');

    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, `${name} unexpectedly verified`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/symbol-missing'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
});

test('internal structure source symbols accept an exact Unicode identifier token', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.root, 'src', 'router.js'), 'export const 处理器 = true;\n');
  git(data.root, 'add', 'src/router.js');
  git(data.root, 'commit', '-m', 'unicode symbol');
  data.diagram.meta.repository.revision = git(data.root, 'rev-parse', 'HEAD');
  attachRepositoryInternalStructure(data, {
    id: 'route-entry',
    role: 'definition',
    symbol: '处理器',
    path: 'src/router.js',
    line: 1,
    end_line: 1,
  });
  const output = path.join(data.root, 'unicode-symbol.html');

  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(evidencePayload(fs.readFileSync(output, 'utf8')).nodes.users[0].symbolLocated, true);
});

test('local-only internal structure evidence keeps source identity without links or local roots', () => {
  const data = fixture();
  data.diagram.meta.repository = {
    url: 'http://git.internal/Team/repo',
    revision: data.revision,
    link_mode: 'local-only',
  };
  git(data.root, 'remote', 'set-url', 'origin', data.diagram.meta.repository.url);
  attachRepositoryInternalStructure(data, {
    id: 'route-entry',
    role: 'definition',
    symbol: 'route',
    path: 'src/router.js',
    line: 1,
    end_line: 1,
  });
  const output = path.join(data.root, 'local-guide.html');

  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  const evidence = evidencePayload(html);
  const source = evidence.nodes.users[0];
  assert.equal(evidence.repository.linkMode, 'local-only');
  assert.equal(Object.hasOwn(evidence.repository, 'href'), false);
  assert.equal(Object.hasOwn(source, 'href'), false);
  assert.deepEqual({ id: source.id, role: source.role, symbol: source.symbol, symbolLocated: source.symbolLocated }, {
    id: 'route-entry',
    role: 'definition',
    symbol: 'route',
    symbolLocated: true,
  });
  assert.deepEqual(internalStructurePayload(html).nodes.users.items[1].sourceRefs, ['route-entry']);
  assert.equal(html.includes(data.root), false, 'artifact must not disclose the local repository root');
});

test('internal structure and source evidence safely round-trip special text', () => {
  const data = fixture();
  const symbol = 'route("</script> & \u2028")';
  const label = 'Source </script> & "quoted"';
  const summaryText = 'Summary </script><img data-archify-injected> & "quoted" \u2028 雪';
  const itemText = 'Never trust <svg onload=alert(1)> & keep \'quotes\' \u2028 intact.';
  fs.writeFileSync(path.join(data.root, 'src', 'special.js'), `// ${symbol}\nexport const safe = true;\n`);
  git(data.root, 'add', 'src/special.js');
  git(data.root, 'commit', '-m', 'special source text');
  data.diagram.meta.repository.revision = git(data.root, 'rev-parse', 'HEAD');
  attachRepositoryInternalStructure(data, {
    id: 'special-source',
    role: 'documentation',
    symbol,
    path: 'src/special.js',
    line: 1,
    end_line: 1,
    label,
  }, { summaryText, itemText });
  const output = path.join(data.root, 'special-text.html');

  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  const evidence = evidencePayload(html);
  const structure = internalStructurePayload(html);
  assert.equal(evidence.nodes.users[0].symbol, symbol);
  assert.equal(evidence.nodes.users[0].label, label);
  assert.equal(evidence.nodes.users[0].symbolLocated, true);
  assert.equal(structure.nodes.users.items[0].summary, summaryText);
  assert.equal(structure.nodes.users.items[1].summary, itemText);
  assert.doesNotMatch(html, /<img data-archify-injected>/);
  assert.doesNotMatch(html, /<svg onload=alert\(1\)>/);
});

test('repository root accepts a different spelling of the same physical Git top-level', (t) => {
  const data = fixture();
  const alias = `${data.root}-alias`;
  fs.symlinkSync(data.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => fs.rmSync(alias, { recursive: true, force: true }));

  // Windows APIs and Git can report the same directory with different case or
  // long/short spellings. Preserve the authored alias for the first lookup so
  // this test exercises physical identity instead of string equality.
  const realpathSync = fs.realpathSync;
  let preservedAlias = false;
  t.mock.method(fs, 'realpathSync', (target, ...args) => {
    if (!preservedAlias && path.resolve(String(target)) === path.resolve(alias)) {
      preservedAlias = true;
      return alias;
    }
    return Reflect.apply(realpathSync, fs, [target, ...args]);
  });

  const evidence = verifyRepositoryEvidence('architecture', data.diagram, alias);
  assert.equal(preservedAlias, true);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.revision, data.revision);
});

test('repository root rejects a different physical directory inside the repository', () => {
  const data = fixture();
  assert.throws(
    () => verifyRepositoryEvidence('architecture', data.diagram, path.join(data.root, 'src')),
    (error) => error?.archifyDiagnostics?.some(({ code }) => code === 'repository-evidence/root-not-top-level'),
  );
});

test('repository root fails closed when physical identity is indeterminate', (t) => {
  const data = fixture();
  const inaccessible = Object.assign(new Error('synthetic identity failure'), { code: 'EACCES' });
  t.mock.method(fs, 'statSync', () => { throw inaccessible; });

  assert.throws(
    () => verifyRepositoryEvidence('architecture', data.diagram, data.root),
    (error) => {
      const diagnostic = error?.archifyDiagnostics?.find(
        ({ code }) => code === 'repository-evidence/root-identity-indeterminate',
      );
      assert.ok(diagnostic);
      assert.equal(diagnostic.evidence.relation.code, 'root-resolution-failed');
      assert.equal(diagnostic.evidence.relation.systemCode, 'EACCES');
      return true;
    },
  );
});

test('Gitee evidence generates provider-specific revision and line links', () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'https://gitee.com/example/evidence-repo';
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const output = path.join(data.root, 'gitee.html');
  for (const remote of [
    'https://gitee.com/example/evidence-repo.git/',
    'git@gitee.com:example/evidence-repo.git',
    'ssh://git@gitee.com/example/evidence-repo.git',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.repository.href, `https://gitee.com/example/evidence-repo/tree/${data.revision}`);
    assert.equal(evidence.nodes.users[0].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-3`);
    assert.equal(evidence.nodes.users[1].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/store.js#L1`);
  }
});

test('local-only evidence verifies HTTP self-hosted origins without generating links', () => {
  const data = fixture();
  data.diagram.meta.repository = {
    url: 'http://git.example.internal:3000/Platform/Services/evidence-repo',
    revision: data.revision,
    link_mode: 'local-only',
  };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  git(data.root, 'remote', 'set-url', 'origin', data.diagram.meta.repository.url);
  // Evidence is read from the pinned commit, not from the current working file.
  fs.writeFileSync(path.join(data.root, 'src/router.js'), 'changed\n');
  const output = path.join(data.root, 'local.html');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).evidence.linkMode, 'local-only');
  const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.href, undefined);
  assert.equal(evidence.repository.linkMode, 'local-only');
  assert.equal(evidence.nodes.users[0].endLine, 3);
  assert.ok(evidence.nodes.users.every((source) => !Object.hasOwn(source, 'href')));
});

test('local-only supports nested HTTPS and Git SSH identities with bounded port equivalence', () => {
  const data = fixture();
  const output = path.join(data.root, 'portable.html');
  for (const [url, remote] of [
    ['https://git.internal/Platform/Services/repo.git', 'https://git.internal:443/Platform/Services/repo.git'],
    ['ssh://git@git.internal/Platform/Services/repo', 'ssh://git@git.internal:22/Platform/Services/repo'],
    ['ssh://git@git.internal:2222/Platform/repo.git', 'ssh://git@git.internal:2222/Platform/repo.git'],
    ['git@git.internal:Platform/repo', 'git@git.internal:Platform/repo'],
    ['git@git.internal:/Platform/repo', 'ssh://git@git.internal/Platform/repo'],
    ['http://git.internal:3000/Platform/repo.git', 'http://user:SYNTHETIC_TOKEN@git.internal:3000/Platform/repo.git'],
    ['https://git.internal/Platform/repo.git', 'https://user:SYNTHETIC_TOKEN@git.internal/Platform/repo.git'],
    ['git@git.internal:Platform/repo%41', 'git@git.internal:Platform/repo%41'],
    ['ssh://git@git.internal/Platform/repo%41', 'ssh://git@git.internal/Platform/repoA'],
  ]) {
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['render', 'architecture', data.input, output, '--repo-root', data.root]);
    assert.equal(result.status, 0, `${url}: ${result.stderr}`);
    const html = fs.readFileSync(output, 'utf8');
    assert.doesNotMatch(html, /SYNTHETIC_TOKEN/);
    assert.equal(evidencePayload(html).repository.href, undefined);
  }
});

for (const [name, url, origin] of [
  ['relative versus absolute SSH paths', 'ssh://git@git.internal/Team/repo', 'git@git.internal:Team/repo'],
  ['literal percent escapes in SCP paths', 'git@git.internal:Team/repoA', 'git@git.internal:Team/repo%41'],
]) {
  test(`local-only rejects ${name} before replacing a trusted artifact`, () => {
    const data = fixture();
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', origin);
    const output = path.join(data.root, 'trusted.html');
    fs.writeFileSync(output, 'trusted previous artifact');
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, 'different Git paths must not verify as the declared repository');
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/origin-mismatch'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  });
}

test('local-only rejects different hosts, paths, path case, endpoints and guessed prefixes', () => {
  const data = fixture();
  const output = path.join(data.root, 'trusted.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  for (const [url, remote] of [
    ['https://git.internal/Team/repo', 'https://other.internal/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/Team/other'],
    ['https://git.internal/Team/repo', 'https://git.internal/team/repo'],
    ['https://git.internal/Team/repo', 'http://git.internal/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal:8443/Team/repo'],
    ['ssh://git@git.internal:2222/Team/repo', 'ssh://git@git.internal:2223/Team/repo'],
    ['https://git.internal:2222/Team/repo', 'ssh://git@git.internal:2222/Team/repo'],
    ['https://git.internal/Team/repo', 'git@ssh-alias:Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/scm/Team/repo'],
    ['https://git.internal/Team/repo', 'https://git.internal/Team/ignored/../repo'],
    ['https://git.internal/Team/repo', 'git@git.internal:Team/repo'],
    ['https://git.internal/Team/repo', 'ssh://git@git.internal/Team/repo'],
    ['git@git.internal:Team/repo', 'git@git.internal:Team/repo.git'],
    ['http://git.internal/Team/repo', 'http://git.internal/Team/repo.git'],
  ]) {
    data.diagram.meta.repository = { url, revision: data.revision, link_mode: 'local-only' };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, `${url} must differ from ${remote}`);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === 'repository-evidence/origin-mismatch'));
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
});

test('local-only preserves root, origin, commit, blob, path and line checks', () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'http://git.internal/team/repo';
  data.diagram.meta.repository.link_mode = 'local-only';
  git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal/team/repo');
  const output = path.join(data.root, 'trusted.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  const original = structuredClone(data.diagram);
  const cases = [
    ['repository-evidence/root-required', () => {}, []],
    ['repository-evidence/revision-unavailable', (diagram) => { diagram.meta.repository.revision = '0'.repeat(40); }],
    ['repository-evidence/file-missing', (diagram) => { diagram.components[0].sources = [{ path: 'src/missing.js' }]; }],
    ['repository-evidence/file-missing', (diagram) => { diagram.components[0].sources = [{ path: 'src' }]; }],
    ['repository-evidence/path-escape', (diagram) => { diagram.components[0].sources = [{ path: '../outside.js' }]; }],
    ['repository-evidence/path-escape', (diagram) => { diagram.components[0].sources = [{ path: '.git/config' }]; }],
    ['repository-evidence/line-out-of-range', (diagram) => { diagram.components[0].sources = [{ path: 'src/router.js', line: 4 }]; }],
    ['repository-evidence/line-range-invalid', (diagram) => { diagram.components[0].sources = [{ path: 'src/router.js', line: 3, end_line: 1 }]; }],
  ];
  for (const [expectedCode, change, roots = ['--repo-root', data.root]] of cases) {
    const diagram = structuredClone(original);
    change(diagram);
    fs.writeFileSync(data.input, JSON.stringify(diagram));
    const result = run(['deliver', 'architecture', data.input, output, ...roots, '--json']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) => code === expectedCode), result.stdout);
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  }
  fs.writeFileSync(data.input, JSON.stringify(original));
  git(data.root, 'remote', 'remove', 'origin');
  const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /must have an origin/);
});

test('repository root identity uses Git position and still rejects a real subdirectory', () => {
  const data = fixture();
  const output = path.join(data.root, 'root-boundary.html');
  fs.writeFileSync(output, 'trusted previous artifact');

  const result = run([
    'deliver', 'architecture', data.input, output,
    '--repo-root', path.join(data.root, 'src'), '--json',
  ]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.ok(JSON.parse(result.stdout).diagnostics.some(({ code }) =>
    code === 'repository-evidence/root-not-top-level'), result.stdout);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('unsupported web providers and invalid authored addresses fail without exposing credentials', () => {
  const data = fixture();
  for (const repository of [
    { url: 'https://git.internal/team/repo' },
    { url: 'https://gitee.com/team/repo', provider: 'github' },
    { url: 'https://git.internal/team/repo', provider: 'gitee' },
    { url: 'https://user:SYNTHETIC_TOKEN@gitee.com/team/repo' },
    { url: 'https://gitee.com/team/repo?token=SYNTHETIC_TOKEN' },
    { url: 'https://gitee.com/team/repo#SYNTHETIC_TOKEN' },
    { url: 'https://gitee.com/team/%2e%2e/repo' },
    { url: 'https://gitee.com/team%2Frepo' },
    { url: 'file:///tmp/repo', link_mode: 'local-only' },
    { url: 'javascript:alert(1)', link_mode: 'local-only' },
    { link_mode: 'local-only' },
  ]) {
    data.diagram.meta.repository = { revision: data.revision, ...repository };
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1, JSON.stringify(repository));
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_TOKEN/);
  }
});

test('portable origin failures redact HTTP credentials and query tokens', () => {
  const data = fixture();
  data.diagram.meta.repository = { url: 'http://git.internal/Team/repo', revision: data.revision, link_mode: 'local-only' };
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  for (const origin of [
    'http://user:SYNTHETIC_TOKEN@git.internal/Team/other',
    'http://git.internal/Team/repo?token=SYNTHETIC_TOKEN',
    'https://user:SYNTHETIC_TOKEN@git.internal/Team/repo',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', origin);
    const result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_TOKEN/);
  }
});

test('explicit providers retain GitHub links and encode Gitee source paths', () => {
  const data = fixture();
  fs.writeFileSync(path.join(data.root, 'src', '中文 # router.js'), 'one\ntwo\n');
  git(data.root, 'add', 'src');
  git(data.root, 'commit', '-m', 'encoded source path');
  const revision = git(data.root, 'rev-parse', 'HEAD');
  data.diagram.components[0].sources = [{ path: 'src/中文 # router.js', line: 1, end_line: 2 }];
  for (const provider of ['github', 'gitee']) {
    data.diagram.meta.repository = { url: `https://${provider}.com/example/evidence-repo.git/`, revision, provider };
    git(data.root, 'remote', 'set-url', 'origin', `git@${provider}.com:example/evidence-repo.git`);
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const output = path.join(data.root, `${provider}.html`);
    const result = run(['render', 'architecture', data.input, output, '--repo-root', data.root]);
    assert.equal(result.status, 0, result.stderr);
    const evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.nodes.users[0].href, `https://${provider}.com/example/evidence-repo/blob/${revision}/src/${encodeURIComponent('中文 # router.js')}#L1-${provider === 'github' ? 'L' : ''}2`);
  }
});

test('local-only preview and compare publish only revision-verified evidence', { timeout: 20000 }, async () => {
  const data = fixture();
  data.diagram.meta.repository.url = 'http://git.internal/Team/repo';
  data.diagram.meta.repository.link_mode = 'local-only';
  git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal/Team/repo');
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  const head = path.join(data.root, 'head.architecture.json');
  fs.writeFileSync(head, JSON.stringify(data.diagram));
  const compared = path.join(data.root, 'compared.html');
  const result = run(['compare', 'architecture', data.input, head, compared, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).proofLevel, 'revision-pinned');
  assert.match(fs.readFileSync(compared, 'utf8'), /local-only/);
  const preview = await startPreview({ type: 'architecture', input: data.input, output: path.join(data.root, 'preview-local.html'), repoRoot: data.root, open: false, debounceMs: 30, pollMs: 60 });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified');
    const before = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.equal(evidencePayload(before).repository.href, undefined);
    data.diagram.components[0].sources[0].line = 999;
    delete data.diagram.components[0].sources[0].end_line;
    fs.writeFileSync(data.input, JSON.stringify(data.diagram));
    const failed = await waitForState(preview.url, (candidate) => candidate.status === 'needs-fix');
    assert.equal(failed.revision, state.revision);
    assert.equal(await (await fetch(new URL('/artifact.html', preview.url))).text(), before);
  } finally { await preview.stop(); }
});

test('browser renders local-only sources as searchable text and web sources as links', {
  skip: process.env.ARCHIFY_CHROME ? false : 'Set ARCHIFY_CHROME to run evidence browser checks.',
  timeout: 60000,
}, async () => {
  const data = fixture();
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    for (const mode of ['github', 'gitee', 'local-only']) {
      const local = mode === 'local-only';
      const url = local ? 'http://git.internal/Team/repo' : `https://${mode}.com/example/evidence-repo`;
      data.diagram.meta.repository = { url, revision: data.revision, ...(local ? { link_mode: mode } : {}) };
      git(data.root, 'remote', 'set-url', 'origin', url);
      fs.writeFileSync(data.input, JSON.stringify(data.diagram));
      const artifactPath = path.join(data.root, `${mode}.html`);
      const result = run(['deliver', 'architecture', data.input, artifactPath, '--repo-root', data.root, '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      for (const theme of ['light', 'dark']) {
        await browser.inspect({ artifactPath, width: 1440, height: 900, theme });
        const sessionId = await browser.sessionPromise;
        const response = await browser.cdp.send('Runtime.evaluate', {
          expression: `(() => {
            document.querySelector('[data-node-id="users"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const panel = document.getElementById('focus-evidence');
            const rows = [...panel.querySelectorAll('.semantic-passport-source')];
            const input = document.getElementById('node-finder-input');
            input.value = 'src/router.js';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return {
              visible: !panel.hidden,
              links: rows.filter(row => row.tagName === 'A').map(row => row.getAttribute('href')),
              paths: rows.map(row => row.querySelector('small').textContent),
              locations: rows.map(row => row.querySelector('code').textContent),
              repositoryHref: document.getElementById('focus-repository').getAttribute('href'),
              scope: panel.title,
              beacon: !!document.querySelector('[data-node-id="users"] [data-source-evidence-beacon]'),
              invalidLinks: [...panel.querySelectorAll('a[href]')].some(a => /undefined|javascript:/.test(a.getAttribute('href'))),
              search: document.getElementById('node-finder-results').textContent
            };
          })()`, returnByValue: true,
        }, sessionId);
        assert.equal(response.exceptionDetails, undefined);
        const observed = response.result.value;
        assert.equal(observed.visible, true);
        assert.equal(observed.beacon, true);
        assert.equal(observed.invalidLinks, false);
        assert.deepEqual(observed.paths, ['src/router.js', 'src/store.js']);
        assert.match(observed.scope, /local Git/);
        assert.match(observed.search, /Users/);
        assert.equal(observed.links.length, local ? 0 : 2);
        assert.equal(observed.locations[0], local ? 'L1–3' : 'L1–3 ↗');
        assert.equal(observed.repositoryHref, local ? null : `${url}/tree/${data.revision}`);
      }
    }
  } finally { await browser.close(); }
});

test('repository evidence accepts canonical HTTPS and common SSH remotes', () => {
  const data = fixture();
  const output = path.join(data.root, 'remote-form.html');
  for (const remote of [
    'https://github.com/example/evidence-repo.git/',
    'https://x-access-token:not-a-real-token@github.com/example/evidence-repo.git',
    'https://oauth2:not-a-real-token@github.com/example/evidence-repo',
    'git@github.com:example/evidence-repo.git',
    'ssh://git@github.com/example/evidence-repo.git',
  ]) {
    git(data.root, 'remote', 'set-url', 'origin', remote);
    const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, `${remote}: ${result.stderr || result.stdout}`);
  }
});

async function waitForState(url, predicate, timeoutMs = 12000) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < timeoutMs) {
    latest = await (await fetch(new URL('/state', url))).json();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(`preview did not settle; latest state: ${JSON.stringify(latest)}`);
}

test('repository evidence is revision-verified, receipt-backed, searchable, and export-clean', () => {
  const data = fixture();
  const output = path.join(data.root, 'verified.html');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.evidence, {
    verified: true,
    repository: 'https://github.com/example/evidence-repo',
    revision: data.revision,
    references: 2,
  });

  const html = fs.readFileSync(output, 'utf8');
  const evidence = evidencePayload(html);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.shortRevision, data.revision.slice(0, 7));
  assert.equal(evidence.nodes.users.length, 2);
  assert.equal(evidence.nodes.users[0].href, `https://github.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-L3`);
  assert.match(html, /Verified source/);
  assert.match(html, /Archify\.sourceEvidence = \(function \(\)/);
  assert.match(html, /var sourceSearch = sources\.map/);
  assert.match(html, /renderSourceEvidence\(id\)/);
  assert.match(html, /referrerPolicy = 'no-referrer'/);
  assert.match(html, /classList\.add\('source-evidence-beacon'\)/);
  assert.match(html, /text\.textContent = viewerText\('viewer\.passport\.sourceMarker'\) \+ ' ' \+ count/);
  assert.match(html, /Archify\.sourceEvidence\.installBeacons\(\)/);
  assert.match(html, /querySelectorAll\('\[data-source-evidence-beacon\]'\)/);
  assert.match(html, /data-source-evidence-original-label/);

  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /src\/router\.js|github\.com\/example\/evidence-repo|source-evidence/);
});

test('repository evidence is opt-in and never appears in ordinary artifacts', () => {
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-no-evidence-')), 'plain.html');
  const input = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const result = run(['render', 'architecture', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(html, /id="archify-source-evidence-data"/);
  assert.match(html, /id="focus-evidence" hidden/);
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.doesNotMatch(svg, /source-evidence-beacon|data-source-evidence-count/);
});


test('origin-mismatch diagnostics redact HTTPS remote userinfo', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  git(data.root, 'remote', 'set-url', 'origin', 'https://user:not-a-real-token@github.com/example/other-repo.git');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /not-a-real-token/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /not-a-real-token/);
  assert.match(diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@github\.com\/example\/other-repo\.git$/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('origin-mismatch diagnostics redact HTTP remote userinfo', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');
  git(data.root, 'remote', 'set-url', 'origin', 'http://user:FAKE_SECRET@github.com/example/other');
  const result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /FAKE_SECRET/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /FAKE_SECRET/);
  assert.match(diagnostic.evidence.localOrigin, /^http:\/\/REDACTED@github\.com\/example\/other$/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('validate accepts credentialed HTTPS remotes and redacts mismatch diagnostics', () => {
  const data = fixture();
  git(data.root, 'remote', 'set-url', 'origin', 'https://x-access-token:not-a-real-token@github.com/example/evidence-repo.git');
  let result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);

  git(data.root, 'remote', 'set-url', 'origin', 'https://user:VALIDATE_SECRET@github.com/example/other-repo.git');
  result = run(['validate', 'architecture', data.input, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/origin-mismatch');
  assert.ok(diagnostic, 'expected origin-mismatch diagnostic');
  assert.doesNotMatch(receipt.error, /VALIDATE_SECRET/);
  assert.doesNotMatch(JSON.stringify(receipt.diagnostics), /VALIDATE_SECRET/);
  assert.doesNotMatch(result.stderr, /VALIDATE_SECRET/);
  assert.match(diagnostic.evidence.localOrigin, /^https:\/\/REDACTED@github\.com\/example\/other-repo\.git$/);
});

test('preview accepts credentialed HTTPS remotes and redacts mismatch diagnostics', { timeout: 20000 }, async () => {
  const data = fixture();
  const output = path.join(data.root, 'preview-credential.html');
  git(data.root, 'remote', 'set-url', 'origin', 'https://oauth2:not-a-real-token@github.com/example/evidence-repo');
  const matched = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(matched.url, (candidate) => candidate.status === 'verified');
    assert.equal(state.revision, 1);
    const html = await (await fetch(new URL('/artifact.html', matched.url))).text();
    assert.equal(evidencePayload(html).repository.revision, data.revision);
  } finally {
    await matched.stop();
  }

  git(data.root, 'remote', 'set-url', 'origin', 'https://user:PREVIEW_SECRET@github.com/example/other-repo.git');
  const mismatched = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(mismatched.url, (candidate) => candidate.status === 'needs-fix');
    assert.equal(state.failure?.stage, 'render');
    assert.match(state.failure?.message || '', /repository-evidence\/origin-mismatch/);
    assert.doesNotMatch(JSON.stringify(state), /PREVIEW_SECRET/);
  } finally {
    await mismatched.stop();
  }
});

test('evidence fails closed without a root, on wrong origin, missing blobs, or impossible lines', () => {
  const data = fixture();
  const output = path.join(data.root, 'must-stay.html');
  fs.writeFileSync(output, 'trusted previous artifact');

  let result = run(['deliver', 'architecture', data.input, output, '--json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'render');
  assert.match(JSON.parse(result.stdout).error, /Pass --repo-root/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');

  git(data.root, 'remote', 'set-url', 'origin', 'https://github.com/example/other-repo.git');
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /does not match/);
  git(data.root, 'remote', 'set-url', 'origin', 'git@github.com:example/evidence-repo.git');

  data.diagram.components[0].sources = [{ path: '../outside.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /must stay inside the repository/);

  data.diagram.components[0].sources = [{ path: 'src/router.js\n' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /repo-relative POSIX path/);

  data.diagram.components[0].sources = [{ path: 'src/missing.js' }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /does not identify a file/);

  data.diagram.components[0].sources = [{ path: 'src/router.js', line: 99 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /requests line 99/);

  data.diagram.components[0].sources = [{ path: 'src/router.js', line: 4 }];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['deliver', 'architecture', data.input, output, '--repo-root', data.root, '--json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /has 3 lines/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
});

test('--repo-root reaches every typed renderer and schema limits evidence shape', () => {
  const data = fixture();
  const workflowOutput = path.join(data.root, 'workflow.html');
  let result = run(['render', 'workflow', path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'), workflowOutput, '--repo-root', data.root]);
  assert.equal(result.status, 0, result.stderr);

  data.diagram.components[0].sources = [
    { path: 'src/router.js' },
    { path: 'src/router.js' },
    { path: 'src/router.js' },
    { path: 'src/router.js' },
  ];
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  result = run(['validate', 'architecture', data.input, '--repo-root', data.root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must NOT have more than 3 items/);
});

test('live preview forwards repo-root and publishes only verified evidence', { timeout: 20000 }, async () => {
  const data = fixture();
  const output = path.join(data.root, 'preview.html');
  const preview = await startPreview({
    type: 'architecture',
    input: data.input,
    output,
    repoRoot: data.root,
    open: false,
    debounceMs: 30,
    pollMs: 60,
  });
  try {
    const state = await waitForState(preview.url, (candidate) => candidate.status === 'verified');
    assert.equal(state.revision, 1);
    const html = await (await fetch(new URL('/artifact.html', preview.url))).text();
    assert.equal(evidencePayload(html).repository.revision, data.revision);
  } finally {
    await preview.stop();
  }
});
