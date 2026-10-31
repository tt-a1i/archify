import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function extractCardBaseRule(css) {
  // Finds the base .card rule block that sets background: var(--panel) and border-radius
  const match = /\.card\s*\{[^}]*background:\s*var\(--panel\)[^}]*\}/.exec(css);
  return match ? match[0] : null;
}

test('viewer.css and template.html declare word-break: keep-all on base .card selector', () => {
  // O que este teste executa:
  // Valida que tanto o arquivo-fonte autoritativo (viewer/viewer.css) quanto o artefato
  // gerado (archify/assets/template.html) contêm as propriedades word-break: keep-all
  // e overflow-wrap: anywhere especificamente dentro da regra base .card, garantindo
  // a resolução da Issue #1160 sem quebras de palavras coreanas no meio de sílabas.
  const viewerCss = fs.readFileSync(path.join(root, 'viewer/viewer.css'), 'utf8');
  const templateHtml = fs.readFileSync(path.join(root, 'archify/assets/template.html'), 'utf8');

  const viewerRule = extractCardBaseRule(viewerCss);
  assert.ok(viewerRule, 'base .card rule must exist in viewer/viewer.css');
  assert.ok(viewerRule.includes('word-break: keep-all;'), '.card in viewer.css must contain word-break: keep-all;');
  assert.ok(viewerRule.includes('overflow-wrap: anywhere;'), '.card in viewer.css must contain overflow-wrap: anywhere;');

  const templateRule = extractCardBaseRule(templateHtml);
  assert.ok(templateRule, 'base .card rule must exist in archify/assets/template.html');
  assert.ok(templateRule.includes('word-break: keep-all;'), '.card in template.html must contain word-break: keep-all;');
  assert.ok(templateRule.includes('overflow-wrap: anywhere;'), '.card in template.html must contain overflow-wrap: anywhere;');
});
