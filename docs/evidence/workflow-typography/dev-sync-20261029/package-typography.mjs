import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [checkout, packaged, output] = process.argv.slice(2);
if (!checkout || !packaged || !output) throw new Error('Supply checkout, extracted package and a new evidence directory.');
if (fs.existsSync(output)) throw new Error('Use a new evidence directory; existing evidence is preserved.');
const { typographyFixture, sourceTypographyFixture } = await import(pathToFileURL(path.join(checkout, 'test/helpers/workflow-typography.mjs')));
const cleanup = [];
const fixtureContext = { after(fn) { cleanup.push(fn); } };
const source = sourceTypographyFixture(fixtureContext, { scale: 1.01 });
const brand = sourceTypographyFixture(fixtureContext, { scale: 2, node: { brand: 'openai', tag: 'reviewed' } });
const cases = [['ordinary', 1], ['ordinary', 1.5], ['dense', 1.5], ['cjk', 2]].map(([name, scale]) => {
  const doc = typographyFixture(name); doc.meta.typography_scale = scale;
  return { name: `${name}-${scale}`, doc };
});
cases.push({ name: 'source-1.01', doc: source.diagram, repository: source.root }, { name: 'source-brand-tag-2', doc: brand.diagram, repository: brand.root });
fs.mkdirSync(output, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
try {
  for (const fixture of cases) {
    const input = path.join(output, fixture.name + '.json');
    fs.writeFileSync(input, JSON.stringify(fixture.doc));
    const pair = [];
    for (const [variant, cli] of [['source', path.join(checkout, 'archify/bin/archify.mjs')], ['package', path.join(packaged, 'bin/archify.mjs')]]) {
      const extra = fixture.repository ? ['--repo-root', fixture.repository] : [];
      const run = args => {
        const result = spawnSync(process.execPath, [cli, ...args, ...extra], { cwd: output, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
        assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr); return result;
      };
      const validation = JSON.parse(run(['validate', 'workflow', input, '--json']).stdout);
      assert.equal(validation.ok, true);
      const htmlPath = path.join(output, `${fixture.name}-${variant}.html`);
      run(['render', 'workflow', input, htmlPath]);
      const html = fs.readFileSync(htmlPath);
      if (fixture.repository) assert.ok(html.includes('archify-source-evidence-data'));
      pair.push(hash(html));
    }
    assert.equal(pair[0], pair[1], fixture.name);
    results.push({ fixture: fixture.name, validation: 'pass', sourceHTMLSha256: pair[0], packageHTMLSha256: pair[1], identical: true });
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { cleanup.reverse().forEach(fn => fn()); }
