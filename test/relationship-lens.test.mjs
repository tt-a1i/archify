import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relationship-lens-'));

const CASES = {
  architecture: { example: 'web-app.architecture.json', collection: 'connections' },
  workflow: { example: 'agent-tool-call.workflow.json', collection: 'edges' },
  sequence: { example: 'cache-miss-request.sequence.json', collection: 'messages' },
  dataflow: { example: 'product-analytics.dataflow.json', collection: 'flows' },
  lifecycle: { example: 'agent-run.lifecycle.json', collection: 'transitions' },
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

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

test('all typed renderers expose named, stable relationships without changing geometry', () => {
  for (const [mode, config] of Object.entries(CASES)) {
    const html = render(mode, config.example);
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', config.example), 'utf8'));
    const relationships = source[config.collection];
    const diagram = svg(html);
    const keys = new Set(Array.from(diagram.matchAll(/data-edge-key="(\d+)"/g), (match) => match[1]));

    assert.equal(keys.size, relationships.length, `${mode} keeps one stable key per source relationship`);
    relationships.forEach((relationship, index) => {
      const expectedKey = source.schema_version === 2 ? '\\d+' : String(index);
      assert.match(diagram, new RegExp(`data-edge-from="${escapeAttr(relationship.from)}"[^>]+data-edge-to="${escapeAttr(relationship.to)}"[^>]+data-edge-key="${expectedKey}"`), `${mode} relationship ${index}`);
      if (relationship.label) {
        assert.match(diagram, new RegExp(`data-edge-label="${escapeAttr(relationship.label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${mode} named relationship ${index}`);
      }
    });
    assert.match(diagram, /data-node-id="[^"]+" data-node-label="[^"]+" tabindex="0"/, mode);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
