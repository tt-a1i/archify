import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createCommunityFixture, payload } from './helpers/community-fixture.mjs';

test('community catalog: real build rejects invalid metadata before displaying PASS', { timeout: 60000 }, () => {
  const fixture = createCommunityFixture();
  try {
    // One real build proves both validator diagnostics reach the build gate;
    // the validator's unit tests exercise the invalid fields independently.
    const entry = structuredClone(fixture.entry);
    entry.summary.extra = true;
    entry.repository = 'https://';
    fixture.write(entry);
    const rejected = fixture.build();
    assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
    assert.match(rejected.stdout + rejected.stderr, /community registry:/);
    assert.match(rejected.stdout + rejected.stderr, /summary: unknown field "extra"/);
    assert.match(rejected.stdout + rejected.stderr, /repository must be an https:\/\/ URL/);
    assert.ok(!fs.existsSync(path.join(fixture.dist, 'community.html')));
    fixture.write(fixture.entry);
    const accepted = fixture.build();
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    for (const file of ['community.html', 'zh/community.html']) {
      const html = fs.readFileSync(path.join(fixture.dist, file), 'utf8');
      assert.ok(html.includes('https://example.com/receipt'), file);
      assert.ok(html.includes('https://example.com/example'), file);
      assert.ok(!html.includes(payload), `${file}: untrusted markup must be escaped during SSR`);
    }
  } finally {
    fixture.close();
  }
});
