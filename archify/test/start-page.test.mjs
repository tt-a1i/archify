import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');

test('start page: checked-in HTML is reproducible from canonical scenario recipes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-start-page-'));
  const generated = path.join(tmp, 'start.html');
  try {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-start.mjs'), generated]);
    assert.equal(
      fs.readFileSync(generated, 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'docs/start.html'), 'utf8'),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('start page: offers five bounded bilingual starts without ingesting source content', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'docs/start.html'), 'utf8');
  assert.doesNotMatch(html, /\[\[[A-Z0-9_]+\]\]/);
  assert.match(html, /npx -y skills add tt-a1i\/archify --skill archify --agent codex --global --copy --yes/);
  assert.match(html, /npx -y skills add tt-a1i\/archify --skill archify --agent codex --copy --yes/);
  for (const agent of ['cursor', 'codex', 'claude-code', 'opencode']) {
    assert.match(html, new RegExp(`role="tab" data-agent="${agent}"`));
  }
  assert.match(html, /data-en="One install\."/);
  assert.match(html, /data-en="One bounded prompt\."/);
  assert.match(html, /data-zh="一次安装，"/);
  assert.match(html, /data-zh="一段有边界的提示词。"/);
  assert.match(html, /No repository content or diagram data is sent to this page\./);
  assert.match(html, /这个页面不会接收仓库内容或图表数据/);
  assert.match(html, /id="copy-starter"/);
  assert.match(html, /data-en="Copy install \+ prompt"/);
  assert.match(html, /data-zh="复制安装命令 \+ 提示词"/);

  const dataMatch = html.match(/<script id="start-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch);
  const data = JSON.parse(dataMatch[1]);
  assert.deepEqual(Object.keys(data), ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
  assert.ok(Object.values(data).every((entry) => entry.en.prompt && entry.zh.prompt && entry.proof));

  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n  <\/script>\n<\/body>/);
  assert.ok(scriptMatch);
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
  assert.match(scriptMatch[1], /KNOWN_TYPES\.has\(requestedType\)/);
  assert.match(scriptMatch[1], /KNOWN_AGENTS\.has\(requestedAgent\)/);
  assert.match(scriptMatch[1], /KNOWN_SOURCES\.has\(requestedSource\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.set\('agent', agent\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.set\('source', source\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.delete\('lang'\)/);
  assert.match(scriptMatch[1], /--agent ' \+ agent \+ ' --global --copy --yes/);
  assert.match(scriptMatch[1], /--agent ' \+ agent \+ ' --copy --yes/);
  assert.match(scriptMatch[1], /function starterText\(\)/);
  assert.match(scriptMatch[1], /archify:start-funnel/);
  assert.match(scriptMatch[1], /archify\.start\.events\.v1/);
  assert.doesNotMatch(scriptMatch[1], /fetch\(|sendBeacon\(|XMLHttpRequest/);
  assert.match(scriptMatch[1], /textContent/);
  assert.match(scriptMatch[1], /replaceChildren/);
  assert.doesNotMatch(scriptMatch[1], /innerHTML/);
});

test('generated artifacts omit the promotional footer and shortcut manual', () => {
  const examples = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-start-artifacts-'));
  try {
    for (const [type, input] of Object.entries(examples)) {
      const out = path.join(tmp, `${type}.html`);
      execFileSync(process.execPath, [
        path.join(skillRoot, `renderers/${type}/render-${type}.mjs`),
        path.join(skillRoot, 'examples', input),
        out,
      ]);
      const html = fs.readFileSync(out, 'utf8');
      assert.doesNotMatch(html, /<p class="footer">/, `${type}: footer element`);
      assert.doesNotMatch(html, /Built with Archify/, `${type}: product signature`);
      assert.doesNotMatch(html, /Create yours/, `${type}: promotional CTA`);
      assert.doesNotMatch(html, /Hover to trace/, `${type}: shortcut manual`);
      assert.doesNotMatch(html, /source=artifact/, `${type}: removed artifact CTA URL`);
      assert.match(html, /id="btn-diagram-guide"/, `${type}: diagram guide remains available`);

      const svg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
      assert.ok(svg, `${type}: SVG missing`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('viewer gives wide screens a larger canvas without forcing a subtitle row', () => {
  const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
  assert.match(template, /max-width: var\(--archify-reader-width, 1440px\)/);
  assert.match(template, /Archify\.readerLayout = \(function \(\)/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-title-hierarchy-'));
  try {
    const input = JSON.parse(fs.readFileSync(
      path.join(skillRoot, 'examples', 'web-app.architecture.json'),
      'utf8',
    ));
    delete input.meta.subtitle;
    const source = path.join(tmp, 'without-subtitle.architecture.json');
    const output = path.join(tmp, 'without-subtitle.html');
    fs.writeFileSync(source, `${JSON.stringify(input, null, 2)}\n`);
    execFileSync(process.execPath, [
      path.join(skillRoot, 'renderers', 'architecture', 'render-architecture.mjs'),
      source,
      output,
    ]);
    assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /class="subtitle"/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('artifact-to-install measurement plan separates observable funnel steps from first-diagram success', () => {
  const plan = fs.readFileSync(
    path.join(repoRoot, 'docs/artifact-install-v2-measurement.md'),
    'utf8',
  );

  for (const required of [
    'start_view',
    'starter_copy',
    'global_install_copy',
    'project_install_copy',
    'prompt_copy',
    'proof_open',
    'starter_copy / start_view',
    'First-diagram success is not observable from this static page',
    'No network request',
    'source=artifact',
    'source=gallery',
  ]) {
    assert.match(plan, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required);
  }
});
