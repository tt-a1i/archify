import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { clientAsset } from '../overlay/client-assets.mjs';

const dir = new URL('../overlay/client/', import.meta.url);
const names = fs.readdirSync(dir).sort();

test('client assets: the page inlines exactly the files in overlay/client', () => {
  assert.deepEqual(names, ['atlas.css', 'atlas.js', 'overlay.css', 'overlay.js']);
  for (const name of names) assert.equal(clientAsset(name), `\n${fs.readFileSync(new URL(name, dir), 'utf8')}`);
});

test('client assets: scripts are valid classic scripts', () => {
  for (const name of names.filter((n) => n.endsWith('.js'))) {
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: name }), name);
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, `${name} is inlined in a classic <script>`);
  }
});

test('client assets: nothing can close the tag they are inlined in', () => {
  for (const name of names) {
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(source, /<\/(script|style)/i, name);
    assert.doesNotMatch(source, /\r/, `${name} must use LF line endings so the page bytes match on every platform`);
  }
});
