import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-types-'));

function run(args) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function documentWith(types, nodeTypes) {
  const file = path.join(tmp, 'types-' + Math.random().toString(36).slice(2) + '.workflow.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Type fixture', quality_profile: 'showcase', ...(types ? { types } : {}) },
    lanes: [{ id: 'l1', label: 'Lane' }],
    nodes: nodeTypes.map((type, index) => ({
      id: 'n' + index, lane: 'l1', col: index, type,
      label: 'Node ' + index, width: 120,
    })),
    edges: [],
    cards: [],
  }, null, 2));
  return file;
}

function render(file) {
  const output = path.join(tmp, path.basename(file) + '.html');
  const result = run(['render', 'workflow', file, output, '--quality', 'showcase']);
  assert.equal(result.status, 0, 'render must succeed:\n' + (result.stdout || result.stderr));
  return fs.readFileSync(output, 'utf8');
}

test('a document may declare its own kind vocabulary and palette slot', () => {
  const html = render(documentWith(
    [
      { id: 'venue', label: '点名的店', color: 'violet' },
      { id: 'open', label: '到了再选', color: 'orange' },
    ],
    ['venue', 'open'],
  ));
  assert.match(html, /点名的店/);
  assert.match(html, /到了再选/);
  // The legend carries these class names itself, so read the drawn nodes: n0 is
  // "venue" (violet → c-database), n1 is "open" (orange → c-messagebus).
  const groups = new Map([...html.matchAll(/<g[^>]*data-node-id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)]
    .map((match) => [match[1], match[2]]));
  assert.match(groups.get('n0') || '', /class="[^"]*c-database/);
  assert.match(groups.get('n1') || '', /class="[^"]*c-messagebus/);
});

test('legacy kind names stay available beside declared ones', () => {
  const html = render(documentWith(
    [{ id: 'venue', label: '点名的店', color: 'violet' }],
    ['venue', 'external'],
  ));
  assert.match(html, /点名的店/);
  assert.match(html, /c-external/);
});

test('a type outside both vocabularies is rejected', () => {
  const result = run(['validate', 'workflow', documentWith(
    [{ id: 'venue', label: '点名的店', color: 'violet' }],
    ['venue', 'ghost'],
  ), '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /workflow\/unknown-type/);
});

test('a document without meta.types keeps the built-in legend', () => {
  const html = render(documentWith(null, ['frontend', 'backend']));
  assert.doesNotMatch(html, /点名的店/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
