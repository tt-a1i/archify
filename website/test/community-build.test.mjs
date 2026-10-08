import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createCommunityFixture, payload } from './helpers/community-fixture.mjs';

test('community catalog: real build rejects invalid metadata before displaying PASS', { timeout: 60000 }, () => {
  const fixture = createCommunityFixture();
  try {
    for (const mutate of [
      entry => { entry.summary.extra = true; },
      entry => { entry.repository = 'https://'; },
    ]) {
      const entry = structuredClone(fixture.entry);
      mutate(entry);
      fixture.write(entry);
      const rejected = fixture.build();
      assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
      assert.match(rejected.stdout + rejected.stderr, /community registry:/);
      assert.ok(!fs.existsSync(path.join(fixture.dist, 'community.html')));
    }
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
