import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidateRoot = path.resolve(here, '../../../..');
if (!process.argv[2]) throw new Error('用法：node compare-defaults.mjs <基线仓库> [结果JSON路径]');
const baseRoot = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] || path.join(here, 'default-compatibility.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-compatibility-'));
const cases = [
  'web-app.architecture.json', 'agent-tool-call.workflow.json', 'cache-miss-request.sequence.json',
  'product-analytics.dataflow.json', 'agent-run.lifecycle.json', 'orders.erd.json',
  'payments.class.json', 'payment-platform.tree.json', 'payment-incident.timeline.json',
  'checkout-request.waterfall.json',
].map(name => ({ name, document: JSON.parse(fs.readFileSync(path.join(baseRoot, 'archify/examples', name), 'utf8')) }));
for (const name of ['ordinary', 'dense', 'cjk']) {
  cases.push({ name: `typography-${name}`, document: JSON.parse(fs.readFileSync(
    path.join(candidateRoot, 'test/fixtures/workflow-typography', `${name}.workflow.json`), 'utf8')) });
}
cases.push({ name: 'workflow-v1', document: JSON.parse(fs.readFileSync(
  path.join(baseRoot, 'test/fixtures/v1-baseline/agent-tool-call.workflow.json'), 'utf8')) });

const record = {
  base: git(baseRoot, 'rev-parse', 'HEAD'), candidate: git(candidateRoot, 'rev-parse', 'HEAD'),
  node: process.versions.node, platform: process.platform,
  method: '两个版本使用相同输入和源码仓库；公开CLI validate/render成功后比较完整HTML及原始SVG字节。',
  cases: [],
};
function run(root, args) {
  const result = spawnSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), ...args], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  if (result.error || result.status !== 0) throw new Error(`${root}: ${args.join(' ')}\n${result.error || result.stdout || result.stderr}`);
  return result.stdout;
}
try {
  // 来源验证使用本轮独有的临时仓库，不修改任何真实仓库的origin或提交身份。
  const sourceRoot = path.join(scratch, 'source');
  fs.mkdirSync(sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, 'source.js'), 'export const source = 1;\n');
  git(sourceRoot, 'init');
  git(sourceRoot, 'remote', 'add', 'origin', 'https://github.com/example/archify-review-fixture');
  git(sourceRoot, 'add', 'source.js');
  git(sourceRoot, '-c', 'user.name=Archify Tests', '-c', 'user.email=archify@example.test', 'commit', '-m', 'fixture');
  for (const brand of [false, true]) {
    cases.push({ name: brand ? 'source-brand-default' : 'source-default', sourceRoot,
      document: { schema_version: 2, diagram_type: 'workflow',
        meta: { title: 'Source-backed workflow', output: 'source.html', repository: {
          url: 'https://github.com/example/archify-review-fixture', revision: git(sourceRoot, 'rev-parse', 'HEAD'),
        } }, lanes: [{ id: 'l', label: 'Lane' }],
        nodes: [{ id: 'n', type: 'backend', lane: 'l', col: 0, label: 'ProcessData', sublabel: 'subtitle',
          sources: [{ path: 'source.js', line: 1 }], ...(brand ? { brand: 'openai', width: 140, height: 80 } : {}) }], edges: [] },
    });
  }
  for (const [index, fixture] of cases.entries()) {
    const input = path.join(scratch, `${index}.json`);
    fs.writeFileSync(input, JSON.stringify(fixture.document));
    const extra = fixture.sourceRoot ? ['--repo-root', fixture.sourceRoot] : [];
    const pair = [];
    for (const [version, root] of [['base', baseRoot], ['candidate', candidateRoot]]) {
      const type = fixture.document.diagram_type;
      const validation = JSON.parse(run(root, ['validate', type, input, '--json', ...extra]));
      if (!validation.ok) throw new Error(`${fixture.name}: validate未通过`);
      const artifact = path.join(scratch, `${index}-${version}.html`);
      run(root, ['render', type, input, artifact, ...extra]);
      const html = fs.readFileSync(artifact, 'utf8');
      const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
      if (!svg) throw new Error(`${fixture.name}: 输出缺少SVG`);
      pair.push({ html: hash(html), svg: hash(svg) });
    }
    const row = { name: fixture.name, type: fixture.document.diagram_type, inputSha256: hash(fs.readFileSync(input)),
      base: pair[0], candidate: pair[1], htmlIdentical: pair[0].html === pair[1].html, svgIdentical: pair[0].svg === pair[1].svg };
    record.cases.push(row);
    console.log(`${fixture.name}: HTML=${row.htmlIdentical} SVG=${row.svgIdentical}`);
  }
  record.passed = record.cases.every(row => row.htmlIdentical && row.svgIdentical);
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  if (!record.passed) process.exitCode = 1;
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
