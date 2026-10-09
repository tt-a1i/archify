import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { segmentRectClearanceWithin } from '../archify/renderers/shared/geometry.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
function inspect(t, diagram, { quality, envQuality } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-auto-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'source.json');
  const source = JSON.stringify(diagram);
  fs.writeFileSync(input, source);
  const env = { ...process.env };
  delete env.ARCHIFY_QUALITY_PROFILE;
  if (envQuality !== undefined) env.ARCHIFY_QUALITY_PROFILE = envQuality;
  const qualityArgs = quality ? ['--quality', quality] : [];
  const result = spawnSync(process.execPath, [cli, 'validate', 'dataflow', input, '--json', ...qualityArgs], { encoding: 'utf8', env });
  assert.equal(fs.readFileSync(input, 'utf8'), source, 'automatic layout must not rewrite authored input');
  const receipt = JSON.parse(result.stdout);
  return { result, receipt, input, output: path.join(cwd, 'diagram.html'), env, qualityArgs };
}
function pipeline() {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Request processing', output: 'diagram.html', quality_profile: 'showcase' },
    stages: ['Input', 'Prepare', 'Execute', 'Decode', 'Output'].map(label => ({ label })),
    nodes: [
      { id: 'input', type: 'frontend', label: 'Configuration', stage: 0, row: 0 },
      { id: 'prepare', type: 'backend', label: 'Invocation', stage: 1, row: 0 },
      { id: 'task', type: 'backend', label: 'Task', stage: 2, row: 0 },
      { id: 'provider', type: 'external', label: 'Provider', stage: 2, row: 2 },
      { id: 'bytes', type: 'external', label: 'Log bytes', stage: 3, row: 2 },
      { id: 'decoded', type: 'backend', label: 'Answer and status', stage: 3, row: 0,
        sublabel: 'success / failed / timeout / cancelled' },
      { id: 'output', type: 'backend', label: 'Ordered results', stage: 4, row: 0,
        sublabel: 'complete / partial / failed' },
      { id: 'archive', type: 'database', label: 'Archive', stage: 4, row: 2 },
    ],
    flows: [
      ['input', 'prepare', 'configuration'], ['prepare', 'task', 'task input'],
      ['task', 'provider', 'command'], ['provider', 'bytes', 'log bytes'],
      ['bytes', 'decoded', 'decode'], ['task', 'decoded', 'timeout / cancellation'],
      ['decoded', 'output', 'answer'], ['output', 'archive', 'save mode'],
    ].map(([from, to, label], index) => ({ id: `f${index}`, from, to, label })),
  };
}

test('automatic dataflow width contains a nearby authored label without moving its pin', t => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Pinned payload', output: 'diagram.html', quality_profile: 'showcase' },
    stages: [{ label: 'Source' }, { label: 'Sink' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'sink', type: 'backend', label: 'Sink', stage: 1, row: 0 },
      { id: 'archive', type: 'backend', label: 'Archive', stage: 1, row: 1 },
    ],
    flows: [{ id: 'flow', from: 'sink', to: 'archive', label: 'versioned transaction payload contract', labelAt: [435, 225] }],
  };
  const { result, receipt, input, output, env } = inspect(t, diagram);
  assert.equal(result.status, 0, JSON.stringify(receipt));
  const rendered = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const width = Number(html.match(/<svg viewBox="0 0 (\d+) /)[1]);
  assert.ok(width >= 535 && width < 940, `pin should fit without the old width floor, got ${width}`);
  assert.match(html, /<text x="435" y="225"/);
  assert.match(html, /versioned transaction payload contract/);
  assert.match(html, /data-composition-points="315,186;315,242"/);
});

function longVerticalLabelDiagram(controls = {}) {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Complete payload contract', output: 'diagram.html', quality_profile: 'showcase' },
    stages: [{ label: 'Source' }, { label: 'Sink' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'sink', type: 'backend', label: 'Sink', stage: 1, row: 0 },
      { id: 'archive', type: 'backend', label: 'Archive', stage: 1, row: 1 },
    ],
    flows: [{ id: 'flow', from: 'sink', to: 'archive',
      label: 'versioned transaction payload contract with account identifiers, settlement metadata and durable audit references',
      ...controls }],
  };
}

function renderedFootprint(t, diagram) {
  const { result, receipt, input, output, env } = inspect(t, diagram);
  assert.equal(result.status, 0, JSON.stringify(receipt));
  const rendered = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const html = fs.readFileSync(output, 'utf8');
  return {
    html,
    width: Number(html.match(/<svg viewBox="0 0 (\d+) /)[1]),
    plates: [...html.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="16" rx="4" class="c-mask"/g)].map(match => match.slice(1).map(Number)),
    nodes: [...html.matchAll(/<rect x="[\d.]+" y="(?:128|242)" width="112" height="58"[^>]*>/g)].map(match => match[0]),
  };
}

for (const [profile, name, controls] of [
  ['showcase', 'unpinned', {}],
  ['showcase', 'authored relative label controls', { labelDx: 20, labelDy: 40, labelSegment: 0 }],
  ['standard', 'authored relative label controls', { labelDx: 20, labelDy: 40, labelSegment: 0 }],
]) {
  test(`automatic width includes the final ${profile} ${name} label footprint`, t => {
    const diagram = longVerticalLabelDiagram(controls);
    diagram.meta.quality_profile = profile;
    const actual = renderedFootprint(t, diagram);
    // Authored canvases retain their established placement policy. Give the
    // unpinned comparison a valid relative position to isolate node/route size.
    const wideDiagram = structuredClone(diagram);
    wideDiagram.meta.viewBox = [940, 398];
    if (name === 'unpinned') wideDiagram.flows[0].labelDy = 40;
    const wide = renderedFootprint(t, wideDiagram);
    assert.equal(actual.plates.length, 1);
    const [[left, , labelWidth]] = actual.plates;
    assert.ok(labelWidth > 480 && left > 0, 'complete label exceeds the compact canvas but has a valid left edge');
    assert.ok(actual.width >= Math.ceil(left + labelWidth + 24), 'canvas fits the final plate with the established 24px padding');
    assert.ok(actual.width < 940, 'automatic canvas retains compact packing');
    assert.ok(actual.html.includes(diagram.flows[0].label), 'full meaningful label remains present');
    if (name !== 'unpinned') assert.deepEqual(actual.plates, wide.plates, 'growing canvas preserves authored relative label coordinates');
    assert.deepEqual(actual.nodes, wide.nodes, 'growing canvas preserves node geometry');
    assert.match(actual.html, /data-composition-points="315,186;315,242"/);
    assert.equal(wide.width, 940, 'authored canvas remains authoritative');
  });
}

test('an authored narrow canvas still reports long-label overflow without resizing it', t => {
  const diagram = longVerticalLabelDiagram();
  diagram.meta.viewBox = [480, 398];
  const { result, receipt } = inspect(t, diagram);
  assert.notEqual(result.status, 0);
  const overflow = receipt.diagnostics.find(diagnostic => diagnostic.code === 'composition/label-canvas-containment');
  assert.ok(overflow);
  assert.deepEqual(overflow.evidence.viewBox, [480, 398]);
  assert.ok(overflow.evidence.overflowPx.right > 0);
});

test('five-stage unpinned pipeline passes first draft with complete text and projected typography', t => {
  const diagram = pipeline();
  const { result, receipt, input, output, env } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(receipt.composition.metrics.desktopReadabilityIssues, 0);
  assert.ok(receipt.composition.metrics.minProjectedNodeTextPx >= 6);
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
  assert.equal(render.status, 0, render.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /viewBox="0 0 1068 512"/);
  assert.match(html, /data-reader-fit="intrinsic-height"/);
  assert.ok(html.includes(diagram.nodes[5].sublabel));
  for (const flow of diagram.flows) {
    assert.ok(html.includes(flow.label), flow.label);
    const points = html.match(new RegExp(`<path[^>]*data-edge-id="${flow.id}"[^>]*data-composition-points="([^"]+)"`))[1]
      .split(';').map(point => point.split(',').map(Number));
    const mask = html.match(new RegExp(`<g data-detail="context"[^>]*data-edge-id="${flow.id}"[^>]*>\\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`));
    const [x, y, width, height] = mask.slice(1).map(Number);
    assert.ok(points.slice(1).some((end, index) =>
      segmentRectClearanceWithin({ start: points[index], end }, { x, y, width, height }, 36) <= 36), flow.id);
  }
  assert.equal(receipt.composition.metrics.maxBends, 0, 'aligned routes must remain straight');
});

test('spread vertical ports use perpendicular bridges without tiny interior segments', t => {
  const diagram = pipeline();
  diagram.stages = [{ label: 'In' }, { label: 'Out' }];
  diagram.nodes = [
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0 },
    { id: 'b', type: 'backend', label: 'Local', stage: 0, row: 1 },
    { id: 'c', type: 'backend', label: 'Remote', stage: 1, row: 1 },
  ];
  diagram.flows = [
    { from: 'a', to: 'b', label: 'local' },
    { from: 'a', to: 'c', label: 'remote', fromSide: 'bottom', toSide: 'top' },
  ];
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(receipt.composition.metrics.microSegmentCount, 0);
  assert.equal(receipt.composition.metrics.shortInteriorSegmentCount, 0);
  assert.ok(receipt.composition.metrics.minInteriorSegmentPx >= 16);
});

for (const pin of [{ labelAt: [530, 176] }, { labelDx: 0 }, { labelDy: 0 }, { labelSegment: 0 }]) {
  test(`authored ${Object.keys(pin)[0]} keeps its vertical-label collision`, t => {
    const diagram = pipeline();
    Object.assign(diagram.flows[2], pin);
    const { result, receipt } = inspect(t, diagram);
    assert.equal(result.status, 1);
    assert.ok(receipt.diagnostics.some(({ message }) => /Label "command" overlaps node "task"/.test(message)));
  });
}

test('explicit cross-row straight route and horizontal sides remain correctly rejected', t => {
  const diagram = pipeline();
  Object.assign(diagram.flows[3], { route: 'straight', fromSide: 'right', toSide: 'left' });
  diagram.nodes[4].row = 1;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ code }) => code === 'clean-flow/endpoint-side-direction'));
});

test('explicit canvas and node width retain the established typography and diagnostics', t => {
  const diagram = pipeline();
  diagram.meta.viewBox = [1180, 720];
  diagram.nodes[5].width = 160;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /Label "command" overlaps node "task"/.test(message)));
  assert.ok(!receipt.diagnostics.some(({ message }) => /7\.7px legible minimum/.test(message)));
});

test('explicit wide adjacent nodes retain the 34px flow-length floor', t => {
  const diagram = pipeline();
  diagram.meta.viewBox = [1080, 720];
  diagram.nodes[5].width = 200;
  diagram.nodes[6].width = 180;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /too short \(25px; minimum 34px\)/.test(message)));
});

test('standard keeps default node sizing and label failure instead of silently restyling', t => {
  const diagram = pipeline();
  diagram.meta.quality_profile = 'standard';
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /node "decoded" provides 104px/.test(message)));
  assert.ok(receipt.diagnostics.some(({ message }) => /Label "command" overlaps node "task"/.test(message)));
});

test('automatic labels reject a distant free island rather than lose the relationship', t => {
  const diagram = pipeline();
  diagram.stages = [{ label: 'In' }, { label: 'Out' }];
  diagram.nodes = [
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0,
      sublabel: 'Long supporting description for source', height: 100 },
    { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0,
      sublabel: 'Long supporting description for target', height: 100 },
  ];
  diagram.flows = [{ from: 'a', to: 'b', label: 'Long asset description' }];
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /Label "Long asset description" overlaps node/.test(message)));
});

test('natural height includes explicit outer route and two-line label plate', t => {
  const diagram = pipeline();
  diagram.stages = [{ label: 'In' }, { label: 'Out' }];
  diagram.nodes = [
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0 },
    { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0 },
  ];
  diagram.flows = [{ from: 'a', to: 'b', label: 'archive', classification: 'restricted',
    fromSide: 'bottom', toSide: 'bottom', via: [[100, 560], [315, 560]], labelAt: [210, 560] }];
  const { result, input, output, env } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
  assert.equal(render.status, 0, render.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /viewBox="0 0 480 674"/);
  assert.match(html, /data-composition-points="100,186;100,560;315,560;315,186"/);
  assert.match(html, /<text x="210" y="560"/);
});

function smallFootprintDiagram(flow) {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Path footprint', output: 'diagram.html', quality_profile: 'showcase' },
    stages: [{ label: 'In' }, { label: 'Out' }],
    nodes: [
      { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0 },
    ],
    flows: [{ from: 'a', to: 'b', label: 'data', ...flow }],
  };
}

function footprintSvg(t, diagram, options) {
  const { result, input, output, env, qualityArgs } = inspect(t, diagram, options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output, ...qualityArgs], { encoding: 'utf8', env });
  assert.equal(render.status, 0, render.stderr);
  return fs.readFileSync(output, 'utf8').match(/<svg\b[^]*?<\/svg>/)[0];
}

for (const [name, metaQuality, options] of [
  ['CLI showcase without JSON profile', undefined, { quality: 'showcase' }],
  ['CLI showcase overrides JSON standard', 'standard', { quality: 'showcase' }],
  ['environment showcase overrides JSON standard', 'standard', { envQuality: 'showcase' }],
  ['CLI showcase overrides environment standard', 'standard', { quality: 'showcase', envQuality: 'standard' }],
]) {
  test(`${name} enables the complete automatic showcase layout`, t => {
    const diagram = pipeline();
    if (metaQuality === undefined) delete diagram.meta.quality_profile;
    else diagram.meta.quality_profile = metaQuality;
    const svg = footprintSvg(t, diagram, options);
    assert.match(svg, /viewBox="0 0 1068 512"/);
    assert.match(svg, /data-reader-fit="intrinsic-height"/);
    assert.ok(svg.includes(diagram.nodes[5].sublabel));
    assert.equal(svg, footprintSvg(t, pipeline()), 'CLI/environment selection must match JSON showcase geometry');
  });
}

function fiveStageDiagram(profile = 'standard') {
  const diagram = pipeline();
  diagram.meta.quality_profile = profile;
  diagram.nodes = diagram.stages.map((_, stage) => ({ id: `n${stage}`, type: 'backend', label: 'Node', stage, row: 0 }));
  diagram.flows = diagram.nodes.slice(1).map((node, index) => ({ id: `f${index}`, from: `n${index}`, to: node.id, label: 'd' }));
  return diagram;
}

for (const [name, profile, options] of [
  ['JSON standard fallback', 'standard', undefined],
  ['missing profile standard default', undefined, undefined],
  ['CLI standard overrides JSON showcase', 'showcase', { quality: 'standard' }],
  ['environment standard overrides JSON showcase', 'showcase', { envQuality: 'standard' }],
  ['CLI standard overrides environment showcase', 'showcase', { quality: 'standard', envQuality: 'showcase' }],
]) {
  test(`${name} fits five stages while preserving standard sizing and height`, t => {
    const diagram = fiveStageDiagram(profile);
    if (profile === undefined) delete diagram.meta.quality_profile;
    const svg = footprintSvg(t, diagram, options);
    assert.match(svg, /viewBox="0 0 1068 720"/);
    assert.equal((svg.match(/width="112" height="58" rx="6" class="c-mask"/g) || []).length, 5);
    assert.equal((svg.match(/data-composition-frame-kind="stage"/g) || []).length, 5);
  });
}

for (const profile of ['standard', 'showcase']) {
  test(`${profile} automatic width contains mixed authored and default node widths`, t => {
    const diagram = fiveStageDiagram(profile);
    diagram.nodes[0].width = 152;
    diagram.nodes[4].width = 220;
    const svg = footprintSvg(t, diagram);
    assert.match(svg, /viewBox="0 0 1094 720"/);
    assert.match(svg, /x="24" y="128" width="152" height="58"/);
    assert.match(svg, /x="850" y="128" width="220" height="58"/);
    assert.equal((svg.match(/width="112" height="58" rx="6" class="c-mask"/g) || []).length, 3);
  });
}

test('an explicit insufficient canvas retains its width and bounds diagnostics', t => {
  const diagram = fiveStageDiagram('showcase');
  diagram.meta.viewBox = [940, 720];
  const { result, receipt, input, output, env } = inspect(t, diagram, { quality: 'showcase' });
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /Node "n4" exceeds the horizontal bounds/.test(message)));
  assert.ok(receipt.diagnostics.some(({ message }) => /Stages exceed viewBox width/.test(message)));
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output, '--quality', 'showcase'], { encoding: 'utf8', env });
  assert.equal(render.status, 1);
  assert.equal(fs.existsSync(output), false, 'a fixed insufficient canvas must remain rejected');
});

test('straight ignores inactive channelY in both route and natural height', t => {
  const plain = footprintSvg(t, smallFootprintDiagram({ route: 'straight' }));
  const inactive = footprintSvg(t, smallFootprintDiagram({ route: 'straight', channelY: 1500 }));
  assert.match(plain, /viewBox="0 0 480 360"/);
  assert.match(plain, /data-composition-points="156,157;259,157"/);
  assert.equal(inactive, plain);
});

test('explicit via overrides channelY in both route and natural height', t => {
  const flow = { route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom',
    via: [[100, 560], [315, 560]], labelAt: [210, 560], classification: 'restricted' };
  const plain = footprintSvg(t, smallFootprintDiagram(flow));
  const inactive = footprintSvg(t, smallFootprintDiagram({ ...flow, channelY: 1500 }));
  assert.match(plain, /viewBox="0 0 480 674"/);
  assert.equal(inactive, plain);
});

test('labelAt overrides labelDy in both label and natural height', t => {
  const flow = { route: 'straight', labelAt: [210, 210] };
  const plain = footprintSvg(t, smallFootprintDiagram(flow));
  const inactive = footprintSvg(t, smallFootprintDiagram({ ...flow, labelDy: 1500 }));
  assert.match(plain, /viewBox="0 0 480 360"/);
  assert.match(plain, /<text x="210" y="210"/);
  assert.equal(inactive, plain);
});

test('empty authored via also suppresses the preset channel footprint', t => {
  const flow = { route: 'bottom-channel', fromSide: 'right', toSide: 'left', via: [] };
  const plain = footprintSvg(t, smallFootprintDiagram(flow));
  const inactive = footprintSvg(t, smallFootprintDiagram({ ...flow, channelY: 1500 }));
  assert.match(plain, /viewBox="0 0 480 360"/);
  assert.equal(inactive, plain);
});

for (const [name, flow, expectedPoints, expectedHeight] of [
  ['default bottom channel', { route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom', labelAt: [210, 230] },
    '100,186;100,212;315,212;315,186', 360],
  ['authored bottom channel', { route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom', channelY: 700, labelAt: [210, 700], classification: 'restricted' },
    '100,186;100,700;315,700;315,186', 814],
  ['default top channel', { route: 'top-channel', fromSide: 'top', toSide: 'top', labelAt: [210, 100] },
    '100,128;100,104;315,104;315,128', 360],
  ['authored top channel', { route: 'top-channel', fromSide: 'bottom', toSide: 'bottom', channelY: 700, labelAt: [210, 700], classification: 'restricted' },
    '100,186;100,700;315,700;315,186', 814],
  ['authored label offset', { route: 'straight', labelDy: 550, classification: 'restricted' },
    '156,157;259,157', 811],
]) {
  test(`natural height contains actual points and final label plate for ${name}`, t => {
    const svg = footprintSvg(t, smallFootprintDiagram(flow));
    assert.ok(svg.includes(`viewBox="0 0 480 ${expectedHeight}"`), svg.slice(0, 200));
    assert.ok(svg.includes(`data-composition-points="${expectedPoints}"`));
    const contentBottom = expectedHeight - 74 - 24;
    for (const point of expectedPoints.split(';')) assert.ok(Number(point.split(',')[1]) <= contentBottom);
    const masks = [...svg.matchAll(/<rect\b[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"[^>]*class="c-mask"/g)];
    assert.equal(masks.length, 3, 'two node masks and the rendered label plate must be measured');
    for (const match of masks) assert.ok(Number(match[1]) + Number(match[2]) <= contentBottom);
  });
}

// Frozen public SVG bytes from dev e23fc2c5, with only the legend row
// re-measured at its rendered font size. The complete HTML/receipt byte
// comparison is recorded in the PR evidence; SVG isolates renderer behavior
// from unrelated future Viewer-template changes.
for (const [name, mutate, expectedSha256] of [
  ['standard-auto', diagram => { diagram.meta.quality_profile = 'standard'; }, '99637c1e91964415abeff668d89e7126ff12960d69d535a570f7a452b088f528'],
  ['explicit-viewbox', diagram => { diagram.meta.viewBox = [1080, 720]; }, 'd738f4c38e336886aaf86bc769ea8b401e540da0f9566330b559408340968879'],
  ['explicit-one-width', diagram => { diagram.nodes[0].width = 152; }, '0533eb9cfbd3a6a5bbd99c01342a3cf07429dc834fd2d446409eb35448a601ec'],
  ['explicit-both', diagram => { diagram.meta.viewBox = [1080, 720]; diagram.nodes[0].width = 152; }, '0d2ee82e89eeb9e1c83e2002f72b004adfe876fb6d50dc91d465f8e778d3e8dd'],
]) {
  test(`dev geometry compatibility outside default motion for ${name}`, t => {
    const diagram = smallFootprintDiagram({ id: 'f' });
    diagram.nodes[0].sublabel = 'context text for processing';
    mutate(diagram);
    const { result, input, output, env } = inspect(t, diagram);
    assert.equal(result.status, name === 'explicit-viewbox' ? 1 : 0, result.stdout + result.stderr);
    const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
    assert.equal(render.status, 0, render.stderr);
    const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[^]*?<\/svg>/)[0]
      .replace(/ data-animation="trace"/g, '')
      .replace(/ data-animate="(?:node|edge)" style="--step:[^"]*"/g, '');
    assert.equal(crypto.createHash('sha256').update(svg).digest('hex'), expectedSha256);
  });
}

test('automatic dataflow routes honor perpendicular pinned sides', t => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Pinned sides', output: 'diagram.html', quality_profile: 'showcase' },
    stages: [{ label: 'A' }, { label: 'B' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 1 },
      { id: 'target', type: 'backend', label: 'Target', stage: 1, row: 0 },
    ],
    flows: [{ id: 'push', from: 'source', to: 'target', label: 'push', fromSide: 'right', toSide: 'bottom' }],
  };
  const { result, receipt, input, output, env } = inspect(t, diagram);
  assert.equal(result.status, 0, JSON.stringify(receipt.diagnostics));
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8', env });
  assert.equal(render.status, 0, render.stderr);
  const points = fs.readFileSync(output, 'utf8').match(/data-composition-points="([^"]+)"/)[1]
    .split(';').map(point => point.split(',').map(Number));
  assert.equal(points.length, 3, JSON.stringify(points));
  assert.ok(points[1][1] > points[2][1], 'final segment rises into the bottom side');
});

test('automatic dataflow routes across stages turn in a clear gap, not inside a middle node', t => {
  const diagram = {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Across stages', output: 'diagram.html', quality_profile: 'showcase' },
    stages: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
    nodes: [
      { id: 'source', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'middle', type: 'backend', label: 'Middle', stage: 1, row: 0 },
      { id: 'other', type: 'backend', label: 'Other', stage: 2, row: 0 },
      { id: 'target', type: 'backend', label: 'Target', stage: 3, row: 1 },
    ],
    flows: [{ id: 'push', from: 'source', to: 'target', label: 'push' }],
  };
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 0, JSON.stringify(receipt.diagnostics));
});
