import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const fixture = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/checkout-platform.base.architecture.json'), 'utf8'));
const translations = {
  'legend.architecture.backend': 'Original backend wording',
  'viewer.common.close': 'Close panel',
};
const revised = { ...translations, 'legend.architecture.backend': 'Revised backend wording' };
const reordered = Object.fromEntries(Object.entries(translations).reverse());
const unchangedEntities = {
  components: { added: 0, changed: 0, evidenceChanged: 0, removed: 0, moved: 0 },
  connections: { added: 0, changed: 0, removed: 0, rerouted: 0 },
  boundaries: { added: 0, changed: 0, removed: 0, geometryChanged: 0 },
};

for (const [name, before, after, changed, sourceChanged = changed] of [
  ['adding translations', undefined, translations, true],
  ['removing translations', translations, undefined, true],
  ['editing a translation', translations, revised, true],
  ['reordering translation keys', translations, reordered, false],
  ['adding an empty translation catalog', undefined, {}, false, true],
  ['removing an empty translation catalog', {}, undefined, false, true],
]) {
  test(`compare reports presentation accurately when ${name}`, { timeout: 30000 }, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delta-translations-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const paths = [path.join(dir, 'before.json'), path.join(dir, 'after.json')];
    [before, after].forEach((catalog, index) => {
      const document = structuredClone(fixture);
      document.meta.locale = 'en';
      if (catalog) document.meta.translations = catalog;
      else delete document.meta.translations;
      fs.writeFileSync(paths[index], JSON.stringify(document));
    });
    const output = path.join(dir, 'delta.html');
    const sidecar = path.join(dir, 'custom-receipt.json');
    const result = spawnSync(process.execPath, [
      cli, 'compare', 'architecture', ...paths, output, '--receipt', sidecar, '--json',
    ], { encoding: 'utf8', timeout: 25000, cwd: skillRoot });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.summary.presentationChanged, changed);
    assert.equal(receipt.summary.provenanceChanged, false);
    for (const [kind, counts] of Object.entries(unchangedEntities)) {
      assert.deepEqual(receipt.summary[kind], counts);
    }
    assert.deepEqual(receipt.changes, { components: [], connections: [], boundaries: [] });
    assert.equal(receipt.provenance, undefined);
    assert.equal(receipt.base.semanticSha256 !== receipt.head.semanticSha256, sourceChanged);
    assert.deepEqual(JSON.parse(fs.readFileSync(sidecar, 'utf8')), receipt);
    const html = fs.readFileSync(output, 'utf8');
    const embedded = html.match(/<script id="archify-compare-receipt" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(embedded, 'compare HTML must carry the matching review receipt');
    const review = JSON.parse(embedded[1]);
    assert.deepEqual(review.summary, receipt.summary);
    assert.deepEqual(review.changes, receipt.changes);
    if (name.includes('empty translation catalog')) {
      // Authored bytes differ, but both catalogs must render the same diagram.
      const svgs = paths.map((input, index) => {
        const rendered = path.join(dir, `rendered-${index}.html`);
        const render = spawnSync(process.execPath, [
          path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, rendered,
        ], { encoding: 'utf8', timeout: 25000 });
        assert.equal(render.status, 0, render.stderr || render.stdout);
        return fs.readFileSync(rendered, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0];
      });
      assert.equal(svgs[0], svgs[1]);
    }
    // The visible wording changes too, not just unrendered metadata.
    for (const catalog of [before, after].filter(Boolean)) {
      const wording = catalog['legend.architecture.backend'];
      if (wording === undefined) continue;
      assert.ok(html.includes(`>${wording}</text>`)
        || html.includes(`&gt;${wording}&lt;/text&gt;`), 'wording must appear in rendered SVG text');
    }
  });
}
