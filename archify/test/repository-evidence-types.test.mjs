import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../bin/preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

// One table for the whole file: every diagram type names its node array
// differently, and repository evidence must behave identically across all of
// them. `first` is the first authored node id, which is where the fixtures
// attach sources and where the verified payload must key them.
const TYPES = [
  { type: 'architecture', collection: 'components', example: 'web-app.architecture.json', first: 'users' },
  { type: 'workflow', collection: 'nodes', example: 'agent-tool-call.workflow.json', first: 'user' },
  { type: 'sequence', collection: 'participants', example: 'cache-miss-request.sequence.json', first: 'user' },
  { type: 'dataflow', collection: 'nodes', example: 'product-analytics.dataflow.json', first: 'web' },
  { type: 'lifecycle', collection: 'states', example: 'agent-run.lifecycle.json', first: 'queued' },
];

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8' });
}

function evidencePayload(html) {
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'verified evidence payload missing');
  return JSON.parse(match[1]);
}

// A throwaway origin-matched checkout plus the typed diagram that points at it.
function fixture({ type, collection, example, first }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-types-'));
  fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'router.js'), 'export function route(input) {\n  return input.kind;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'store.js'), 'export const store = new Map();\n');
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'git@github.com:example/evidence-repo.git');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  const revision = git(root, 'rev-parse', 'HEAD');

  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  diagram.meta.repository = { url: 'https://github.com/example/evidence-repo', revision };
  const node = diagram[collection].find((candidate) => candidate.id === first);
  assert.ok(node, `${type} example is missing node ${JSON.stringify(first)}`);
  node.sources = [
    { path: 'src/router.js', line: 1, end_line: 3, label: 'Request router' },
    { path: 'src/store.js', line: 1 },
  ];
  const input = path.join(root, `diagram.${type}.json`);
  const write = () => fs.writeFileSync(input, JSON.stringify(diagram, null, 2));
  write();
  return { root, revision, diagram, node, input, write };
}

for (const shape of TYPES) {
  const { type, collection, first } = shape;

  test(`${type} repository evidence is revision-verified, receipt-backed, and keyed by node id`, () => {
    const data = fixture(shape);
    const output = path.join(data.root, `verified.${type}.html`);
    const result = run(['deliver', type, data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.deepEqual(JSON.parse(result.stdout).evidence, {
      verified: true,
      repository: 'https://github.com/example/evidence-repo',
      revision: data.revision,
      references: 2,
    });

    const html = fs.readFileSync(output, 'utf8');
    const evidence = evidencePayload(html);
    assert.equal(evidence.verified, true);
    assert.equal(evidence.referenceCount, 2);
    assert.equal(evidence.repository.shortRevision, data.revision.slice(0, 7));
    assert.deepEqual(Object.keys(evidence.nodes), [first]);
    assert.equal(evidence.nodes[first].length, 2);
    assert.equal(
      evidence.nodes[first][0].href,
      `https://github.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-L3`,
    );
    assert.equal(evidence.nodes[first][0].label, 'Request router');

    // The verified node must exist in the artifact under the same id, or the
    // viewer's beacon pass has nothing to attach the SRC affordance to.
    assert.match(html, new RegExp(`data-node-id="${first}"`));
    assert.match(html, /Archify\.sourceEvidence\.installBeacons\(\)/);

    const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
    assert.doesNotMatch(svg, /src\/router\.js|github\.com\/example\/evidence-repo|source-evidence/);
  });

  test(`${type} repository evidence applies every architecture verification`, () => {
    const data = fixture(shape);
    const output = path.join(data.root, `must-stay.${type}.html`);
    fs.writeFileSync(output, 'trusted previous artifact');
    const deliver = (...args) => run(['deliver', type, data.input, output, ...args, '--json']);

    // No --repo-root at all.
    let result = deliver();
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /Pass --repo-root/);

    // Not the Git top-level directory.
    result = deliver('--repo-root', path.join(data.root, 'src'));
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /must be the Git top-level directory/);

    // Origin does not match the authored repository.
    git(data.root, 'remote', 'set-url', 'origin', 'https://github.com/example/other-repo.git');
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /does not match/);
    git(data.root, 'remote', 'set-url', 'origin', 'git@github.com:example/evidence-repo.git');

    // Commit does not exist locally.
    const pinned = data.diagram.meta.repository.revision;
    data.diagram.meta.repository.revision = '0'.repeat(40);
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /is not available in the local repository/);
    data.diagram.meta.repository.revision = pinned;

    // Path escape.
    data.node.sources = [{ path: '../outside.js' }];
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /must stay inside the repository/);

    // Non-POSIX / control-character path.
    data.node.sources = [{ path: 'src/router.js\n' }];
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /repo-relative POSIX path/);

    // Blob does not exist at the pinned revision.
    data.node.sources = [{ path: 'src/missing.js' }];
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /does not identify a file/);

    // Line range beyond the pinned blob.
    data.node.sources = [{ path: 'src/router.js', line: 4 }];
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /has 3 lines/);

    // Inverted line range.
    data.node.sources = [{ path: 'src/router.js', line: 3, end_line: 2 }];
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /must be greater than or equal to line/);

    // end_line without line.
    data.node.sources = [{ path: 'src/router.js', end_line: 2 }];
    data.write();
    result = deliver('--repo-root', data.root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /requires line/);

    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted previous artifact');
  });

  test(`${type} repository evidence honors Gitee links and local-only mode`, () => {
    const data = fixture(shape);
    const output = path.join(data.root, `provider.${type}.html`);

    data.diagram.meta.repository = { url: 'https://gitee.com/example/evidence-repo', revision: data.revision, provider: 'gitee' };
    data.write();
    git(data.root, 'remote', 'set-url', 'origin', 'git@gitee.com:example/evidence-repo.git');
    let result = run(['deliver', type, data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.repository.href, `https://gitee.com/example/evidence-repo/tree/${data.revision}`);
    assert.equal(evidence.nodes[first][0].href, `https://gitee.com/example/evidence-repo/blob/${data.revision}/src/router.js#L1-3`);

    data.diagram.meta.repository.provider = 'github';
    data.write();
    result = run(['validate', type, data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).diagnostics.some((entry) => entry.code === 'repository-evidence/provider-invalid'));

    data.diagram.meta.repository = { url: 'http://git.internal:3000/Platform/evidence-repo', revision: data.revision, link_mode: 'local-only' };
    data.write();
    git(data.root, 'remote', 'set-url', 'origin', 'http://git.internal:3000/Platform/evidence-repo');
    result = run(['deliver', type, data.input, output, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).evidence.linkMode, 'local-only');
    evidence = evidencePayload(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.repository.linkMode, 'local-only');
    assert.equal(evidence.repository.href, undefined);
    assert.equal(evidence.nodes[first].length, 2);
    assert.ok(evidence.nodes[first].every((source) => !Object.hasOwn(source, 'href')));
  });

  test(`${type} evidence diagnostics point at its own node collection`, () => {
    const data = fixture(shape);
    data.node.sources = [{ path: 'src/missing.js' }];
    data.write();
    const result = run(['validate', type, data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    const diagnostic = receipt.diagnostics.find((entry) => entry.code === 'repository-evidence/file-missing');
    assert.ok(diagnostic, JSON.stringify(receipt.diagnostics));
    assert.match(diagnostic.subject.path, new RegExp(`^/${collection}/\\d+/sources/0/path$`));
    assert.equal(diagnostic.subject.nodeId, first);
    assert.equal(diagnostic.evidence.sourcePath, 'src/missing.js');
    assert.ok(diagnostic.supportedFixes.length);
  });

  test(`${type} sources stay bounded by the shared schema shape`, () => {
    const data = fixture(shape);
    data.node.sources = [
      { path: 'src/router.js' },
      { path: 'src/router.js' },
      { path: 'src/router.js' },
      { path: 'src/router.js' },
    ];
    data.write();
    let result = run(['validate', type, data.input, '--repo-root', data.root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must NOT have more than 3 items/);

    data.node.sources = [{ path: 'src/router.js', branch: 'main' }];
    data.write();
    result = run(['validate', type, data.input, '--repo-root', data.root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must NOT have additional properties/);
  });

  test(`${type} node sources require pinned repository metadata`, () => {
    const data = fixture(shape);
    delete data.diagram.meta.repository;
    data.write();
    const result = run(['validate', type, data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(
      (entry) => entry.code === 'repository-evidence/repository-required',
    ));
  });

  test(`${type} repository metadata requires at least one verified source`, () => {
    const data = fixture(shape);
    delete data.node.sources;
    data.write();
    const result = run(['validate', type, data.input, '--repo-root', data.root, '--json']);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).diagnostics.some(
      (entry) => entry.code === 'repository-evidence/source-required',
    ));
  });
}

// The issue's own reproduction: --repo-root must be accepted by every typed
// command, including for a diagram that carries no evidence at all.
test('--repo-root is accepted for every diagram type', () => {
  for (const { type, example } of TYPES) {
    const result = run(['validate', type, path.join(skillRoot, 'examples', example), '--repo-root', '.']);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
  }
});

test('repository evidence no longer rejects any supported diagram type', () => {
  const rejected = run(['validate', 'lifecycle', path.join(skillRoot, 'examples', 'agent-run.lifecycle.json'), '--repo-root', '.']);
  assert.equal(rejected.status, 0, rejected.stderr);
  assert.doesNotMatch(rejected.stderr, /architecture diagrams only/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(skillRoot, 'renderers', 'shared', 'repository-evidence.mjs'), 'utf8'),
    /type-unsupported/,
    'the type-unsupported diagnostic is unreachable and must be removed deliberately',
  );
});

test('ordinary typed artifacts still carry no repository evidence', () => {
  for (const { type, example } of TYPES) {
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-no-evidence-types-')), `${type}.html`);
    const result = run(['render', type, path.join(skillRoot, 'examples', example), output]);
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(output, 'utf8');
    assert.doesNotMatch(html, /id="archify-source-evidence-data"/);
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

test('live preview publishes verified evidence for a non-architecture type', { timeout: 20000 }, async () => {
  const shape = TYPES.find(({ type }) => type === 'lifecycle');
  const data = fixture(shape);
  const output = path.join(data.root, 'preview.lifecycle.html');
  const preview = await startPreview({
    type: shape.type,
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
    const evidence = evidencePayload(html);
    assert.equal(evidence.repository.revision, data.revision);
    assert.equal(evidence.nodes[shape.first].length, 2);
  } finally {
    await preview.stop();
  }
});
