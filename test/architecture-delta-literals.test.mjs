import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const attr = (node, name) => node.attrs?.find((entry) => entry.name === name)?.value;
const descendants = (node) => [node, ...(node.childNodes || []).flatMap(descendants)];
const textContent = (node) => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join('');

const labels = ['PID $$', 'Match $&', 'Before $`', "After $'"];

function fixtures(kind, operation) {
  const base = {
    schema_version: 1, diagram_type: 'architecture', meta: { title: 'Literal labels', output: 'literal-labels.html' },
    components: [], connections: [], boundaries: [],
  };
  // Independent rows batch the tokens without overlapping nodes, routes, or frames.
  for (const [index, label] of labels.entries()) {
    const y = 80 + index * 320;
    base.components.push(
      { id: `keep-${index}`, type: 'backend', label: 'Keep', pos: [80, y], size: [160, 80] },
      { id: `target-${index}`, type: 'database', label: kind === 'node' ? label : 'Target', pos: [380, y], size: [160, 80] },
    );
    if (kind === 'edge') base.connections.push({ id: `link-${index}`, from: `keep-${index}`, to: `target-${index}`, label });
    if (kind === 'boundary') base.boundaries.push({ kind: 'region', label, wraps: [`target-${index}`], pad: 30 });
  }
  const head = structuredClone(base);
  if (operation === 'removed') {
    if (kind === 'node') head.components = head.components.filter(({ id }) => id.startsWith('keep-'));
    if (kind === 'edge') head.connections = [];
    if (kind === 'boundary') head.boundaries = [];
  } else if (kind === 'edge') {
    for (const [index, connection] of head.connections.entries()) {
      const y = 240 + index * 320;
      Object.assign(connection, { fromSide: 'bottom', toSide: 'bottom', via: [[160, y], [460, y]] });
    }
  } else if (kind === 'boundary') {
    for (const boundary of head.boundaries) boundary.pad = 40;
  } else {
    for (const component of head.components.filter(({ id }) => id.startsWith('target-'))) component.pos[0] = 680;
  }
  return [base, head];
}

for (const kind of ['node', 'edge', 'boundary']) {
  for (const operation of ['removed', 'moved']) {
    test(`compare preserves literal replacement tokens in ${operation} ${kind} labels`, (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delta-literals-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const inputs = fixtures(kind, operation).map((value, index) => {
        const file = path.join(dir, `${index}.json`);
        fs.writeFileSync(file, JSON.stringify(value));
        return file;
      });
      const output = path.join(dir, 'delta.html');
      const run = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'),
        'compare', 'architecture', ...inputs, output, '--quality', 'standard', '--json'],
      { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
      assert.ifError(run.error);
      assert.equal(run.status, 0, run.stderr || run.stdout);
      const document = parse(fs.readFileSync(output, 'utf8'));
      const section = descendants(document).find((node) => attr(node, 'data-view') === 'delta');
      assert.ok(section, 'delta section exists');
      const nodes = descendants(section);
      const state = operation === 'removed' ? 'removed' : 'moved-from';
      if (kind === 'boundary') {
        for (const node of nodes.filter((node) => attr(node, 'data-delta-boundary-key') !== undefined)) {
          const label = attr(node, 'data-composition-frame-label') ?? textContent(node);
          assert.ok(labels.includes(label), 'every navigation key belongs to a literal boundary');
          assert.equal(attr(node, 'data-delta-boundary-key'), `region:${label}`);
        }
      }
      for (const [index, label] of labels.entries()) {
        let texts;
        if (kind === 'node') {
          const group = nodes.find((node) => attr(node, 'data-node-id') === `target-${index}` && attr(node, 'data-delta-state') === state);
          assert.ok(group, 'baseline node exists');
          assert.equal(attr(group, 'data-node-label'), label);
          texts = descendants(group).filter((node) => node.tagName === 'text');
        } else if (kind === 'edge') {
          const group = nodes.find((node) => node.tagName === 'g' && attr(node, 'data-edge-id') === `link-${index}` && attr(node, 'data-delta-state') === state);
          assert.ok(group, 'baseline relationship label exists');
          texts = descendants(group).filter((node) => node.tagName === 'text');
        } else {
          const frame = nodes.find((node) => attr(node, 'data-graph-role') === 'structural-frame' && attr(node, 'data-composition-frame-label') === label && attr(node, 'data-delta-state') === state);
          assert.ok(frame, 'baseline boundary exists');
          assert.equal(attr(frame, 'data-composition-frame-label'), label);
          assert.equal(attr(frame, 'data-delta-boundary-key'), `region:${label}`);
          const keyed = nodes.filter((node) => attr(node, 'data-delta-boundary-key') === `region:${label}`);
          assert.ok(keyed.length >= 2, 'boundary frame and label have navigation keys');
          texts = nodes.filter((node) => node.tagName === 'text' && attr(node, 'data-boundary-label') !== undefined && attr(node, 'data-delta-state') === state && textContent(node) === label);
          for (const node of texts) assert.equal(attr(node, 'data-delta-boundary-key'), `region:${label}`);
        }
        assert.ok(texts.some((node) => textContent(node) === label), `${kind} visible label must preserve ${label}`);
      }
    });
  }
}
