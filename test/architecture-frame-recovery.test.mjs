import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = new URL('fixtures/architecture-frame-recovery/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', fixtures), 'utf8'));
const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

for (const [name, { file, passes, diagnostic, round5Svg }] of Object.entries(cases)) {
  test(`frame recovery preserves the validated layout for ${name}`, t => {
    const scratch = mkdtempSync(join(tmpdir(), 'archify-fixed-canvas-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const output = join(scratch, 'chart.html');
    const env = { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
    delete env.ARCHIFY_QUALITY_PROFILE;
    const result = spawnSync(process.execPath, [cli, 'render', 'architecture', fileURLToPath(new URL(file, fixtures)), output], {
      encoding: 'utf8', env,
    });
    const failure = result.stdout + result.stderr;
    assert.equal(result.status === 0, passes, failure);
    if (diagnostic) assert.ok(failure.includes(`[${diagnostic}]`), failure);
    if (round5Svg) {
      // Fixed-canvas compatibility includes routes, labels and frames.
      const svg = readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/g)
        .reduce((longest, match) => match.length > longest.length ? match : longest);
      assert.equal(createHash('sha256').update(svg).digest('hex'), round5Svg);
    }
  });
}
