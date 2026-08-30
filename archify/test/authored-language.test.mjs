import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authored-language-'));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function fixture(name, mutate) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  mutate(source);
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(source, null, 2));
  return file;
}

function dataflowFixture(name, mutate) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/product-analytics.dataflow.json'), 'utf8'));
  mutate(source);
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(source, null, 2));
  return file;
}

function localizeReaderFacing(source) {
  const localize = (value) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => localize(entry));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (['label', 'sublabel', 'tag', 'note', 'title', 'subtitle', 'classification'].includes(key)
        && typeof entry === 'string') {
        value[key] = key === 'title' && value === source.meta ? source.meta.title : '中文说明';
      } else if (key === 'items' && Array.isArray(entry)) {
        entry.forEach((_item, index) => { entry[index] = '中文说明'; });
      } else {
        localize(entry);
      }
    }
  };
  localize(source);
}

test('validate rejects an English-authored candidate when Chinese is required', () => {
  const input = fixture('english.workflow.json', (source) => {
    source.meta.title = 'Agent tool workflow';
    source.meta.locale = 'en';
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.equal(receipt.diagnostics[0].code, 'content/authored-language');
});

test('validate rejects a Chinese title when reader-facing body copy remains English', () => {
  const input = fixture('mixed-language.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.equal(receipt.diagnostics[0].code, 'content/authored-language');
  assert.ok(receipt.diagnostics[0].evidence.violations.some((entry) => entry.path === '/lanes/0/label'));
});

test('validate accepts Chinese reader-facing copy while preserving technical identifiers', () => {
  const input = fixture('chinese.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.nodes[0].label = 'ToolResultMessage[]';
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.authoredLanguage.required, 'zh-CN');
  assert.equal(receipt.authoredLanguage.violations, 0);
  const bytes = fs.readFileSync(input);
  assert.deepEqual(receipt.specification, {
    type: 'workflow',
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
});

test('validate rejects Chinese reader-facing body copy when English is required', () => {
  const input = fixture('english-with-chinese-body.workflow.json', (source) => {
    source.meta.title = 'Agent tool workflow';
    source.meta.locale = 'en';
    source.lanes[0].label = '中文阶段';
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'en', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.ok(receipt.diagnostics[0].evidence.violations.some((entry) => entry.path === '/lanes/0/label'));
});

test('validate preserves bounded multi-word product names in Chinese diagrams', () => {
  const input = fixture('chinese-product-name.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.nodes[0].label = 'GitHub Actions';
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.authoredLanguage.violations, 0);
  assert.ok(receipt.authoredLanguage.technicalIdentifiersPreserved >= 1);
});

test('validate preserves bounded technical expressions and operator-separated event names', () => {
  const input = fixture('chinese-technical-expressions.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.cards[0].items = [
      'runAgentLoop(AgentMessage[], snapshot)',
      'transformContext + convertToLlm',
      'AgentEvent.start / AgentEvent.delta / AgentEvent.done',
      'runAgentLoop(first, second, third)',
    ];
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.authoredLanguage.violations, 0);
  assert.ok(receipt.authoredLanguage.technicalIdentifiersPreserved >= 4);
});

test('validate still rejects ordinary lower-case English prose', () => {
  const input = fixture('chinese-english-prose.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.cards[0].items[0] = 'prompt input';
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.ok(receipt.diagnostics[0].evidence.violations.some((entry) => entry.text === 'prompt input'));
});

test('validate rejects English prose hidden behind a short Chinese explanation prefix', () => {
  const input = fixture('chinese-prefix-english-prose.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.cards[0].items = [
      '说明：prompt input and retry policy',
      '备注: query profile and metrics',
      '描述：Web App sends request',
    ];
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.deepEqual(
    receipt.diagnostics[0].evidence.violations.map(({ text }) => text),
    [
      '说明：prompt input and retry policy',
      '备注: query profile and metrics',
      '描述：Web App sends request',
    ],
  );
});

test('validate preserves technical identifiers after a Chinese explanation prefix', () => {
  const input = fixture('chinese-prefix-technical-identifiers.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.cards[0].items = [
      '说明：GET /refresh',
      '备注：DtpExecutor',
    ];
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.authoredLanguage.violations, 0);
  assert.ok(receipt.authoredLanguage.technicalIdentifiersPreserved >= 2);
});

test('validate rejects English prose that uses one Chinese character as a language bypass', () => {
  const input = fixture('single-chinese-character-english-prose.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.cards[0].items = [
      'X data pipeline 图',
      '图 complete English description',
    ];
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(
    receipt.diagnostics[0].evidence.violations.map(({ text }) => text),
    ['X data pipeline 图', '图 complete English description'],
  );
});

test('validate inspects reader-facing dataflow classification text', () => {
  const input = dataflowFixture('english-classification.dataflow.json', (source) => {
    source.meta.title = '产品分析数据流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.flows[0].classification = 'complete English description';
  });
  const result = run(['validate', 'dataflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.ok(receipt.diagnostics[0].evidence.violations.some((entry) => (
    entry.path === '/flows/0/classification'
      && entry.text === 'complete English description'
  )));
});

test('validate rejects ordinary English hidden behind operators or a technical-looking prefix', () => {
  const input = fixture('chinese-operator-prose.workflow.json', (source) => {
    source.meta.title = 'Agent 工具调用工作流';
    source.meta.locale = 'zh-CN';
    localizeReaderFacing(source);
    source.cards[0].items = [
      'retry / cancel / abort',
      'retry. / cancel. / abort.',
      'retryLater. / cancelNow. / abortSoon.',
      'this) / is) / english)',
      'GitHub Actions Builds Every Pull Request Automatically',
    ];
  });
  const result = run(['validate', 'workflow', input, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.deepEqual(
    receipt.diagnostics[0].evidence.violations.map(({ text }) => text),
    [
      'retry / cancel / abort',
      'retry. / cancel. / abort.',
      'retryLater. / cancelNow. / abortSoon.',
      'this) / is) / english)',
      'GitHub Actions Builds Every Pull Request Automatically',
    ],
  );
});

test('deliver enforces the same authored-language gate before touching output', () => {
  const input = fixture('english-delivery.workflow.json', (source) => {
    source.meta.title = 'Agent tool workflow';
    source.meta.locale = 'en';
  });
  const output = path.join(tmp, 'should-not-exist.html');
  const result = run(['deliver', 'workflow', input, output, '--require-authored-language', 'zh-CN', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(fs.existsSync(output), false);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'language');
  assert.equal(receipt.diagnostics[0].code, 'content/authored-language');
});

test('validate-batch enforces each candidate authored-language requirement before browser work', () => {
  const manifest = path.join(tmp, 'language-batch.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    schemaVersion: 1,
    candidates: [{
      id: 'english-workflow',
      type: 'workflow',
      input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      requiredLanguage: 'zh-CN',
    }],
  }, null, 2)}\n`);
  const result = run(['validate-batch', manifest, '--quality', 'showcase', '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'validate-batch');
  assert.equal(receipt.candidates[0].stage, 'language');
  assert.equal(receipt.candidates[0].diagnostics[0].code, 'content/authored-language');
});
