import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-links-'));

function fixture(links) {
  const file = path.join(tmp, 'links-' + Math.random().toString(36).slice(2) + '.workflow.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Linked workflow', quality_profile: 'showcase' },
    lanes: [{ id: 'l1', label: 'Lane' }],
    nodes: [
      { id: 'a', lane: 'l1', col: 0, type: 'frontend', label: 'Start', sublabel: 'here', width: 120, ...(links ? { links } : {}) },
      { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'End', width: 120 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: 'go', ...(links ? { links: [{ label: '导航', href: 'https://example.com/route' }] } : {}) }],
    cards: [],
  }, null, 2));
  return file;
}

function run(args) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function render(file) {
  const output = path.join(tmp, path.basename(file) + '.html');
  const result = run(['render', 'workflow', file, output, '--quality', 'showcase']);
  assert.equal(result.status, 0, 'render must succeed:\n' + (result.stdout || result.stderr));
  return fs.readFileSync(output, 'utf8');
}

test('authored node and edge links render as clickable anchors that open in a new tab', () => {
  const html = render(fixture([
    { label: '地图', href: 'https://uri.amap.com/marker?position=121.4,31.2' },
    { label: '点评', href: 'https://www.dianping.com/search/keyword/1/0_x' },
  ]));
  assert.match(html, /<a href="https:\/\/uri\.amap\.com\/marker[^"]*" target="_blank" rel="noopener noreferrer" data-node-link="地图"/);
  assert.match(html, /data-node-link="点评"/);
  assert.match(html, /data-edge-link="导航"/);
  assert.match(html, /\.c-link-chip/);
  assert.match(html, /\.node-actions \{ opacity: 0;/);
});

test('workflows without authored links keep the link stylesheet and anchors out of the artifact', () => {
  const html = render(path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'));
  assert.doesNotMatch(html, /data-node-link=/);
  assert.doesNotMatch(html, /data-edge-link=/);
  assert.doesNotMatch(html, /c-link-chip/);
});

test('a non-http link target is rejected by the schema', () => {
  const file = fixture([{ label: '地图', href: 'javascript:alert(1)' }]);
  const result = run(['validate', 'workflow', file, '--json']);
  assert.notEqual(result.status, 0, 'javascript: targets must not validate');
  assert.match(result.stdout + result.stderr, /href|pattern/i);
});

test('an action row that cannot fit reports instead of disappearing', () => {
  const file = path.join(tmp, 'overflow.workflow.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Overflow fixture', quality_profile: 'showcase' },
    lanes: [{ id: 'l1', label: 'Lane' }],
    nodes: [{
      id: 'narrow', lane: 'l1', col: 0, type: 'frontend', label: 'Narrow', width: 100,
      links: [
        { label: '地图', href: 'https://example.com/map' },
        { label: '点评', href: 'https://example.com/review' },
        { label: '小红书', href: 'https://example.com/note' },
      ],
    }],
    edges: [],
    cards: [],
  }, null, 2));
  const result = run(['validate', 'workflow', file, '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /workflow\/action-row-overflow/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
