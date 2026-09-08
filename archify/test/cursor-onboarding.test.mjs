import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const cursorCommand = 'npx -y skills add tt-a1i/archify --skill archify --agent cursor --global --copy --yes';

test('Cursor onboarding stays explicit, bilingual, and backed by the same Skill', () => {
  const english = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const englishMirror = fs.readFileSync(path.join(repoRoot, 'README_EN.md'), 'utf8');
  const chinese = fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8');
  const start = fs.readFileSync(path.join(repoRoot, 'docs', 'start.html'), 'utf8');
  const landing = fs.readFileSync(path.join(repoRoot, 'docs', 'index.html'), 'utf8');

  assert.equal(english, englishMirror, 'English README mirrors must stay synchronized');
  assert.match(english, /Cursor, Claude Code, Codex CLI, and OpenCode/);
  assert.match(chinese, /Cursor、Claude Code、Codex CLI 和 OpenCode/);
  for (const surface of [english, chinese, landing]) assert.ok(surface.includes(cursorCommand));
  for (const surface of [english, chinese, start, landing]) {
    assert.doesNotMatch(surface, /skills use[^\n<]*--agent cursor/);
    assert.doesNotMatch(surface, /~\/\.cursor\/skills\/archify/);
    assert.doesNotMatch(surface, /all Cursor models|every Cursor model/i);
  }

  assert.match(start, /data-agent="cursor">Cursor<\/button>/);
  assert.match(start, /data-agent="codex">Codex<\/button>/);
  assert.match(start, /data-agent="claude-code">Claude Code<\/button>/);
  assert.match(start, /data-agent="opencode">OpenCode<\/button>/);
  assert.match(start, /KNOWN_AGENTS\.has\(requestedAgent\)/);
  assert.match(start, /same Skill/);
  assert.match(start, /同一份 Skill/);
  assert.doesNotMatch(start, /vendor-specific (?:renderer|schema|skill)/i);
});

test('the zero-dependency archive works from the canonical Cursor-visible agent path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cursor-package-'));
  const agentSkills = path.join(tmp, '.agents', 'skills');
  try {
    fs.mkdirSync(agentSkills, { recursive: true });
    execFileSync('unzip', ['-q', path.join(repoRoot, 'archify.zip'), '-d', agentSkills]);
    const installed = path.join(agentSkills, 'archify');
    const cli = path.join(installed, 'bin', 'archify.mjs');
    const doctor = execFileSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8' });
    assert.match(doctor, /Archify is ready\./);

    const fixtures = {
      architecture: 'web-app.architecture.json',
      workflow: 'agent-tool-call.workflow.json',
      sequence: 'cache-miss-request.sequence.json',
      dataflow: 'product-analytics.dataflow.json',
      lifecycle: 'agent-run.lifecycle.json',
    };
    for (const [type, fixture] of Object.entries(fixtures)) {
      const output = execFileSync(process.execPath, [
        cli,
        'validate',
        type,
        path.join(installed, 'examples', fixture),
        '--json',
      ], { encoding: 'utf8' });
      const receipt = JSON.parse(output);
      assert.equal(receipt.ok, true, `${type}: installed package validation failed`);
      assert.equal(receipt.type, type);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
