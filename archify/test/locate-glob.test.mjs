import assert from 'node:assert/strict';
import test from 'node:test';
import { LocateError } from '../locate/error.mjs';
import { compileGlob, expandBraces, matchesGlob, subsumes } from '../locate/glob.mjs';

test('§3: a/**/b matches zero or more intermediate segments', () => {
  assert.equal(matchesGlob('a/**/b', 'a/b'), true);
  assert.equal(matchesGlob('a/**/b', 'a/x/b'), true);
  assert.equal(matchesGlob('a/**/b', 'a/x/y/b'), true);
  assert.equal(matchesGlob('a/**/b', 'a/x/y/c'), false);
});

test('§3: trailing ** matches one or more segments and not the prefix file', () => {
  assert.equal(matchesGlob('a/**', 'a/x'), true);
  assert.equal(matchesGlob('a/**', 'a/x/y'), true);
  assert.equal(matchesGlob('a/**', 'a'), false);
});

test('§3: **/*.md matches markdown at any depth', () => {
  assert.equal(matchesGlob('**/*.md', 'README.md'), true);
  assert.equal(matchesGlob('**/*.md', 'docs/guide.md'), true);
  assert.equal(matchesGlob('**/*.md', 'a/b/c.md'), true);
  assert.equal(matchesGlob('**/*.md', 'a/b/c.txt'), false);
});

test('§3: ** must be a whole segment', () => {
  assert.throws(() => compileGlob('a/b**/c'), (error) => (
    error instanceof LocateError && error.code === 'locate/ownership-glob-invalid'
  ));
});

test('§3: no implicit directory expansion and matching is anchored and case-sensitive', () => {
  assert.equal(matchesGlob('archify/schemas', 'archify/schemas'), true);
  assert.equal(matchesGlob('archify/schemas', 'archify/schemas/architecture.schema.json'), false);
  assert.equal(matchesGlob('Archify/bin/**', 'archify/bin/archify.mjs'), false);
  assert.equal(matchesGlob('bin/*.mjs', 'prefix/bin/cli.mjs'), false);
  assert.equal(matchesGlob('file?.js', 'fileA.js'), true);
  assert.equal(matchesGlob('file?.js', 'fileAB.js'), false);
});

test('§3: brace expansion is literal and happens first', () => {
  assert.deepEqual(expandBraces('archify/renderers/{architecture,workflow}/**').sort(), [
    'archify/renderers/architecture/**',
    'archify/renderers/workflow/**',
  ]);
  assert.equal(matchesGlob('archify/renderers/{architecture,workflow}/**', 'archify/renderers/architecture/render-architecture.mjs'), true);
  assert.equal(matchesGlob('archify/renderers/{architecture,workflow}/**', 'archify/renderers/sequence/render-sequence.mjs'), false);
});

test('§3: invalid braces fail closed', () => {
  assert.throws(() => expandBraces('a/{b'), (error) => error.code === 'locate/ownership-glob-invalid');
  assert.throws(() => expandBraces('a/{b*}'), (error) => error.code === 'locate/ownership-glob-invalid');
  assert.throws(() => expandBraces('a/{b,{c}}'), (error) => error.code === 'locate/ownership-glob-invalid');
  const many = `{${Array.from({ length: 65 }, (_, index) => `v${index}`).join(',')}}`;
  assert.throws(() => expandBraces(many), (error) => error.code === 'locate/ownership-glob-invalid');
});

test('§6: ten conservative subsumes cases', () => {
  const cases = [
    ['archify/renderers/**', 'archify/renderers/shared/**', true],
    ['archify/renderers/**', 'archify/renderers/shared/*.mjs', true],
    ['archify/assets/**', 'archify/**', false],
    ['archify/scripts/*.mjs', 'archify/scripts/**', false],
    ['a/**', 'a/x/y', true],
    ['a/**', 'a', false],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['*', 'foo', true],
    ['foo', 'f*', false],
    ['**', '*', false],
    ['**', '*/*', false],
    ['**', '{,}', false],
    ['**', '{a,}', false],
    ['a/**', 'a/*', false],
    ['*/**', '*/*', false],
    ['**/**', '*', false],
  ];
  for (const [parent, child, expected] of cases) {
    assert.equal(subsumes(parent, child), expected, `${parent} ⊇ ${child}`);
  }
});

// Bounded deterministic counterexample search for the subset implication.
test('subsumes never admits a sampled path outside the parent', () => {
  const segments = ['', 'a', 'b', '*', '?', '**', '{a,}'];
  const patterns = [...segments.filter(Boolean), ...segments.flatMap(a => segments.map(b => `${a}/${b}`))];
  const parts = ['', 'a', 'b', 'ab'];
  const paths = [...parts, ...parts.flatMap(a => parts.map(b => `${a}/${b}`)),
    ...parts.flatMap(a => parts.flatMap(b => parts.map(c => `${a}/${b}/${c}`)))];
  const compiled = new Map(patterns.map(p => [p, compileGlob(p)]));
  for (const parent of patterns) for (const child of patterns) {
    if (!subsumes(parent, child)) continue;
    for (const path of paths) {
      assert.ok(!compiled.get(child)(path) || compiled.get(parent)(path),
        JSON.stringify({ parent, child, path }));
    }
  }
});
