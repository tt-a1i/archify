import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-passport-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers emit details-on-demand metadata and native SVG titles', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    const diagram = svg(html);
    assert.match(diagram, /data-node-kind="[^"]+"/, mode);
    assert.match(diagram, /data-node-sublabel="[^"]+"/, mode);
    assert.match(diagram, /data-node-context="[^"]+"/, mode);
    assert.match(diagram, /<g id="node-[^"]+"[\s\S]*?<title>[^<]+ · [^<]+<\/title>/, mode);
  }
});

test('renderer-owned structure supplies truthful Semantic Passport context', () => {
  const architecture = render('architecture', CASES.architecture);
  const workflow = render('workflow', CASES.workflow);
  const sequence = render('sequence', CASES.sequence);
  const dataflow = render('dataflow', CASES.dataflow);
  const lifecycle = render('lifecycle', CASES.lifecycle);

  assert.match(architecture, /data-node-id="api"[^>]+data-node-kind="backend"[^>]+data-node-context="AWS Region: us-west-2 › sg-api :443\/:8000"/);
  assert.match(workflow, /data-node-id="approval"[^>]+data-node-kind="security"[^>]+data-node-context="Policy Boundary › Plan \+ route"/);
  assert.match(sequence, /data-node-id="redis"[^>]+data-node-kind="database"[^>]+data-node-context="Sequence participant"/);
  assert.match(dataflow, /data-node-id="warehouse"[^>]+data-node-kind="database"[^>]+data-node-context="04 \/ Store"/);
  assert.match(lifecycle, /data-node-id="executing"[^>]+data-node-kind="active"[^>]+data-node-context="Lifecycle phases"/);
});

test('Relationship Lens renders one Semantic Passport and copyable stable focus link', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /<span class="relationship-lens-eyebrow">Semantic passport<\/span>/);
  assert.match(html, /id="focus-detail" hidden/);
  assert.match(html, /id="focus-kind" data-passport="kind"/);
  assert.match(html, /id="focus-context" data-passport="context" hidden/);
  assert.match(html, /id="focus-tag" data-passport="tag" hidden/);
  assert.match(html, /id="focus-id" data-passport="id"/);
  assert.match(html, /id="btn-focus-copy"[^>]+aria-label="Copy link to focused node"/);
  assert.match(html, /id="btn-focus-relations"[^>]+aria-expanded="false"[^>]+aria-controls="relationship-lens-list"/);
  assert.match(html, /function renderPassport\(id, node\)/);
  assert.match(html, /var relationId = record && record\.id/);
  assert.match(html, /\? '#relation=' \+ encodeURIComponent\(relationId\)/);
  assert.match(html, /: '#focus=' \+ encodeURIComponent\(activeIds\[0\]\)/);
  assert.match(html, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /copyLink: copyFocusLink/);
  assert.match(html, /compactOnMobile = mobile && chip\.getAttribute\('data-relations-expanded'\) !== 'true'/);
  assert.match(html, /nodeTop - chip\.offsetHeight - gap/);
  assert.match(html, /focus-chip:not\(\[data-relations-expanded="true"\]\) \.relationship-lens-list \{ display: none; \}/);
});

test('Node Finder searches and presents the same passport facts', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /var authored = node\.getAttribute\('data-node-kind'\)/);
  assert.match(html, /var sublabel = node\.getAttribute\('data-node-sublabel'\) \|\| ''/);
  assert.match(html, /var context = node\.getAttribute\('data-node-context'\) \|\| ''/);
  assert.match(html, /var tag = node\.getAttribute\('data-node-tag'\) \|\| ''/);
  assert.match(html, /search: \(id \+ ' ' \+ label \+ ' ' \+ type \+ ' ' \+ sublabel \+ ' ' \+ context \+ ' ' \+ tag \+ ' ' \+ text\)\.toLowerCase\(\)/);
  assert.match(html, /\[item\.type, item\.context, item\.sublabel, item\.tag, item\.id\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
