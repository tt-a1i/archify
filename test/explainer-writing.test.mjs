import test from 'node:test';
import assert from 'node:assert/strict';
import {lintExplainerWriting} from '../archify/explainer/writing.mjs';
const entry = (text, extra = {}) => ({text, line: 1, component: 'prose', ...extra});

test('writing: independently authored bilingual hints give concrete repairs without failing by default', () => {
  const result = lintExplainerWriting([
    entry('进行分析，赋能业务，很多用户会使用。提前预先检查。'),
    entry('Perform an analysis of the cache. At the end of the day, many users need each and every result.'),
  ]);
  assert.deepEqual(new Set(result.map(d => d.evidence.rule)), new Set(['light-verb', 'cliche', 'vague-quantity', 'redundancy']));
  assert.ok(result.every(d => d.severity === 'warning' && d.code.startsWith('explainer/writing-')));
  assert.ok(result.every(d => d.evidence.reason && d.evidence.example && d.supportedFixes.length));
  assert.ok(result.some(d => d.evidence.matched === 'Perform an analysis of'));
  assert.ok(result.some(d => d.evidence.matched === '很多用户'));
});

test('writing: direct technical prose and quoted URL bodies do not trigger phrase hints', () => {
  assert.deepEqual(lintExplainerWriting([
    entry('接口检查缓存。实测 3.5 ms，样本为 120 次请求。'),
    entry('Analyze the cache. The limit is 32 requests per second. Read https://example.test/many-users/future-plans.'),
    entry('当前计划与未来计划分别覆盖两个时间段。Make a request to the API.'),
  ]), []);
});

test('writing: long sentences count Han and English words, not punctuation or decimal dots', () => {
  const result = lintExplainerWriting([
    entry('缓存读取返回空值后接口等待数据库再写回缓存。', {line: 4}),
    entry('Latency is 3.5 ms and the database returns the result before the cache is updated.'),
  ], {sentenceLimits: {zh: 12, en: 8}});
  assert.equal(result.length, 2);
  assert.ok(result.every(d => d.code === 'explainer/writing-sentence-length'));
  assert.equal(result[0].subject.line, 4);
  assert.equal(result[1].evidence.units, 15);
  assert.deepEqual(lintExplainerWriting([entry('缓存读取返回空值。接口等待数据库。然后写回缓存。')], {sentenceLimits: {zh: 12}}), []);
});

test('writing: strict and off mode preserve explicit severity control', () => {
  assert.ok(lintExplainerWriting([entry('很多用户。')], {mode: 'strict'}).every(d => d.severity === 'error'));
  assert.deepEqual(lintExplainerWriting([entry('很多用户。')], {mode: 'off'}), []);
  assert.throws(() => lintExplainerWriting([], {mode: 'silent'}), /mode/);
  assert.throws(() => lintExplainerWriting([], {sentenceLimits: {en: 0}}), /positive integers/);
});

test('writing: source line offsets, component targets and diagnostic order survive repeated calls', () => {
  const entries = [entry('接口读取缓存。\n\n进行检查。\n很多用户。', {line: 20, component: 'answer', panelId: 'recommendation'})];
  const first = lintExplainerWriting(entries);
  assert.deepEqual(first.map(d => d.subject.line), [22, 23]);
  assert.ok(first.every(d => d.subject.component === 'answer' && d.subject.panelId === 'recommendation'));
  assert.deepEqual(lintExplainerWriting(entries), first);
  assert.equal(entries[0].text, '接口读取缓存。\n\n进行检查。\n很多用户。');
});

test('writing: a URL with sentence punctuation is excluded from length but leaves the next sentence measurable', () => {
  const entries = [entry('Read https://example.test/a.b?q=3.5. Then read the measured result before changing the cache behavior.')];
  const result = lintExplainerWriting(entries, {sentenceLimits: {en: 5}, locale: 'en-US'});
  assert.equal(result.length, 1);
  assert.equal(result[0].evidence.units, 10);
});

test('writing: URL masking preserves Chinese prose after bare and Markdown links', () => {
  for (const text of [
    '[依据](https://example.com)。很多用户进行分析。',
    '[依据](https://example.com)很多用户进行分析。',
    '[依据](https://example.com).很多用户进行分析。',
    'https://example.com。很多用户进行分析。',
    'https://example.com，很多用户进行分析。',
    'https://example.com！很多用户进行分析。',
    '[依据](https://example.com/topic_(one))。\n很多用户进行分析。',
  ]) {
    const result = lintExplainerWriting([entry(text, {line: 10})], {mode: 'strict'});
    assert.deepEqual(new Set(result.map(d => d.evidence.rule)), new Set(['vague-quantity', 'light-verb']), text);
    assert.ok(result.every(d => d.severity === 'error'));
    assert.ok(result.every(d => d.subject.line === (text.includes('\n') ? 11 : 10)));
  }
});

test('writing: English URL paths and balanced URL parentheses stay masked', () => {
  assert.deepEqual(lintExplainerWriting([
    entry('[依据](https://example.com/future%20plans/many-users/topic_(choose-a-path))。检查缓存。'),
    entry('Read https://example.com/(future-plans)/many-users?q=3.5. Check the cache.'),
    entry('[资料](https://example.com/资料)。检查缓存。'),
  ], {mode: 'strict'}), []);
});

test('writing: long paragraphs, an all-bold conclusion and a disclaimer-style scope get structural hints', () => {
  const rules = entries => lintExplainerWriting(entries).map(item => item.evidence.rule);
  assert.deepEqual(rules([entry('一。二。三。四。五。')]), ['paragraph-length']);
  assert.deepEqual(rules([entry('一。二。三。', {component: 'list'})]), []);
  const summary = '先做模块化单体，等模块边界稳定后再拆分服务。';
  assert.deepEqual(rules([entry(summary, {component: 'answer', pointer: '/answer/summary', raw: `**${summary}**`})]), ['verdict-emphasis']);
  assert.deepEqual(rules([entry(summary, {component: 'answer', pointer: '/answer/summary', raw: '先做**模块化单体**，等模块边界稳定后再拆分服务。'})]), []);
  assert.deepEqual(rules([entry('本页讨论功能方向，尚未实现。依据用户陈述，本次没有核对历史记录。页面只是阅读体验样例，不构成任何法律审查意见，也没有经过实际运行验证。', {component: 'scope'})]), ['scope-length']);
  assert.deepEqual(rules([entry('示例 · 8 人团队', {component: 'scope'})]), []);
});

test('writing: Chinese and English controlled-language hints stay precise', () => {
  const rules = text => lintExplainerWriting([entry(text)]).map(item => item.evidence.rule);
  assert.deepEqual(rules('综上所述，先做出决定再加以验证。'), ['filler', 'light-verb', 'light-verb']);
  assert.deepEqual(rules('重试 3 次以上会放大延迟。'), ['number-boundary']);
  assert.deepEqual(rules('In order to utilize the cache, read it first.'), ['plain-word', 'plain-word']);
  assert.deepEqual(rules('In summary, this cutting-edge design is seamless.'), ['filler', 'cliche', 'cliche']);
  assert.deepEqual(lintExplainerWriting(['任务进行中。', '目的的确清楚。', '重试超过 3 次。', '服务以下游为准。', 'Use the cache before the database.'].map(text => entry(text))), []);
});

test('writing: independent Chinese modifiers do not imply a nested noun phrase', () => {
  const independentModifiers = [
    '冲突中的文件不适用上表的简单复制模型：从暂存区恢复工作区时，未合并条目需要相应的冲突选项处理。',
    '是当前提交里的版本；暂存区是准备提交的版本；工作区是磁盘上正在编辑的文件。',
    '上面的机制来自固定版本的 CPython 3.13.9 源码；观察运行于本地 Python 3.15.0，并非 3.13.9 的实测。',
    '请求的状态和用户的权限决定缓存的键。',
  ];
  assert.deepEqual(lintExplainerWriting(independentModifiers.map(text => entry(text)), {mode: 'strict'}), []);
});


test('writing: local uncertainty and examples survive strict mode without disabling actionable hints', () => {
  const qualifications = [
    '示例中的 3 个请求共用一次调用，不代表结果会被缓存。',
    '图中的耗时未实测；箭头只表示调用顺序。',
    'The counts are illustrative, not measured.',
    'The request count is not measured; check traces before choosing a limit.',
  ];
  assert.deepEqual(lintExplainerWriting(qualifications.map(text => entry(text)), {mode: 'strict'}), []);
  const mixed = lintExplainerWriting([entry('本例未实测。很多用户进行分析。')], {mode: 'strict'});
  assert.deepEqual(mixed.map(d => d.evidence.rule), ['vague-quantity', 'light-verb']);
  assert.ok(mixed.every(d => d.severity === 'error'));
});
