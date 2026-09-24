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
    'AWS_ACCESS_KEY_ID = "AKIAEXAMPLE"',
    'client_key_id: "abc",',
  ]) assert.equal(safeSourceLine(line), null, line);
  assert.equal(safeSourceLine('fetch(url, { method: "POST" })'), 'fetch(url, { method: "POST" })');
  assert.equal(safeSourceLine('const u = "https://user:pw@host/x";'), 'const u = "https://[redacted]@host/x";');
});

test('the default evidence pack copies no source text, even around channel calls', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { buildRepositoryEvidence } = await import('../modules/repository-index/index.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pack-secrets-'));
  const detail = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pack-detail-'));
  try {
    const write = (file, text) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    };
    write('package.json', JSON.stringify({ name: 'fixture', dependencies: { ws: '1' } }));
    write('src/server.js', [
      "import { spawn } from 'node:child_process';",
      'const url = "https://host/v1?token=MARKER1";',
      'fetch(url, {',
      '  headers: { "x-api-key": "MARKER2" },',
      '  body: "MARKER3" });',
      'const child = spawn("MARKER4", ["--password", "MARKER5"]);',
      'const db = open("MARKER6.db");',
      'export function handler(secret = "MARKER7") { return secret; }',
      'const AWS_ACCESS_KEY_ID = "MARKER8AWS";',
      'fetch("/data", { headers: { id: AWS_ACCESS_KEY_ID } });',
      'const token_url = "/oauth"; fetch(token_url);',
    ].join('\n'));
    write('src/worker.py', 'import subprocess, sqlite3\nsubprocess.run(["MARKER8", "x"])\nconn = sqlite3.connect("MARKER9.sqlite")\n');
    const result = buildRepositoryEvidence(root, { detailDirectory: detail });
    const detailText = fs.readdirSync(detail).map((entry) => fs.readFileSync(path.join(detail, entry, 'source-graph.json'), 'utf8')).join('');
    assert.equal(result.policy.sourceBodiesIncluded, false);
    assert.ok(result.pack.runtimeChannels.items.length > 0, 'channels are still reported');
    assert.doesNotMatch(JSON.stringify(result), /MARKER/);
    assert.doesNotMatch(detailText, /MARKER/);
    const opted = buildRepositoryEvidence(root, { sourceExcerpts: true });
    assert.equal(opted.policy.sourceBodiesIncluded, true);
    assert.doesNotMatch(JSON.stringify(opted), /MARKER[1257]|MARKER8AWS/, 'credential lines stay out of opt-in excerpts');
    const httpCalls = result.pack.runtimeChannels.items.filter((item) => item.kind === 'http-client');
    assert.ok(httpCalls.length > 0 && httpCalls[0].count >= 3, 'calls on credential-looking lines are still counted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(detail, { recursive: true, force: true });
  }
});
