import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertCamoSafeSvg } from '../archify/renderers/shared/svg-bake.mjs';
import { RISK_VERDICTS, fillAssets, findRiskVerdict, renderPackMarkdown, replacePackBlock, themedPicture } from '../archify/pr/markdown.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { cli, git, skillRoot } from './helpers/repository-evidence-fixture.mjs';
import { parseXml } from './helpers/xml.mjs';

const PICTURE_LINE = /^<a href="([^"]+)"><picture><source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)"><img alt="[^"]+" src="\1"><\/picture><\/a>$/;

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8', ...options });
}

function architecture(extra = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Checkout topology', output: 'out/topology.html', ...extra.meta },
    components: [
      { id: 'web', label: 'Web', type: 'frontend', pos: [40, 160], size: [120, 60], change: 'unchanged' },
      { id: 'api', label: 'Checkout API', type: 'backend', pos: [260, 160], size: [130, 60], change: 'modified', ...(extra.api || {}) },
      { id: 'ledger', label: 'Ledger', type: 'database', pos: [500, 60], size: [130, 60], change: 'added', ...(extra.ledger || {}) },
      { id: 'legacy', label: 'Legacy audit', type: 'external', pos: [500, 260], size: [130, 60], change: 'removed', ...(extra.legacy || {}) },
    ],
    connections: [
      { from: 'web', to: 'api', label: 'POST /checkout' },
      { from: 'api', to: 'ledger', label: 'append', change: 'added' },
      { from: 'api', to: 'legacy', label: 'audit', change: 'removed' },
    ],
  };
}

function sequence(extra = {}) {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Checkout flow', output: 'out/flow.html', ...extra.meta },
    participants: [
      { id: 'web', label: 'Web', type: 'frontend' },
      { id: 'api', label: 'API', type: 'backend', change: 'modified' },
    ],
    messages: [
      { id: 'm1', from: 'web', to: 'api', y: 160, label: 'POST /checkout', change: 'modified', payload: { contentType: 'application/json', before: { total: 10 }, after: { total: 10, ledger_ref: 'L-1' } } },
      { id: 'm2', from: 'api', to: 'web', y: 240, label: '201 Created' },
    ],
  };
}

function manifest(overrides = {}) {
  return {
    schema_version: 1,
    kind: 'pr-pack',
    title: 'Checkout ledger rollout',
    summary: 'Adds a ledger write to checkout and retires the legacy audit hop.',
    stats: { filesChanged: 3, additions: 40, deletions: 12 },
    views: [
      { id: 'topology', title: 'Service topology', caption: 'Ledger enters between API and the removed audit hop.', type: 'architecture', input: 'topology.json' },
      { id: 'flow', title: 'Checkout sequence', caption: 'POST /checkout gains ledger_ref.', type: 'sequence', input: 'flow.json', collapsed: true },
    ],
    changes: [
      { subject: 'ledger', kind: 'service', change: 'added', detail: 'append-only ledger', view: 'topology' },
      { subject: 'legacy audit', kind: 'service', change: 'removed', view: 'topology' },
      { subject: 'POST /checkout', kind: 'endpoint', change: 'modified', detail: 'adds ledger_ref', view: 'flow' },
    ],
    changeTableLimit: 2,
    ...overrides,
  };
}

function writePack(dir, { manifest: data = manifest(), topology = architecture(), flow = sequence() } = {}) {
  fs.writeFileSync(path.join(dir, 'topology.json'), JSON.stringify(topology, null, 2));
  fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify(flow, null, 2));
  const file = path.join(dir, 'pr-pack.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function scratch() {
  return createScratchDirectory(path.join(os.tmpdir(), 'archify-pr-pack-'));
}

test('pr build renders offline HTML, Camo-safe dual-theme SVGs, an anchored Markdown draft and a receipt', () => {
  const dir = scratch();
  const file = writePack(dir);
  const outDir = path.join(dir, 'out');
  const validate = run(['pr', 'validate', file, '--json']);
  assert.equal(validate.status, 0, validate.stderr);
  const validated = JSON.parse(validate.stdout);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.views.map((view) => view.id), ['topology', 'flow']);

  const build = run(['pr', 'build', file, '--out-dir', outDir, '--json']);
  assert.equal(build.status, 0, build.stderr);
  const receipt = JSON.parse(build.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.kind, 'pr-pack-receipt');
  assert.equal(receipt.platform, 'github');
  assert.equal(receipt.revisions.verified, false);
  assert.equal(fs.existsSync(path.join(outDir, 'pr-pack.receipt.json')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'pr-pack.receipt.json'), 'utf8')).assets, receipt.assets);
  assert.deepEqual(receipt.assets.map((asset) => asset.id), ['topology-light', 'topology-dark', 'flow-light', 'flow-dark']);
  for (const asset of receipt.assets) {
    const svg = fs.readFileSync(asset.path, 'utf8');
    parseXml(svg);
    const camo = assertCamoSafeSvg(svg, { assert: false });
    assert.equal(camo.ok, true, JSON.stringify(camo.problems));
    assert.equal(camo.bytes, asset.bytes);
    assert.match(svg, new RegExp(`data-theme="${asset.theme}"`));
    assert.doesNotMatch(svg, /archify-payloads-data|<script/);
    assert.equal(asset.placeholder, `{{archify:asset:${asset.id}}}`);
  }
  for (const view of receipt.views) {
    assert.equal(fs.existsSync(view.html), true);
    assert.equal(fs.existsSync(view.snapshot), true);
  }
  const flowHtml = fs.readFileSync(receipt.views[1].html, 'utf8');
  assert.match(flowHtml, /id="archify-payloads-data"/);
  assert.equal(receipt.views[1].payloads, true);
  assert.equal(receipt.views[0].payloads, false);

  const markdown = fs.readFileSync(receipt.markdown.path, 'utf8');
  const lines = markdown.split('\n');
  assert.equal(lines[0], '<!-- archify-pr-pack:start -->');
  assert.equal(lines.at(-2), '<!-- archify-pr-pack:end -->');
  const pictures = lines.filter((line) => line.startsWith('<a href='));
  assert.equal(pictures.length, 2);
  for (const line of pictures) assert.match(line, PICTURE_LINE);
  assert.match(pictures[0], /\{\{archify:asset:topology-light\}\}.*\{\{archify:asset:topology-dark\}\}/);
  assert.match(markdown, /<details><summary><b>Checkout sequence<\/b><\/summary>/);
  assert.match(markdown, /<code>filesChanged: 3<\/code> · <code>additions: 40<\/code>/);
  assert.match(markdown, /### Changes \(3\)/);
  assert.match(markdown, /<details><summary>More changes <kbd>\+1<\/kbd><\/summary>/);
  assert.equal((markdown.match(/white-space: nowrap/g) || []).length, 3 * 4);
  assert.equal(findRiskVerdict(markdown), null);
  for (const verdict of RISK_VERDICTS) assert.doesNotMatch(markdown, new RegExp(verdict, 'i'));
});

test('the bundled checkout-ledger example validates at showcase and builds a verdict-free GitHub pack', () => {
  const manifest = path.join(skillRoot, 'examples/checkout-ledger.pr-pack.json');
  const pack = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const view of pack.views) {
    const validated = run(['validate', view.type, path.join(skillRoot, 'examples', view.input), '--quality', 'showcase', '--json']);
    assert.equal(validated.status, 0, `${view.input}: ${validated.stdout}${validated.stderr}`);
  }
  const outDir = path.join(scratch(), 'out');
  const build = run(['pr', 'build', manifest, '--out-dir', outDir, '--json']);
  assert.equal(build.status, 0, build.stderr);
  const receipt = JSON.parse(build.stdout);
  assert.deepEqual(receipt.views.map((view) => [view.id, view.type, view.collapsed]), [['schema', 'erd', false], ['topology', 'architecture', false], ['flow', 'sequence', true]]);
  assert.equal(receipt.views.every((view) => view.preset === 'classic'), true, 'pack views unify to classic preset by default');
  const topologySnapshot = JSON.parse(fs.readFileSync(receipt.views.find((view) => view.id === 'topology').snapshot, 'utf8'));
  assert.equal(topologySnapshot.meta.visual_preset, 'classic');
  assert.equal(receipt.assets.length, 6);
  for (const asset of receipt.assets) {
    const svg = fs.readFileSync(asset.path, 'utf8');
    parseXml(svg);
    assert.equal(assertCamoSafeSvg(svg, { assert: false }).ok, true, asset.id);
    assert.match(svg, /data-change="removed"/);
    assert.doesNotMatch(svg, /<animate|<script/);
  }
  const markdown = fs.readFileSync(receipt.markdown.path, 'utf8');
  assert.equal(findRiskVerdict(markdown), null);
  assert.match(markdown, /<details>\s*<summary><b>Checkout request sequence<\/b><\/summary>/);
  assert.match(markdown, /<code>tablesRemoved: 1<\/code>/);
  assert.equal((markdown.match(/<picture>/g) || []).length, 3);
});

test('pr build honours --no-html, --platform gitlab single images, and --animate-flow only for flow types', () => {
  const dir = scratch();
  const file = writePack(dir);
  const outDir = path.join(dir, 'out');
  const build = run(['pr', 'build', file, '--out-dir', outDir, '--platform', 'gitlab', '--no-html', '--animate-flow', '--json']);
  assert.equal(build.status, 0, build.stderr);
  const receipt = JSON.parse(build.stdout);
  assert.equal(receipt.platform, 'gitlab');
  assert.deepEqual(receipt.assets.map((asset) => [asset.id, asset.animated]), [['topology-light', false], ['flow-light', true]]);
  for (const view of receipt.views) {
    assert.equal(view.html, null);
    assert.equal(fs.existsSync(path.join(outDir, 'views', `${view.id}.html`)), false);
  }
  const markdown = fs.readFileSync(receipt.markdown.path, 'utf8');
  assert.doesNotMatch(markdown, /<picture>/);
  assert.match(markdown, /^!\[Service topology \(architecture diagram\)\]\(\{\{archify:asset:topology-light\}\}\)$/m);
});

test('pr build fails closed on schema errors, unknown change views, risk verdicts and argument mistakes', () => {
  const dir = scratch();
  const outDir = path.join(dir, 'out');
  const broken = writePack(dir, { manifest: manifest({ views: [{ id: 'topology', title: 'x', type: 'architecture', input: 'topology.json' }], changes: [{ subject: 'a', change: 'added', view: 'missing' }] }) });
  const unknownView = run(['pr', 'build', broken, '--out-dir', outDir, '--json']);
  assert.equal(unknownView.status, 1);
  assert.equal(JSON.parse(unknownView.stdout).diagnostics[0].code, 'pr-pack/unknown-change-view');
  assert.equal(fs.existsSync(outDir), false);

  const verdict = writePack(dir, { manifest: manifest({ summary: 'This change is SAFE and mergeable.' }) });
  const verdictResult = run(['pr', 'build', verdict, '--out-dir', outDir, '--json']);
  assert.equal(verdictResult.status, 1);
  const verdictReceipt = JSON.parse(verdictResult.stdout);
  assert.equal(verdictReceipt.diagnostics[0].code, 'pr-pack/risk-verdict');
  assert.equal(verdictReceipt.diagnostics[0].evidence.verdict, 'SAFE');
  assert.equal(fs.existsSync(path.join(outDir, 'pr-pack.md')), false);

  const badDiagram = writePack(dir, { topology: { ...architecture(), components: [{ id: 'x', label: 'no type' }] } });
  const schema = run(['pr', 'build', badDiagram, '--out-dir', outDir, '--json']);
  assert.equal(schema.status, 1);
  const schemaReceipt = JSON.parse(schema.stdout);
  assert.equal(schemaReceipt.stage, 'views');
  assert.equal(schemaReceipt.diagnostics[0].subject.view, 'topology');

  const badManifest = writePack(dir, { manifest: { ...manifest(), kind: 'nope' } });
  const manifestResult = run(['pr', 'validate', badManifest, '--json']);
  assert.equal(manifestResult.status, 1);
  assert.equal(JSON.parse(manifestResult.stdout).stage, 'manifest');

  const file = writePack(dir);
  const noOut = run(['pr', 'build', file, '--json']);
  assert.equal(noOut.status, 2);
  assert.equal(JSON.parse(noOut.stdout).diagnostics[0].code, 'cli/missing-option-value');
  const badPlatform = run(['pr', 'build', file, '--out-dir', outDir, '--platform', 'bitbucket', '--json']);
  assert.equal(badPlatform.status, 2);
  assert.equal(JSON.parse(badPlatform.stdout).diagnostics[0].code, 'cli/unsupported-option');
  const unknownOption = run(['pr', 'build', file, '--out-dir', outDir, '--bogus', '--json']);
  assert.equal(unknownOption.status, 2);
  const badSubcommand = run(['pr', 'publish', '--json']);
  assert.equal(badSubcommand.status, 2);
  assert.equal(JSON.parse(badSubcommand.stdout).diagnostics[0].code, 'cli/invalid-arguments');
  const noManifest = run(['pr', 'attach', '42', '--json']);
  assert.equal(noManifest.status, 2);
  assert.equal(JSON.parse(noManifest.stdout).diagnostics[0].subject.option, '--manifest');
});

test('pr attach --dry-run through the CLI uses the injected gh binary and reports the plan', () => {
  const dir = scratch();
  const file = writePack(dir);
  const outDir = path.join(dir, 'out');
  assert.equal(run(['pr', 'build', file, '--out-dir', outDir]).status, 0);
  const fakeGh = path.join(dir, 'gh');
  fs.writeFileSync(fakeGh, [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  "--version ") echo "gh version 2.99.0 (2026-01-01)";;',
    '  "auth status") echo "Logged in";;',
    '  "pr view") echo \'{"number":42,"url":"https://github.com/acme/checkout/pull/42","body":"hand written","comments":[]}\';;',
    '  *) echo "unexpected $*" >&2; exit 1;;',
    'esac',
  ].join('\n'));
  fs.chmodSync(fakeGh, 0o755);
  const result = run(['pr', 'attach', '42', '--repo', 'acme/checkout', '--manifest', path.join(outDir, 'pr-pack.receipt.json'), '--dry-run', '--json'], { env: { ...process.env, ARCHIFY_GH: fakeGh } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.dryRun, true);
  assert.equal(receipt.attachments.length, 4);
  assert.match(receipt.markdown.preview, /<user-attachments:flow-dark>/);
  const text = run(['pr', 'attach', 'https://github.com/acme/checkout/pull/42', '--manifest', path.join(outDir, 'pr-pack.receipt.json'), '--dry-run'], { env: { ...process.env, ARCHIFY_GH: fakeGh } });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /\(dry-run\).*pull\/42 target=body/);
  const missingGh = run(['pr', 'attach', '42', '--repo', 'acme/checkout', '--manifest', path.join(outDir, 'pr-pack.receipt.json'), '--dry-run', '--json'], { env: { ...process.env, ARCHIFY_GH: path.join(dir, 'missing-gh') } });
  assert.equal(missingGh.status, 1);
  assert.equal(JSON.parse(missingGh.stdout).diagnostics[0].code, 'pr-attach/gh-unavailable');
});

function changeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pr-repo-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'api.mjs'), 'export function checkout() {\n  return audit();\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'legacy.mjs'), 'export function audit() {\n  return true;\n}\n');
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/checkout.git');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '-b', 'feat/ledger');
  fs.rmSync(path.join(root, 'src', 'legacy.mjs'));
  fs.writeFileSync(path.join(root, 'src', 'ledger.mjs'), 'export function append(entry) {\n  return entry;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'api.mjs'), 'export function checkout() {\n  return append();\n}\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'ledger');
  const headSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(root, 'README.md'), 'moved on\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'main moves on');
  const mainTip = git(root, 'rev-parse', 'HEAD');
  return { root, baseSha, headSha, mainTip };
}

function evidenceTopology(headSha, overrides = {}) {
  return architecture({
    meta: { repository: { url: 'https://github.com/acme/checkout', revision: headSha } },
    api: { sources: [{ path: 'src/api.mjs', line: 1, end_line: 3 }] },
    ledger: { sources: [{ path: 'src/ledger.mjs', line: 1 }] },
    legacy: { sources: [{ path: 'src/legacy.mjs', line: 1, end_line: 3 }], ...overrides.legacy },
  });
}

test('pr build with --repo-root verifies the three-dot merge-base and checks removed ghosts at the base revision', (t) => {
  const repo = changeRepository();
  t.after(() => fs.rmSync(repo.root, { recursive: true, force: true }));
  const dir = scratch();
  const outDir = path.join(dir, 'out');
  const file = writePack(dir, {
    manifest: manifest({ repository: 'acme/checkout', baseRef: 'main', headRef: 'feat/ledger' }),
    topology: evidenceTopology(repo.headSha),
  });
  const build = run(['pr', 'build', file, '--out-dir', outDir, '--repo-root', repo.root, '--json']);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const receipt = JSON.parse(build.stdout);
  assert.deepEqual(receipt.revisions, { repoRoot: fs.realpathSync(repo.root) === repo.root ? repo.root : path.resolve(repo.root), baseSha: repo.baseSha, headSha: repo.headSha, mergeBase: repo.baseSha, verified: true });
  assert.notEqual(receipt.revisions.baseSha, repo.mainTip);
  assert.deepEqual(receipt.views[0].evidence, { declared: true, verified: true });
  const snapshot = JSON.parse(fs.readFileSync(receipt.views[0].snapshot, 'utf8'));
  assert.equal(snapshot.meta.repository.base_revision, repo.baseSha);
  const html = fs.readFileSync(receipt.views[0].html, 'utf8');
  const evidence = JSON.parse(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.repository.baseRevision, repo.baseSha);
  assert.equal(evidence.nodes.legacy[0].revision, repo.baseSha);
  assert.match(evidence.nodes.legacy[0].href, new RegExp(`/blob/${repo.baseSha}/src/legacy.mjs`));
  assert.equal(evidence.nodes.ledger[0].revision, undefined);
  assert.match(evidence.nodes.ledger[0].href, new RegExp(`/blob/${repo.headSha}/src/ledger.mjs`));
  const markdown = fs.readFileSync(receipt.markdown.path, 'utf8');
  assert.match(markdown, new RegExp(`<code>main...feat/ledger</code> · <code>${repo.baseSha.slice(0, 7)}</code> → <code>${repo.headSha.slice(0, 7)}</code>`));

  // A removed node whose citation is checked at head would be a lie: the file is gone.
  const notRemoved = writePack(dir, {
    manifest: manifest({ baseRef: 'main', headRef: 'feat/ledger' }),
    topology: evidenceTopology(repo.headSha, { legacy: { change: 'modified' } }),
  });
  const headCheck = run(['pr', 'build', notRemoved, '--out-dir', path.join(dir, 'out2'), '--repo-root', repo.root, '--json']);
  assert.equal(headCheck.status, 1);
  const headReceipt = JSON.parse(headCheck.stdout);
  assert.equal(headReceipt.diagnostics[0].code, 'repository-evidence/file-missing');
  assert.equal(headReceipt.diagnostics[0].subject.view, 'topology');

  // Two-dot substitution: declaring the main tip as the base is rejected.
  const twoDot = writePack(dir, {
    manifest: manifest({ baseRef: 'main', headRef: 'feat/ledger', baseSha: repo.mainTip }),
    topology: evidenceTopology(repo.headSha),
  });
  const twoDotResult = run(['pr', 'validate', twoDot, '--repo-root', repo.root, '--json']);
  assert.equal(twoDotResult.status, 1);
  const twoDotReceipt = JSON.parse(twoDotResult.stdout);
  assert.equal(twoDotReceipt.stage, 'revisions');
  assert.equal(twoDotReceipt.diagnostics[0].code, 'pr-pack/base-sha-not-merge-base');
  assert.equal(twoDotReceipt.diagnostics[0].evidence.mergeBase, repo.baseSha);

  // SHA-only manifests still need base to be the merge-base of head.
  const shaOnly = writePack(dir, { manifest: manifest({ baseSha: repo.baseSha, headSha: repo.headSha }), topology: evidenceTopology(repo.headSha) });
  const shaOnlyResult = run(['pr', 'validate', shaOnly, '--repo-root', repo.root, '--json']);
  assert.equal(shaOnlyResult.status, 0, shaOnlyResult.stdout);
  const reversed = writePack(dir, { manifest: manifest({ baseSha: repo.headSha, headSha: repo.baseSha }), topology: evidenceTopology(repo.baseSha) });
  const reversedResult = run(['pr', 'validate', reversed, '--repo-root', repo.root, '--json']);
  assert.equal(JSON.parse(reversedResult.stdout).diagnostics[0].code, 'pr-pack/base-sha-not-merge-base');

  // A view pinned at a different revision than the pack head is a mismatch.
  const stale = writePack(dir, { manifest: manifest({ baseRef: 'main', headRef: 'feat/ledger' }), topology: evidenceTopology(repo.baseSha) });
  const staleResult = run(['pr', 'validate', stale, '--repo-root', repo.root, '--json']);
  assert.equal(JSON.parse(staleResult.stdout).diagnostics[0].code, 'pr-pack/view-revision-mismatch');

  // Without --repo-root, declared evidence is never silently skipped.
  const unverified = run(['pr', 'build', file, '--out-dir', path.join(dir, 'out3'), '--json']);
  assert.equal(unverified.status, 1);
  assert.equal(JSON.parse(unverified.stdout).diagnostics[0].code, 'repository-evidence/root-required');
});

test('markdown helpers keep the picture on one line, replace only the anchored block and refuse verdicts', () => {
  const picture = themedPicture({ light: 'https://l/x.svg', dark: 'https://d/x.svg', alt: 'Topology "quoted"\nnext' });
  assert.match(picture, PICTURE_LINE);
  assert.doesNotMatch(picture, /\n/);
  assert.match(picture, /alt="Topology &quot;quoted&quot; next"/);

  const body = 'Hand-written intro.\n\n- [x] checklist\n\n<!-- archify-pr-pack:start -->\nold block\n<!-- archify-pr-pack:end -->\n\nReview replies stay.\n';
  const replaced = replacePackBlock(body, '<!-- archify-pr-pack:start -->\nnew block\n<!-- archify-pr-pack:end -->');
  assert.equal(replaced, 'Hand-written intro.\n\n- [x] checklist\n\n<!-- archify-pr-pack:start -->\nnew block\n<!-- archify-pr-pack:end -->\n\nReview replies stay.\n');
  assert.equal(replacePackBlock(replaced, '<!-- archify-pr-pack:start -->\nthird\n<!-- archify-pr-pack:end -->').split('archify-pr-pack:start').length, 2);
  assert.equal(replacePackBlock('Plain description', 'BLOCK'), 'Plain description\n\nBLOCK\n');
  assert.equal(replacePackBlock('', 'BLOCK'), 'BLOCK\n');

  const filled = fillAssets('x {{archify:asset:a-light}} y {{archify:asset:a-dark}}', { 'a-light': 'https://github.com/user-attachments/assets/1' });
  assert.equal(filled.markdown, 'x https://github.com/user-attachments/assets/1 y {{archify:asset:a-dark}}');
  assert.deepEqual(filled.missing, ['a-dark']);

  assert.equal(findRiskVerdict('No impact on billing'), 'NO IMPACT');
  assert.equal(findRiskVerdict('low-risk refactor'), 'LOW RISK');
  assert.equal(findRiskVerdict('verified_pr'), 'VERIFIED PR');
  assert.equal(findRiskVerdict('failsafe retry and unsafe-inline are words'), null);
  const pack = { manifest: { title: 'T', changes: [] }, platform: 'github', views: [{ id: 'v', title: 'V', type: 'erd', theme: 'both', collapsed: false, caption: 'all MERGEABLE' }], changeTableLimit: 20 };
  assert.throws(() => renderPackMarkdown(pack, {}), /MERGEABLE/);
});

test('pr build unifies pack views under manifest.preset unless an individual view overrides it', () => {
  const dir = scratch();
  const outDir = path.join(dir, 'out');
  const file = writePack(dir, {
    manifest: manifest({
      preset: 'editorial',
      views: [
        { id: 'topology', title: 'Service topology', type: 'architecture', input: 'topology.json' },
        { id: 'flow', title: 'Checkout sequence', type: 'sequence', input: 'flow.json', preset: 'blueprint' },
      ],
    }),
    topology: architecture({ meta: { visual_preset: 'signal-flow' } }),
    flow: sequence({ meta: { visual_preset: 'classic' } }),
  });
  const build = run(['pr', 'build', file, '--out-dir', outDir, '--json']);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const receipt = JSON.parse(build.stdout);
  const topologyView = receipt.views.find((view) => view.id === 'topology');
  const flowView = receipt.views.find((view) => view.id === 'flow');
  assert.equal(topologyView.preset, 'editorial');
  assert.equal(flowView.preset, 'blueprint');
  assert.equal(JSON.parse(fs.readFileSync(topologyView.snapshot, 'utf8')).meta.visual_preset, 'editorial');
  assert.equal(JSON.parse(fs.readFileSync(flowView.snapshot, 'utf8')).meta.visual_preset, 'blueprint');
  assert.match(fs.readFileSync(topologyView.svgs.light, 'utf8'), /data-preset="editorial"/);
  assert.match(fs.readFileSync(flowView.svgs.light, 'utf8'), /data-preset="blueprint"/);
});
