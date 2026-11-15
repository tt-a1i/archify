import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, probeSkills } from './probe-skills.mjs';

test('skill probe waits for every expected root and loads its current body through the registry', async () => {
  let calls = 0;
  const loaded = [];
  const archify = { name: 'archify', provider: 'archify-plugin' };
  const personal = { name: 'personal-probe', provider: 'archify-plugin' };
  const skills = {
    async list(options) {
      assert.deepEqual(options, { cwd: '/workspace' });
      calls += 1;
      return calls === 1 ? [] : calls === 2 ? [archify] : [archify, personal];
    },
    async get(name, options) {
      assert.deepEqual(options, { cwd: '/workspace' });
      loaded.push(name);
      return { name, provider: 'archify-plugin', content: `Current body of ${name}` };
    },
  };
  const result = await probeSkills(skills, '/workspace', ['archify', 'personal-probe'], {
    timeoutMs: 1_000,
    sleep: async () => {},
  });
  assert.equal(calls, 3);
  assert.deepEqual(loaded, ['archify', 'personal-probe']);
  assert.equal(result.definitions['personal-probe'].contentSha256,
    createHash('sha256').update('Current body of personal-probe').digest('hex'));
  assert.equal(result.definitions.archify.provider, 'archify-plugin');
});

test('missing roots and listed-but-unloadable skills remain absent from probe definitions', async () => {
  const result = await probeSkills({
    async list() { return [{ name: 'archify' }]; },
    async get(name) { assert.equal(name, 'archify'); return null; },
  }, '/workspace', ['archify', 'missing-personal'], { timeoutMs: 0 });
  assert.deepEqual(result.skills.map((skill) => skill.name), ['archify']);
  assert.deepEqual(result.definitions, {});
});


test('host probe uses the requested project even when the host process cwd differs', async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-cwd-'));
  const out = path.join(scratch, 'probe.json');
  const cwd = path.join(scratch, 'project');
  const env = {
    ARCHIFY_DSH_PROBE_OUT: out,
    ARCHIFY_DSH_PROBE_CWD: cwd,
    ARCHIFY_DSH_PROBE_SKILLS: '["project-probe"]',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  Object.assign(process.env, env);
  await apply({ skills: {
    async list(options) {
      assert.equal(options.cwd, cwd);
      assert.notEqual(options.cwd, process.cwd());
      return [{ name: 'project-probe' }];
    },
    async get(name, options) {
      assert.equal(options.cwd, cwd);
      return { name, content: 'Loaded project body' };
    },
  } });
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(result.definitions['project-probe'].contentLength);
});
