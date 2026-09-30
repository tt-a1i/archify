import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the summary card rule keeps unbreakable tokens below the grid track min-content floor', () => {
  // viewer/viewer.css is the source; assets/template.html is generated from
  // it (scripts/generate-viewer.mjs) and must carry the same rule.
  const sources = [
    path.join(root, '..', 'viewer', 'viewer.css'),
    path.join(root, 'assets', 'template.html'),
  ];
  for (const file of sources) {
    const css = fs.readFileSync(file, 'utf8');
    // Media variants restate .card one-liners; the base rule is the one that
    // must carry the two properties.
    const rules = [...css.matchAll(/(^|\n)\s*\.card \{[^}]*\}/g)].map((m) => m[0]);
    assert.ok(rules.length > 0, file + ': .card base rule not found');
    const base = rules.find((rule) => /min-width: 0;/.test(rule) && /overflow-wrap: anywhere;/.test(rule));
    assert.ok(base, file + ': the base .card rule must carry min-width: 0 and overflow-wrap: anywhere');
  }
});
