import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function workflowFixture() {
  return JSON.parse(fs.readFileSync(
    new URL('./fixtures/workflow-routing-clarity.workflow.json', import.meta.url),
    'utf8',
  ));
}

function edgeTag(svg, from, to) {
  const tag = (svg.match(/<path\b[^>]*>/g) || []).find((candidate) => (
    candidate.includes(`data-edge-from="${from}"`) && candidate.includes(`data-edge-to="${to}"`)
  ));
  assert.ok(tag, `expected rendered ${from}->${to}`);
  return tag;
}

test('readable-v2 separates unrelated automatic branches that meet at a bend', () => {
  const workflow = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Independent failure branches', locale: 'zh-CN', output: 'branches.html' },
    lanes: [{ id: 'sender', label: '请求处理' }, { id: 'stop', label: '失败处理', variant: 'exception' }],
    nodes: [
      { id: 'request', lane: 'sender', col: 0, type: 'external', label: '提交请求', sublabel: '待处理业务任务' },
      { id: 'resolve', lane: 'sender', col: 1, type: 'security', label: '验证并选择目标', sublabel: '检查请求目标 · 排除自身' },
      { id: 'dispatch', lane: 'sender', col: 3, type: 'messagebus', label: '发送任务卡', sublabel: '新 ID · 当前协议' },
      { id: 'targetStop', lane: 'stop', col: 0, type: 'security', label: '目标不明确', sublabel: '无目标 / 多目标 / 当前未知' },
      { id: 'deliveryFail', lane: 'stop', col: 1, type: 'security', label: '发送失败', sublabel: '未完成 · 保留记录' },
      { id: 'invalid', lane: 'stop', col: 2, type: 'security', label: '拒绝错误请求', sublabel: '不执行 invalid 操作' },
    ],
    edges: [
      { id: 'resolve-targetStop', from: 'resolve', to: 'targetStop', label: '不明确', role: 'error' },
      { id: 'dispatch-deliveryFail', from: 'dispatch', to: 'deliveryFail', label: '拒绝', role: 'error' },
    ],
  };
  const before = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const [left, right] = result.receipt.edges;
  // For orthogonal segments, disjoint bounding boxes prove no crossing or
  // touching. This independently checks the visible paths, not router scores.
  const boxes = route => route.points.slice(1).map((end, i) => {
    const start = route.points[i];
    assert.ok(start[0] === end[0] || start[1] === end[1]);
    return { minX: Math.min(start[0], end[0]), maxX: Math.max(start[0], end[0]),
      minY: Math.min(start[1], end[1]), maxY: Math.max(start[1], end[1]) };
  });
  for (const a of boxes(left)) for (const b of boxes(right)) {
    assert.ok(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY,
      'two unrelated conditions must not acquire a false visual junction');
  }
  assert.deepEqual(result.receipt.nodes.map(n => n.id), workflow.nodes.map(n => n.id));
  assert.deepEqual(result.receipt.edges.map(e => [e.id, e.from, e.to]).sort(),
    workflow.edges.map(e => [e.id, e.from, e.to]).sort());
  assert.deepEqual(result.receipt.labels.map(l => l.label).sort(), ['不明确', '拒绝'].sort());
  assert.deepEqual(workflow, before);
});

test('readable-v2 keeps a clear vertical main step straight when its source also branches', () => {
  const workflow = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Payment and timeout', output: 'payment.html' },
    lanes: [{ id: 'checkout', label: 'Checkout' }, { id: 'expiry', label: 'Expiry' }],
    mainPath: ['pending', 'pay'],
    nodes: [
      { id: 'pending', lane: 'checkout', col: 2, yOffset: 0, type: 'backend', label: 'Pending order' },
      { id: 'pay', lane: 'checkout', col: 2, yOffset: 80, type: 'cloud', label: 'Payment' },
      { id: 'timeout', lane: 'expiry', col: 2, type: 'security', label: 'Timeout' },
    ],
    edges: [
      { id: 'pending-pay', from: 'pending', to: 'pay', role: 'main' },
      { id: 'pending-timeout', from: 'pending', to: 'timeout', role: 'branch', label: 'Still unpaid', variant: 'dashed' },
    ],
  };
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const route = result.receipt.edges.find(edge => edge.id === 'pending-pay');
  const from = result.receipt.nodes.find(node => node.id === 'pending');
  const to = result.receipt.nodes.find(node => node.id === 'pay');
  assert.deepEqual(route.points, [
    [from.x + from.width / 2, from.y + from.height],
    [to.x + to.width / 2, to.y],
  ], 'a clear vertical gap must not acquire a side detour from provisional port spreading');
  assert.equal(result.receipt.edges.length, 2, 'the timeout branch must remain present');
  assert.equal(result.receipt.labels.find(label => label.edge === 'pending-timeout').label, 'Still unpaid');
  assert.deepEqual(workflow, original);
});

test('readable-v2 uses a clear internal corridor for a long same-column branch', () => {
  const workflow = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Payment and expiry', locale: 'zh-CN', output: 'expiry.html' },
    lanes: [
      { id: 'checkout', label: '下单与支付' },
      { id: 'fulfillment', label: '支付成功后履约' },
      { id: 'exceptions', label: '库存不足 / 支付失败', variant: 'exception' },
      { id: 'expiry', label: '超时关闭与回收', variant: 'exception' },
    ],
    nodes: [
      { id: 'pending', lane: 'checkout', col: 2, type: 'backend', label: '创建待支付订单', sublabel: '订单服务' },
      { id: 'pay', lane: 'checkout', col: 2, yOffset: 80, type: 'cloud', label: '发起支付', sublabel: '支付服务', icon: 'decision' },
      { id: 'failed', lane: 'exceptions', col: 2, type: 'external', label: '支付失败，可重试', sublabel: '买家重试支付', icon: 'failure' },
      { id: 'event', lane: 'fulfillment', col: 3, type: 'messagebus', label: '投递 OrderPaid', sublabel: '订单服务' },
      { id: 'timeout', lane: 'expiry', col: 2, type: 'security', label: '超过 15 分钟？', sublabel: '订单服务检查未支付订单', icon: 'decision' },
      { id: 'close', lane: 'expiry', col: 1, type: 'backend', label: '超时关闭订单', sublabel: '订单服务', icon: 'stop' },
    ],
    edges: [
      { id: 'pending-pay', from: 'pending', to: 'pay', role: 'main' },
      { id: 'pay-failed', from: 'pay', to: 'failed', role: 'error', label: '支付失败', variant: 'security' },
      { id: 'retry-pay', from: 'failed', to: 'pay', role: 'return', label: '未超时，重试', variant: 'dashed' },
      { id: 'pending-timeout', from: 'pending', to: 'timeout', role: 'branch', label: '持续未支付', variant: 'dashed' },
      { id: 'timeout-close', from: 'timeout', to: 'close', role: 'error', label: '是，仍未支付', variant: 'security' },
    ],
  };
  const original = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const route = result.receipt.edges.find(edge => edge.id === 'pending-timeout');
  const from = result.receipt.nodes.find(node => node.id === 'pending');
  const to = result.receipt.nodes.find(node => node.id === 'timeout');
  const length = route.points.slice(1).reduce((sum, point, index) => sum
    + Math.abs(point[0] - route.points[index][0]) + Math.abs(point[1] - route.points[index][1]), 0);
  assert.ok(length < 2 * Math.abs(to.y - from.y),
    'this unobstructed internal corridor should avoid a trip around the whole diagram');
  assert.deepEqual(result.receipt.edges.map(edge => edge.id).sort(), workflow.edges.map(edge => edge.id).sort());
  assert.deepEqual(result.receipt.labels.map(label => label.label).sort(), workflow.edges.filter(edge => edge.label).map(edge => edge.label).sort());
  assert.deepEqual(workflow, original);
});

test('readable-v2 keeps clear backward branches straight after provisional port spreading', () => {
  for (const role of ['error', 'return', undefined]) {
    const workflow = {
      schema_version: 2, diagram_type: 'workflow',
      meta: { title: 'Timeout branch', locale: 'zh-CN', output: 'timeout.html' },
      lanes: ['checkout', 'fulfillment', 'expiry'].map(id => ({ id, label: id })),
      nodes: [
        { id: 'pending', lane: 'checkout', col: 3, type: 'backend', label: '创建待支付订单' },
        { id: 'pick', lane: 'fulfillment', col: 4, type: 'backend', label: '拣货' },
        { id: 'timeout', lane: 'expiry', col: 4, type: 'security', label: '超过 15 分钟？' },
        { id: 'close', lane: 'expiry', col: 3, type: 'backend', label: '超时关闭订单' },
      ],
      edges: [
        { id: 'pending-timeout', from: 'pending', to: 'timeout', role: 'branch', label: '持续未支付', variant: 'dashed' },
        { id: 'timeout-close', from: 'timeout', to: 'close', role, label: '是，仍未支付', variant: 'security' },
      ],
    };
    const before = structuredClone(workflow);
    const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const edge = result.receipt.edges.find(entry => entry.id === 'timeout-close');
    assert.equal(edge.points.length, 2, 'a clear backward branch must not loop below the lane');
    assert.equal(edge.points[0][1], edge.points[1][1], 'keep the facing route horizontal');
    assert.ok(edge.points[0][0] > edge.points[1][0], 'preserve the backward relationship');
    assert.equal(result.receipt.labels.find(entry => entry.edge === edge.id).label, '是，仍未支付');
    assert.equal(result.receipt.nodes.length, workflow.nodes.length);
    assert.equal(result.receipt.edges.length, workflow.edges.length);
    assert.deepEqual(workflow, before, 'routing must preserve the authored document');
  }
});

test('readable-v2 keeps clear adjacent routes straight while fitting full node text', () => {
  const workflow = workflowFixture();
  const before = structuredClone(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  // Widths and canvas are automatic: preferred secondary text may grow them.
  // Preserve the authored content and straight facing relationships below.
  assert.deepEqual(workflow, before);
  for (const node of workflow.nodes) {
    assert.ok(result.svg.includes(`>${node.label}</text>`), `preserve full label for ${node.id}`);
    if (node.sublabel) assert.ok(result.svg.includes(`>${node.sublabel}</text>`), `preserve full context for ${node.id}`);
  }
  assert.equal(result.receipt.nodes.length, workflow.nodes.length);
  assert.equal(result.receipt.edges.length, workflow.edges.length);
  assert.deepEqual(result.receipt.nodes.map(({ id }) => id).sort(), workflow.nodes.map(({ id }) => id).sort());
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(), workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());

  const adjacentRoutes = [['turn', 'tool'], ['commit', 'project']].map(([from, to]) => {
    const edge = result.receipt.edges.find((candidate) => candidate.from === from && candidate.to === to);
    assert.ok(edge, `expected the authored ${from}->${to} relationship`);
    const source = result.receipt.nodes.find(({ id }) => id === from);
    const target = result.receipt.nodes.find(({ id }) => id === to);
    assert.deepEqual(edge.points, [
      [source.x + source.width, source.y + source.height / 2],
      [target.x, target.y + target.height / 2],
    ], 'clear adjacent routes must connect facing node borders horizontally');
    return { from, to, pointCount: edge.points.length };
  });
  assert.deepEqual(adjacentRoutes, [
    { from: 'turn', to: 'tool', pointCount: 2 },
    { from: 'commit', to: 'project', pointCount: 2 },
  ], 'clear adjacent forward relationships should not take channel detours');
});

test('readable-v2 separates opposing routes that meet at a shared node', () => {
  const result = compileWorkflow({ workflow: workflowFixture(), qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const edges = result.receipt.edges;
  const opposingCorridors = [];
  for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
    const first = edges[firstIndex];
    for (const second of edges.slice(firstIndex + 1)) {
      if (![first.from, first.to].some((id) => id === second.from || id === second.to)) continue;
      for (let firstSegment = 0; firstSegment < first.points.length - 1; firstSegment += 1) {
        const [a, b] = first.points.slice(firstSegment, firstSegment + 2);
        for (let secondSegment = 0; secondSegment < second.points.length - 1; secondSegment += 1) {
          const [c, d] = second.points.slice(secondSegment, secondSegment + 2);
          for (const axis of [0, 1]) {
            const fixedAxis = 1 - axis;
            if (a[fixedAxis] !== b[fixedAxis] || c[fixedAxis] !== d[fixedAxis]
                || a[fixedAxis] !== c[fixedAxis]) continue;
            if ((b[axis] - a[axis]) * (d[axis] - c[axis]) >= 0) continue;
            const overlapPx = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
              - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
            if (overlapPx >= 8) {
              opposingCorridors.push({
                first: `${first.from}->${first.to}`,
                second: `${second.from}->${second.to}`,
                overlapPx,
              });
            }
          }
        }
      }
    }
  }

  assert.deepEqual(opposingCorridors, [], 'incoming and outgoing arrows must remain distinguishable at shared nodes');
});

test('readable-v2 routing remains deterministic and preserves every authored relationship', () => {
  const workflow = workflowFixture();
  const before = JSON.stringify(workflow);
  const first = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.equal(JSON.stringify(workflow), before, 'compilation must not mutate its input');
  assert.equal(first.receipt.nodes.length, 9);
  assert.deepEqual(
    first.receipt.edges.map(({ from, to }) => `${from}->${to}`).sort(),
    workflow.edges.map(({ from, to }) => `${from}->${to}`).sort(),
  );

  const reordered = workflowFixture();
  reordered.nodes.reverse();
  reordered.edges.reverse();
  for (const document of [workflow, reordered]) {
    const repeated = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
    assert.equal(repeated.ok, true, JSON.stringify(repeated.diagnostics, null, 2));
    assert.deepEqual(repeated.receipt, first.receipt);
    assert.equal(repeated.svg, first.svg);
  }
});

test('readable-v2 preserves authored sides, routes, channels, vias, and label positions', () => {
  const cases = [
    { fromSide: 'right', toSide: 'left' },
    { route: 'straight' },
    { route: 'bottom-channel' },
    { channelY: 425 },
    { via: [[716.8, 425], [836.8, 425]], fromSide: 'bottom', toSide: 'bottom' },
    { labelAt: [776.8, 415] },
  ];
  for (const authored of cases) {
    const workflow = workflowFixture();
    Object.assign(workflow.edges.find(({ from, to }) => from === 'commit' && to === 'project'), authored);
    const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
    assert.equal(result.ok, true, JSON.stringify({ authored, diagnostics: result.diagnostics }, null, 2));
    const edge = result.receipt.edges.find(({ from, to }) => from === 'commit' && to === 'project');
    const source = result.receipt.nodes.find(({ id }) => id === 'commit');
    const target = result.receipt.nodes.find(({ id }) => id === 'project');
    assert.doesNotMatch(edgeTag(result.svg, 'commit', 'project'), /data-composition-routing=/);
    assert.match(edgeTag(result.svg, 'request', 'admit'), /data-composition-routing="workflow-v2-auto"/);
    if (authored.fromSide === 'right') assert.equal(edge.points[0][0], source.x + source.width);
    if (authored.toSide === 'left') assert.equal(edge.points.at(-1)[0], target.x);
    if (authored.fromSide === 'bottom') assert.equal(edge.points[0][1], source.y + source.height);
    if (authored.toSide === 'bottom') assert.equal(edge.points.at(-1)[1], target.y + target.height);
    if (authored.route === 'straight') assert.equal(edge.points.length, 2);
    if (authored.route === 'bottom-channel') {
      assert.ok(edge.points.slice(1, -1).every(([, y]) => y > Math.max(source.y + source.height, target.y + target.height)));
    }
    if (authored.channelY !== undefined) {
      assert.ok(edge.points.some((point, index) => index > 0 && point[1] === authored.channelY
        && edge.points[index - 1][1] === authored.channelY));
    }
    if (authored.via) assert.deepEqual(edge.points.slice(1, -1), authored.via);
    if (authored.labelAt) {
      const label = result.receipt.labels.find(({ label: text }) => text === 'projection');
      assert.deepEqual([label.x, label.y], authored.labelAt);
    }
  }
});

test('fixed-v1 stays outside the automatic workflow routing contract', () => {
  const workflow = JSON.parse(fs.readFileSync(
    new URL('./fixtures/v1-baseline/agent-tool-call.workflow.json', import.meta.url),
    'utf8',
  ));
  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.receipt.contract, 'fixed-v1');
  assert.deepEqual(result.receipt.viewBox, [720, 900]);
  assert.equal(result.receipt.edges.length, workflow.edges.length);
  assert.doesNotMatch(result.svg, /data-composition-routing="workflow-v2-auto"/);
});

test('readable-v2 keeps emphasis and wide-arrow fan-in marker bounds disjoint', () => {
  for (const width of [undefined, 6]) {
    const workflow = {
      schema_version: 2,
      diagram_type: 'workflow',
      meta: { title: 'Shared destination', output: 'shared-destination.html', legend: { mode: 'hidden' } },
      lanes: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
      nodes: ['a', 'b', 'c'].map((id) => ({
        id, lane: id, col: id === 'c' ? 2 : 0, type: 'backend', label: id.toUpperCase(),
      })),
      edges: ['a', 'b'].map((from) => ({
        from, to: 'c', variant: 'emphasis', ...(width === undefined ? {} : { width }),
      })),
    };
    const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const destination = result.receipt.nodes.find(({ id }) => id === 'c');
    const topRoute = result.receipt.edges.find(({ from }) => from === 'a').points;
    const leftRoute = result.receipt.edges.find(({ from }) => from === 'b').points;
    const topTip = topRoute.at(-1);
    const leftTip = leftRoute.at(-1);
    assert.deepEqual(topTip, [destination.x + destination.width / 2, destination.y]);
    assert.equal(topRoute.at(-2)[0], topTip[0]);
    assert.ok(topRoute.at(-2)[1] < topTip[1], 'the top arrow arrives downward');
    // The bundled 10x7 marker has refX=9: these perpendicular marker bounds
    // remain disjoint even with a 6px stroke, without relying on router helpers.
    const strokeWidth = width ?? 1.8;
    if (leftTip[1] === destination.y) {
      assert.equal(leftRoute.at(-2)[0], leftTip[0]);
      assert.ok(leftRoute.at(-2)[1] < leftTip[1]);
      assert.ok(Math.abs(topTip[0] - leftTip[0]) >= 7 * strokeWidth,
        'parallel arrivals must have non-overlapping marker bounds');
    } else {
      assert.deepEqual(leftTip, [destination.x, destination.y + destination.height / 2]);
      assert.equal(leftRoute.at(-2)[1], leftTip[1]);
      assert.ok(leftRoute.at(-2)[0] < leftTip[0]);
      assert.ok(topTip[0] - 3.5 * strokeWidth > leftTip[0] + strokeWidth,
        'the top marker must remain to the right of the left marker');
    }
  }
});

test('public validate and rendered HTML agree on automatic workflow routing', (t) => {
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const input = fileURLToPath(new URL('./fixtures/workflow-routing-clarity.workflow.json', import.meta.url));
  const validation = spawnSync(process.execPath, [cli, 'validate', 'workflow', input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  const receipt = JSON.parse(validation.stdout);
  assert.equal(receipt.ok, true);
  assert.ok(receipt.checks.length > 0);
  assert.ok(receipt.checks.every(({ ok }) => ok));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-routing-clarity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'workflow.html');
  const rendered = spawnSync(process.execPath, [cli, 'render', 'workflow', input, output, '--quality', 'showcase'], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.equal((html.match(/data-composition-routing="workflow-v2-auto"/g) || []).length, 11);
  const checked = spawnSync(process.execPath, [cli, 'check', output, '--json'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).ok, true);
});

test('preferred secondary widths preserve all branches into the repair node', () => {
  // Real first draft: preferred context widths exposed adjacent repair arrows
  // colliding in the old planner. Preserve all failure and review relationships.
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-preferred-secondary-routing.json', import.meta.url), 'utf8'));
  const before = structuredClone(workflow);
  assert.equal(workflow.nodes.length, 9);
  assert.equal(workflow.edges.length, 14);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, before);
  assert.ok(result.receipt.nodes.every(({ width }) => width <= 200));
  assert.deepEqual(result.receipt.nodes.map(({ id }) => id).sort(), workflow.nodes.map(({ id }) => id).sort());
  assert.deepEqual(result.receipt.edges.map(({ from, to }) => [from, to]).sort(), workflow.edges.map(({ from, to }) => [from, to]).sort());
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(), workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());
  for (const node of workflow.nodes) {
    assert.ok(result.svg.includes(`>${node.label}</text>`), `preserve full label for ${node.id}`);
    assert.ok(result.svg.includes(`font-size="8" text-anchor="middle">${node.sublabel}</text>`), `preserve full preferred-size context for ${node.id}`);
  }
  for (const edge of workflow.edges) {
    assert.equal(attributeRole(edgeTag(result.svg, edge.from, edge.to)), edge.role || '');
  }
});

function attributeRole(tag) {
  return tag.match(/data-edge-role="([^"]*)"/)?.[1];
}

test('an automatic cross-lane return stays outside the lane and exception frames', () => {
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-frame-clearance.json', import.meta.url), 'utf8'));
  const before = structuredClone(workflow);
  assert.equal(workflow.nodes.length, 16);
  assert.equal(workflow.edges.length, 17);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, before);
  assert.deepEqual(result.receipt.nodes.map(({ id }) => id).sort(), workflow.nodes.map(({ id }) => id).sort());
  assert.deepEqual(result.receipt.edges.map(({ from, to }) => [from, to]).sort(), workflow.edges.map(({ from, to }) => [from, to]).sort());
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(), workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());
  for (const node of workflow.nodes) {
    assert.ok(result.svg.includes(`>${node.label}</text>`), `preserve full label for ${node.id}`);
    if (node.sublabel) assert.ok(result.svg.includes(`>${node.sublabel}</text>`), `preserve full context for ${node.id}`);
  }

  // Compare the return to the rendered frame envelope, not frozen automatic
  // coordinates or a global near-border threshold. This return has room to
  // remain visibly outside both the right rail and the bottom shelf.
  const frames = (result.svg.match(/<rect\b[^>]*>/g) || []).filter(tag => (
    /data-composition-frame-kind="(?:lane|exception-lane)"/.test(tag)
  ));
  assert.ok(frames.length > workflow.lanes.length, 'retain the exception grouping frame');
  const number = (tag, name) => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
  const frameRight = Math.max(...frames.map(tag => number(tag, 'x') + number(tag, 'width')));
  const frameBottom = Math.max(...frames.map(tag => number(tag, 'y') + number(tag, 'height')));
  const route = result.receipt.edges.find(({ from, to }) => from === 'receipt' && to === 'undo_confirm');
  assert.ok(route);
  const segments = route.points.slice(1).map((end, index) => [route.points[index], end]);
  const vertical = segments.filter(([start, end]) => start[0] === end[0])
    .sort((a, b) => Math.abs(b[1][1] - b[0][1]) - Math.abs(a[1][1] - a[0][1]))[0];
  const horizontal = segments.filter(([start, end]) => start[1] === end[1])
    .sort((a, b) => Math.abs(b[1][0] - b[0][0]) - Math.abs(a[1][0] - a[0][0]))[0];
  assert.ok(vertical && horizontal, 'preserve the return rail and shelf');
  assert.ok(vertical[0][0] > frameRight, 'the long return rail must remain outside the frame envelope');
  assert.ok(horizontal[0][1] > frameBottom, 'the return shelf must remain below the frame envelope');
});

test('implicit labels clear lane borders while preserving an authored source side', () => {
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-label-frame-clearance.json', import.meta.url), 'utf8'));
  const before = structuredClone(workflow);
  assert.equal(workflow.nodes.length, 16);
  assert.equal(workflow.edges.length, 17);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, before);
  const placement = nodes => nodes.map(({ id, lane, col }) => [id, lane, col]).sort();
  assert.deepEqual(placement(result.receipt.nodes), placement(workflow.nodes));
  const topology = edges => edges.map(({ from, to }) => JSON.stringify([from, to])).sort();
  assert.deepEqual(topology(result.receipt.edges), topology(workflow.edges));
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(), workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());
  for (const node of workflow.nodes) {
    assert.ok(result.svg.includes('>' + node.label + '</text>'), 'preserve full label for ' + node.id);
    if (node.sublabel) assert.ok(result.svg.includes('>' + node.sublabel + '</text>'), 'preserve full context for ' + node.id);
  }
  for (const edge of workflow.edges) {
    assert.equal(attributeRole(edgeTag(result.svg, edge.from, edge.to)), edge.role || '');
  }

  const scan = result.receipt.nodes.find(({ id }) => id === 'scan');
  const route = result.receipt.edges.find(({ from, to }) => from === 'scan' && to === 'state');
  assert.ok(scan && route);
  assert.equal(workflow.edges.find(({ from, to }) => from === 'scan' && to === 'state').fromSide, 'bottom');
  const [start, next] = route.points;
  assert.equal(start[1], scan.y + scan.height, 'honor the authored bottom source side');
  assert.ok(start[0] >= scan.x && start[0] <= scan.x + scan.width);
  assert.equal(next[0], start[0]);
  assert.ok(next[1] > start[1], 'the authored bottom departure points downward');

  const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
  const box = tag => {
    const values = attrs(tag);
    const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(values[key])]));
    assert.ok(Object.values(rect).every(Number.isFinite));
    assert.ok(rect.width > 0 && rect.height > 0);
    return rect;
  };
  const labelGroups = [...result.svg.matchAll(/<g\b(?=[^>]*data-edge-from=)(?=[^>]*data-edge-label=)[^>]*>[\s\S]*?<\/g>/g)];
  const targetGroups = labelGroups.filter(([group]) => {
    const values = attrs(group);
    return values['data-edge-from'] === 'scan' && values['data-edge-to'] === 'state';
  });
  assert.equal(targetGroups.length, 1);
  const targetGroup = targetGroups[0][0];
  assert.equal((targetGroup.match(/>保存<\/text>/g) || []).length, 1);
  const targetRects = targetGroup.match(/<rect\b[^>]*class="c-mask"[^>]*>/g) || [];
  assert.equal(targetRects.length, 1);
  const mask = box(targetRects[0]);
  const text = attrs(targetGroup.match(/<text\b[^>]*>/)[0]);
  const matchingReceipt = result.receipt.labels.filter(label => label.label === '保存'
    && label.x === Number(text.x) && label.y === Number(text.y));
  assert.equal(matchingReceipt.length, 1, 'receipt and rendered label must agree');
  const receiptLabel = matchingReceipt[0];
  assert.deepEqual(mask, {
    x: receiptLabel.x - receiptLabel.width / 2, y: receiptLabel.y - 10,
    width: receiptLabel.width, height: receiptLabel.height,
  });

  const flowId = 'lane-' + workflow.lanes.findIndex(({ id }) => id === 'flow');
  const frameTags = (result.svg.match(/<rect\b[^>]*>/g) || []).filter(tag => attrs(tag)['data-composition-frame-id'] === flowId);
  assert.equal(frameTags.length, 1, 'retain the actual flow lane frame');
  const frame = box(frameTags[0]);
  const frameAttrs = attrs(frameTags[0]);
  const radius = Number(frameAttrs.rx || 0);
  const frameHalfStroke = Number(frameAttrs['stroke-width']) / 2;
  assert.ok(Number.isFinite(radius) && Number.isFinite(frameHalfStroke));
  assert.ok(mask.x >= frame.x + radius && mask.x + mask.width <= frame.x + frame.width - radius,
    'this fixture tests the straight frame border, away from rounded corners');
  const bottom = frame.y + frame.height;
  assert.ok(mask.y + mask.height < bottom - frameHalfStroke || mask.y > bottom + frameHalfStroke,
    'the semantic label mask must not contact the actual lane bottom stroke');

  const disjoint = (a, b) => a.x + a.width < b.x || b.x + b.width < a.x
    || a.y + a.height < b.y || b.y + b.height < a.y;
  // Inspect rendered rectangles; do not copy the fallback anchor algorithm.
  for (const node of workflow.nodes) {
    const nodeGroup = [...result.svg.matchAll(/<g\b(?=[^>]*data-node-id=)[^>]*>[\s\S]*?<\/g>/g)]
      .find(([group]) => attrs(group)['data-node-id'] === node.id)?.[0];
    assert.ok(nodeGroup, 'retain rendered node ' + node.id);
    const paintTag = (nodeGroup.match(/<rect\b[^>]*>/g) || []).find(tag => attrs(tag)['data-animate'] === 'node');
    assert.ok(paintTag, 'retain the painted node rectangle for ' + node.id);
    const nodeBox = box(paintTag);
    const halfStroke = Number(attrs(paintTag)['stroke-width']) / 2;
    assert.ok(Number.isFinite(halfStroke));
    assert.ok(disjoint(mask, {
      x: nodeBox.x - halfStroke, y: nodeBox.y - halfStroke,
      width: nodeBox.width + 2 * halfStroke, height: nodeBox.height + 2 * halfStroke,
    }), 'label mask must not cover node ' + node.id);
  }
  for (const [group] of labelGroups) {
    if (group === targetGroup) continue;
    const otherMask = group.match(/<rect\b[^>]*class="c-mask"[^>]*>/)?.[0];
    assert.ok(otherMask, 'retain every other semantic label mask');
    assert.ok(disjoint(mask, box(otherMask)), 'moving the label must not obscure another label');
  }
});


test('a labeled repair return uses the available outer envelope without losing failure paths', () => {
  const workflow = JSON.parse(fs.readFileSync(
    new URL('./fixtures/workflow-late-label-envelope.json', import.meta.url), 'utf8',
  ));
  const before = structuredClone(workflow);
  assert.equal(workflow.nodes.length, 10);
  assert.equal(workflow.edges.length, 15);
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(workflow, before, 'routing must preserve the full authored document, including sources and cards');
  const placement = nodes => nodes.map(({ id, lane, col }) => [id, lane, col]).sort();
  assert.deepEqual(placement(result.receipt.nodes), placement(workflow.nodes));
  assert.deepEqual(result.receipt.edges.map(({ from, to }) => [from, to]).sort(),
    workflow.edges.map(({ from, to }) => [from, to]).sort());
  assert.deepEqual(result.receipt.labels.map(({ label }) => label).sort(),
    workflow.edges.filter(({ label }) => label).map(({ label }) => label).sort());
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  for (const node of workflow.nodes) {
    for (const text of [node.label, node.sublabel].filter(Boolean)) {
      assert.ok(result.svg.includes('>' + escape(text) + '</text>'), 'preserve full node text for ' + node.id);
    }
  }
  for (const edge of workflow.edges) {
    assert.equal(attributeRole(edgeTag(result.svg, edge.from, edge.to)), edge.role || '');
  }

  const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)]
    .map(([, key, value]) => [key, value]));
  const box = tag => {
    const values = attrs(tag);
    const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(values[key])]));
    assert.ok(Object.values(rect).every(Number.isFinite));
    assert.ok(rect.width > 0 && rect.height > 0);
    return rect;
  };
  const expand = (rect, pad) => ({
    x: rect.x - pad, y: rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad,
  });
  const disjoint = (a, b) => a.x + a.width < b.x || b.x + b.width < a.x
    || a.y + a.height < b.y || b.y + b.height < a.y;
  const frames = (result.svg.match(/<rect\b[^>]*>/g) || []).filter(tag => (
    /data-composition-frame-kind="(?:lane|exception-lane)"/.test(tag)
  ));
  assert.equal(frames.length, workflow.lanes.length, 'retain every lane frame');
  const frameRight = Math.max(...frames.map(tag => {
    const rect = box(tag);
    return rect.x + rect.width;
  }));
  const route = result.receipt.edges.find(({ from, to }) => from === 'review' && to === 'repair');
  assert.ok(route);
  const source = result.receipt.nodes.find(({ id }) => id === route.from);
  const target = result.receipt.nodes.find(({ id }) => id === route.to);
  const [start, next] = route.points, end = route.points.at(-1), previous = route.points.at(-2);
  assert.equal(start[1], source.y + source.height);
  assert.ok(start[0] >= source.x && start[0] <= source.x + source.width);
  assert.equal(next[0], start[0]);
  assert.ok(next[1] > start[1], 'retain the downward departure into the return corridor');
  assert.equal(end[0], target.x + target.width);
  assert.ok(end[1] >= target.y && end[1] <= target.y + target.height);
  assert.equal(previous[1], end[1]);
  assert.ok(previous[0] > end[0], 'the arrow must reach the repair card from its right side');
  // This full graph has a clear outer corridor. Do not spend another whole
  // card column on empty return space, or freeze a particular automatic rail.
  const widestCard = Math.max(...result.receipt.nodes.map(({ width }) => width));
  assert.ok(Math.max(...route.points.map(([x]) => x)) < frameRight + widestCard,
    'the feedback loop should fit within one card width beyond the actual lanes');

  const groups = [...result.svg.matchAll(/<g\b(?=[^>]*data-edge-from=)(?=[^>]*data-edge-label=)[^>]*>[\s\S]*?<\/g>/g)]
    .map(([group]) => group);
  for (const edge of workflow.edges.filter(({ label }) => label)) {
    const group = groups.find(group => attrs(group)['data-edge-from'] === edge.from
      && attrs(group)['data-edge-to'] === edge.to);
    assert.ok(group, 'retain the rendered label group for ' + edge.from + '->' + edge.to);
    assert.ok(group.includes('>' + escape(edge.label) + '</text>'),
      'preserve full rendered condition text for ' + edge.from + '->' + edge.to);
  }
  const targetGroup = groups.find(group => attrs(group)['data-edge-from'] === 'review'
    && attrs(group)['data-edge-to'] === 'repair');
  assert.ok(targetGroup);
  assert.equal((targetGroup.match(/>发现问题<\/text>/g) || []).length, 1);
  const maskTag = targetGroup.match(/<rect\b[^>]*class="c-mask"[^>]*>/)?.[0];
  assert.ok(maskTag);
  // Read the rendered mask paint width rather than reproducing the candidate
  // rail/shelf construction or importing the router's private helpers.
  const maskStroke = Number(result.svg.match(/g\[data-edge-from\] > rect\.c-mask \{[^}]*stroke-width:\s*([\d.]+)px/)?.[1]);
  assert.ok(Number.isFinite(maskStroke));
  const mask = expand(box(maskTag), maskStroke / 2);
  for (const tag of frames) {
    const frame = box(tag), halfStroke = Number(attrs(tag)['stroke-width']) / 2;
    assert.ok(Number.isFinite(halfStroke));
    const borders = [
      { x: frame.x, y: frame.y, width: frame.width, height: 0 },
      { x: frame.x, y: frame.y + frame.height, width: frame.width, height: 0 },
      { x: frame.x, y: frame.y, width: 0, height: frame.height },
      { x: frame.x + frame.width, y: frame.y, width: 0, height: frame.height },
    ];
    for (const border of borders) assert.ok(disjoint(mask, expand(border, halfStroke)),
      'the failure label paint must stay separate from lane border paint');
  }
  for (const node of result.receipt.nodes) {
    assert.ok(disjoint(mask, expand(node, 0.75)), 'the failure label must not cover card ' + node.id);
  }
  for (const group of groups) {
    if (group === targetGroup) continue;
    const otherMask = group.match(/<rect\b[^>]*class="c-mask"[^>]*>/)?.[0];
    assert.ok(otherMask);
    assert.ok(disjoint(mask, expand(box(otherMask), maskStroke / 2)),
      'the failure label must not obscure another condition');
  }
});
