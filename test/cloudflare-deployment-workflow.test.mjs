import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = parse(fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const cloudflare = workflow.jobs['deploy-cloudflare'];

test('Cloudflare deployment is opt-in, stable-main-only, and waits for the existing publication gates', () => {
  assert.match(cloudflare.if, /github\.event_name == 'push'/);
  assert.match(cloudflare.if, /github\.ref == 'refs\/heads\/main'/);
  assert.match(cloudflare.if, /vars\.CLOUDFLARE_PAGES_PROJECT != ''/);
  assert.deepEqual(cloudflare.needs, workflow.jobs['deploy-pages'].needs);
  assert.deepEqual(cloudflare.permissions, { contents: 'read' });
  assert.equal(cloudflare.concurrency['cancel-in-progress'], false);
});

test('Cloudflare publishes only the checked artifact at the current main SHA', () => {
  const steps = cloudflare.steps;
  const download = steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
  const gate = steps.find(step => step.id === 'deployment-head');
  const deployment = steps.find(step => step.id === 'deployment');
  assert.equal(download.with.name, 'website-cloudflare-dist');
  assert.equal(download.with.path, 'website/dist-cloudflare');
  assert.ok(steps.indexOf(gate) > steps.indexOf(download));
  assert.ok(steps.indexOf(deployment) > steps.indexOf(gate));
  assert.match(gate.run, /current_main.*gh api/);
  assert.match(gate.run, /"\$current_main" == "\$GITHUB_SHA"/);
  assert.equal(deployment.if, "steps.deployment-head.outputs.current == 'true'");
  assert.match(deployment.with.command, /^pages deploy website\/dist-cloudflare /);
  assert.match(deployment.with.command, /--branch=main --commit-hash=\$\{\{ github.sha \}\}/);
  assert.equal(deployment.with.apiToken, '${{ secrets.CLOUDFLARE_API_TOKEN }}');
  assert.match(deployment.with.wranglerVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(!steps.some(step => /npm (?:run build|ci)/.test(step.run ?? '')), 'deployment must not rebuild');
  const build = workflow.jobs.website.steps.find(step => step.env?.ARCHIFY_SITE_TARGET === 'cloudflare');
  assert.match(build.run, /npm run build && node scripts\/check-cloudflare-output.mjs/);
  assert.match(build.run, /node --test test\/deployment-target.test.mjs/);
  const browser = workflow.jobs.website.steps.find(step => step.env?.ARCHIFY_SITE_ROOT?.endsWith('/website/dist-cloudflare'));
  assert.equal(browser.env.ARCHIFY_SITE_BASE, '');
  assert.equal(browser.env.ARCHIFY_SITE_INTEGRATION, '1');
  assert.equal(browser.run, 'npm run test:browser');
  const upload = workflow.jobs.website.steps.find(step => step.with?.name === download.with.name);
  assert.equal(upload.with.path, download.with.path);
  assert.equal(upload.with['if-no-files-found'], 'error');
});

test('Cloudflare destination rejects invalid values without evaluating them as shell code', () => {
  const step = cloudflare.steps.find(step => step.name === 'Validate Cloudflare destination');
  assert.ok(!step.run.includes('${{'));
  const run = project => spawnSync('bash', ['-c', step.run], {
    env: { ...process.env, CLOUDFLARE_PAGES_PROJECT: project, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) },
  });
  assert.equal(run('archify').status, 0);
  for (const value of ['', '--help', 'archify --branch=dev', '$(exit 0)', 'a\nb']) {
    assert.notEqual(run(value).status, 0, value);
  }
});
