import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { captureAtomicOutput } from '../archify/renderers/shared/atomic-output.mjs';
import { fromStoryBriefToChoreography, normalizeChoreographySpec } from '../archify/story/choreography-plan.mjs';
import { writeStoryOutput } from '../archify/story/output.mjs';
import { compileStoryStillSvg, compileStorySvg, createCompiledStoryTheme } from '../archify/story/story-svg.mjs';
import { assertCamoSafeSvg, bakeSvg, extractCanonicalSvg, loadViewerStyles } from '../archify/story/svg-bake.mjs';
import { git } from './helpers/repository-evidence-fixture.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { parseXml } from './helpers/xml.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function run(args, cwd = skillRoot, extraEnv = {}, nodeArgs = []) {
  return spawnSync(process.execPath, [...nodeArgs, cli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1', ...extraEnv },
  });
}

function scratch() {
  return createScratchDirectory(path.join(os.tmpdir(), 'archify-story-choreo-test-'));
}

function multiViewFixtures(dir) {
  const archV1 = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Gateway Overview', output: 'arch1.html' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 120], size: [120, 60] },
      { id: 'gateway', type: 'backend', label: 'Gateway', sublabel: 'v1 direct', pos: [260, 120], size: [150, 60] },
    ],
    connections: [
      { id: 'c_req', from: 'client', to: 'gateway', label: 'POST /jobs' },
    ],
  };

  const seqV2 = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Async Worker Flow', output: 'seq2.html' },
    participants: [
      { id: 'gateway', label: 'Gateway', type: 'backend' },
      { id: 'queue', label: 'Job Queue', type: 'messagebus' },
      { id: 'worker', label: 'Worker', type: 'backend' },
    ],
    messages: [
      { id: 'm_pub', from: 'gateway', to: 'queue', y: 170, label: 'enqueue()' },
      { id: 'm_run', from: 'queue', to: 'worker', y: 250, label: 'consume()' },
    ],
  };

  const erdV3 = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Job Schema', output: 'erd3.html' },
    entities: [
      {
        id: 'jobs',
        label: 'jobs',
        row: 0,
        col: 0,
        attributes: [
          { name: 'id', type: 'uuid', key: 'pk' },
          { name: 'status', type: 'text' },
        ],
      },
      {
        id: 'workers',
        label: 'workers',
        row: 0,
        col: 1,
        attributes: [
          { name: 'id', type: 'uuid', key: 'pk' },
          { name: 'job_id', type: 'uuid', key: 'fk', references: 'jobs.id' },
        ],
      },
    ],
    relationships: [
      { id: 'job_worker', from: 'jobs', to: 'workers', fromCardinality: 'one', toCardinality: 'many', label: 'claims' },
    ],
  };

  fs.writeFileSync(path.join(dir, 'arch1.json'), JSON.stringify(archV1, null, 2));
  fs.writeFileSync(path.join(dir, 'seq2.json'), JSON.stringify(seqV2, null, 2));
  fs.writeFileSync(path.join(dir, 'erd3.json'), JSON.stringify(erdV3, null, 2));
  fs.writeFileSync(path.join(dir, 'gateway.mjs'), [
    'export async function enqueueJob(payload) {',
    '  const job = await queue.push(payload);',
    '  return { accepted: job.id };',
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'jobs.sql'), [
    'CREATE TABLE jobs (',
    '  id uuid PRIMARY KEY,',
    '  status text NOT NULL DEFAULT \'queued\'',
    ');',
  ].join('\n'));
}

test('standalone multi-view component choreography validates, compiles dual-theme SVGs, static stills, and interactive MP4/WebM stage HTML', () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const choreoPath = path.join(dir, 'choreography.json');
  fs.writeFileSync(choreoPath, JSON.stringify({
    schema_version: 1,
    kind: 'story-choreography',
    id: 'job-pipeline',
    title: 'Gateway to Worker Component Walkthrough',
    caption: 'Standalone ARC component demonstration across architecture, sequence, and schema layers.',
    locale: 'zh-CN',
    chrome: 'story',
    badge: 'v2 Async',
    stills: [1.0, 9.0],
    views: [
      { id: 'arch', type: 'architecture', input: 'arch1.json', preset: 'blueprint', callouts: { gateway: { text: 'Edge Entry', tone: 'accent' } } },
      { id: 'seq', type: 'sequence', input: 'seq2.json', preset: 'editorial' },
      { id: 'schema', type: 'erd', input: 'erd3.json' },
    ],
    steps: [
      {
        view: 'arch',
        duration: 4.5,
        title: '01 · 入口网关与直连调用',
        body: '客户端先访问 Gateway，随后将其异步状态重标为排队网关。',
        focus: ['client', 'gateway'],
        relabel: [{ node: 'gateway', label: 'Gateway API', subtitle: 'v2 async' }],
        trace: { edges: ['c_req'], travel: 1.0 },
      },
      {
        view: 'seq',
        duration: 6.5,
        title: '02 · 跨视图延续 Gateway 并展开队列消费',
        body: 'Gateway 组件平滑延续到时序阶段，依次动态展示 Queue 消息队列、Worker 消费节点与 m_pub/m_run 异步链路，同时在右侧打开 enqueueJob() 的实现源码面板并标注关键调用行。',
        transition: { from: 'arch', shared: [{ id: 'gateway' }] },
        enter: ['queue', 'worker'],
        connect: ['m_pub', 'm_run'],
        trace: { edges: ['m_pub', 'm_run'], action: 'trace', travel: 1.0 },
        metrics: [{ node: 'gateway', label: 'P95 ms', before: 180, after: 24, slot: 'center' }],
        detail: {
          nodes: ['gateway'],
          title: 'gateway.mjs · enqueueJob()',
          note: '异步投递任务并立即返回凭证',
          path: 'gateway.mjs',
          lines: [1, 2, 3, 4],
          highlight: [2],
        },
      },
      {
        view: 'schema',
        duration: 5.0,
        title: '03 · 落库持久化 jobs 与 workers 关系',
        body: '切换到实体关系视图并聚焦 jobs 主表，同时打开 SQL 定义面板。',
        focus: { nodes: ['jobs'], area: 'left' },
        detail: {
          nodes: ['jobs'],
          title: 'jobs.sql · jobs table',
          path: 'jobs.sql',
          lines: [1, 2, 3, 4],
          highlight: [2, 3],
        },
      },
    ],
  }, null, 2));

  const validate = run(['story', 'validate', choreoPath, '--json'], dir);
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  const vJson = JSON.parse(validate.stdout);
  assert.equal(vJson.ok, true);
  assert.deepEqual(vJson.stages, ['arch', 'seq', 'schema']);
  assert.equal(vJson.duration, 16);
  assert.equal(vJson.steps, 3);

  const svgStem = path.join(dir, 'walkthrough');
  const svgRes = run(['story', 'svg', choreoPath, svgStem, '--theme', 'both', '--still', '--json'], dir);
  assert.equal(svgRes.status, 0, svgRes.stdout + svgRes.stderr);
  const svgJson = JSON.parse(svgRes.stdout);
  assert.equal(svgJson.preset, 'blueprint');
  assert.equal(svgJson.outputs.length, 2);
  assert.equal(svgJson.stills.length, 4);

  for (const out of svgJson.outputs) {
    const svg = fs.readFileSync(out.path, 'utf8');
    parseXml(svg);
    assert.equal(assertCamoSafeSvg(svg, { assert: false }).ok, true);
    assert.match(svg, /<svg\b[^>]* data-preset="blueprint"/);
    assert.match(svg, /data-archify-bake="story"/);
    assert.match(svg, /Gateway API/);
    assert.match(svg, /Edge Entry/);
    assert.match(svg, /v2 Async/);
    assert.match(svg, /180 → 24/);
    assert.match(svg, /story-source-detail-0/);
    assert.match(svg, /story-source-detail-1/);
    assert.match(svg, /<tspan\b/, 'long mixed CJK/Latin body wraps into bounded 2-line tspans');
    assert.doesNotMatch(svg, /Primer Octicons/, 'general story engine emits zero domain icon notices');
  }

  for (const still of svgJson.stills) {
    const svg = fs.readFileSync(still.path, 'utf8');
    parseXml(svg);
    assert.equal(assertCamoSafeSvg(svg, { assert: false }).ok, true);
    assert.match(svg, /data-archify-bake="story-still"/);
    assert.doesNotMatch(svg, /@keyframes/, 'static keyframe SVG contains zero animation keyframes');
  }

  const stageHtmlPath = path.join(dir, 'stage.html');
  const stageRes = run(['story', 'stage', choreoPath, stageHtmlPath, '--theme', 'dark', '--preset', 'signal-flow', '--json'], dir);
  assert.equal(stageRes.status, 0, stageRes.stdout + stageRes.stderr);
  assert.equal(JSON.parse(stageRes.stdout).preset, 'signal-flow');
  const html = fs.readFileSync(stageHtmlPath, 'utf8');
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /window\.ArchifyStoryStage/);
  assert.match(html, /StoryContainer/);
  assert.match(html, /avc1\.64002a/);
  assert.match(html, /data-stage-theme="light"/);
  assert.match(html, /data-stage-theme="dark"/);
});

function writeLegacyStoryBrief(dir) {
  const htmlPath = path.join(skillRoot, 'examples', 'workflow-agent-tool-call-rendered.html');
  const briefPath = path.join(dir, 'brief.json');
  const scanRes = run(['story', 'scan', htmlPath, '--json'], dir);
  assert.equal(scanRes.status, 0, scanRes.stderr);
  const facts = JSON.parse(scanRes.stdout);
  const edge = facts.edges[0];
  fs.writeFileSync(briefPath, JSON.stringify({
    version: 2,
    title: 'Single-diagram bridge test',
    intro: 'Shows the overall agent workflow before tracing an edge.',
    outro: 'Returns to full workflow overview.',
    scenes: [{
      title: 'Follow one handoff',
      points: [{
        anchor: edge.to,
        via: edge.id,
        title: 'Tool dispatch edge',
        text: 'Follows the routed handoff directly in animated SVG and interactive stage.',
      }],
    }],
  }, null, 2));
  return { htmlPath, briefPath };
}

test('3-positional story svg and story stage bridge existing native HTML and version-2 briefs', () => {
  const dir = scratch();
  const { htmlPath, briefPath } = writeLegacyStoryBrief(dir);
  const outSvg = path.join(dir, 'single.svg');
  const svgRes = run(['story', 'svg', htmlPath, briefPath, outSvg, '--json'], dir);
  assert.equal(svgRes.status, 0, svgRes.stdout + svgRes.stderr);
  const svgJson = JSON.parse(svgRes.stdout);
  assert.deepEqual(svgJson.outputs.map(item => item.path), [outSvg]);
  parseXml(fs.readFileSync(outSvg, 'utf8'));
  assert.deepEqual(svgJson.stills.map(item => [item.path, item.time]), [[path.join(dir, 'single.still.svg'), 0]]);
  parseXml(fs.readFileSync(svgJson.stills[0].path, 'utf8'));
  const blockedSvg = path.join(dir, 'blocked.svg');
  fs.mkdirSync(path.join(dir, 'blocked.still.svg'));
  const blocked = run(['story', 'svg', htmlPath, briefPath, blockedSvg, '--json'], dir);
  assert.notEqual(blocked.status, 0);
  assert.equal(fs.existsSync(blockedSvg), false, 'an invalid static destination also blocks animated SVG publication');

  const outStage = path.join(dir, 'single-stage.html');
  const stageRes = run(['story', '--theme', 'light', 'stage', htmlPath, briefPath, outStage, '--json'], dir);
  assert.equal(stageRes.status, 0, stageRes.stdout + stageRes.stderr);
  assert.match(fs.readFileSync(outStage, 'utf8'), /Single-diagram bridge test/);

  const attached = run(['story', '--repo-root', dir, 'attach', htmlPath, briefPath, path.join(dir, 'attached.html'), '--json'], dir);
  assert.equal(attached.status, 0, attached.stdout + attached.stderr);

  const longBrief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
  longBrief.scenes = Array.from({length: 20}, () => structuredClone(longBrief.scenes[0]));
  fs.writeFileSync(briefPath, JSON.stringify(longBrief));
  const longOut = path.join(dir, 'long.svg');
  const tooLong = run(['story', 'svg', htmlPath, briefPath, longOut, '--theme', 'light', '--json'], dir);
  assert.equal(tooLong.status, 1, 'Long briefs must report the choreography limit instead of silently dropping their ending');
  const limit = JSON.parse(tooLong.stdout).diagnostics[0];
  assert.equal(limit.code, 'schema/maxItems');
  assert.equal(limit.subject.path, '/steps');
  assert.equal(limit.evidence.limit, 16);
  assert.equal(fs.existsSync(longOut), false);
});

test('story SVG preserves invalid node diagnostics in the default dual-theme export', () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const specPath = path.join(dir, 'invalid-focus.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schema_version: 1,
    title: 'Invalid focus',
    views: [{ id: 'arch', type: 'architecture', input: 'arch1.json' }],
    steps: [{ view: 'arch', title: 'Focus a node', body: 'Find the referenced node.', focus: ['missing'] }],
  }));

  const stem = path.join(dir, 'walkthrough');
  const lightSvg = stem + '-light.svg';
  const previous = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  fs.writeFileSync(lightSvg, previous);
  const originalFiles = fs.readdirSync(dir).sort();
  const args = ['story', 'svg', specPath, stem, '--json'];
  const light = run([...args, '--theme', 'light'], dir);
  assert.equal(light.status, 1, light.stdout + light.stderr);
  const expected = JSON.parse(light.stdout).diagnostics;
  assert.equal(expected[0].code, 'story/unknown-node');
  assert.equal(expected[0].subject.view, 'arch');
  assert.equal(expected[0].subject.node, 'missing');

  const both = run(args, dir);
  assert.equal(both.status, 1, both.stdout + both.stderr);
  assert.deepEqual(JSON.parse(both.stdout).diagnostics, expected);
  assert.equal(fs.readFileSync(lightSvg, 'utf8'), previous);
  assert.deepEqual(fs.readdirSync(dir).sort(), originalFiles);
});

test('a Story recovery write requires the captured parent identity before staging', () => {
  const dir = scratch();
  const first = path.join(dir, 'first');
  const second = path.join(dir, 'second');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  const target = path.join(second, 'story.svg');
  const original = captureAtomicOutput(path.join(first, 'story.svg'));
  const current = captureAtomicOutput(target);
  assert.equal(original.status, 'captured');
  assert.equal(current.status, 'captured');
  const { parentDevice, parentInode } = original.snapshot.slot;
  const expectedSnapshot = {
    ...current.snapshot,
    slot: { ...current.snapshot.slot, parentDevice, parentInode },
  };
  assert.throws(() => writeStoryOutput(target, '<svg/>', undefined, { createOnly: true, expectedSnapshot }),
    /write-slot-changed/);
  assert.deepEqual(fs.readdirSync(second), []);
});

test('story SVG restores the output pair and keeps recovery copies when restoration fails through an alias', () => {
  const dir = scratch();
  const { htmlPath, briefPath } = writeLegacyStoryBrief(dir);
  const physical = path.join(dir, 'physical');
  const alias = path.join(dir, 'alias');
  fs.mkdirSync(physical);
  fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const animated = path.join(alias, 'story.svg');
  const still = path.join(alias, 'story.still.svg');
  const stillDestination = path.join(fs.realpathSync(path.dirname(still)), path.basename(still));
  const trace = path.join(dir, 'faults.txt');
  const hook = path.join(dir, 'fault.mjs');
  fs.writeFileSync(hook, `import fs from 'node:fs';
import path from 'node:path';
const link = fs.linkSync;
const open = fs.openSync;
const destination = ${JSON.stringify(stillDestination)};
const trace = ${JSON.stringify(trace)};
const mode = process.env.ARCHIFY_TEST_STORY_FAULT;
let publicationFailed = false;
let restorationFailed = false;
function fail(stage) {
  fs.appendFileSync(trace, stage + '\\n');
  throw Object.assign(new Error('injected ' + stage + ' failure'), { code: 'EIO' });
}
fs.linkSync = function(from, to, ...args) {
  if (path.resolve(to) === destination) {
    if (!publicationFailed) {
      publicationFailed = true;
      fail('publication');
    }
    if (mode === 'current-restore' && !restorationFailed) {
      restorationFailed = true;
      fail('current restoration');
    }
  }
  return link.call(this, from, to, ...args);
};
fs.openSync = function(file, flags, ...args) {
  if (mode === 'pair-restore' && publicationFailed
      && flags === 'wx' && /^\\.archify-story-[a-f0-9-]+\\.tmp$/.test(path.basename(String(file)))) {
    fail('restoration');
  }
  return open.call(this, file, flags, ...args);
};`);

  const runFaulted = (mode, faults, format = ['--json']) => {
    fs.writeFileSync(trace, '');
    const result = run(['story', 'svg', htmlPath, briefPath, animated, ...format], dir,
      { ARCHIFY_TEST_STORY_FAULT: mode, TMPDIR: dir, TEMP: dir, TMP: dir }, ['--import', pathToFileURL(hook).href]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.deepEqual(fs.readFileSync(trace, 'utf8').trim().split('\n'), faults);
    return result;
  };

  const assertRecoveryCopies = (diagnostic, outputs) => {
    const { recoveryDirectory, recoveryFiles } = diagnostic.evidence;
    assert.ok(fs.statSync(recoveryDirectory).isDirectory());
    assert.deepEqual(recoveryFiles.map(({ backup, requestedPath, target }) => [
      requestedPath, target, fs.readFileSync(backup, 'utf8'),
    ]), outputs.map(([output, content]) => [
      output, path.join(fs.realpathSync(physical), path.basename(output)), content,
    ]));
  };

  fs.writeFileSync(still, 'previous still');
  const absent = JSON.parse(runFaulted('publish-only', ['publication']).stdout).diagnostics[0];
  assert.equal(fs.existsSync(animated), false, 'do not leave half of a new pair');
  assert.equal(absent.code, 'story/svg-publication');
  assert.equal(absent.evidence.restoration, 'complete');
  assert.equal(fs.readFileSync(still, 'utf8'), 'previous still');

  const alternateSpelling = path.join(physical, 'Story.svg');
  fs.writeFileSync(alternateSpelling, 'previous animation');
  if (!fs.existsSync(animated)) fs.renameSync(alternateSpelling, animated);
  const restored = JSON.parse(runFaulted('publish-only', ['publication']).stdout).diagnostics[0];
  assert.equal(restored.evidence.restoration, 'complete');
  assert.equal(fs.readFileSync(animated, 'utf8'), 'previous animation');
  assert.equal(fs.readFileSync(still, 'utf8'), 'previous still');
  assert.deepEqual(fs.readdirSync(physical).map(file => file.toLowerCase()).sort(), ['story.still.svg', 'story.svg']);

  fs.unlinkSync(animated);
  const onlyStill = JSON.parse(runFaulted('current-restore', ['publication', 'current restoration']).stdout).diagnostics[0];
  assert.equal(onlyStill.evidence.restoration, 'incomplete');
  assertRecoveryCopies(onlyStill, [[still, 'previous still']]);
  assert.equal(fs.existsSync(animated), false);
  fs.writeFileSync(animated, 'previous animation');
  fs.writeFileSync(still, 'previous still');

  const incomplete = JSON.parse(runFaulted('pair-restore', ['publication', 'restoration']).stdout).diagnostics[0];
  assert.equal(incomplete.code, 'story/svg-publication');
  assert.equal(incomplete.evidence.restoration, 'incomplete');
  assert.match(incomplete.message, /restoration failure/);
  assertRecoveryCopies(incomplete, [[animated, 'previous animation'], [still, 'previous still']]);
  assert.equal(fs.readFileSync(still, 'utf8'), 'previous still');
  fs.writeFileSync(animated, 'previous animation');
  const plain = runFaulted('pair-restore', ['publication', 'restoration'], []);
  assert.match(plain.stderr, /Recovery incomplete/);
  assert.match(plain.stderr, /Recovery directory "/);
  assert.ok(plain.stderr.includes(`for "${still}" (resolved target "${stillDestination}")`));

  fs.writeFileSync(animated, 'previous animation');
  const failedMember = JSON.parse(runFaulted('current-restore', ['publication', 'current restoration']).stdout).diagnostics[0];
  assert.equal(failedMember.code, 'story/svg-publication');
  assert.equal(failedMember.evidence.restoration, 'incomplete');
  assert.match(failedMember.message, /Previous output could not be verified/);
  assert.equal(fs.readFileSync(animated, 'utf8'), 'previous animation');
  assert.equal(fs.existsSync(still), false);
  assertRecoveryCopies(failedMember, [[animated, 'previous animation'], [still, 'previous still']]);
});

test('choreography resolves pinned repository source lines via --repo-root and rejects invalid paths/ranges/motion', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-repo-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repo, 'worker.mjs'), 'export function processJob() {\n  return "ok";\n}\n');
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Archify Tests');
  git(repo, 'config', 'user.email', 'archify@example.test');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/jobs.git');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', 'feat/worker');
  fs.writeFileSync(path.join(repo, 'worker.mjs'), [
    'export function processJob(job) {',
    '  if (!job) return "skip";',
    '  return job.id;',
    '}',
    ...Array.from({ length: 26 }, (_, i) => `// Cited line ${i + 5}`),
  ].join('\n'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'worker guard');
  const headSha = git(repo, 'rev-parse', 'HEAD');
  const baseSha = git(repo, 'rev-parse', 'HEAD^');

  const dir = scratch();
  multiViewFixtures(dir);
  const workerSeq = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Worker Sequence', output: 'seq.html', visual_preset: 'editorial', repository: { url: 'https://github.com/acme/jobs', revision: headSha } },
    participants: [
      { id: 'gateway', label: 'Gateway', type: 'backend' },
      { id: 'worker', label: 'Worker', type: 'backend', sources: [{ path: 'worker.mjs', line: 1, end_line: 30 }] },
    ],
    messages: [
      { id: 'dispatch', from: 'gateway', to: 'worker', y: 170, label: 'dispatch()' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'seq.json'), JSON.stringify(workerSeq, null, 2));
  const specPath = path.join(dir, 'repo-story.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schema_version: 1,
    title: 'Repo-backed walkthrough',
    views: [{ id: 'seq', type: 'sequence', input: 'seq.json' }],
    steps: [{
      view: 'seq',
      title: 'Guard empty jobs',
      body: 'Pins worker.mjs at the diagram revision.',
      detail: { nodes: ['worker'], title: 'worker.mjs', path: 'worker.mjs', lines: [1, 2, 3], highlight: [2] },
    }],
  }, null, 2));

  const outSvg = path.join(dir, 'repo.svg');
  const okRes = run(['story', 'svg', specPath, outSvg, '--theme', 'light', '--repo-root', repo, '--json'], dir);
  assert.equal(okRes.status, 0, okRes.stdout + okRes.stderr);
  assert.match(fs.readFileSync(outSvg, 'utf8'), /if \(!job\) return &quot;skip&quot;;/);

  // Multiple pinned views must read the revision of the view owning the excerpt.
  const beforeSeq = structuredClone(workerSeq);
  beforeSeq.meta.repository.revision = baseSha;
  beforeSeq.participants[1].sources[0].end_line = 3;
  fs.writeFileSync(path.join(dir, 'before-seq.json'), JSON.stringify(beforeSeq));
  const pairedSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  pairedSpec.views.unshift({ id: 'before', type: 'sequence', input: 'before-seq.json' });
  pairedSpec.steps.unshift({ view: 'before', title: 'Before the guard', body: 'The earlier implementation returns ok.', duration: 4 });
  fs.writeFileSync(specPath, JSON.stringify(pairedSpec));
  const pairedRes = run(['story', 'svg', specPath, outSvg, '--theme', 'light', '--repo-root', repo, '--json'], dir);
  assert.equal(pairedRes.status, 0, pairedRes.stdout + pairedRes.stderr);
  assert.match(fs.readFileSync(outSvg, 'utf8'), /if \(!job\) return &quot;skip&quot;;/, 'The second view keeps its own pinned source instead of the first view revision');

  // The same pin survives when the views arrive as rendered native HTML.
  for (const [input, output] of [['before-seq.json', 'before-seq.html'], ['seq.json', 'seq.html']]) {
    const rendered = run(['render', 'sequence', path.join(dir, input), path.join(dir, output), '--repo-root', repo], dir);
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  }
  pairedSpec.views.forEach(view => { view.input = view.input.replace(/\.json$/, '.html'); });
  fs.writeFileSync(specPath, JSON.stringify(pairedSpec));
  fs.writeFileSync(path.join(repo, 'worker.mjs'), 'export function processJob() { return "uncommitted"; }\n');
  const htmlViews = run(['story', 'svg', specPath, outSvg, '--theme', 'light', '--repo-root', repo, '--json'], dir);
  assert.equal(htmlViews.status, 0, htmlViews.stdout + htmlViews.stderr);
  assert.match(fs.readFileSync(outSvg, 'utf8'), /if \(!job\) return &quot;skip&quot;;/, 'Rendered HTML views retain pinned source despite working-tree edits');

  const briefPath = path.join(dir, 'worker-brief.json');
  fs.writeFileSync(briefPath, JSON.stringify({
    version: 2,
    title: 'Worker sources',
    intro: 'Introduce the worker.',
    outro: 'Return to the diagram.',
    scenes: [{ title: 'Inspect the worker', points: [{
      anchor: 'worker', title: 'Read the worker source', text: 'Show the full cited excerpt.',
      code: { fromLine: 4, toLine: 23, emphasis: [23, 99] },
    }] }],
  }));
  const bridged = run(['story', 'svg', path.join(dir, 'seq.html'), briefPath, outSvg, '--theme', 'light', '--repo-root', repo, '--json'], dir);
  assert.equal(bridged.status, 0, bridged.stdout + bridged.stderr);
  const bridgeSvg = fs.readFileSync(outSvg, 'utf8');
  const codeRows = [...bridgeSvg.matchAll(/<text\b[^>]*xml:space="preserve"[^>]*>([^<]*)<\/text>/g)];
  assert.equal(codeRows.length, 20);
  assert.equal(codeRows.at(-1)[1], '// Cited line 23');
  assert.equal((bridgeSvg.match(/<rect id="story-source-hl-/g) || []).length, 1);
  assert.equal(JSON.parse(bridged.stdout).preset, 'editorial');

  const removedArch = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Removed edge', output: 'rem.html' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [40, 100], size: [120, 60] },
      { id: 'old', type: 'external', label: 'Legacy', pos: [260, 100], size: [120, 60] },
    ],
    connections: [
      { id: 'old_call', from: 'api', to: 'old', label: 'audit' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'removed.json'), JSON.stringify(removedArch, null, 2));

  const cases = [
    [
      'story/removed-transfer',
      {
        schema_version: 1,
        title: 'Removed transfer check',
        views: [{ id: 'rem', type: 'architecture', input: 'removed.json', callouts: { old: { text: 'Retired', tone: 'removed' } } }],
        steps: [{ view: 'rem', title: 'Invalid token on removed', body: 'Tries to trace removed edge.', trace: { edges: ['old_call'] } }],
      },
    ],
    [
      'story/static-structure-trace',
      {
        schema_version: 1,
        title: 'ERD trace check',
        views: [{ id: 'schema', type: 'erd', input: 'erd3.json' }],
        steps: [{ view: 'schema', title: 'Invalid token on ERD', body: 'Tries to trace static ERD.', trace: { edges: ['job_worker'] } }],
      },
    ],
    [
      'story/source-line-out-of-range',
      {
        schema_version: 1,
        title: 'Line range check',
        views: [{ id: 'seq', type: 'sequence', input: 'seq.json' }],
        steps: [{ view: 'seq', title: 'OOB line', body: 'Out-of-range line number.', detail: { nodes: ['worker'], title: 'worker.mjs', path: 'worker.mjs', lines: [99] } }],
      },
    ],
    [
      'story/caption-overflow',
      {
        schema_version: 1,
        title: 'Caption overflow check',
        views: [{ id: 'arch', type: 'architecture', input: 'arch1.json' }],
        steps: [{ view: 'arch', title: 'Overflow body', body: '测'.repeat(180) }],
      },
    ],
  ];

  for (const [index, [expectedCode, badSpec]] of cases.entries()) {
    const specFile = path.join(dir, `bad-${index}.json`);
    fs.writeFileSync(specFile, JSON.stringify(badSpec, null, 2));
    const res = run(['story', 'svg', specFile, path.join(dir, `bad-${index}`), '--theme', 'light', '--repo-root', repo, '--json'], dir);
    assert.equal(res.status, 1, `expected failure ${expectedCode}`);
    assert.equal(JSON.parse(res.stdout).diagnostics[0].code, expectedCode);
  }
});

test('choreography protects cited source inputs from animated, still, stage and video outputs', async (t) => {
  const dir = scratch();
  multiViewFixtures(dir);
  const source = 'Original cited text must survive an export collision.\n';
  for (const [name, action, requested, cited, flags] of [
    ['animated', 'svg', 'notes.svg', 'notes.svg', []],
    ['still', 'svg', 'notes.svg', 'notes.still.svg', ['--still']],
    ['stage', 'stage', 'notes.html', 'notes.html', []],
    ['video', 'video', 'notes.mp4', 'notes.mp4', []],
  ]) {
    await t.test(name, () => {
      fs.writeFileSync(path.join(dir, cited), source);
      const spec = path.join(dir, `${name}.json`);
      fs.writeFileSync(spec, JSON.stringify({
        schema_version: 1,
        views: [{ id: 'arch', type: 'architecture', input: 'arch1.json' }],
        steps: [{ view: 'arch', title: 'Cited source', body: 'Keep source inputs intact.',
          detail: { nodes: ['gateway'], title: cited, path: cited, lines: [1] } }],
      }));
      const res = run(['story', action, spec, path.join(dir, requested), '--theme', 'light', ...flags, '--json'], dir, {
        ARCHIFY_CHROME: path.join(dir, 'no-browser-needed-for-output-preflight'),
      });
      assert.ok(fs.readFileSync(path.join(dir, cited), 'utf8') === source, 'An export must not replace a cited input');
      assert.equal(res.status, 1, res.stdout + res.stderr);
      assert.match(JSON.parse(res.stdout).diagnostics[0].code, /^output\//, 'Collision must be rejected before video encoding');
    });
  }
});

test('choreography honors explicit revision requests and rejects unfulfilled pins', async (t) => {
  const dir = scratch();
  multiViewFixtures(dir);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const source = path.join(repo, 'worker.mjs');
  fs.writeFileSync(source, 'const version = "BASE_SOURCE";\n');
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Archify Tests');
  git(repo, 'config', 'user.email', 'archify@example.test');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/jobs.git');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(source, 'const version = "HEAD_SOURCE";\n');
  git(repo, 'commit', '-qam', 'head');
  const head = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(source, 'const version = "LOCAL_SOURCE";\n');
  fs.writeFileSync(path.join(dir, 'worker.mjs'), 'const version = "LOCAL_SOURCE";\n');
  const diagram = JSON.parse(fs.readFileSync(path.join(dir, 'arch1.json'), 'utf8'));
  diagram.meta.repository = { url: 'https://github.com/acme/jobs', revision: head };
  diagram.components[1].sources = [{ path: 'worker.mjs', line: 1, end_line: 1 }];
  fs.writeFileSync(path.join(dir, 'arch1.json'), JSON.stringify(diagram));
  const rendered = run(['render', 'architecture', path.join(dir, 'arch1.json'), path.join(dir, 'pinned.html'), '--repo-root', repo], dir);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);

  for (const [name, revision, withRepo, expected] of [
    ['explicit commit', base, true, 'BASE_SOURCE'],
    ['head alias', 'head', true, 'HEAD_SOURCE'],
    ['missing base', 'base', true, null],
    ['missing repository', head, false, null],
    ['implicit pin without repository', undefined, false, null],
  ]) {
    await t.test(name, () => {
      const spec = path.join(dir, 'pinned.json');
      const output = path.join(dir, `${name.replaceAll(' ', '-')}.svg`);
      fs.writeFileSync(spec, JSON.stringify({
        schema_version: 1,
        views: [{ id: 'arch', type: 'architecture', input: 'pinned.html' }],
        steps: [{ view: 'arch', title: 'Fixed revision', body: 'Never substitute workspace code for a pin.',
          detail: { nodes: ['gateway'], title: 'worker.mjs', path: 'worker.mjs', lines: [1], ...(revision ? { revision } : {}) } }],
      }));
      const res = run(['story', 'svg', spec, output, '--theme', 'light', ...(withRepo ? ['--repo-root', repo] : []), '--json'], dir);
      if (expected) {
        assert.equal(res.status, 0, res.stdout + res.stderr);
        assert.ok(fs.readFileSync(output, 'utf8').includes(expected), `Expected source at ${revision}`);
      } else {
        assert.equal(res.status, 1, 'An unfulfilled pin must fail before publishing');
        assert.equal(JSON.parse(res.stdout).diagnostics[0].code, 'story/source-revision-unavailable');
        assert.equal(fs.existsSync(output), false);
      }
    });
  }
});

test('explicit step timing honors duration and rejects overlaps and story overruns', () => {
  const spec = {
    schema_version: 1, duration: 20,
    views: [{ id: 'arch', input: 'arch1.json', type: 'architecture' }],
    steps: [
      { view: 'arch', at: 0, duration: 3, title: 'Short beat', body: 'Leave an intentional pause.' },
      { view: 'arch', at: 10, duration: 4, title: 'Next beat', body: 'Continue after the pause.' },
    ],
  };
  const normalize = (raw) => normalizeChoreographySpec(raw, { declaredViews: ['arch'] });
  assert.deepEqual(normalize(spec).steps.map(s => [s.at, s.tEnd]), [[0, 3], [10, 14]]);
  for (const [index, duration] of [[0, 12], [1, 11]]) {
    const bad = structuredClone(spec);
    bad.steps[index].duration = duration;
    assert.throws(() => normalize(bad), error => error.code === 'story/invalid-timing');
  }
});

test('automatic timing contains authored staggers and every trace hop, including brief conversion', () => {
  const base = { schema_version: 1, views: [{ id: 'main', type: 'architecture', input: 'arch1.json' }] };
  const normalize = step => normalizeChoreographySpec({ ...base, steps: [{ view: 'main', title: 'Work', body: 'Follow all operations.', ...step }] }, { declaredViews: ['main'] });
  for (const field of ['enter', 'connect']) {
    const op = field === 'enter' ? { nodes: ['a', 'b', 'c'], stagger: 5 } : { edges: ['a', 'b', 'c'], stagger: 5 };
    assert.ok(normalize({ [field]: op }).duration >= (field === 'enter' ? 11.35 : 11.5), `${field} must include the last staggered operation`);
  }
  const edges = Array.from({ length: 16 }, (_, i) => `edge${i}`);
  const long = normalize({ trace: { edges } });
  assert.ok(long.duration >= long.traces[0].times.at(-1) + long.traces[0].travel);
  const facts = { nodes: [{ id: 'a' }, { id: 'b' }], edges: edges.map(id => ({ id, from: 'a', to: 'b' })) };
  const converted = fromStoryBriefToChoreography({
    version: 2, title: 'Long trace', intro: 'Establish the graph.', outro: 'Every handoff has completed.',
    scenes: [{ title: 'Trace all connections', points: [{ anchor: 'b', via: edges, title: 'Handoffs', text: 'Follow the entire route.' }] }],
  }, facts, { diagramType: 'architecture' });
  const bridged = normalizeChoreographySpec(converted, { declaredViews: ['main'] });
  const trace = bridged.traces[0];
  assert.ok(bridged.steps[1].tEnd >= trace.times.at(-1) + trace.travel);
});

test('Camo checks distinguish inert source text from active SVG attributes and CSS', () => {
  const svg = body => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  assert.equal(assertCamoSafeSvg(svg('<text>const onClick = save; @import url(https://example.test/a); javascript: sample</text>')).ok, true);
  for (const [body, expected] of [
    ['<g onclick="save()"/>', 'svg/event-handler'],
    ["<g onclick='save()'/>", 'svg/event-handler'],
    ['<script>save()</script>', 'svg/script'],
    ['<foreignObject/>', 'svg/foreign-object'],
    ['<a href="&#106;avascript:save()"/>', 'svg/javascript-url'],
    ['<image href="https://example.test/a.png"/>', 'svg/external-href'],
    ['<style>@import "https://example.test/style.css";</style>', 'svg/css-import'],
    ['<g style="fill:url(https://example.test/fill.svg)"/>', 'svg/external-css-url'],
  ]) {
    const result = assertCamoSafeSvg(svg(body), { assert: false });
    assert.ok(result.problems.some(p => p.code === expected), JSON.stringify({ body, result }));
  }
});

test('story video reports structured diagnostic without Chrome and StoryContainer supports silent MP4/WebM tracks', async () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const specPath = path.join(dir, 'mini.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schema_version: 1,
    duration: 6,
    title: 'Video preflight',
    views: [{ id: 'arch', type: 'architecture', input: 'arch1.json' }],
    steps: [{ view: 'arch', title: 'Entry', body: 'Client requests gateway.', focus: ['client', 'gateway'] }],
  }));

  const missingBrowser = run(['story', 'video', specPath, path.join(dir, 'out.mp4'), '--json'], dir, {
    ARCHIFY_CHROME: path.join(dir, 'nonexistent-chrome'),
  });
  assert.equal(missingBrowser.status, 1);
  assert.equal(JSON.parse(missingBrowser.stdout).diagnostics[0].code, 'story/browser-unavailable');
  const overrun = run(['story', 'video', specPath, path.join(dir, 'out.mp4'), '--seconds', '6.005', '--json'], dir, {
    ARCHIFY_CHROME: path.join(dir, 'nonexistent-chrome'),
  });
  assert.equal(JSON.parse(overrun.stdout).diagnostics[0].code, 'story/invalid-timing', 'CLI rejects the runtime-invalid interval before launching Chrome');
  const extension = run(['story', 'video', specPath, path.join(dir, 'out.mov'), '--json'], dir, {
    ARCHIFY_CHROME: path.join(dir, 'nonexistent-chrome'),
  });
  assert.equal(JSON.parse(extension.stdout).diagnostics[0].code, 'output/cli-extension');

  // Verify video-only (audio: false) MP4 & WebM container construction in StoryContainer.
  const ctx = vm.createContext({ Blob, TextEncoder });
  vm.runInContext(fs.readFileSync(path.join(skillRoot, 'story/story-container.js'), 'utf8'), ctx);

  const mp4Mux = ctx.StoryContainer.open({
    format: 'mp4', audio: false, width: 1920, height: 1080, fps: 30, frames: 2, duration: 2 / 30, maxBytes: 1024 * 1024, check() {},
  });
  const avcC = new Uint8Array([1, 100, 0, 42, 255, 225, 0, 4, 103, 100, 0, 42, 1, 0, 4, 104, 238, 60, 128]);
  mp4Mux.add('video', { timestamp: 0, type: 'key', byteLength: 4, copyTo: (d) => d.set([0, 0, 0, 1]) }, { decoderConfig: { description: avcC } });
  mp4Mux.add('video', { timestamp: Math.round(1e6 / 30), type: 'delta', byteLength: 4, copyTo: (d) => d.set([0, 0, 0, 2]) });
  const mp4Blob = await mp4Mux.finish();
  const mp4Bytes = Buffer.from(await mp4Blob.arrayBuffer());
  assert.equal(mp4Blob.type, 'video/mp4');
  assert.equal(mp4Bytes.subarray(4, 12).toString('ascii'), 'ftypmp42');
  assert.ok(mp4Bytes.includes(Buffer.from('vide')));
  assert.equal(mp4Bytes.includes(Buffer.from('soun')), false, 'audio: false MP4 omits audio track');

  const webmMux = ctx.StoryContainer.open({
    format: 'webm', audio: false, width: 1920, height: 1080, fps: 30, frames: 2, duration: 2 / 30, maxBytes: 1024 * 1024, check() {},
  });
  webmMux.add('video', { timestamp: 0, type: 'key', byteLength: 4, copyTo: (d) => d.set([1, 2, 3, 4]) });
  webmMux.add('video', { timestamp: Math.round(1e6 / 30), type: 'delta', byteLength: 4, copyTo: (d) => d.set([5, 6, 7, 8]) });
  const webmBlob = await webmMux.finish();
  const webmBytes = Buffer.from(await webmBlob.arrayBuffer());
  assert.equal(webmBlob.type, 'video/webm');
  assert.deepEqual([...webmBytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(webmBytes.includes(Buffer.from('V_VP9')));
  assert.equal(webmBytes.includes(Buffer.from('A_OPUS')), false, 'audio: false WebM omits audio track');
});

test('createCompiledStoryTheme matches compileStorySvg/compileStoryStillSvg byte-for-byte without repeating AST passes', () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const archHtml = path.join(dir, 'arch1.html');
  const rendered = run(['render', 'architecture', path.join(dir, 'arch1.json'), archHtml], dir);
  assert.equal(rendered.status, 0, rendered.stderr);

  const canonical = extractCanonicalSvg(fs.readFileSync(archHtml, 'utf8'));
  const styles = loadViewerStyles();
  const bakedViews = new Map([
    ['arch', new Map(['light', 'dark'].map((theme) => [theme, bakeSvg(canonical, { theme, preset: 'classic', styles })]))],
  ]);
  const viewTypes = new Map([['arch', 'architecture']]);
  const plan = normalizeChoreographySpec({
    schema_version: 1,
    title: 'Reuse Check',
    views: [{ id: 'arch', type: 'architecture', input: 'arch1.json' }],
    steps: [
      { view: 'arch', duration: 4.0, title: 'Establish', body: 'Initial overview.', trace: { edges: ['c_req'], travel: 1.0 } },
      { view: 'arch', duration: 4.0, title: 'Relabel', body: 'Zoom and relabel.', focus: ['gateway'], relabel: [{ node: 'gateway', label: 'Gateway API' }] },
    ],
  }, { declaredViews: ['arch'], baseDir: dir });

  for (const theme of ['light', 'dark']) {
    const compiled = createCompiledStoryTheme({ plan, bakedViews, viewTypes, theme, preset: 'classic', styles });
    assert.equal(compiled.meta.steps.length, 2);
    assert.equal(compiled.renderAnimatedSvg().svg, compileStorySvg({ plan, bakedViews, viewTypes, theme, preset: 'classic', styles }).svg);
    for (const t of [1.2, 5.5, null]) {
      assert.equal(
        compiled.renderStillSvg(t).svg,
        compileStoryStillSvg({ plan, bakedViews, viewTypes, theme, preset: 'classic', styles, atTime: t }).svg,
      );
    }
  }
});

test('a code detail keeps its step narration in frame and only recedes unrelated context', () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const seqHtml = path.join(dir, 'seq2.html');
  const rendered = run(['render', 'sequence', path.join(dir, 'seq2.json'), seqHtml], dir);
  assert.equal(rendered.status, 0, rendered.stderr);
  const styles = loadViewerStyles();
  const baked = bakeSvg(extractCanonicalSvg(fs.readFileSync(seqHtml, 'utf8')), { theme: 'light', preset: 'classic', styles });
  const bakedViews = new Map([['seq', new Map([['light', baked]])]]);
  const plan = normalizeChoreographySpec({
    schema_version: 1,
    views: [{ id: 'seq', type: 'sequence', input: 'seq2.json' }],
    steps: [{
      view: 'seq', duration: 6, title: 'Publish', body: 'The gateway enqueues the job.',
      focus: { nodes: ['queue'], area: 'left' },
      trace: { edges: ['m_pub'], travel: 1 },
      detail: { nodes: ['queue'], title: 'enqueueJob()', path: 'gateway.mjs', lines: [1, 2, 3], highlight: [2] },
    }],
  }, { declaredViews: ['seq'], baseDir: dir });
  const compiled = createCompiledStoryTheme({ plan, bakedViews, viewTypes: new Map([['seq', 'sequence']]), theme: 'light', preset: 'classic', styles });
  const animated = compiled.renderAnimatedSvg().svg;
  assert.ok(!animated.includes('data-story-edge-id="null~null"'), 'Lifelines and icons must not share a synthetic edge identity');

  const css = animated.slice(animated.indexOf('<style>'), animated.indexOf('</style>'));
  assert.ok(!css.includes('[data-node-id="gateway"]'), 'A trace endpoint outside detail.nodes stays visible');
  assert.ok(!css.includes('[data-edge-id="m_pub"]'), 'The traced message stays visible under the code panel');
  assert.ok(css.includes('[data-node-id="worker"]') && css.includes('[data-edge-id="m_run"]'), 'Unrelated context still recedes');

  const still = compiled.renderStillSvg(4).svg;
  const camera = /#camera-seq\{[^}]*transform:translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(still)
    || /id="camera-seq" style="transform:translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(still);
  assert.ok(camera, 'still exposes the camera transform');
  const [tx, scale] = [Number(camera[1]), Number(camera[3])];
  const gatewayRect = /data-node-id="gateway"[\s\S]*?<rect[^>]*\bx="([\d.]+)"/.exec(baked);
  const left = tx + Number(gatewayRect[1]) * scale;
  assert.ok(left >= 18 && left < 506, `trace source stays left of the code panel: ${left}`);
});

test('opensView preserves reduced-motion overview framing and holds hop-0 camera before multi-hop follow', () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const wideChain = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Wide Chain', output: 'wide.html' },
    components: [
      { id: 'n1', type: 'frontend', label: 'Stage 1', pos: [40, 120], size: [180, 70] },
      { id: 'n2', type: 'backend', label: 'Stage 2', pos: [320, 120], size: [180, 70] },
      { id: 'n3', type: 'backend', label: 'Stage 3', pos: [600, 120], size: [180, 70] },
      { id: 'n4', type: 'backend', label: 'Stage 4', pos: [880, 120], size: [180, 70] },
      { id: 'n5', type: 'database', label: 'Stage 5', pos: [1160, 120], size: [180, 70] },
    ],
    connections: [
      { id: 'e12', from: 'n1', to: 'n2', label: 'step 1' },
      { id: 'e23', from: 'n2', to: 'n3', label: 'step 2' },
      { id: 'e34', from: 'n3', to: 'n4', label: 'step 3' },
      { id: 'e45', from: 'n4', to: 'n5', label: 'step 4' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'wide.json'), `${JSON.stringify(wideChain, null, 2)}\n`);
  const archHtml = path.join(dir, 'arch1.html');
  const wideHtml = path.join(dir, 'wide.html');
  assert.equal(run(['render', 'architecture', path.join(dir, 'arch1.json'), archHtml], dir).status, 0);
  assert.equal(run(['render', 'architecture', path.join(dir, 'wide.json'), wideHtml], dir).status, 0);

  const styles = loadViewerStyles();
  const bakedArch = bakeSvg(extractCanonicalSvg(fs.readFileSync(archHtml, 'utf8')), { theme: 'light', preset: 'classic', styles });
  const bakedWide = bakeSvg(extractCanonicalSvg(fs.readFileSync(wideHtml, 'utf8')), { theme: 'light', preset: 'classic', styles });
  const bakedViews = new Map([
    ['arch', new Map([['light', bakedArch]])],
    ['wide', new Map([['light', bakedWide]])],
  ]);
  const viewTypes = new Map([['arch', 'architecture'], ['wide', 'architecture']]);

  const plan = normalizeChoreographySpec({
    schema_version: 1,
    views: [
      { id: 'arch', type: 'architecture', input: 'arch1.json' },
      { id: 'wide', type: 'architecture', input: 'wide.json' },
    ],
    steps: [
      { view: 'arch', duration: 5, title: 'Intro', body: 'Overview.' },
      {
        view: 'wide', duration: 7, title: 'Walk chain', body: 'Follow wide chain next to code.',
        focus: { nodes: ['n1', 'n2', 'n3', 'n4', 'n5'], area: 'left' },
        trace: { edges: ['e12', 'e23', 'e34', 'e45'], travel: 0.9 },
        detail: { nodes: ['n4', 'n5'], title: 'finish()', path: 'gateway.mjs', lines: [1, 2, 3], highlight: [2] },
      },
    ],
  }, { declaredViews: ['arch', 'wide'], baseDir: dir });

  const compiled = createCompiledStoryTheme({ plan, bakedViews, viewTypes, theme: 'light', preset: 'classic', styles });
  const animated = compiled.renderAnimatedSvg().svg;

  // 1. prefers-reduced-motion hides the code panel, so it must use the full overview camera (wider scale than 0.5 left-crop).
  const rmBlock = /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?#camera-wide\{transform:translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)!important\}/.exec(animated);
  assert.ok(rmBlock, 'reduced-motion rule defines #camera-wide transform');
  const rmScale = Number(rmBlock[3]);
  assert.ok(rmScale > 0.55, `reduced-motion uses overview framing instead of 0.5 left-crop (got ${rmScale})`);

  // 2. When wide opens at t=5 with multi-hop follow, camera must stay at hop-0 camera at t=0 and t=5 (no early drift).
  const stillAt0 = compiled.renderStillSvg(0).svg;
  const stillAtEnter = compiled.renderStillSvg(5).svg;
  const parseCam = (svg) => {
    const m = /#camera-wide\{[^}]*transform:translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(svg)
      || /id="camera-wide" style="transform:translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(svg);
    assert.ok(m, 'still exposes #camera-wide transform');
    return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
  };
  const cam0 = parseCam(stillAt0);
  const camEnter = parseCam(stillAtEnter);
  assert.equal(camEnter.x, cam0.x, `wide camera must hold hop-0 x until step entry (t=0: ${cam0.x}, t=5: ${camEnter.x})`);
  assert.equal(camEnter.y, cam0.y, `wide camera must hold hop-0 y until step entry (t=0: ${cam0.y}, t=5: ${camEnter.y})`);
  const camLate = parseCam(compiled.renderStillSvg(11).svg);
  assert.ok(camLate.x < camEnter.x - 100, `multi-hop follow pans rightward along the wide chain (${camEnter.x} -> ${camLate.x})`);
});

test('camera framing respects timed focus ops, wide targets, detail backdrop, delayed entrance and single edge dim', () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const wideArch = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Wide Architecture', output: 'wide-arch.html' },
    components: [
      { id: 'api', type: 'frontend', label: 'API', pos: [60, 120], size: [160, 70] },
      { id: 'mid', type: 'backend', label: 'Middle', pos: [1340, 120], size: [160, 70] },
      { id: 'worker', type: 'backend', label: 'Worker', pos: [2620, 120], size: [160, 70] },
    ],
    connections: [
      { id: 'e_am', from: 'api', to: 'mid', label: 'dispatch' },
      { id: 'e_mw', from: 'mid', to: 'worker', label: 'finish' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'wide-arch.json'), `${JSON.stringify(wideArch, null, 2)}\n`);
  const wideHtml = path.join(dir, 'wide-arch.html');
  assert.equal(run(['render', 'architecture', path.join(dir, 'wide-arch.json'), wideHtml], dir).status, 0);
  const styles = loadViewerStyles();
  const baked = bakeSvg(extractCanonicalSvg(fs.readFileSync(wideHtml, 'utf8')), { theme: 'light', preset: 'classic', styles });
  const bakedViews = new Map([['arch', new Map([['light', baked]])]]);
  const viewTypes = new Map([['arch', 'architecture']]);
  const parseCam = (svg) => {
    const m = /#camera-arch\{[^}]*transform:translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(svg)
      || /id="camera-arch" style="transform:translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(svg);
    assert.ok(m, 'still exposes #camera-arch transform');
    return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
  };

  // 1. Separately timed top-level focus ops pan between targets; explicit at=0.1 holds overview at t=0.
  const timedPlan = normalizeChoreographySpec({
    schema_version: 1,
    views: [{ id: 'arch', type: 'architecture', input: 'wide-arch.json' }],
    stages: [{ view: 'arch', start: 0, end: 8 }],
    steps: [{ view: 'arch', at: 0, duration: 8, title: 'Pan', body: 'API then worker.' }],
    focus: [
      { view: 'arch', nodes: ['api'], at: 0.1, area: 'center' },
      { view: 'arch', nodes: ['worker'], at: 4.0, area: 'center' },
    ],
  }, { declaredViews: ['arch'], baseDir: dir });
  const timed = createCompiledStoryTheme({ plan: timedPlan, bakedViews, viewTypes, theme: 'light', preset: 'classic', styles });
  const camT0 = parseCam(timed.renderStillSvg(0).svg);
  const camT25 = parseCam(timed.renderStillSvg(2.5).svg);
  const camT6 = parseCam(timed.renderStillSvg(6).svg);
  assert.ok(camT0.scale < 0.5, `explicit focus at=0.1 holds overview at t=0 (got scale=${camT0.scale})`);
  assert.ok(camT25.scale > 1.0, `focus at=0.1 zooms onto API by t=2.5 (got scale=${camT25.scale})`);
  assert.ok(Math.abs(camT6.x - camT25.x) > 500, `second focus at=4 pans from API to worker (${camT25.x} -> ${camT6.x})`);

  // 2. Widely separated targets without a sequential trace fit both nodes even alongside a detail panel.
  const widePlan = normalizeChoreographySpec({
    schema_version: 1,
    views: [{ id: 'arch', type: 'architecture', input: 'wide-arch.json' }],
    steps: [{
      view: 'arch', duration: 6, title: 'Both ends', body: 'Keep both endpoints visible beside code.',
      focus: ['api', 'worker'],
      detail: { nodes: ['api'], title: 'handle()', path: 'gateway.mjs', lines: [1, 2, 3], highlight: [2] },
    }],
  }, { declaredViews: ['arch'], baseDir: dir });
  const wideCompiled = createCompiledStoryTheme({ plan: widePlan, bakedViews, viewTypes, theme: 'light', preset: 'classic', styles });
  const camWide = parseCam(wideCompiled.renderStillSvg(3).svg);
  assert.ok(camWide.x + 60 * camWide.scale >= 18, `left endpoint stays on-screen: ${camWide.x + 60 * camWide.scale}`);
  assert.ok(camWide.x + (2620 + 160) * camWide.scale <= 506, `right endpoint stays clear of code backdrop: ${camWide.x + 2780 * camWide.scale}`);

  // 3. Explicit focus.area="center" paired with a code detail keeps focused nodes clear of the x=506 code backdrop,
  //    and unrelated edges are dimmed once via :not(...) instead of compounding on wrapper + nested path.
  const centerDetailPlan = normalizeChoreographySpec({
    schema_version: 1,
    views: [{ id: 'arch', type: 'architecture', input: 'wide-arch.json' }],
    steps: [{
      view: 'arch', duration: 6, title: 'Detail', body: 'Focus API alongside code.',
      focus: { nodes: ['api'], area: 'center' },
      detail: { nodes: ['api'], title: 'handle()', path: 'gateway.mjs', lines: [1, 2, 3], highlight: [2] },
    }],
  }, { declaredViews: ['arch'], baseDir: dir });
  const cdCompiled = createCompiledStoryTheme({ plan: centerDetailPlan, bakedViews, viewTypes, theme: 'light', preset: 'classic', styles });
  const camCd = parseCam(cdCompiled.renderStillSvg(3).svg);
  const apiRight = camCd.x + (60 + 160) * camCd.scale;
  assert.ok(apiRight <= 506, `focused node stays clear of x=506 code backdrop: right=${apiRight}`);
  const cdSvg = cdCompiled.renderAnimatedSvg().svg;
  assert.ok(cdSvg.includes(':not([data-edge-id="e_mw"] *)'), 'edge dim selector excludes nested descendants to avoid double dimming');
});
