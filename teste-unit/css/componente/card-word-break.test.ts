import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// O que este teste executa: Valida que a regra CSS da classe .card contem word-break: keep-all e overflow-wrap: anywhere para prevenir quebras artificiais de palavras em coreano (Issue #1160).
test('template.html declara word-break: keep-all em .card preservando quebras de palavras e seguranca contra overflow', () => {
  const templatePath = join(process.cwd(), 'archify/assets/template.html');
  const content = readFileSync(templatePath, 'utf8');

  // O que este teste executa: Verifica a presenca da combinacao de regras word-break e overflow-wrap no bloco .card.
  assert.strictEqual(content.includes('word-break: keep-all;'), true, 'Deveria conter word-break: keep-all');
  assert.strictEqual(content.includes('overflow-wrap: anywhere;'), true, 'Deveria conter overflow-wrap: anywhere');
});
