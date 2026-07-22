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
  assert.match(html, /npx skills add tt-a1i\/archify -g/);
  assert.match(html, /npx skills use tt-a1i\/archify@archify --agent codex/);
  assert.match(html, /data-en="One install\."/);
  assert.match(html, /data-en="One bounded prompt\."/);
  assert.match(html, /data-zh="一次安装，"/);
  assert.match(html, /data-zh="一段有边界的提示词。"/);
  assert.match(html, /No repository content or diagram data is sent to this page\./);
  assert.match(html, /这个页面不会接收仓库内容或图表数据/);

  const dataMatch = html.match(/<script id="start-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch);
  const data = JSON.parse(dataMatch[1]);
  assert.deepEqual(Object.keys(data), ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
  assert.ok(Object.values(data).every((entry) => entry.en.prompt && entry.zh.prompt && entry.proof));

  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n  <\/script>\n<\/body>/);
  assert.ok(scriptMatch);
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
  assert.match(scriptMatch[1], /KNOWN_TYPES\.has\(requestedType\)/);
  assert.match(scriptMatch[1], /textContent/);
  assert.match(scriptMatch[1], /replaceChildren/);
  assert.doesNotMatch(scriptMatch[1], /innerHTML/);
});

test('generated artifacts: viewer-only Create yours link carries the exact diagram type', () => {
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
      const expected = `https://tt-a1i.github.io/archify/start.html?type=${type}`;
      assert.match(html, new RegExp(`class="artifact-start-link"[^>]+href="${expected.replace(/[.?]/g, '\\$&')}"`), type);
      assert.match(html, /class="artifact-start-link"[^>]+rel="noopener noreferrer"/, `${type}: referrer boundary`);
      assert.equal((html.match(new RegExp(expected.replace(/[.?]/g, '\\$&'), 'g')) || []).length, 1, type);

      const svg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
      assert.ok(svg, `${type}: SVG missing`);
      assert.ok(!svg.includes('Create yours'), `${type}: CTA leaked into canonical SVG`);
      assert.ok(!svg.includes('/start.html'), `${type}: start URL leaked into canonical SVG`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
