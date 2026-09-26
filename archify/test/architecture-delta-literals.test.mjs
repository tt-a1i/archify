import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attr = (node, name) => node.attrs?.find((entry) => entry.name === name)?.value;
const descendants = (node) => [node, ...(node.childNodes || []).flatMap(descendants)];
const textContent = (node) => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join('');

function fixtures(kind, operation, label) {
  const base = {
    schema_version: 1, diagram_type: 'architecture', meta: { title: 'Literal labels', output: 'literal-labels.html' },
    components: [
      { id: 'keep', type: 'backend', label: 'Keep', pos: [80, 80], size: [160, 80] },
      { id: 'target', type: 'database', label: kind === 'node' ? label : 'Target', pos: [380, 80], size: [160, 80] },
    ],
    connections: kind === 'edge' ? [{ id: 'link', from: 'keep', to: 'target', label }] : [],
    boundaries: kind === 'boundary' ? [{ kind: 'region', label, wraps: ['target'], pad: 30 }] : [],
  };
  const head = structuredClone(base);
  if (operation === 'removed') {
    if (kind === 'node') head.components.pop();
    if (kind === 'edge') head.connections = [];
    if (kind === 'boundary') head.boundaries = [];
  } else if (kind === 'edge') {
    Object.assign(head.connections[0], { fromSide: 'bottom', toSide: 'bottom', via: [[160, 240], [460, 240]] });
  } else if (kind === 'boundary') head.boundaries[0].pad = 40;
  else head.components[1].pos = [380, 280];
  return [base, head];
}

for (const kind of ['node', 'edge', 'boundary']) {
  for (const operation of ['removed', 'moved']) {
    test(`compare preserves literal replacement tokens in ${operation} ${kind} labels`, (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delta-literals-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      for (const label of ['PID $$', 'Match $&', 'Before $`', "After $'"]) {
        const inputs = fixtures(kind, operation, label).map((value, index) => {
          const file = path.join(dir, `${index}.json`);
          fs.writeFileSync(file, JSON.stringify(value));
          return file;
        });
        const output = path.join(dir, 'delta.html');
        const run = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'),
          'compare', 'architecture', ...inputs, output, '--quality', 'standard', '--json'],
        { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
        assert.ifError(run.error);
        assert.equal(run.status, 0, `${label}: ${run.stderr || run.stdout}`);
        const document = parse(fs.readFileSync(output, 'utf8'));
        const section = descendants(document).find((node) => attr(node, 'data-view') === 'delta');
        assert.ok(section, 'delta section exists');
        const nodes = descendants(section);
        const state = operation === 'removed' ? 'removed' : 'moved-from';
        let texts;
        if (kind === 'node') {
          const group = nodes.find((node) => attr(node, 'data-node-id') === 'target' && attr(node, 'data-delta-state') === state);
          assert.ok(group, 'baseline node exists');
          assert.equal(attr(group, 'data-node-label'), label);
          texts = descendants(group).filter((node) => node.tagName === 'text');
        } else if (kind === 'edge') {
          const group = nodes.find((node) => node.tagName === 'g' && attr(node, 'data-edge-id') === 'link' && attr(node, 'data-delta-state') === state);
          assert.ok(group, 'baseline relationship label exists');
          texts = descendants(group).filter((node) => node.tagName === 'text');
        } else {
          const frame = nodes.find((node) => attr(node, 'data-graph-role') === 'structural-frame' && attr(node, 'data-delta-state') === state);
          assert.ok(frame, 'baseline boundary exists');
          assert.equal(attr(frame, 'data-composition-frame-label'), label);
          const keyed = nodes.filter((node) => attr(node, 'data-delta-boundary-key') !== undefined);
          assert.ok(keyed.length >= 2, 'boundary frame and label have navigation keys');
          for (const node of keyed) assert.equal(attr(node, 'data-delta-boundary-key'), `region:${label}`);
          texts = nodes.filter((node) => node.tagName === 'text' && attr(node, 'data-boundary-label') !== undefined && attr(node, 'data-delta-state') === state);
        }
        assert.ok(texts.some((node) => textContent(node) === label), `${kind} visible label must preserve ${label}`);
      }
    });
  }
}
