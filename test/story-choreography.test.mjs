import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { normalizeChoreographySpec } from '../archify/story/choreography-plan.mjs';
import { compileStoryStillSvg, compileStorySvg, createCompiledStoryTheme } from '../archify/story/story-svg.mjs';
import { assertCamoSafeSvg, bakeSvg, extractCanonicalSvg, loadViewerStyles } from '../archify/story/svg-bake.mjs';
import { git } from './helpers/repository-evidence-fixture.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { parseXml } from './helpers/xml.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function run(args, cwd = skillRoot, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
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
    preset: 'classic',
    chrome: 'story',
    badge: 'v2 Async',
    stills: [1.0, 9.0],
    views: [
      { id: 'arch', type: 'architecture', input: 'arch1.json', callouts: { gateway: { text: 'Edge Entry', tone: 'accent' } } },
      { id: 'seq', type: 'sequence', input: 'seq2.json' },
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
  assert.equal(svgJson.outputs.length, 2);
  assert.equal(svgJson.stills.length, 4);

  for (const out of svgJson.outputs) {
    const svg = fs.readFileSync(out.path, 'utf8');
    parseXml(svg);
    assert.equal(assertCamoSafeSvg(svg, { assert: false }).ok, true);
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
  const stageRes = run(['story', 'stage', choreoPath, stageHtmlPath, '--theme', 'dark', '--json'], dir);
  assert.equal(stageRes.status, 0, stageRes.stdout + stageRes.stderr);
  const html = fs.readFileSync(stageHtmlPath, 'utf8');
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /window\.ArchifyStoryStage/);
  assert.match(html, /StoryContainer/);
  assert.match(html, /avc1\.64002a/);
  assert.match(html, /data-stage-theme="light"/);
  assert.match(html, /data-stage-theme="dark"/);
});

test('3-positional story svg and story stage bridge existing native HTML and version-2 briefs', () => {
  const dir = scratch();
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

  const outSvg = path.join(dir, 'single.svg');
  const svgRes = run(['story', 'svg', htmlPath, briefPath, outSvg, '--theme', 'light', '--still', '--json'], dir);
  assert.equal(svgRes.status, 0, svgRes.stdout + svgRes.stderr);
  const svgJson = JSON.parse(svgRes.stdout);
  assert.equal(svgJson.outputs[0].path, outSvg);
  parseXml(fs.readFileSync(outSvg, 'utf8'));
  assert.equal(fs.existsSync(svgJson.stills[0].path), true);

  const outStage = path.join(dir, 'single-stage.html');
  const stageRes = run(['story', 'stage', htmlPath, briefPath, outStage, '--json'], dir);
  assert.equal(stageRes.status, 0, stageRes.stdout + stageRes.stderr);
  assert.match(fs.readFileSync(outStage, 'utf8'), /Single-diagram bridge test/);
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
  fs.writeFileSync(path.join(repo, 'worker.mjs'), 'export function processJob(job) {\n  if (!job) return "skip";\n  return job.id;\n}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'worker guard');
  const headSha = git(repo, 'rev-parse', 'HEAD');

  const dir = scratch();
  multiViewFixtures(dir);
  const workerSeq = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Worker Sequence', output: 'seq.html', repository: { url: 'https://github.com/acme/jobs', revision: headSha } },
    participants: [
      { id: 'gateway', label: 'Gateway', type: 'backend' },
      { id: 'worker', label: 'Worker', type: 'backend', sources: [{ path: 'worker.mjs', line: 1, end_line: 4 }] },
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

test('story video reports structured diagnostic without Chrome and StoryContainer supports silent MP4/WebM tracks', async () => {
  const dir = scratch();
  multiViewFixtures(dir);
  const specPath = path.join(dir, 'mini.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schema_version: 1,
    title: 'Video preflight',
    views: [{ id: 'arch', type: 'architecture', input: 'arch1.json' }],
    steps: [{ view: 'arch', title: 'Entry', body: 'Client requests gateway.', focus: ['client', 'gateway'] }],
  }));

  const missingBrowser = run(['story', 'video', specPath, path.join(dir, 'out.mp4'), '--json'], dir, {
    ARCHIFY_CHROME: path.join(dir, 'nonexistent-chrome'),
  });
  assert.equal(missingBrowser.status, 1);
  assert.equal(JSON.parse(missingBrowser.stdout).diagnostics[0].code, 'story/browser-unavailable');

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
