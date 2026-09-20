import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Every spell of a schema accepts meta.labels. This suite checks the other half
// of that promise: the copy a document restates is the copy that gets drawn, in
// every renderer, not only in the mode where the seam was born.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-interface-labels-'));

const MODES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];

function render(mode, document, name) {
  const input = path.join(tmp, name + '.json');
  const output = path.join(tmp, name + '.html');
  fs.writeFileSync(input, JSON.stringify(document, null, 2));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', mode, 'render-' + mode + '.mjs'), input, output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function workflowDocument(labels) {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Label fixture', quality_profile: 'showcase', ...(labels ? { labels } : {}) },
    lanes: [{ id: 'l1', label: 'Lane' }],
    nodes: [{ id: 'a', lane: 'l1', col: 0, type: 'external', label: 'A', width: 120 }],
    edges: [],
    cards: [],
  };
}

test('a legend word restated through meta.labels is the word that is drawn', () => {
  const plain = render('workflow', workflowDocument(null), 'labels-plain');
  assert.equal(plain.status, 0, plain.output);
  assert.match(plain.html, /External system/, 'the default legend word must be there before the override');
  const overridden = render('workflow', workflowDocument({ 'legend.workflow.external': 'RESTATED' }), 'labels-override');
  assert.equal(overridden.status, 0, overridden.output);
  assert.match(overridden.html, /RESTATED/);
  assert.doesNotMatch(overridden.html, /External system/);
});

test('every renderer reads the overrides it accepts', () => {
  // A dynamic case per renderer would need one legal document per mode; this
  // reads the call sites instead, so a new localization call that forgets the
  // overrides fails here rather than rendering the catalog default in silence.
  for (const mode of MODES) {
    // The workflow renderer hands its copy to the compiler, which is checked below.
    if (mode === 'workflow') continue;
    const source = fs.readFileSync(path.join(skillRoot, 'renderers', mode, 'render-' + mode + '.mjs'), 'utf8');
    const calls = [...source.matchAll(/i18nText\([^;]*?\);/gs)].map((match) => match[0]);
    assert.ok(calls.length, mode + ': expected at least one localization call');
    for (const call of calls) {
      assert.match(call, /meta\.labels/, mode + ': this call drops the document overrides:\n' + call);
    }
  }
  const compiler = fs.readFileSync(path.join(skillRoot, 'renderers', 'workflow', 'workflow-compiler.mjs'), 'utf8');
  for (const call of [...compiler.matchAll(/i18nText\([^;]*?\);/gs)].map((match) => match[0])) {
    assert.match(call, /meta\.labels/, 'workflow compiler: this call drops the document overrides:\n' + call);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
