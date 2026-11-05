import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { publishSeo } from '../scripts/publish-seo.mjs';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { canonicalPath, sitePages } from '../src/data/site-urls.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
test('SEO insertion preserves replacement tokens in authored gallery copy', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-seo-dollar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const page of sitePages) for (const lang of ['en','zh']) {
    const route = canonicalPath(page,lang).slice(1);
    const file = path.join(root, route === '' ? 'index.html' : `${route}.html`);
    fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, '<html></html>');
  }
  const entries = CASES.map(item => {
    const artifact = `gallery/artifacts/${item.output}`, input = `gallery/sources/${item.input}`;
    const html = '<html><head></head><body>Diagram</body></html>', source = '{}';
    for (const [name, content] of [[artifact,html],[input,source]]) { const file=path.join(root,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content); }
    return {id:item.id,artifact,input,checks:[{ok:true}],artifactSha256:digest(html),sourceSha256:digest(source)};
  });
  fs.writeFileSync(path.join(root,'gallery/manifest.json'),JSON.stringify({entries}));
  const original = CASES[0].titleEn;
  t.after(() => { CASES[0].titleEn = original; });
  CASES[0].titleEn = 'Price $& with $` and $\' and $$';
  publishSeo(root,{name:'github'});
  const html=fs.readFileSync(path.join(root,entries[0].artifact),'utf8');
  const json=/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(json).name,CASES[0].titleEn);
  assert.equal((html.match(/<\/head>/g)||[]).length,1);
});
