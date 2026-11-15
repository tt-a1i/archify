import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { publishSeo, stripPublishedArtifactMetadata } from '../scripts/publish-seo.mjs';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { canonicalPath, sitePages } from '../src/data/site-urls.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

// Regression ported from #826, with the selected case fixture added and exact
// original closing-tag bytes checked alongside literal replacement tokens.
test('SEO insertion preserves replacement tokens in authored gallery copy', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-seo-dollar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(new URL('../../docs/cases/', import.meta.url), path.join(root, 'cases'), { recursive: true });
  for (const page of sitePages) for (const lang of ['en', 'zh']) {
    const route = canonicalPath(page, lang).slice(1);
    const file = path.join(root, route === '' ? 'index.html' : `${route}.html`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<html></html>');
  }
  const html = '<html><head></HEAD><body>Diagram</body></html>';
  const entries = CASES.map(item => {
    const artifact = `gallery/artifacts/${item.output}`, input = `gallery/sources/${item.input}`;
    const source = '{}';
    for (const [name, content] of [[artifact, html], [input, source]]) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return { id: item.id, artifact, input, checks: [{ ok: true }], artifactSha256: digest(html), sourceSha256: digest(source) };
  });
  fs.writeFileSync(path.join(root, 'gallery/manifest.json'), JSON.stringify({ entries }));
  const original = CASES[0].titleEn;
  t.after(() => { CASES[0].titleEn = original; });
  CASES[0].titleEn = 'Price $& with $` and $\' and $$';
  publishSeo(root, { name: 'github' });
  const published = fs.readFileSync(path.join(root, entries[0].artifact), 'utf8');
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(published)[1];
  assert.equal(JSON.parse(json).name, CASES[0].titleEn);
  assert.equal((published.match(/<\/head>/gi) || []).length, 1);
  assert.equal(stripPublishedArtifactMetadata(published), html);
});
