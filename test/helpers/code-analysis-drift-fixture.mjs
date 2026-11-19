import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../archify/bin/archify.mjs', import.meta.url));
const env = { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
function run(cwd, file, args) {
  return spawnSync(file, args, { cwd, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
}
function git(root, ...args) {
  const p = run(root, 'git', args);
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim();
}

export function driftFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drift-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'Drift fixture');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  for (const id of ['app', 'db', 'lib', 'ui']) fs.mkdirSync(path.join(repo, 'src', id), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(repo, file), text);
  write('src/app/main.ts', "import { ui } from '../ui/module.js';\nexport const app = ui;\n");
  write('src/db/module.ts', 'export const db = 2;\n');
  write('src/lib/module.ts', 'export const lib = 3;\n');
  write('src/ui/module.ts', 'export const ui = 4;\n');
  const commit = () => { git(repo, 'add', 'src'); git(repo, 'commit', '-qm', 'capture'); return git(repo, 'rev-parse', 'HEAD'); };
  const base = commit();
  write('src/app/main.ts', "import { ui } from '../ui/module.js';\nimport { db } from '../db/module.js';\nimport { lib } from '../lib/module.js';\nexport const app = ui + db + lib;\n");
  const head = commit();
  write('src/app/main.ts', 'export const onlyWorkingTree = true;\n');
  const ir = path.join(dir, 'architecture.json');
  const map = path.join(dir, 'map.json');
  const doc = { schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Pinned drift test', output: 'architecture.html' },
    components: [
      { id: 'app', type: 'backend', label: 'Application', pos: [70, 70], size: [175, 65] },
      { id: 'ui', type: 'backend', label: 'UI', pos: [385, 70], size: [175, 65] },
      { id: 'db', type: 'backend', label: 'Database', pos: [385, 265], size: [175, 65] },
      { id: 'lib', type: 'backend', label: 'Library', pos: [70, 265], size: [175, 65] },
    ],
    connections: [{ id: 'app-lib', from: 'app', to: 'lib' }],
  };
  const mapping = { app: ['src-app'], lib: ['src-lib'], ui: ['src-ui'], db: ['src-db'] };
  fs.writeFileSync(ir, JSON.stringify(doc));
  fs.writeFileSync(map, JSON.stringify(mapping));
  const analyze = ({ b = base, h = head, output = 'out', extra = [] } = {}) => {
    const out = path.join(dir, output);
    const p = run(dir, process.execPath, [cli, 'code-analysis', 'drift', repo, '--base', b, '--head', h, '--ir', ir, '--map', map, '--out', out, '--json', ...extra]);
    return { p, out, result: JSON.parse(p.stdout) };
  };
  return { dir, repo, write, commit, base, head, ir, map, mapping, doc, analyze };
}
