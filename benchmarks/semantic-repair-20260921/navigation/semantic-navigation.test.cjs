'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cli = path.join(__dirname, 'semantic-navigation.cjs');
const node22 = '/opt/homebrew/opt/node@22/bin/node';
function fixture(files) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-navigation-')); for (const [name, text] of Object.entries(files)) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } return root; }
function run(root, ...args) { return spawnSync(node22, [cli, '--repo-root', root, '--scope', 'src', '--json', ...args], { encoding: 'utf8' }); }

test('follows alias and barrel re-export without including an unrelated same-name declaration', () => {
  const root = fixture({ 'src/original.ts': 'export function target(value: string) { return value }\n', 'src/barrel.ts': "export { target as renamed } from './original.js'\n", 'src/use.ts': "import { renamed } from './barrel.js'\nexport const value = renamed('ok')\n", 'src/unrelated.ts': 'export function target() { return 0 }\n', 'tests/ignored.ts': 'export const target = 1\n' });
  const result = run(root, '--at', 'src/use.ts:2:22');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.declarations.items[0].identifier.path, 'src/original.ts');
  assert.ok(output.references.items.some((item) => item.path === 'src/use.ts'));
  assert.ok(!output.references.items.some((item) => item.path === 'src/unrelated.ts'));
  assert.equal(output.scope.includedFiles, 4);
});
test('reports a missing symbol and preserves bounds with explicit truncation', () => {
  const root = fixture({ 'src/a.ts': 'export const repeated = 1\nexport const one = repeated\nexport const two = repeated\n' });
  const missing = run(root, '--symbol', 'missing');
  assert.equal(missing.status, 2); assert.match(missing.stderr, /no declaration named missing/);
  const limited = run(root, '--symbol', 'repeated', '--limit', '1');
  assert.equal(limited.status, 0, limited.stderr);
  const output = JSON.parse(limited.stdout);
  assert.equal(output.references.items.length, 1);
  assert.ok(output.references.truncated >= 1);
});
test('requires a file-qualified selector for independent same-name declarations', () => {
  const root = fixture({ 'src/left.ts': 'export function collide() { return 1 }\n', 'src/right.ts': 'export function collide() { return 2 }\n' });
  const ambiguous = run(root, '--symbol', 'collide');
  assert.equal(ambiguous.status, 2); assert.match(ambiguous.stderr, /ambiguous --symbol collide/);
  const selected = run(root, '--symbol', 'src/right.ts:collide');
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).declarations.items[0].identifier.path, 'src/right.ts');
});
test('returns AST implementation bounds and keeps overload signatures distinct from a bounded slice', () => {
  const root = fixture({ 'src/example.ts': [
    'export class Example {',
    '  work(value: string): string;',
    '  work(value: string) {',
    '    if (value) {',
    '      return `${value}!`;',
    '    }',
    "    return '';",
    '  }',
    '}',
  ].join('\n') });
  const result = run(root, '--symbol', 'Example.work', '--declaration-lines', '2');
  assert.equal(result.status, 0, result.stderr);
  const definitions = JSON.parse(result.stdout).declarations.items;
  assert.equal(definitions.length, 2);
  assert.equal(definitions[0].role, 'overload-signature');
  const implementation = definitions.find((item) => item.role === 'implementation');
  assert.deepEqual(implementation.range, { start: { line: 3, column: 3 }, end: { line: 8, column: 4 } });
  assert.equal(implementation.source.shownThroughLine, 4);
  assert.equal(implementation.source.fullEndLine, 8);
  assert.equal(implementation.source.truncatedLines, 4);
});
test('rejects malformed and out-of-bounds source locations', () => {
  const root = fixture({ 'src/a.ts': 'export const value = 1\n' });
  for (const at of ['src/a.ts:bad:1', 'src/a.ts:2:1', 'src/a.ts:1:999']) {
    const result = run(root, '--at', at);
    assert.equal(result.status, 2, `${at}: ${result.stderr}`);
  }
});


test('import resolution cannot expose queries or locations outside eligible scope files', () => {
  const root = fixture({ 'src/in.ts': "import { outside } from '../out/outside.js'\nexport const local = outside()\n", 'out/outside.ts': 'export function outside() { return 1 }\n' });
  const name = run(root, '--symbol', 'outside');
  assert.equal(name.status, 2, name.stdout);
  const location = run(root, '--at', 'out/outside.ts:1:17');
  assert.equal(location.status, 2, location.stdout);
  const imported = run(root, '--at', 'src/in.ts:2:22');
  assert.equal(imported.status, 0, imported.stderr);
  const output = JSON.parse(imported.stdout);
  assert.equal(output.declarations.items.length, 0);
  assert.equal(output.scope.omittedByScope.declarations, 1);
  assert.ok(output.references.items.every((item) => item.path.startsWith('src/')));
  const escaped = fixture({ 'outside.ts': 'export const escaped = 1\n' });
  fs.symlinkSync(escaped, path.join(root, 'linked'));
  const link = spawnSync(node22, [cli, '--repo-root', root, '--scope', 'linked', '--symbol', 'escaped'], { encoding: 'utf8' });
  assert.equal(link.status, 2, link.stdout);
});
