import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { cli, skillRoot } from './helpers/repository-evidence-fixture.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { softwareNotices } from '../archify/renderers/shared/software-notices.mjs';
import { loadViewerStyles } from '../archify/renderers/shared/svg-bake.mjs';
import { alignPayloadLines } from '../archify/pr/lens-runtime.mjs';
import { compileLensScene } from '../archify/pr/lens-scene.mjs';
import { findRiskVerdict } from '../archify/pr/markdown.mjs';

const example = path.join(skillRoot, 'examples', 'checkout-ledger.pr-pack.json');
const run = (args, options = {}) => spawnSync(process.execPath, [cli, 'pr', ...args], {
  cwd: skillRoot, encoding: 'utf8', ...options,
});
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readModel = (html) => JSON.parse(html.match(/<script id="lens-data" type="application\/json">([^<]*)<\/script>/)[1]);

function manifestFixture() {
  const directory = createScratchDirectory(path.join(os.tmpdir(), 'archify-pr-lens-test-'));
  const manifest = read(example);
  for (const view of manifest.views) fs.copyFileSync(path.join(path.dirname(example), view.input), path.join(directory, view.input));
  const file = path.join(directory, 'manifest.json');
  const output = path.join(directory, 'review');
  const save = () => fs.writeFileSync(file, JSON.stringify(manifest));
  const lens = (...args) => {
    save();
    return run(['lens', file, '--out-dir', output, ...args]);
  };
  return { directory, manifest, file, output, save, lens };
}

test('legacy checkout-ledger produces one deterministic offline review file and exact hashes', () => {
  const { output } = manifestFixture();
  const command = ['lens', example, '--out-dir', output];
  const result = run([...command, '--json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.kind, 'pr-lens-result');
  const file = path.join(output, 'pr-lens.html');
  assert.deepEqual(fs.readdirSync(output), ['pr-lens.html']);
  const html = fs.readFileSync(file, 'utf8');
  assert.deepEqual(receipt.output, { path: file, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') });
  assert.deepEqual(receipt.revisions, { baseSha: null, headSha: null, verified: false });
  assert.equal(receipt.verifiedHunkCount, 0);
  const model = readModel(html);
  assert.deepEqual(model.views.map((view) => view.id), ['schema', 'topology', 'flow']);
  assert.deepEqual(model.steps.map((step) => step.id), ['schema', 'topology', 'flow']);
  assert.equal(model.steps.flatMap((step) => step.changes).length, 6);
  assert.ok(model.counts.every((count) => count.origin === 'Declared'));
  assert.match(model.unavailable, /matching checkout required/);
  assert.ok(model.steps[2].payloads.some(({ payload }) => Object.hasOwn(payload, 'before')));
  assert.ok(model.steps[2].payloads.some(({ payload }) => Object.hasOwn(payload, 'sample')));
  assert.equal(model.notices, softwareNotices);
  assert.equal(html.split(loadViewerStyles().fontCss).length, 2);
  assert.equal(html.split(JSON.stringify(softwareNotices).slice(0, 40)).length, 2);
  assert.doesNotMatch(html, /\sstyle=|\.style\./);
  assert.equal(findRiskVerdict(html), null);
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for (const directive of ["default-src 'none'", "script-src-attr 'none'", "style-src-attr 'none'", "connect-src 'none'"]) {
    assert.ok(policy.split('; ').includes(directive));
  }
  for (const match of html.matchAll(/<(style|script)>([\s\S]*?)<\/\1>/g)) {
    const digest = createHash('sha256').update(match[2]).digest('base64');
    assert.match(policy, new RegExp(`(?:^|; )${match[1]}-src [^;]*${digest.replace(/[+]/g, '\\$&')}`));
  }
  const human = run(command);
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stdout.trim(), file);
  assert.equal(fs.readFileSync(file, 'utf8'), html);
});

test('walkthrough validates explicit view-local references and round-trips authored JSON', () => {
  const { manifest, file, save, lens } = manifestFixture();
  const special = '</ScRiPt><img src=x> & " \u2028\u2029';
  manifest.pullRequest = { number: 42, author: 'A. Reviewer', facts: ['Recorded from the PR'] };
  const step = { id: 'response', title: special, viewId: 'flow', edgeIds: ['create'], primarySliceId: 'route', payload: { before: null, after: { [special]: special } } };
  manifest.walkthrough = { steps: [step], slices: [{ id: 'route', path: 'src/routes.js', side: 'head' }] };
  const result = lens('--json');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(JSON.parse(result.stdout).output.path, 'utf8');
  const [modelStep] = readModel(html).steps;
  assert.deepEqual(modelStep.payloads[0].payload, step.payload);
  assert.equal(modelStep.title, special);
  assert.equal(modelStep.focus.length, 1);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /\\u003c\/ScRiPt\\u003e.*\\u2028\\u2029/);
  assert.equal(run(['validate', file, '--json']).status, 0);

  const validateFailure = (pointer) => {
    save();
    const invalid = run(['validate', file, '--json']);
    assert.equal(invalid.status, 1, invalid.stderr);
    const diagnostic = JSON.parse(invalid.stdout).diagnostics[0];
    assert.match(diagnostic.subject.path, new RegExp(`^${pointer.replaceAll('/', '\\/')}(?:$| )`));
  };
  step.edgeIds = ['not-authored'];
  validateFailure('/walkthrough/steps/0/edgeIds/0');
  step.edgeIds = ['create'];
  step.relatedSliceIds = ['route'];
  validateFailure('/walkthrough/steps/0/relatedSliceIds/0');
  delete step.relatedSliceIds;
  manifest.walkthrough.steps.push({ ...step });
  validateFailure('/walkthrough/steps/1/id');
  manifest.walkthrough.steps.pop();
  manifest.walkthrough.slices.push({ ...manifest.walkthrough.slices[0] });
  validateFailure('/walkthrough/slices/1/id');
  manifest.walkthrough.slices.pop();
  Object.assign(manifest.walkthrough.slices[0], { line: 1, hunk: 1 });
  validateFailure('/walkthrough/slices/0');
});

test('validates Lens-only walkthroughs and keeps walkthrough failure envelopes verdict-free', () => {
  const { directory, manifest, output, file, save } = manifestFixture();
  for (const view of manifest.views) view.storyOnly = true;
  manifest.walkthrough = { steps: [{ id: 'one', title: 'Inspect exchange', viewId: 'flow' }] };
  save();
  assert.equal(run(['validate', file, '--json']).status, 0);
  assert.equal(run(['lens', file, '--out-dir', output, '--json']).status, 0);
  const pack = run(['build', file, '--out-dir', output, '--json']);
  assert.equal(pack.status, 1);
  assert.equal(JSON.parse(pack.stdout).diagnostics[0].code, 'pr-pack/no-visible-output');
  manifest.walkthrough.steps[0].viewId = 'missing';
  const verdictPath = path.join(directory, 'SAFE.json');
  fs.writeFileSync(verdictPath, JSON.stringify(manifest));
  for (const command of ['validate', 'lens']) {
    const result = run([command, verdictPath, '--json', ...(command === 'lens' ? ['--out-dir', output] : [])]);
    assert.equal(result.status, 1);
    assert.equal(findRiskVerdict(result.stdout + result.stderr), null);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].subject.path, '/walkthrough/steps/0/viewId');
  }
});

test('refresh publishes with one replacement and refuses symlinks and directories', () => {
  const { directory, file, output, manifest, lens } = manifestFixture();
  const target = path.join(output, 'pr-lens.html');
  const raceHook = path.join(directory, 'race.mjs');
  fs.writeFileSync(raceHook, `
    import fs from 'node:fs';
    import path from 'node:path';
    for (const name of ['linkSync', 'renameSync']) {
      const original = fs[name];
      fs[name] = (from, to) => {
        if (path.basename(to) === 'pr-lens.html') fs.writeFileSync(to, 'Concurrent output', { flag: 'wx' });
        original(from, to);
      };
    }
  `);
  fs.writeFileSync(file, JSON.stringify(manifest));
  const race = spawnSync(process.execPath, ['--import', raceHook, cli, 'pr', 'lens', file, '--out-dir', output, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(race.status, 1, race.stdout + race.stderr);
  assert.equal(JSON.parse(race.stdout).diagnostics[0].code, 'pr-lens/publication-failed');
  assert.equal(fs.readFileSync(target, 'utf8'), 'Concurrent output');
  assert.deepEqual(fs.readdirSync(output), ['pr-lens.html']);
  fs.unlinkSync(target);
  const initial = lens('--json');
  assert.equal(initial.status, 0, initial.stdout + initial.stderr);
  const previous = fs.readFileSync(target);
  const pack = path.join(output, 'pr-pack.md');
  fs.writeFileSync(pack, 'Existing pack');
  const hook = path.join(directory, 'replace.mjs');
  fs.writeFileSync(hook, `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === path.join(fs.realpathSync(${JSON.stringify(output)}), 'pr-lens.html')) {
        assert.match(fs.readFileSync(to, 'utf8'), /Checkout/);
        assert.match(fs.readFileSync(from, 'utf8'), /Revised title/);
        process.stderr.write('Both files readable at replacement\\n');
        if (process.env.ARCHIFY_TEST_FAIL_REPLACE) throw new Error('Interrupted replacement');
      }
      original(from, to);
    };
  `);
  manifest.title = 'Revised title';
  fs.writeFileSync(file, JSON.stringify(manifest));
  const replace = (fail) => spawnSync(process.execPath, ['--import', hook, cli, 'pr', 'lens', file, '--out-dir', output, '--json'], {
    encoding: 'utf8', env: { ...process.env, ...(fail ? { ARCHIFY_TEST_FAIL_REPLACE: '1' } : {}) },
  });
  const failure = replace(true);
  assert.equal(failure.status, 1, failure.stdout + failure.stderr);
  assert.match(failure.stderr, /Both files readable at replacement/);
  assert.deepEqual(fs.readFileSync(target), previous);
  assert.deepEqual(fs.readdirSync(output).sort(), ['pr-lens.html', 'pr-pack.md']);
  const refresh = replace(false);
  assert.equal(refresh.status, 0, refresh.stdout + refresh.stderr);
  assert.match(refresh.stderr, /Both files readable at replacement/);
  assert.match(fs.readFileSync(target, 'utf8'), /Revised title/);

  fs.unlinkSync(target);
  fs.mkdirSync(target);
  assert.equal(JSON.parse(lens('--json').stdout).diagnostics[0].code, 'pr-lens/publication-failed');
  fs.rmdirSync(target);
  if (process.platform !== 'win32') {
    fs.symlinkSync(pack, target);
    const bad = lens('--json');
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).diagnostics[0].code, 'pr-lens/publication-failed');
    assert.equal(fs.readlinkSync(target), pack);
    assert.equal(fs.readFileSync(pack, 'utf8'), 'Existing pack');
  }
});

test('payload alignment accepts exactly one million allocated cells', () => {
  const lines = (count) => Array(count).fill('same');
  const exact = alignPayloadLines(lines(999), lines(999));
  assert.equal(exact.length, 999);
  assert.ok(exact.every(([before, after]) => before === 'same' && after === before));
  assert.equal(alignPayloadLines(lines(999), lines(1000)), null);
  assert.equal(alignPayloadLines(lines(1000), lines(1000)), null);
});

test('rejects verdict-bearing data and failures without replacing an existing review file', () => {
  const { directory, manifest, file, output, lens } = manifestFixture();
  const temp = path.join(directory, 'tmp');
  fs.mkdirSync(temp);
  const env = { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp };
  const initial = lens('--json');
  assert.equal(initial.status, 0, initial.stdout + initial.stderr);
  const target = path.join(output, 'pr-lens.html');
  const previous = fs.readFileSync(target);
  const cases = [
    () => { manifest.pullRequest = { facts: ['low_risk'] }; },
    () => { manifest.walkthrough = { steps: [{ id: 'one', title: 'Message change', viewId: 'flow', payload: { after: { 'no-impact': 1 } } }] }; },
    () => { manifest.walkthrough.steps[0].payload = { after: { label: 'vErIfIeD_pr' } }; },
    () => { delete manifest.walkthrough; manifest.views[0].caption = 'MERGEABLE'; },
  ];
  const caption = manifest.views[0].caption;
  for (const [i, edit] of cases.entries()) {
    delete manifest.pullRequest;
    manifest.views[0].caption = caption;
    edit();
    const result = lens('--json');
    assert.equal(result.status, 1, `case ${i}`);
    assert.equal(findRiskVerdict(result.stdout + result.stderr), null);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'pr-pack/risk-verdict');
  }
  manifest.views[0].caption = caption;
  const badView = path.join(directory, manifest.views[0].input);
  const diagram = read(badView);
  diagram.entities[0].label = 'SAFE';
  fs.writeFileSync(badView, JSON.stringify(diagram));
  let result = lens();
  assert.equal(result.status, 1);
  assert.equal(findRiskVerdict(result.stderr), null);
  // Geometry error occurs after the owned render directory has been created.
  diagram.entities[0].label = 'An entity';
  diagram.entities[1].id = diagram.entities[0].id;
  fs.writeFileSync(badView, JSON.stringify(diagram));
  result = run(['lens', file, '--out-dir', output, '--json'], { env });
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readdirSync(temp), []);
  assert.deepEqual(fs.readFileSync(target), previous);
  assert.deepEqual(fs.readdirSync(output), ['pr-lens.html']);
});

test('lens CLI rejects publishing flags and its result cannot be used as a build receipt', () => {
  const { directory, lens } = manifestFixture();
  for (const flag of ['--platform=gitlab', '--no-html', '--animate-flow', '--manifest=x', '--target=body', '--quality=other', '--SAFE']) {
    const rejected = lens(flag, '--json');
    assert.equal(rejected.status, 2, rejected.stdout + rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).stage, 'arguments');
    assert.equal(findRiskVerdict(rejected.stdout + rejected.stderr), null);
  }
  const result = lens('--json');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = path.join(directory, 'lens-result.json');
  fs.writeFileSync(receipt, result.stdout);
  const attach = run(['attach', '42', '--manifest', receipt, '--repo', 'acme/checkout', '--dry-run', '--json']);
  assert.equal(attach.status, 1, attach.stdout + attach.stderr);
  assert.match(attach.stdout, /receipt/);
});

test('Lens renders native scenes for all ten types, including separate tabs for the same type', () => {
  const { directory, manifest, lens } = manifestFixture();
  const fixtures = {
    architecture: 'checkout-ledger', sequence: 'checkout-ledger', erd: 'checkout-ledger',
    class: 'payment-processors', workflow: 'agent-tool-call', dataflow: 'event-stream',
    lifecycle: 'deployment-release', tree: 'payment-platform', timeline: 'payment-incident', waterfall: 'checkout-request',
  };
  manifest.views = Object.entries(fixtures).map(([type, name]) => {
    const input = `${name}.${type}.json`;
    fs.copyFileSync(path.join(skillRoot, 'examples', input), path.join(directory, input));
    return { id: type, type, title: name, input };
  });
  const sequencePath = path.join(directory, manifest.views.find(({ type }) => type === 'sequence').input);
  const sequence = read(sequencePath);
  const unnamed = sequence.messages.find((edge) => edge.label && edge.payload);
  delete unnamed.id;
  fs.writeFileSync(sequencePath, JSON.stringify(sequence));
  manifest.views.push({ ...manifest.views[0], id: 'alternate', storyOnly: true, preset: 'blueprint' });
  delete manifest.changes;
  const result = lens('--json');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(JSON.parse(result.stdout).output.path, 'utf8');
  const model = readModel(html);
  assert.deepEqual(model.views.map((view) => view.type), [...Object.keys(fixtures), 'architecture']);
  assert.ok(model.views.every((view) => view.nodes.length > 0));
  assert.ok(model.steps.find(({ id }) => id === 'sequence').payloads.some(({ label }) => label === unnamed.label));
  assert.equal(model.views.at(-1).storyOnly, true);
  assert.equal(html.match(/<template id="scene-/g).length, 11);
  const scenes = [...html.matchAll(/<template id="scene-\d+">([\s\S]*?)<\/template>/g)].map(([, scene]) => scene);
  assert.match(scenes[0], /<svg [^>]+data-node-ui/);
  assert.match(scenes[4], /<svg [^>]+data-node-ui/);
  assert.match(scenes[10], /<svg [^>]+data-preset="blueprint"/);
  assert.match(scenes[3], /data-class-kind="abstract"/);
  assert.match(scenes[7], /data-tree-depth="0"/);
  assert.equal([...scenes[7].matchAll(/<rect data-tree-stack=""/g)].length, 4);
  assert.match(html, /\[data-tree-stack\] \{ display: none;/);
  assert.match(html, /\[data-tree-depth="0"\] \.tree-label \{ fill: var\(--mask\)/);
  assert.match(scenes[8], /data-timeline-lane="response"/);
  assert.equal([...scenes[8].matchAll(/data-lens-participant="deploy"/g)].length, 3);
  assert.match(html, /\[data-preset="classic"\][^{]+\{ rx: 10px;/);
  assert.match(scenes[6], /data-graph-role="automatic-crossover-underlay"[^>]+data-lens-decoration="e\d+" aria-hidden="true"/);
});

test('companion forwards the Lens command and status to the core CLI', () => {
  const { output } = manifestFixture();
  const wrapper = path.resolve(skillRoot, '../archify-pr/bin/archify-pr.mjs');
  const runWrapper = (...args) => spawnSync(process.execPath, [wrapper, 'pr', 'lens', example, ...args], {
    env: { ...process.env, ARCHIFY_BIN: cli }, encoding: 'utf8',
  });
  const result = runWrapper('--out-dir', output, '--json');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).output.path, path.join(output, 'pr-lens.html'));
  assert.equal(runWrapper('--no-html').status, 2);
});


test('scene boundary refuses active SVG and unresolved or external resources', () => {
  const view = { type: 'architecture', preset: 'classic' };
  const compile = (body) => compileLensScene(
    `<div class="diagram-container"><svg viewBox="0 0 100 100">${body}</svg></div>`,
    {}, view, loadViewerStyles(), 0,
  );
  for (const markup of [
    '<script>alert(1)</script>',
    '<foreignObject><div>x</div></foreignObject>',
    '<rect onmouseover="alert(1)"/>',
    '<use href="#missing"/>',
    '<image href="https://example.test/image.png"/>',
    '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    ...['png', 'jpeg', 'gif', 'webp', 'x-icon'].map((type) => `<image href="data:image/${type};base64,PHN2Zy8+"/>`),
    '<rect style="fill:url(https://example.test/paint)"/>',
    '<a href="javascript:alert(1)"><text>Link</text></a>',
  ]) assert.throws(() => compile(markup), (error) => error.code === 'pr-lens/invalid-scene', markup);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3sAAAAASUVORK5CYII=';
  const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const passive = compile(`<style>.native { fill: red; background-image: url(https://example.test/); position: fixed; --unknown: red; }</style>
    <defs><marker id="tip"/></defs>
    <a href="sibling.html"><path style="stroke-width:2; padding:999px" marker-end="url(#tip)"/></a>
    <image href="data:image/png;base64,${png}"/><image href="data:image/gif;base64,${gif}"/>`);
  assert.doesNotMatch(passive.svg, /<a |style=|sibling.html/);
  assert.match(passive.svg, /class="lens-paint-0"/);
  assert.match(passive.css, /stroke-width: 2;/);
  assert.match(passive.css, /\.native \{ fill: red; \}/);
  assert.doesNotMatch(passive.css, /background-image|position: fixed|--unknown|padding: 999px/);
  assert.match(passive.svg, /data:image\/png;base64,/);
  assert.match(passive.svg, /data:image\/gif;base64,/);
  assert.throws(() => compile(`<image href="data:image/gif;base64,${png}"/>`), { code: 'pr-lens/invalid-scene' });
});
