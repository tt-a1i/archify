import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
const claude = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');

const discoveryCommand = 'npx -y skills add tt-a1i/archify --list --full-depth';

test('agent installation requires direct action and explicit scope', () => {
  assert.match(agents, /only when the user names that exact\s+action directly/i);
  assert.match(agents, /implied need[\s\S]*is not consent/i);
  assert.match(agents, /exact action, source, agent, and global or project scope/i);
  assert.match(agents, /Do not\s+infer `--all`/i);
  assert.match(agents, /use `--yes` only after those values are explicit/i);
  assert.match(agents, /A reinstall[\s\S]*not permission to remove unrelated paths/i);
});

test('Skills CLI discovery is non-mutating and fails closed', () => {
  assert.ok(agents.includes(discoveryCommand));
  assert.match(agents, /documented\s+`--list` mode/i);
  assert.match(agents, /exactly one Skill named `archify`/i);
  assert.match(agents, /command\s+error, zero matches, or multiple matches[\s\S]*stop[\s\S]*without\s+running a mutating command/i);
});

test('local and manual installs preserve unrelated destinations', () => {
  assert.match(agents, /canonical `tt-a1i\/archify` source/i);
  assert.match(agents, /system temporary directory[\s\S]*Git worktree[\s\S]*session-scoped/i);
  assert.match(agents, /prefer `--copy` unless they explicitly request managed symlinks/i);
  assert.match(agents, /Before a manual copy or extraction, fail if the destination exists/i);
  assert.match(agents, /never delete or replace it unless the user explicitly[\s\S]*approves[\s\S]*named path[\s\S]*conflict/i);
  assert.match(agents, /never add an unrequested force flag/i);
  assert.match(agents, /Never describe a partial installation as success/i);
  assert.match(agents, /exact command, source, action, skill or package, agent,[\s\S]*scope, and result/i);
});

test('updates and removals stay named and scoped', () => {
  assert.match(agents, /For `skills update`, name `archify`/i);
  assert.match(agents, /pass `--global` or `--project` explicitly/i);
  assert.match(agents, /For `skills remove`, name `archify`/i);
  assert.match(agents, /specify[\s\S]*scope and requested agents/i);
  assert.match(agents, /never use `--all`/i);
  assert.match(agents, /Manual `archify\.zip`[\s\S]*Claude\.ai upload[\s\S]*DSH plugin add\/remove/i);
  assert.match(agents, /update checker is notification-only[\s\S]*never authorizes installation/i);
});

test('Claude Code inherits the shared root policy with a plaintext fallback', () => {
  assert.match(claude, /Read and follow \[`AGENTS\.md`\]\(AGENTS\.md\)/);
  assert.match(claude, /^@AGENTS\.md$/m);
});
