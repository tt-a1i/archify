import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Node 22 prints its own runtime warnings (for example undici's experimental
// EnvHttpProxyAgent notice when proxy env vars are set) on every child
// process's stderr, which breaks tests that assert on captured stderr or parse
// it as JSON. Silence those runtime warnings for every CLI child this file
// spawns (the setting inherits into grandchildren too); warnings printed by
// archify itself are unaffected. Assign unconditionally: Node only silences
// warnings when the value is exactly '1', so an inherited '0' or empty value
// would re-enable them in the spawned children.
process.env.NODE_NO_WARNINGS = '1';

const root = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');

function run(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

// Regression for https://github.com/tt-a1i/archify/issues/1160:
// Korean card prose broke between Hangul syllables mid-word
// (`롤백합니` / `다.`) because cards carried `word-break: normal` with
// `overflow-wrap: anywhere`.
test('workflow cards keep CJK words unbroken while retaining the overflow guard', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-card-cjk-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'workflow.json');
  const output = path.join(cwd, 'workflow.html');
  const diagram = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: '테스트', locale: 'ko', quality_profile: 'standard', output: 'workflow.html' },
    lanes: [{ id: 'dev', label: '개발자' }],
    mainPath: ['a', 'b'],
    nodes: [
      { id: 'a', lane: 'dev', col: 0, type: 'external', label: '풀 리퀘스트 작성' },
      { id: 'b', lane: 'dev', col: 1, type: 'frontend', label: '빌드·린트' },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: '푸시' }],
    cards: [
      {
        dot: 'rose',
        title: '되돌리기',
        items: ['카나리 단계에서 오류율이 1%를 넘으면 자동으로 롤백합니다.'],
      },
    ],
  };
  fs.writeFileSync(input, JSON.stringify(diagram));

  const validated = run([cli, 'validate', 'workflow', input, '--json'], cwd);
  assert.equal(validated.status, 0, validated.stderr);
  const rendered = run([cli, 'render', 'workflow', input, output], cwd);
  assert.equal(rendered.status, 0, rendered.stderr);

  const html = fs.readFileSync(output, 'utf8');
  const cardRule = html.match(/\.card \{[^}]*\}/g)?.find(rule => rule.includes('overflow-wrap'));
  assert.ok(cardRule, 'rendered HTML inlines the .card rule');
  // Declaration text can also appear inside CSS comments; judge the
  // declarations only so a comment cannot satisfy these assertions.
  const declarations = cardRule.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(
    declarations,
    /word-break\s*:\s*keep-all/,
    'card prose keeps CJK words unbroken (wraps at spaces, not between syllables)',
  );
  assert.match(
    declarations,
    /overflow-wrap\s*:\s*anywhere/,
    'card prose retains the unbroken-run overflow guard from #632',
  );
  assert.ok(
    html.includes('class="card"'),
    'rendered Korean card carries the .card class the rule styles',
  );
});
