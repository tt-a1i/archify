import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { injectBundleManifest, serializeBundleManifest, validateBundle } from '../bundle/diagram-bundle.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';

const cli = fileURLToPath(new URL('../bin/archify.mjs', import.meta.url));
function fixture(t) {
  const root = stageBundleFixture({ prefix: 'archify-locate-portable-' });
  t.after(() => disposeBundleFixture(root));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  for (const diagram of manifest.diagrams) {
    const file = diagram.file.replace(/\.html$/, '.json');
    const map = JSON.parse(fs.readFileSync(path.join(root, file)));
    const link = manifest.drilldowns.find(row => row.child === diagram.id);
    const items = map.components || map.nodes;
    const components = items.map(item => ({ id: item.id,
      globs: [link ? `src/${link.component}/${item.id}/**` : `src/${item.id}/**`],
      ...(manifest.drilldowns.find(row => row.component === item.id && row.parent === diagram.id)
        ? { child_map: manifest.diagrams.find(child => child.id === manifest.drilldowns.find(row => row.component === item.id).child).file.replace(/\.html$/, '.json') } : {}),
    }));
    fs.writeFileSync(path.join(root, file.replace(/\.json$/, '.ownership.json')), JSON.stringify({
      schema_version: 1, kind: 'ownership', map: file, components,
      ...(link ? { parent: { map: 'checkout-platform.json', component: link.component } } : {}),
    }));
  }
  fs.mkdirSync(path.join(root, 'src/payments/api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/payments/api/code.js'), 'before');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'src/payments/api/code.js'), 'after');
  git('add', '.'); git('commit', '-qm', 'head');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-locate-destination-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const run = (extra = [], env = process.env) => spawnSync(process.execPath, [cli, 'locate', `${base}..HEAD`,
    '--repo-root', root, '--map', path.join(root, 'checkout-platform.json'), '--bundle', root, '--out', out, '--json', ...extra], { encoding: 'utf8', env });
  return { root, out, manifest, run };
}

test('Locate delivers every manifest-bound file to a portable output directory', t => {
  const { root, out, manifest, run } = fixture(t);
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const diagram of manifest.diagrams) {
    for (const file of [diagram.file, diagram.file.replace(/\.html$/, '.json'), diagram.file.replace(/\.html$/, '.ownership.json')]) {
      assert.deepEqual(fs.readFileSync(path.join(out, file)), fs.readFileSync(path.join(root, file)), file);
    }
  }
  disposeBundleFixture(root);
  assert.doesNotThrow(() => validateBundle(out), 'delivery must not depend on the source directory');
  const projected = fs.readFileSync(path.join(out, 'checkout-platform.locate.html'), 'utf8');
  assert.match(projected, /archify-locate-projection/);
  const projection = JSON.parse(projected.match(/<script id="archify-locate-projection" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(projection.children.payments.nodes.api, 'touched');
});

test('Locate rejects a bundle bound to a different entry map and preserves outputs', t => {
  const { root, out, run } = fixture(t);
  const other = JSON.parse(fs.readFileSync(path.join(root, 'checkout-platform.json')));
  other.meta.title = 'Different map';
  fs.writeFileSync(path.join(root, 'other.json'), JSON.stringify(other));
  const own = JSON.parse(fs.readFileSync(path.join(root, 'checkout-platform.ownership.json')));
  own.map = 'other.json'; own.components = own.components.map(({ child_map, ...rest }) => rest);
  fs.writeFileSync(path.join(root, 'other.ownership.json'), JSON.stringify(own));
  fs.writeFileSync(path.join(out, 'locate.html'), 'preserve');
  const result = run(['--map', path.join(root, 'other.json')]);
  assert.equal(result.status, 1); assert.match(result.stdout, /manifest-bound entry/);
  assert.equal(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), 'preserve');
});

test('Locate rejects a stale child artifact instead of projecting current facts on it', t => {
  const { root, out, run } = fixture(t);
  fs.appendFileSync(path.join(root, 'payments.html'), '\n<!-- stale bytes -->');
  fs.writeFileSync(path.join(out, 'locate.html'), 'preserve');
  const result = run(); assert.equal(result.status, 1); assert.match(result.stdout, /locate\/bundle-invalid/);
  assert.equal(fs.readFileSync(path.join(out, 'locate.html'), 'utf8'), 'preserve');
});

test('a moved Locate directory opens the child and forwards its projection in Chrome', async t => {
  if (!process.env.ARCHIFY_CHROME) return t.skip('Set ARCHIFY_CHROME for portable bundle browser acceptance.');
  const { ChromeVisualBrowser, findChrome } = await import('../bin/visual-check.mjs');
  const { root, out, run } = fixture(t);
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  const relocated = `${out}-moved`;
  fs.renameSync(out, relocated);
  t.after(() => fs.rmSync(relocated, { recursive: true, force: true }));
  disposeBundleFixture(root);
  const browser = new ChromeVisualBrowser(findChrome());
  t.after(() => browser.close());
  await browser.inspect({ artifactPath: path.join(relocated, 'checkout-platform.locate.html'), width: 1440, height: 900, theme: 'light' });
  const session = await browser.sessionPromise;
  const descended = await browser.cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      Archify.drilldown.descend('payments');
      const deadline = performance.now() + 5000;
      while (document.getElementById('archify-drilldown-frame').hidden) {
        if (performance.now() > deadline) throw new Error('child handshake did not complete');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return document.getElementById('archify-drilldown-frame').src;
    })()` }, session);
  assert.equal(descended.exceptionDetails, undefined, descended.exceptionDetails?.exception?.description);
  assert.ok(descended.result.value.includes(path.basename(relocated)));
  const frames = await browser.cdp.send('Page.getFrameTree', {}, session);
  const child = frames.frameTree.childFrames.find(frame => frame.frame.url.endsWith('/payments.html'));
  assert.ok(child, 'child must be loaded from the relocated directory');
  const world = await browser.cdp.send('Page.createIsolatedWorld', { frameId: child.frame.id }, session);
  const childState = await browser.cdp.send('Runtime.evaluate', { contextId: world.executionContextId, returnByValue: true, awaitPromise: true,
    expression: `(async () => {
      const deadline = performance.now() + 5000;
      while (document.querySelector('[data-node-id="api"]')?.getAttribute('data-locate-state') !== 'touched') {
        if (performance.now() > deadline) throw new Error('child projection did not arrive');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return document.querySelector('[data-node-id="api"]').getAttribute('data-locate-state');
    })()` }, session);
  assert.equal(childState.result.value, 'touched');
});


test('a late bundle installation failure restores the complete previous output set', t => {
  const { root, out, run } = fixture(t);
  const first = run(); assert.equal(first.status, 0, first.stdout + first.stderr);
  fs.writeFileSync(path.join(out, 'locate.html'), 'previous customized output');
  const previous = new Map(fs.readdirSync(out).map(name => [name, fs.readFileSync(path.join(out, name))]));
  const preload = path.join(root, 'fail-bundle-install.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const rename = fs.renameSync; let failed = false;
fs.renameSync = function(source, target) {
  if (!failed && String(source).endsWith('/bundle/payments.html') && String(target) === ${JSON.stringify(path.join(out, 'payments.html'))}) {
    failed = true; throw new Error('injected late bundle failure');
  }
  return rename.apply(this, arguments);
};`);
  const result = run([], { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /injected late bundle failure/);
  assert.deepEqual(fs.readdirSync(out).sort(), [...previous.keys()].sort());
  for (const [name, bytes] of previous) assert.deepEqual(fs.readFileSync(path.join(out, name)), bytes, name);
});


function replaceManifest(root, manifest) {
  const text = serializeBundleManifest(manifest);
  fs.writeFileSync(path.join(root, 'manifest.json'), text);
  const entry = path.join(root, manifest.diagrams.find(diagram => diagram.id === manifest.entry).file);
  fs.writeFileSync(entry, injectBundleManifest(fs.readFileSync(entry, 'utf8'), text));
  validateBundle(root);
}

test('Locate uses the manifest filename when an ID-named decoy spec also exists', t => {
  const { root, out, manifest, run } = fixture(t);
  fs.renameSync(path.join(root, 'payments.html'), path.join(root, 'payment-view.html'));
  fs.copyFileSync(path.join(root, 'payments.json'), path.join(root, 'payment-view.json'));
  const bound = JSON.parse(fs.readFileSync(path.join(root, 'payments.ownership.json')));
  bound.map = 'payment-view.json';
  fs.writeFileSync(path.join(root, 'payment-view.ownership.json'), JSON.stringify(bound));
  const decoy = { ...bound, map: 'payments.json', components: bound.components.map(item => ({
    ...item, globs: item.id === 'api' ? ['src/payments/decoy/**'] : item.globs,
  })) };
  fs.writeFileSync(path.join(root, 'payments.ownership.json'), JSON.stringify(decoy));
  const parent = JSON.parse(fs.readFileSync(path.join(root, 'checkout-platform.ownership.json')));
  parent.components.find(item => item.id === 'payments').child_map = 'payment-view.json';
  fs.writeFileSync(path.join(root, 'checkout-platform.ownership.json'), JSON.stringify(parent));
  manifest.diagrams.find(diagram => diagram.id === 'payments').file = 'payment-view.html';
  replaceManifest(root, manifest);
  const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(path.join(out, 'checkout-platform.locate.html'), 'utf8');
  const projection = JSON.parse(html.match(/<script id="archify-locate-projection" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(projection.children.payments.nodes.api, 'touched');
  assert.equal(fs.existsSync(path.join(out, 'payments.json')), false, 'unbound decoy must not be copied');
});

test('Locate includes a non-default ownership file explicitly bound by the manifest', t => {
  const { root, out, manifest, run } = fixture(t);
  const file = 'custom.ownership.json';
  fs.copyFileSync(path.join(root, 'checkout-platform.ownership.json'), path.join(root, file));
  manifest.ownership = { file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') };
  replaceManifest(root, manifest);
  const result = run(['--ownership', path.join(root, file)]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(fs.existsSync(path.join(out, file)));
  disposeBundleFixture(root);
  assert.doesNotThrow(() => validateBundle(out));
});
