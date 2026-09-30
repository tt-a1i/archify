import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-svg-path-checker-'));
const deadlineMs = process.platform === 'win32' ? 10000 : 3000;
let sequence = 0;
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// 公共 CLI 会再启动 checker；超时必须结束我们自己的整棵进程树。
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && child.exitCode === null) {
      throw new Error(`taskkill failed: ${result.stderr || result.stdout}`);
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

async function check(t, body, { publicCli = false, rootAttrs = '', profile = 'showcase' } = {}) {
  const file = path.join(scratch, `${sequence++}.html`);
  fs.writeFileSync(file, `<!doctype html><html><body><svg viewBox="0 0 400 250" data-quality-profile="${profile}" ${rootAttrs}>${body}</svg></body></html>`);
  const args = publicCli ? [cli, 'check', file, '--json'] : [checker, file];
  return execute(t, args, body);
}

async function execute(t, args, description) {
  const child = spawn(process.execPath, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  let stdout = '', stderr = '', timedOut = false, exited = false, spawnError, cleanupError;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    exited = true;
    resolve({ code, signal });
  }));
  const timer = setTimeout(() => {
    timedOut = true;
    try { killTree(child); } catch (error) { cleanupError = error; }
  }, deadlineMs);
  t.after(async () => {
    clearTimeout(timer);
    if (!exited) killTree(child);
    await closed;
  });
  const result = await closed;
  clearTimeout(timer);
  assert.ifError(spawnError);
  assert.ifError(cleanupError);
  assert.equal(timedOut, false, `路径检查在 ${deadlineMs}ms 内未退出，已终止进程树：${description}`);
  assert.equal(result.signal, null, stderr);
  assert.ok(stdout.trim(), `路径检查必须返回 JSON 回执：${stderr}`);
  return { ...result, receipt: JSON.parse(stdout), stderr };
}

function arrow(d, { id = 'route', from = 'a', to = 'b', extra = '' } = {}) {
  return `<path id="${id}" data-edge-id="${id}" data-edge-from="${from}" data-edge-to="${to}" d="${d}" class="a-default" marker-end="url(#arrowhead)" ${extra}/>`;
}

const normalChecks = ['single_svg', 'finite_svg', 'orthogonal_arrows', 'label_route_clearance',
  'relationship_crossings', 'relationship_corridors', 'container_border_runs', 'route_rhythm', 'legend_clearance'];
function assertPass(result) {
  assert.equal(result.code, 0, JSON.stringify(result.receipt));
  assert.equal(result.receipt.ok, true);
  assert.deepEqual(result.receipt.checks.map(item => item.name), normalChecks, '正常产物仍保留原有九项检查');
}
function assertPathError(result, code, { role = 'relationship', pathIndex = 1, id = 'route' } = {}) {
  assert.equal(result.code, 1, JSON.stringify(result.receipt));
  assert.equal(result.receipt.ok, false);
  assert.equal(result.receipt.checks.find(item => item.name === 'svg_path_data')?.ok, false);
  const diagnostic = result.receipt.diagnostics?.find(item => item.code === code);
  assert.ok(diagnostic, JSON.stringify(result.receipt));
  assert.equal(diagnostic.subject.role, role);
  assert.equal(diagnostic.subject.pathIndex, pathIndex);
  assert.equal(diagnostic.subject.id, id);
  assert.ok(Number.isInteger(diagnostic.evidence.tokenOffset) && diagnostic.evidence.tokenOffset >= 0);
  assert.ok(diagnostic.evidence.reason);
  assert.ok(diagnostic.supportedFixes.length > 0);
}

for (const d of [
  'M 20', 'M 20 20 Q 30 30 40', 'M 20 20 L 100', 'M 20 20 L 100 M 200 20',
  'M 20 NaN', 'M 20 20 L 1e999 30', 'M 20 20 X 100 20', 'M 20 20 Z 7', 'M20 20L40,,20',
]) {
  test(`缺失、未知或非有限路径数据以诊断结束：${d}`, async t => {
    assertPathError(await check(t, arrow(d)), 'artifact/svg-path-malformed');
  });
}
for (const d of ['M20 20A40 40 0 0 1 100 100', 'M20 20C40 20 60 20 100 20']) {
  test(`合法但未支持的指令不能被当作其他指令继续读取：${d}`, async t => {
    assertPathError(await check(t, arrow(d)), 'artifact/svg-path-unsupported');
  });
}

test('公共 check CLI 有界返回路径诊断，不遗留其 checker 子进程', async t => {
  const result = await check(t, arrow('M20 20Q40 40 80'), { publicCli: true });
  assertPathError(result, 'artifact/svg-path-malformed');
});

test('路径诊断定位实际 path 元素并保留可修复的命令信息', async t => {
  const decoration = '<path d="M0 0C1 1 2 2 3 3"/>';
  const result = await check(t, decoration + arrow('M20 20A40 40 0 0 1 100 100'));
  assertPathError(result, 'artifact/svg-path-unsupported', { pathIndex: 2 });
  assert.equal(result.receipt.diagnostics.find(item => item.code === 'artifact/svg-path-unsupported').evidence.command, 'A');
  assert.equal(result.receipt.diagnostics.find(item => item.code === 'artifact/svg-path-unsupported').evidence.tokenOffset, 6);
});

test('大小写指数、小数、隐式重复和相对坐标保留同一条实际直线', async t => {
  const forms = ['M20 20L200 20', 'M2E1,2e1 2e2,2E1', 'm20 20h1.8e2',
    'M+20.0 +20.L2.0e2 20.', 'M20 20h80 100', 'M&#x20;20&#32;20H200'];
  let metrics;
  for (const d of forms) {
    const result = await check(t, arrow(d));
    assertPass(result);
    const actual = result.receipt.composition.metrics;
    if (!metrics) metrics = actual;
    assert.equal(actual.properCrossings, 0);
    assert.equal(actual.maxBends, 0);
    assert.equal(actual.minSegmentPx, metrics.minSegmentPx);
  }
});

test('正常二次曲线继续受检，不能为拒绝其他曲线而禁止已有 Q', async t => {
  assertPass(await check(t, arrow('M20 20L80 20Q100 20 100 40L100 120')));
  assertPass(await check(t, arrow('m20 20l60 0q20 0 20 20v80')));
});

const disconnected = 'M20 20L100 20M100 100L200 100';
const acrossGap = arrow('M80 60L120 60', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' });
for (const rootAttrs of ['', 'data-layout-contract="readable-v2"']) {
  test(`多个 M 不产生虚构的交叉、转弯或遮挡：${rootAttrs || 'legacy'}`, async t => {
    const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Gap label"><rect class="c-mask" x="90" y="50" width="20" height="20"/></g>';
    const result = await check(t, arrow(disconnected) + acrossGap + label, { rootAttrs });
    assertPass(result);
    const metrics = result.receipt.composition.metrics;
    assert.equal(metrics.properCrossings, 0);
    assert.equal(metrics.labelRouteClearanceIssues, 0);
    assert.equal(metrics.maxBends, 0);
    assert.equal(metrics.microSegmentCount, 0);
  });
  test(`路径元数据不能跨越可见子路径断点：${rootAttrs || 'legacy'}`, async t => {
    const metadata = 'data-composition-points="20,20;100,20;100,100;200,100"';
    const result = await check(t, arrow(disconnected, { extra: metadata }) + acrossGap, { rootAttrs });
    assertPass(result);
    assert.equal(result.receipt.composition.metrics.maxBends, 0);
  });
  test(`真实连续路径交叉仍然失败：${rootAttrs || 'legacy'}`, async t => {
    const result = await check(t, arrow('M20 20L100 20L100 100L200 100') + acrossGap, { rootAttrs });
    assert.equal(result.code, 1);
    assert.equal(result.receipt.checks.find(item => item.name === 'relationship_crossings').ok, false);
    assert.deepEqual(result.receipt.composition.issues.find(item => item.code === 'composition/proper-crossing').point, [100, 60]);
  });
}

test('Z 回到当前子路径起点，后续相对 m 不沿旧终点移动', async t => {
  const d = 'M20 20H100V100H20Z m0 120h60';
  const other = arrow('M10 180H30', { id: 'other', from: 'c', to: 'd' });
  const result = await check(t, arrow(d) + other);
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.properCrossings, 0);
});

test('每个新 M 都重置关闭点，两个正交闭合子路径不会出现对角线', async t => {
  assertPass(await check(t, arrow('M20 20H100V60H20Z M160 20H240V60H160Z')));
});

test('关闭路径后继续的相对绘制使用关闭点，仍能发现真实交叉', async t => {
  const body = arrow('M20 20H100V100H20Z m0 120h60')
    + arrow('M60 130V150', { id: 'other', from: 'c', to: 'd' });
  const result = await check(t, body);
  assert.equal(result.code, 1);
  assert.deepEqual(result.receipt.composition.issues.find(item => item.code === 'composition/proper-crossing').point, [60, 140]);
});

test('合法 metadata 不能使残缺路径绕过语法检查', async t => {
  const result = await check(t, arrow('M20', { extra: 'data-composition-points="20,20;200,20"' }), {
    rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assertPathError(result, 'artifact/svg-path-malformed');
});

test('结构框的残缺路径返回独立定位，不在第二个解析入口挂起', async t => {
  const frame = '<path id="outline" data-composition-frame-kind="group" data-composition-frame-id="group-a" d="M20 20Q40 40 80"/>';
  assertPathError(await check(t, frame), 'artifact/svg-path-malformed', { role: 'structural-frame', id: 'outline' });
});

test('结构框子路径之间的空隙不产生边框重合，真实边框仍会失败', async t => {
  const makeFrame = d => `<path data-composition-frame-kind="group" data-composition-frame-id="group-a" d="${d}"/>`;
  const relation = arrow('M120 40H180');
  assertPass(await check(t, makeFrame('M40 40H100 M200 40H280') + relation));
  const crossing = await check(t, makeFrame('M40 40H280') + relation);
  assert.equal(crossing.code, 1);
  assert.equal(crossing.receipt.checks.find(item => item.name === 'container_border_runs').ok, false);
});

test('图标、品牌与普通装饰中的 A/C 不扩大检查器的路径范围', async t => {
  const decorations = `<g data-node-icon="cloud"><path d="M0 0A4 4 0 0 1 8 0"/></g>
    <g data-node-brand="example"><path d="M0 0C1 1 2 2 3 3"/></g>
    <path class="a-default" d="M20 20A40 40 0 0 1 100 100"/>
    <path marker-end="url(#arrowhead)" d="M20 20C40 20 60 20 100 20"/>`;
  assertPass(await check(t, decorations + arrow('M20 20H200')));
});


test('多子路径的预算按连续片段测量，同一关系超预算只计一次', async t => {
  const result = await check(t, arrow('M20 20H60V60H100V100 M160 20H200V60H240V100'));
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.maxBends, 6);
  assert.equal(result.receipt.composition.metrics.routesOverSuggestedBends, 1);
});

test('后续子路径仍参与标签遮挡，不能被关系 ID 去重丢弃', async t => {
  const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Label"><rect class="c-mask" x="130" y="90" width="20" height="20"/></g>';
  const result = await check(t, arrow('M20 20H60 M100 100H200')
    + arrow('M90 200H210', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' }) + label);
  assert.equal(result.code, 1);
  const issue = result.receipt.composition.issues.find(item => item.code === 'composition/label-route-clearance');
  assert.equal(issue.otherRelationship.id, 'route');
  assert.equal(issue.segmentIndex, 1);
});

test('多子路径只以真实最后一段检测 marker-end，早期片段不产生虚假箭头相撞', async t => {
  const result = await check(t, arrow('M20 20H100 M20 100H150', { from: 'a', to: 'end' })
    + arrow('M20 21H100 M20 150H150', { id: 'other', from: 'b', to: 'end' }), {
    rootAttrs: 'data-layout-contract="readable-v2"',
  });
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.arrowheadCollisions, 0);
});

for (const [name, left, right, from, to, passes] of [
  ['实际 source', 'M20 20H40V60 M100 100H140', 'M20 20H40V0 M180 100H220', 'a', 'other-end', true],
  ['内部 source', 'M20 20H60 M100 100H120V140', 'M20 60H60 M100 100H120V60', 'a', 'other-end', false],
  ['实际 target', 'M20 20H60 M100 100H120', 'M20 60H60 M100 80V100H120', 'other-start', 'b', true],
  ['内部 target', 'M100 100H120 M200 20H240', 'M100 80V100H120 M200 60H240', 'other-start', 'b', false],
]) {
  test(`workflow 短共享线例外使用 ${name} 而非任意子路径首尾`, async t => {
    const result = await check(t, arrow(left) + arrow(right, { id: 'other', from, to }), {
      rootAttrs: 'data-layout-contract="readable-v2"',
    });
    if (passes) assertPass(result);
    else {
      assert.equal(result.code, 1);
      assert.equal(result.receipt.checks.find(item => item.name === 'relationship_corridors').ok, false);
      assert.equal(result.receipt.composition.metrics.ambiguousCorridors, 1);
    }
  });
}

test('注释、CDATA 和属性文本中的伪路径不参与严格解析或路径编号', async t => {
  const fake = '<path class="a-default" marker-end="url(#arrowhead)" d="M20 20X100 20"/>';
  const frame = '<path data-composition-frame-kind="group" d="M20"/>';
  const ignored = `<!-- ${fake}${frame} --> <![CDATA[${fake}${frame}]]><g data-example='${fake}${frame}'></g>`;
  assertPass(await check(t, ignored + arrow('M20 20H200')));
  assertPathError(await check(t, ignored + arrow('M20')), 'artifact/svg-path-malformed');
});

test('多子路径模式仍对同一关系的重复 SVG 片段只计算一次标签遮挡', async t => {
  const duplicate = arrow('M20 100H200', { extra: 'data-edge-key="0"' });
  const other = arrow('M90 200H210', { id: 'other', from: 'c', to: 'd', extra: 'data-edge-key="1"' });
  const label = '<g data-edge-key="1" data-edge-from="c" data-edge-to="d" data-edge-label="Label"><rect class="c-mask" x="130" y="90" width="20" height="20"/></g>';
  const trigger = arrow('M20 220H60 M100 220H200', { id: 'disjoint', from: 'e', to: 'f' });
  const base = await check(t, duplicate + duplicate + other + label);
  const multi = await check(t, duplicate + duplicate + other + label + trigger);
  assert.equal(base.receipt.composition.metrics.labelRouteClearanceIssues, 1);
  assert.equal(multi.receipt.composition.metrics.labelRouteClearanceIssues, 1);
});

test('每片段各两次转弯仍累计为原关系的四个真实转弯', async t => {
  const result = await check(t, arrow('M20 20H100V60H180 M220 20H300V60H380'));
  assertPass(result);
  assert.equal(result.receipt.composition.metrics.maxBends, 4);
  assert.equal(result.receipt.composition.metrics.routesOverSuggestedBends, 1);
});

test('deliver 保留路径诊断并且不覆盖此前存在的 HTML', async t => {
  const output = path.join(scratch, 'previous.html');
  const wrapper = path.join(scratch, 'broken-renderer.mjs');
  const previous = Buffer.from('<!doctype html><p>previous trusted artifact</p>');
  fs.writeFileSync(output, previous);
  // 只在 renderer 成功写完后破坏其产物；交付、检查、回执与回滚均走生产入口。
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  const result = original(command, args, options);
  if (String(args?.[0]).endsWith('render-architecture.mjs') && result.status === 0) {
    const html = fs.readFileSync(args[2], 'utf8');
    let replaced = false;
    const broken = html.replace(/<path\\b[^>]*>/g, tag => {
      if (replaced || !/class="[^"]*\\ba-(?:default|emphasis|security|dashed)\\b/.test(tag) || !tag.includes('marker-end=')) return tag;
      replaced = true;
      return tag.replace('<path ', '<path id="injected-path" ').replace(/\\bd="[^"]*"/, 'd="M20 20A40 40 0 0 1 100 100"');
    });
    if (!replaced) throw new Error('fixture did not find a rendered arrow');
    fs.writeFileSync(args[2], broken);
  }
  return result;
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'architecture',
  ${JSON.stringify(path.join(skillRoot, 'examples/web-app.architecture.json'))}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = await execute(t, [wrapper], 'deliver with an unsupported rendered path');
  assert.equal(result.code, 1, JSON.stringify(result.receipt));
  assert.equal(result.receipt.stage, 'check');
  assert.equal(result.receipt.ok, false);
  const issue = result.receipt.diagnostics.find(item => item.code === 'artifact/svg-path-unsupported');
  assert.ok(issue, JSON.stringify(result.receipt));
  assert.equal(issue.subject.id, 'injected-path');
  assert.equal(issue.subject.role, 'relationship');
  assert.ok(issue.subject.pathIndex >= 1);
  assert.equal(issue.evidence.command, 'A');
  assert.equal(issue.evidence.tokenOffset, 6);
  assert.ok(issue.supportedFixes.length > 0);
  assert.deepEqual(fs.readFileSync(output), previous);
});
