import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const workflow = await fs.readFile(new URL('../../../.github/workflows/contributor-cards.yml', import.meta.url), 'utf8');
// Security contract checks guard future edits to the privileged event path.
test('privileged automation reads the default branch and does not interpolate PR text into shell', () => {
  assert.match(workflow, /push:\s+branches: \[main, dev\]/);
  assert.match(workflow, /pull_request_target:\s+types: \[closed\]\s+branches: \[main\]/);
  assert.match(workflow, /github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /pull_request\.head|refs\/pull|pull_request\.merge_commit_sha/);
  assert.doesNotMatch(workflow, /\$\{\{[^}]*\.(title|body|login)[^}]*\}\}/);
  assert.match(workflow, /persist-credentials: false/);
  for (const [, ref] of workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g)) assert.match(ref, /^[a-f0-9]{40}$/);
  assert.match(workflow, /group: contributor-card-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
});
