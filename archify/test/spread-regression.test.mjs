// Regression coverage for the argument-spread RangeError. V8 caps the number of
// arguments a single call may receive, so `Math.min(...items)` over an
// input-sized collection used to crash large-but-valid specs. Each case below
// failed on the pre-fix revision and must now render successfully.
//
// The `many-components` case passes `--stack-size=128` to lower the argument
// ceiling so a 12k-component fixture still exceeds it on the older Node runtimes
// in the matrix (observed RangeError on Node 20, ~30s render); on newer V8 the
// same input is a fast completion guard for the legend/layout path.
//
//   node --test test/spread-regression.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-spread-'));

const component = (index) => ({
  id: `c${index}`,
  type: 'backend',
  label: 'N',
  pos: [40 + index * 140, 80],
  size: [120, 60],
});

function render(name, doc, flags = []) {
  const input = path.join(tmp, `${name}.json`);
  const output = path.join(tmp, `${name}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = spawnSync(process.execPath, [...flags, renderer, input, output], {
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { result, output };
}

function spec(overrides) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Spread regression', output: 'spread-regression.html' },
    components: [],
    boundaries: [],
    connections: [],
    ...overrides,
  };
}

test('boundary wraps list larger than the call-argument limit still renders', () => {
  const { result, output } = render('large-wraps', spec({
    components: [component(0)],
    boundaries: [{ kind: 'region', label: 'B', wraps: Array(150_000).fill('c0') }],
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(output));
});

test('many components render through legend layout under a shrunken stack', () => {
  const { result, output } = render('many-components', spec({
    components: Array.from({ length: 12_000 }, (_, index) => component(index)),
  }), ['--stack-size=128']);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(html.includes('<svg'));
});
