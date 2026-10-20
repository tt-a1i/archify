import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');

// A pipe holds 8 KiB on macOS and 64 KiB on Linux before it blocks, so every
// fixture below produces a layout report well past both sizes.
const PIPE_LIMIT = 64 * 1024;

const wideTree = () => {
  const nodes = [{ id: 'root', label: 'root' }];
  for (let i = 0; i < 20; i += 1) {
    nodes.push({ id: `b${i}`, label: `B${i}`, parent: 'root' });
    for (let j = 0; j < 10; j += 1) nodes.push({ id: `l${i}_${j}`, label: 'leaf', parent: `b${i}` });
  }
  return { schema_version: 1, diagram_type: 'tree', meta: { title: 't' }, nodes };
};

const wideTimeline = () => {
  const events = [];
  for (let i = 0; i < 800; i += 1) {
    events.push({
      id: `e${i}`,
      at: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
      title: `Event ${i}`,
    });
  }
  return { schema_version: 1, diagram_type: 'timeline', meta: { title: 't', evidence: 'observed' }, events };
};

const wideWaterfall = () => {
  const spans = [];
  for (let i = 0; i < 300; i += 1) {
    spans.push({ id: `s${i}`, name: `Span ${i}`, start: i * 10, end: i * 10 + 5 });
  }
  return { schema_version: 1, diagram_type: 'waterfall', meta: { title: 't', evidence: 'measured', unit: 's' }, spans };
};

const wideClass = () => {
  const types = [];
  for (let i = 0; i < 600; i += 1) {
    types.push({
      id: `t${i}`,
      label: `Type${i}`,
      kind: 'class',
      pos: [(i % 25) * 200, Math.floor(i / 25) * 160],
      attributes: [{ name: 'id', type: 'long' }],
    });
  }
  return { schema_version: 1, diagram_type: 'class', meta: { title: 't' }, types };
};

const wideErd = () => {
  const entities = [];
  for (let i = 0; i < 169; i += 1) {
    const attributes = [];
    for (let j = 0; j < 16; j += 1) attributes.push({ name: `col_${j}`, type: 'varchar(40)' });
    entities.push({
      id: `e${i}`,
      label: `entity_${i}`,
      row: i % 13,
      col: Math.floor(i / 13),
      attributes,
    });
  }
  return { schema_version: 1, diagram_type: 'erd', meta: { title: 't' }, entities };
};

const cases = [
  ['tree', wideTree],
  ['timeline', wideTimeline],
  ['waterfall', wideWaterfall],
  ['class', wideClass],
  ['erd', wideErd],
];

for (const [type, build] of cases) {
  test(`layout-json: ${type} report larger than a pipe buffer arrives complete through a stalled pipe`, { skip: process.platform === 'win32' && 'needs a POSIX shell pipeline' }, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `archify-layout-json-${type}-`));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const input = path.join(dir, `wide.${type}.json`);
    const output = path.join(dir, 'wide.html');
    fs.writeFileSync(input, JSON.stringify(build()));
    const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);

    // Control: the same report redirected to a regular file is complete.
    const controlPath = path.join(dir, 'control.json');
    const descriptor = fs.openSync(controlPath, 'w');
    let controlRun;
    try {
      controlRun = spawnSync(process.execPath, [renderer, input, output, '--layout-json'], {
        stdio: ['ignore', descriptor, 'pipe'],
        encoding: 'utf8',
      });
    } finally {
      fs.closeSync(descriptor);
    }
    assert.equal(controlRun.status, 0, controlRun.stderr);
    const expected = fs.readFileSync(controlPath, 'utf8');
    assert.ok(Buffer.byteLength(expected) > PIPE_LIMIT, `${type} fixture must exceed a pipe buffer`);
    assert.doesNotThrow(() => JSON.parse(expected));

    // The pipeline's reader starts two seconds late, so the pipe is full
    // long before anyone drains it. A renderer that exits right after
    // printing discards the unwritten tail; only the bytes that fit the
    // pipe buffer would reach the file.
    const pipedPath = path.join(dir, 'piped.json');
    const command = [
      JSON.stringify(process.execPath),
      JSON.stringify(renderer),
      JSON.stringify(input),
      JSON.stringify(output),
      '--layout-json',
      '| (sleep 2; cat)',
      '>',
      JSON.stringify(pipedPath),
    ].join(' ');
    const pipedRun = spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(pipedRun.status, 0, pipedRun.stderr);
    const piped = fs.readFileSync(pipedPath, 'utf8');
    assert.equal(piped, expected, `${type} layout report must not be truncated by a pipe`);
    assert.doesNotThrow(() => JSON.parse(piped));
  });
}
