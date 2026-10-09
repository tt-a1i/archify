import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  authoredControls,
  benchmarkDocument,
  contentLost,
  finalizeStatus,
  renderedSvgFingerprint,
} from '../.agents/skills/archify-tuning/scripts/lib.mjs';

test('tuning: content lost names the elements and relationships a final candidate dropped', () => {
  const first = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'invalid' }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { from: 'b', to: 'invalid', label: 'rejects' }],
  };
  const final = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'ab', from: 'a', to: 'b' }] };
  assert.deepEqual(contentLost('workflow', first, final), {
    elements: ['invalid'],
    relations: ['b>invalid>rejects'],
    containers: [],
    membershipChanges: [],
    firstCounts: [3, 2],
    finalCounts: [2, 1],
  });
  assert.equal(contentLost('workflow', first, null), null);
});

test('tuning: authored controls separate fully automatic drafts from pinned ones', () => {
  assert.deepEqual(authoredControls('workflow', { edges: [{ from: 'a', to: 'b', route: 'auto' }] }), {});
  assert.deepEqual(authoredControls('dataflow', {
    flows: [{ from: 'a', to: 'b', fromSide: 'right', via: [[1, 2]] }, { from: 'b', to: 'c', labelDy: 4 }],
  }), { fromSide: 1, via: 1, labelDy: 1 });
});

test('tuning: benchmark drafts drop repository evidence and keep their layout', () => {
  const draft = {
    meta: { title: 'T', output: '.archify/x/y.html', repository: { url: 'https://example.com/private.git' } },
    nodes: [{ id: 'a', col: 1, sources: [{ path: 'src/a.ts' }] }],
  };
  assert.deepEqual(benchmarkDocument(draft, 'r01-demo'), {
    meta: { title: 'T', output: 'r01-demo.html' },
    nodes: [{ id: 'a', col: 1 }],
  });
  assert.ok(draft.meta.repository, 'the source document is not modified');
});

test('tuning: finalize status reads gate results rather than the exit code of a pipe', () => {
  assert.equal(finalizeStatus('fail {"validate":"fail","deliver":"not-run"} ... Exit code: 0'), 'fail');
  assert.equal(finalizeStatus('{"schemaVersion":1,"ok":false,"status":"fail"} Exit code: 1'), 'fail');
  assert.equal(finalizeStatus('pass {"validate":"pass","deliver":"pass","check":"pass","browser-check":"pass"} Exit code: 0'), 'pass');
  assert.equal(finalizeStatus('{"ok":true,"status":"pass"}'), 'pass');
  assert.equal(finalizeStatus('Usage: archify finalize ... Exit code: 2'), 'fail');
  assert.equal(finalizeStatus('done Exit code: 0'), 'unknown');
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(repoRoot, '.agents/skills/archify-tuning/scripts');
const temporary = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-tuning-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const run = (script, args, env = {}) => spawnSync(process.execPath, [path.join(scripts, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('tuning: lane merges, group membership loss and parent deletion cannot report complete retention', () => {
  const first = { lanes: [{ id: 'client' }, { id: 'server' }], groups: [{ id: 'auth', lane: 'server', fromCol: 0, toCol: 1 }], nodes: [{ id: 'a', lane: 'client', col: 0 }, { id: 'b', lane: 'server', col: 1 }], edges: [] };
  const merged = { ...first, lanes: [{ id: 'client' }], groups: [], nodes: first.nodes.map((node) => ({ ...node, lane: 'client' })) };
  const lost = contentLost('workflow', first, merged);
  assert.deepEqual(lost.elements, []);
  assert.deepEqual(lost.containers, ['lane:server', 'group:auth']);
  const regrouped = { ...first, nodes: first.nodes.map((node) => node.id === 'b' ? { ...node, col: 2 } : node) };
  assert.deepEqual(contentLost('workflow', first, regrouped).membershipChanges, [{ container: 'group:auth', element: 'b' }]);
  for (const type of ['tree', 'waterfall']) {
    const key = type === 'tree' ? 'nodes' : 'spans';
    assert.deepEqual(contentLost(type, { [key]: [{ id: 'a' }, { id: 'b', parent: 'a' }] }, { [key]: [{ id: 'a' }, { id: 'b' }] }).relations, ['a>b>']);
  }
});

test('tuning: a stable relationship ID cannot conceal endpoint or label loss', () => {
  const first = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ id: 'call', from: 'a', to: 'b', label: 'rejects invalid' }] };
  for (const edit of [{ to: 'c' }, { label: 'accepts' }]) assert.deepEqual(contentLost('workflow', first, { ...first, edges: [{ ...first.edges[0], ...edit }] }).relations, ['call']);
});

test('tuning: boundary, stage and domain membership losses remain visible', () => {
  assert.deepEqual(contentLost('architecture', { components: [{ id: 'a' }], boundaries: [{ kind: 'region', label: 'Private', wraps: ['a'] }] }, { components: [{ id: 'a' }], boundaries: [{ kind: 'region', label: 'Private', wraps: [] }] }).membershipChanges, [{ container: 'boundary:region:Private', element: 'a' }]);
  assert.deepEqual(contentLost('dataflow', { stages: [{ label: 'In' }, { label: 'Out' }], nodes: [{ id: 'a', stage: 0 }] }, { stages: [{ label: 'In' }, { label: 'Out' }], nodes: [{ id: 'a', stage: 1 }] }).membershipChanges, [{ container: 'stage:In', element: 'a' }]);
  assert.deepEqual(contentLost('erd', { entities: [{ id: 'orders', tag: 'Sales' }] }, { entities: [{ id: 'orders', tag: 'Accounts' }] }).containers, ['domain:Sales']);
});

test('tuning: label, frame, node, legend and stylesheet changes request visual comparison', () => {
  const original = fs.readFileSync(path.join(repoRoot, 'archify/examples/web-app-rendered.html'), 'utf8');
  const replacements = [
    ['AWS Region: us-west-2', 'AWS Region: ap-east-1'],
    ['data-legend-width="87"', 'data-legend-width="187"'],
    ['font-size="10"', 'font-size="11"'],
    ['class="c-backend"', 'class="c-database"'],
  ];
  for (const [before, after] of replacements) {
    assert.ok(original.includes(before), before);
    assert.notEqual(renderedSvgFingerprint(original.replaceAll(before, after)), renderedSvgFingerprint(original), before);
  }
  const svg = '<svg role="img" viewBox="0 0 20 20"><rect x="1" y="2" width="3" height="4"/><text x="3">Test</text></svg>';
  assert.notEqual(renderedSvgFingerprint(svg), renderedSvgFingerprint(svg.replace('width="3"', 'width="5"')));
  assert.notEqual(renderedSvgFingerprint(svg), renderedSvgFingerprint(svg.replace('x="1"', 'x="9"')));
  assert.equal(renderedSvgFingerprint(svg), renderedSvgFingerprint(svg.replace('><', '>\n  <')));
  assert.notEqual(renderedSvgFingerprint(`<style>.c-backend{fill:red}</style>${svg}`), renderedSvgFingerprint(`<style>.c-backend{fill:blue}</style>${svg}`));
});

test('tuning: failed Chrome reruns discard stale screenshots and report failure', (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'shots'));
  for (const side of ['base', 'head']) {
    fs.mkdirSync(path.join(root, side, 'tree'), { recursive: true });
    fs.writeFileSync(path.join(root, side, 'tree/demo.html'), '<html>new content</html>');
    fs.writeFileSync(path.join(root, 'shots', `tree-demo-${side}.png`), 'stale image');
  }
  fs.writeFileSync(path.join(root, 'replay.json'), JSON.stringify({ results: [{ type: 'tree', name: 'demo', note: 'changed', base: { ok: true }, head: { ok: true } }] }));
  // Node is an executable, but rejects Chrome flags: deterministic browser startup failure.
  const result = run('shots.mjs', [root], { ARCHIFY_CHROME: process.execPath });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /0 screenshots captured; 2 capture failures/);
  assert.ok(!fs.existsSync(path.join(root, 'shots/tree-demo-head.png')));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'shots/index.html'), 'utf8'), /<img/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'shots/capture.json'), 'utf8')).captures.map(({ status }) => status), ['fail', 'fail']);
});

test('tuning: neutral trace exports collect first drafts and repairs without a host database', (t) => {
  const root = temporary(t);
  const round = path.join(root, 'round');
  const candidate = path.join(round, 'workflow/.archify/demo/candidate.json');
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  const first = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'ab', from: 'a', to: 'b' }] };
  const final = { nodes: [{ id: 'a' }], edges: [] };
  fs.writeFileSync(candidate, JSON.stringify(final));
  const trace = path.join(root, 'trace.json');
  const messages = [
    { role: 'user', content: `Generate in ${round}/workflow` },
    { role: 'assistant', content: '', tool_calls: [{ id: 'write-1', name: 'write', arguments: { file_path: candidate, content: JSON.stringify(first) } }] },
    { role: 'tool', content: 'written', tool_call_id: 'write-1' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'exec-1', name: 'exec', arguments: { command: `node /archify/bin/archify.mjs finalize workflow ${candidate} output.html --json` } }] },
    { role: 'tool', content: '{"ok":false,"status":"fail","diagnostics":[{"code":"composition/proper-crossing"}]}', tool_call_id: 'exec-1' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'exec-2', name: 'exec', arguments: { command: `node /archify/bin/archify.mjs finalize workflow ${candidate} output.html --json` } }] },
    { role: 'tool', content: '{"ok":true,"status":"pass"}', tool_call_id: 'exec-2' },
  ];
  fs.writeFileSync(trace, JSON.stringify({ schemaVersion: 1, sessions: [{ id: 'portable-1', messages }] }));
  const result = run('collect.mjs', [round, '--trace-export', trace, '--no-bench', '--dump'], { ARCHIFY_TUNING_HOME: root });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(round, 'tuning-summary.json'), 'utf8')).workflow;
  assert.equal(summary.tools, 3);
  assert.equal(summary.finalizeRuns, 2);
  assert.equal(summary.finalizeFailures, 1);
  assert.equal(summary.firstFinalize, 'fail');
  assert.equal(summary.routingMode, 'automatic-routes');
  assert.deepEqual(summary.lost.elements, ['b']);
  assert.deepEqual(summary.lost.relations, ['ab']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(round, 'workflow/first-draft.json'), 'utf8')), first);
  assert.match(fs.readFileSync(path.join(round, 'workflow.trace.txt'), 'utf8'), /composition\/proper-crossing/);
  messages[2].tool_call_id = 'missing-call';
  fs.writeFileSync(trace, JSON.stringify({ schemaVersion: 1, sessions: [{ id: 'broken', messages }] }));
  const bad = run('collect.mjs', [round, '--trace-export', trace, '--no-bench'], { ARCHIFY_TUNING_HOME: root });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /reference one earlier tool call/);
});

test('tuning: replay pins revisions and benchmark bytes and flags node-only visual changes', (t) => {
  const root = temporary(t);
  const bench = path.join(root, 'bench');
  fs.mkdirSync(path.join(bench, 'tree'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'tree/demo.json'), JSON.stringify({ meta: {} }));
  for (const [side, x] of [['base', 1], ['head', 5]]) {
    const tree = path.join(root, side);
    fs.mkdirSync(path.join(tree, 'bin'), { recursive: true });
    const html = `<svg role="img" viewBox="0 0 20 20"><rect x="${x}" y="1" width="4" height="4"/></svg>`;
    fs.writeFileSync(path.join(tree, 'bin/archify.mjs'), `import fs from 'node:fs'; fs.writeFileSync(process.argv[5], ${JSON.stringify(html)});`);
    execFileSync('git', ['init', '-q', tree]);
    execFileSync('git', ['-C', tree, 'add', '.']);
    execFileSync('git', ['-C', tree, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  }
  const out = path.join(root, 'out');
  const result = run('replay.mjs', ['--base', path.join(root, 'base'), '--head', path.join(root, 'head'), '--bench', bench, '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'replay.json'), 'utf8'));
  assert.equal(receipt.results[0].note, 'changed');
  assert.match(receipt.provenance.base.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(receipt.provenance.head.dirty, []);
  assert.match(receipt.provenance.benchmark.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.provenance.benchmark.inventory[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(result.stdout, /render pass rate.*browser gate not run/);
});

test('tuning: fresh real-browser captures publish PNGs and record fixed comparison conditions', { skip: !process.env.ARCHIFY_CHROME ? 'Set ARCHIFY_CHROME for real screenshot capture' : false }, (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'head/tree'), { recursive: true });
  fs.writeFileSync(path.join(root, 'head/tree/demo.html'), '<!doctype html><html data-theme="light"><body><svg role="img" viewBox="0 0 100 100"><text x="10" y="30">Fresh</text></svg></body></html>');
  fs.writeFileSync(path.join(root, 'replay.json'), JSON.stringify({ results: [{ type: 'tree', name: 'demo', note: 'FIXED', base: { ok: false }, head: { ok: true } }] }));
  const result = run('shots.mjs', [root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 screenshots captured; 0 capture failures/);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'shots/capture.json'), 'utf8'));
  assert.deepEqual(receipt.captures.map(({ status }) => status), ['not-rendered', 'pass']);
  assert.equal(receipt.theme, 'light');
  assert.equal(receipt.captures[1].resolvedTheme, 'light');
  const captured = fs.readFileSync(path.join(root, 'shots/tree-demo-head.png'));
  assert.deepEqual(captured.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(captured.readUInt32BE(16), receipt.viewport.width);
  assert.equal(captured.readUInt32BE(20), receipt.viewport.height);
  assert.ok(!fs.readdirSync(path.join(root, 'shots')).some(name => name.startsWith('.pending-')));
});

test('tuning: portable exports match native separators and quoted finalize paths with spaces', (t) => {
  const root = temporary(t);
  for (const nativeSeparators of [false, true]) {
    const round = path.join(root, nativeSeparators ? 'Windows round' : 'POSIX round');
    const candidate = path.join(round, 'workflow/.archify/diagram with spaces/candidate.json');
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    const draft = { nodes: [{ id: 'a' }], edges: [] };
    fs.writeFileSync(candidate, JSON.stringify(draft));
    const spelling = (file) => nativeSeparators ? file.replaceAll('/', '\\') : file.replaceAll('\\', '/');
    const cli = nativeSeparators ? 'C:\\Program Files\\Archify\\bin\\archify.mjs' : '/Applications/Archify Skill/bin/archify.mjs';
    const command = (quote) => `node ${quote}${cli}${quote} finalize workflow ${quote}${spelling(candidate)}${quote} output.html --json`;
    const messages = [
      { role: 'user', content: `Create a diagram in ${spelling(path.join(round, 'workflow'))}` },
      { role: 'assistant', content: '', tool_calls: [{ id: 'read', name: 'read', arguments: { file_path: spelling('/skills/archify/references/authoring-defaults.md') } }, { id: 'write', name: 'write', arguments: { file_path: spelling(candidate), content: JSON.stringify(draft) } }] },
      { role: 'tool', tool_call_id: 'read', content: 'reference' },
      { role: 'tool', tool_call_id: 'write', content: 'written' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'finalize-1', name: 'exec', arguments: { command: command('"') } }] },
      { role: 'tool', tool_call_id: 'finalize-1', content: '{"ok":false,"status":"fail"}' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'finalize-2', name: 'exec', arguments: { command: command("'") } }] },
      { role: 'tool', tool_call_id: 'finalize-2', content: '{"ok":true,"status":"pass"}' },
    ];
    const trace = path.join(round, 'trace.json');
    fs.writeFileSync(trace, JSON.stringify({ schemaVersion: 1, sessions: [{ id: 'portable-paths', messages }] }));
    const result = run('collect.mjs', [round, '--trace-export', trace, '--no-bench'], { ARCHIFY_TUNING_HOME: root });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(fs.readFileSync(path.join(round, 'tuning-summary.json'), 'utf8')).workflow;
    assert.equal(summary.finalizeRuns, 2, `${nativeSeparators ? 'native' : 'POSIX'} quoted command counting`);
    assert.equal(summary.finalizeFailures, 1);
    assert.equal(summary.firstFinalize, 'fail');
    assert.deepEqual(summary.docReads, ['references/authoring-defaults.md']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(round, 'workflow/first-draft.json'), 'utf8')), draft);
  }
});

test('tuning: collect accepts boolean flags before its round and consumes only value options', (t) => {
  const root = temporary(t);
  const round = path.join(root, 'round');
  const candidate = path.join(round, 'tree/.archify/demo/candidate.json');
  const draft = { nodes: [{ id: 'root', label: 'Root' }] };
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(candidate, JSON.stringify(draft));
  const trace = path.join(root, 'trace.json');
  fs.writeFileSync(trace, JSON.stringify({ schemaVersion: 1, sessions: [{ id: 'flag-first', messages: [
    { role: 'user', content: `Create in ${round}/tree` },
    { role: 'assistant', content: '', tool_calls: [{ id: 'write', name: 'write', arguments: { file_path: candidate, content: JSON.stringify(draft) } }] },
    { role: 'tool', tool_call_id: 'write', content: 'Written' },
  ] }] }));
  const invocations = [
    ['--dump', round, '--no-bench', '--trace-export', trace],
    ['--no-bench', round, '--dump', '--trace-export', trace],
    ['--trace-export', trace, '--round', 'custom-name', '--dump', round, '--no-bench'],
  ];
  for (const args of invocations) {
    const result = run('collect.mjs', args, { ARCHIFY_TUNING_HOME: root });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(round, 'tuning-summary.json'), 'utf8')).tree.tools, 1);
    assert.ok(fs.existsSync(path.join(round, 'tree.trace.txt')));
  }
});

test('tuning: replay records missing and incomplete SVG failures and continues its receipt', (t) => {
  const root = temporary(t);
  const bench = path.join(root, 'bench');
  fs.mkdirSync(path.join(bench, 'tree'), { recursive: true });
  for (const name of ['missing', 'incomplete', 'good']) fs.writeFileSync(path.join(bench, 'tree', `${name}.json`), JSON.stringify({ meta: {}, name }));
  for (const side of ['base', 'head']) {
    const tree = path.join(root, side);
    fs.mkdirSync(path.join(tree, 'bin'), { recursive: true });
    const renderer = `import fs from 'node:fs';\nconst document=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));\nconst good='<svg role="img" viewBox="0 0 20 20"><text x="1">Good</text></svg>';\nconst invalid=${JSON.stringify(side)}==='head'&&document.name!=='good';\nfs.writeFileSync(process.argv[5],invalid?(document.name==='missing'?'<html>No diagram</html>':'<svg role="img"><text>Partial</text>'):good);\n`;
    fs.writeFileSync(path.join(tree, 'bin/archify.mjs'), renderer);
  }
  const out = path.join(root, 'out');
  const result = run('replay.mjs', ['--base', path.join(root, 'base'), '--head', path.join(root, 'head'), '--bench', bench, '--out', out]);
  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(fs.readFileSync(path.join(out, 'replay.json'), 'utf8'));
  assert.equal(receipt.results.length, 3);
  for (const name of ['missing', 'incomplete']) {
    const item = receipt.results.find((item) => item.name === name);
    assert.equal(item.note, 'REGRESSED');
    assert.equal(item.head.ok, false);
    assert.equal(item.head.geometry, null);
    assert.equal(item.head.problems, 1);
    assert.ok(item.head.codes.includes('artifact/rendered-svg-invalid'));
    assert.match(item.head.first, /SVG.*(?:missing|incomplete)/);
  }
  assert.equal(receipt.results.find((item) => item.name === 'good').head.ok, true);
});
