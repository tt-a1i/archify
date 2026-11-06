import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Adapted from BlueboxC's #1067 reproduction and a50dd164d9a31cd7b754673b3591428ad992d142.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const titles = [
  '付款服務部署後開始逾時，值班人員收到告警通知。',
  '先確認訂單狀態再執行「退款」，再通知客戶。',
  '決済エラー率が上昇し、オンコール担当者へ通知。',
];
const startsWithClosing = /^[、。，．：；！？）〕］｝〉》」』】々〻ゝゞヽヾー…‥]/u;
const endsWithOpening = /[（〔［｛〈《「『【]$/u;

function render(t, diagram) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cjk-wrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  diagram.meta.output ??= 'output.html';
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', diagram.diagram_type, input, output], { encoding: 'utf8', maxBuffer: 16*1024*1024 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/u)[0];
}

function textLines(svg, selector) {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)]
    .filter(([, attrs]) => selector.test(attrs))
    .map(([, , content]) => {
      const lines = [...content.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/gu)].map(([, line]) => line);
      return lines.length ? lines : [content];
    });
}

function check(groups, originals) {
  assert.equal(groups.length, originals.length);
  for (const [i, lines] of groups.entries()) {
    assert.equal(lines.join(''), originals[i], 'wrapping preserves every authored character');
    for (const line of lines) {
      assert.ok(!startsWithClosing.test(line), `closing punctuation starts ${JSON.stringify(line)}`);
      assert.ok(!endsWithOpening.test(line), `opening bracket ends ${JSON.stringify(line)}`);
    }
  }
}

test('CJK timeline titles keep punctuation with its text', (t) => {
  const svg = render(t, { schema_version: 1, diagram_type: 'timeline', meta: { title: '付款事件', locale: 'zh-TW', timezone: 'Asia/Taipei', evidence: 'illustrative' }, events: titles.map((title, i) => ({ id: `e${i}`, at: `2026-10-01T${10+i}:00:00+08:00`, title })) });
  check(textLines(svg, /data-node-label=/u), titles);
});

test('CJK timeline titles retain space after an opening quote without ending a line there', (t) => {
  const title = '先確認訂單狀態再執行「 退款」，再通知客戶。';
  const svg = render(t, { schema_version: 1, diagram_type: 'timeline', meta: { title: '付款事件', locale: 'zh-TW', evidence: 'illustrative' }, events: [{ id: 'a', at: '2026-10-01T10:00:00Z', title }] });
  check(textLines(svg, /data-node-label=/u), [title]);
});

test('CJK tree labels and sublabels keep punctuation with its text', (t) => {
  const labels = ['先確認訂單狀態再執行「退款」，再通知客戶。'.repeat(3)];
  const sublabels = ['「授權」與「請款」分開處理，避免重複扣款。'];
  const svg = render(t, { schema_version: 1, diagram_type: 'tree', meta: { title: '付款流程', locale: 'zh-TW' }, nodes: [{ id: 'root', label: labels[0], sublabel: sublabels[0] }] });
  check(textLines(svg, /data-node-label=/u), labels);
  check(textLines(svg, /tree-sublabel/u), sublabels);
});

test('CJK sequence notes keep punctuation with its text', (t) => {
  const notes = ['密碼只在伺服器端驗證，前端不保存。登入成功後換發權杖。', '先確認訂單狀態再執行「退款」，再通知客戶。', '通知を受け取ったら「決済状態」を確認し、再試行する。'];
  const svg = render(t, { schema_version: 1, diagram_type: 'sequence', meta: { title: '付款請求', locale: 'zh-TW', column_fit: 'spread' }, participants: ['client','api','db'].map(id => ({ id, label: id, type: 'backend' })), messages: notes.map((note,i) => ({ from: 'client', to: 'api', y: 200+i*200, label: 'request', note })) });
  check(textLines(svg, /data-detail="context".*font-size="7"/u), notes);
});
