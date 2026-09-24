import assert from 'node:assert/strict';
import test from 'node:test';
import { safeSourceLine } from '../modules/repository-index/source-redaction.mjs';

test('source excerpts drop credentials behind quoted or subscripted keys', () => {
  for (const line of [
    '  "api_key": "sk-live-123",',
    "  headers: { 'X-Api-Key': 'abc' },",
    'config = {"password": "hunter2"}',
    'os.environ["API_TOKEN"] = value',
    'const token = process.env.TOKEN;',
    'let api_key = load();',
  ]) assert.equal(safeSourceLine(line), null, line);
  assert.equal(safeSourceLine('fetch(url, { method: "POST" })'), 'fetch(url, { method: "POST" })');
  assert.equal(safeSourceLine('const u = "https://user:pw@host/x";'), 'const u = "https://[redacted]@host/x";');
});
