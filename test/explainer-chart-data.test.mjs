import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const attr = (node, name) => node.attrs?.find(entry => entry.name === name)?.value;
const content = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(content).join('');
function findAll(node, predicate) {
  return [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => findAll(child, predicate))];
}

function chartText(html) {
  const figures = findAll(parse(html), node => node.tagName === 'figure' && attr(node, 'class') === 'chart');
  assert.equal(figures.length, 1, '输出中应有且仅有一张数据图');
  const [svg] = findAll(figures[0], node => node.tagName === 'svg');
  assert.ok(svg, '必须检查实际绘制的 SVG，不能只检查嵌入原稿');
  return findAll(svg, node => node.tagName === 'text').map(node => {
    const spans = (node.childNodes || []).filter(child => child.tagName === 'tspan');
    if (!spans.length) return content(node);
    const lines = [];
    let previousY;
    for (const span of spans) {
      const y = attr(span, 'y');
      if (!lines.length || (y !== undefined && y !== previousY)) lines.push('');
      lines[lines.length - 1] += content(span);
      if (y !== undefined) previousY = y;
    }
    return lines.join('\n');
  });
}

function setup(t, { file = 'values.csv', kind = 'bar', x = 'name', y = ['value'], unit } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-chart-data-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'draft.json'), output = path.join(directory, 'page.html');
  const dataFile = path.join(directory, file);
  const document = {
    schema_version: 1, diagram_type: 'explainer',
    meta: { id: 'data-fidelity', title: 'What changed?', locale: 'en' },
    answer: { summary: 'Compare the recorded values.' },
    panels: [{ id: 'comparison', title: 'Which values differ?', blocks: [
      { id: 'measurements', type: 'chart', data: { path: file, kind, x, y, ...(unit ? { unit } : {}) } },
    ] }],
    sources: [],
  };
  const source = JSON.stringify(document, null, 2) + '\n';
  fs.writeFileSync(input, source);
  const run = bytes => {
    fs.writeFileSync(dataFile, bytes);
    const result = spawnSync(process.execPath, [cli, 'finalize', 'explainer', input, output, '--json'], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20_000,
      env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    assert.ifError(result.error);
    assert.equal(fs.readFileSync(input, 'utf8'), source, '渲染和失败都不能改写作者原稿');
    assert.deepEqual(fs.readFileSync(dataFile), Buffer.from(bytes), '数据文件的原始字节必须保持不变');
    let receipt;
    try { receipt = JSON.parse(result.stdout); } catch { assert.fail(result.stdout + result.stderr); }
    return { ...result, receipt, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null };
  };
  return { input, output, run };
}

function successful(result) {
  assert.equal(result.status, 0, JSON.stringify(result.receipt.diagnostics) + result.stderr);
  assert.equal(result.receipt.ok, true);
  return chartText(result.html);
}

function includesLabels(texts, labels) {
  for (const label of labels) assert.ok(texts.includes(label), `图中须保留 ${JSON.stringify(label)}；实际文本：${JSON.stringify(texts)}`);
}

test('CSV bar labels, series names and units preserve quotes and backslashes in rendered SVG', t => {
  const series = 'p99 "cold"\\ms', unit = 'ms "wall"\\clock';
  const { run } = setup(t, { y: [series], unit });
  const csv = 'name,"p99 ""cold""\\ms"\n"Reader ""Desktop""",60\n"src\\router",30\n"North, west",10\n';
  const texts = successful(run(csv));
  includesLabels(texts, ['Reader "Desktop"', 'src\\router', 'North, west', series, unit]);
  includesLabels(texts, ['60', '30', '10']);
});

test('JSON line labels retain literal escapes and entity-like text without becoming chart syntax', t => {
  const labels = ['"warm"', 'C:\\new', '#quot;', '&quot;'];
  const series = 'Time "saved"\\request';
  const { run } = setup(t, { file: 'values.json', kind: 'line', y: [series] });
  const texts = successful(run(JSON.stringify(labels.map((name, index) => ({ name, [series]: 10 + index })))));
  includesLabels(texts, [...labels, series]);
});

test('JSON pie legends preserve authored labels alongside the value and share', t => {
  const { run } = setup(t, { file: 'values.json', kind: 'pie' });
  const labels = ['Owner "read"', 'folder\\leaf', '<b>¶</b>'];
  const texts = successful(run(JSON.stringify([
    { name: labels[0], value: 60 }, { name: labels[1], value: 30 }, { name: labels[2], value: 10 },
  ])));
  includesLabels(texts, [`${labels[0]} · 60 (60%)`, `${labels[1]} · 30 (30%)`, `${labels[2]} · 10 (10%)`]);
});

test('CSV bar labels resembling icons or comments remain literal text', t => {
  const { run } = setup(t);
  const texts = successful(run('name,value\nfa:fa-home,60\n%%,40\n'));
  includesLabels(texts, ['fa:fa-home', '%%', '60', '40']);
});

test('CSV quoted multiline cells keep their lines, commas and doubled quotes under LF and CRLF', t => {
  for (const ending of ['\n', '\r\n']) {
    const { run } = setup(t);
    const csv = ['name,value', '"North, ""east""', 'South",60', 'West,40', ''].join(ending);
    const texts = successful(run(csv));
    includesLabels(texts, ['North, "east"\nSouth', 'West', '60', '40']);
  }
});

function rejectedWithoutPublication(context, bytes, previousHtml, description) {
  const result = context.run(bytes);
  assert.equal(result.status, 1, `${description}: 不可忠实解析的数据必须失败，不能发布错误图表`);
  assert.equal(result.receipt.ok, false);
  const issue = result.receipt.diagnostics.find(entry => entry.code === 'explainer/chart-data');
  assert.ok(issue, JSON.stringify(result.receipt.diagnostics));
  assert.equal(issue.subject.component, 'chart');
  assert.equal(issue.subject.input, context.input);
  assert.equal(issue.subject.path, '/panels/0/blocks/0');
  assert.ok(Number.isInteger(issue.subject.line) && issue.subject.line > 1, '错误必须定位到作者图表');
  assert.ok(issue.message && issue.evidence.reason && issue.supportedFixes.length, '错误应解释原因并给出可执行修复');
  assert.equal(result.html, previousHtml, '失败必须保留之前成功交付的 HTML 字节');
  return issue;
}

test('malformed CSV is rejected with a chart location and preserves the prior artifact', t => {
  const context = setup(t);
  const before = context.run('name,value\nOrdinary,60\nSecond,40\n');
  includesLabels(successful(before), ['Ordinary', 'Second', '60', '40']);
  const cases = [
    // 错误故意放在未选作横轴或数值的列里，避免因数值缺失而碰巧失败。
    ['unclosed quoted cell', 'name,value,note\nNorth,60,"unfinished\n'],
    ['quote in an unquoted cell', 'name,value,note\nNorth,60,note"tail\n'],
    ['characters after a quoted cell', 'name,value\n"North"tail,60\n'],
    ['extra field', 'name,value\nNorth,60,discarded\n'],
    ['missing field', 'name,value,note\nNorth,60\n'],
    ['ambiguous duplicate header', 'name,value,value\nNorth,60,40\n'],
  ];
  for (const [description, csv] of cases) rejectedWithoutPublication(context, csv, before.html, description);
});

test('labels that cannot be displayed faithfully fail before replacing a previous chart', t => {
  const context = setup(t, { file: 'values.json' });
  const before = context.run(JSON.stringify([{ name: 'Ordinary', value: 60 }, { name: 'Second', value: 40 }]));
  includesLabels(successful(before), ['Ordinary', 'Second']);
  for (const label of [
    'North\u0000South', 'North\ud800South', '', ' \t ',
    'North\u0085South', 'North\u2028South', 'North\u2029South',
  ]) {
    rejectedWithoutPublication(context, JSON.stringify([{ name: label, value: 60 }]), before.html, JSON.stringify(label));
  }
});

test('ordinary label whitespace is normalized for display without changing data', t => {
  const csv = setup(t);
  includesLabels(successful(csv.run('name,value\n" North  America ",60\n"South\tWest",40\n"East\n Coast",20\n')),
    ['North America', 'South West', 'East\nCoast']);
  const series = ' p99\tms ', unit = ' ms  wall ';
  const json = setup(t, { file: 'values.json', kind: 'line', y: [series], unit });
  includesLabels(successful(json.run(JSON.stringify([{ name: ' North ', [series]: 60 }, { name: 'South\n East', [series]: 40 }]))),
    ['North', 'South\nEast', 'p99 ms', 'ms wall']);
  const pie = setup(t, { file: 'values.json', kind: 'pie' });
  includesLabels(successful(pie.run(JSON.stringify([{ name: ' North  America ', value: 60 }, { name: 'South\tWest', value: 40 }]))),
    ['North America · 60 (60%)', 'South West · 40 (40%)']);
});

test('unrepresentable series names and units are diagnosed without publishing a modified label', t => {
  // 横轴标签、序列名与单位都会进入图表文本；仅检验横轴会漏掉另外两个入口。
  for (const [field, value] of [['series', 'p99\u0000ms'], ['unit', 'ms\u0000wall']]) {
    const context = setup(t, { file: 'values.json', ...(field === 'series' ? { y: [value] } : { unit: value }) });
    const bytes = JSON.stringify([{ name: 'Ordinary', [field === 'series' ? value : 'value']: 60 }]);
    const result = context.run(bytes);
    assert.equal(result.status, 1, `${field}: 不可忠实绘制的文本须失败`);
    assert.equal(result.html, null, '首次失败不能留下误导性的图表');
    const issue = result.receipt.diagnostics.find(entry => entry.code === 'explainer/chart-data');
    assert.ok(issue, JSON.stringify(result.receipt.diagnostics));
    assert.equal(issue.subject.component, 'chart');
    assert.equal(issue.subject.input, context.input);
    assert.ok(issue.message && issue.supportedFixes.length);
  }
});
