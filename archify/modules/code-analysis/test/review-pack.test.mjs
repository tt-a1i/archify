import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { changesUrl, readPrReviewPack } from '../lib/review-pack.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pr-review-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'pr-pack.receipt.json');
  const pr = { repository: 'example/service', mergeBaseSHA: 'a'.repeat(40), headSHA: 'b'.repeat(40) };
  const views = path.join(root, 'views');
  fs.mkdirSync(views);
  const snapshot = { meta: { repository: { url: 'https://github.com/example/service',
    revision: pr.headSHA, base_revision: pr.mergeBaseSHA } },
    components: [
      { change: 'modified', sources: [{ path: 'app/src/checkout.mjs', line: 4 }, { path: 'app/src/checkout.mjs', line: 4 }, { path: 'other/not-in-scope.js' }] },
      { change: 'removed', sources: [{ path: 'app/old.mjs', line: 2 }, { path: 'app/new.mjs', line: 1 }] },
      { change: 'added', sources: [{ path: 'app/old.mjs', line: 2 }, { path: '../private.js', line: 1 }] },
    ] };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12"/></svg>';
  const image = path.join(views, 'topology-light.svg');
  fs.writeFileSync(path.join(views, 'topology.json'), JSON.stringify(snapshot));
  fs.writeFileSync(image, svg);
  const receipt = { schemaVersion: 1, ok: true, kind: 'pr-pack-receipt', repository: 'example/service',
    title: 'Checkout review', revisions: { verified: true, baseSha: pr.mergeBaseSHA, headSha: pr.headSHA },
    views: [{ id: 'topology', title: 'Service topology', type: 'architecture', snapshot: 'C:/original-machine/topology.json' }],
    assets: [{ id: 'topology-light', view: 'topology', theme: 'light', path: 'C:/original-machine/topology-light.svg',
      bytes: Buffer.byteLength(svg), sha256: createHash('sha256').update(svg).digest('hex') }] };
  const save = () => fs.writeFileSync(file, JSON.stringify(receipt));
  save();
  return { scope: 'app', pr, changedFiles: [
    { status: 'modified', path: 'src/checkout.mjs' }, { status: 'renamed', path: 'new.mjs', previousPath: 'old.mjs' },
  ], file, receipt, save, image };
}

const diagnostic = key => error => error.diagnostics?.[0]?.code === 'analysis/pr-pack-' + key;

test('a copied native pack offers only unique, scoped source anchors on the right Git side', t => {
  const pack = fixture(t);
  const result = readPrReviewPack(pack.file, pack);
  assert.deepEqual(result.views[0].anchors, [{ side: 'head', file: 'src/checkout.mjs', line: 4 },
    { side: 'base', file: 'old.mjs', line: 2 }]);
  assert.match(result.views[0].images.light, /^data:image\/svg\+xml;base64,/);
});

test('review pack import fails closed on stale revisions and changed SVG bytes', t => {
  const pack = fixture(t);
  pack.receipt.revisions.headSha = 'c'.repeat(40);
  pack.save();
  assert.throws(() => readPrReviewPack(pack.file, pack), diagnostic('revision'));
  pack.receipt.revisions.headSha = pack.pr.headSHA;
  pack.save();
  const image = fs.readFileSync(pack.image, 'utf8').replace('<rect', '<path');
  fs.writeFileSync(pack.image, image);
  assert.throws(() => readPrReviewPack(pack.file, pack), diagnostic('asset'));
});

test('the GitHub review link opens Changes and rejects unsafe schemes and credentials', () => {
  assert.equal(changesUrl('https://example.com/report.html#readme'), 'https://example.com/report.html#changes');
  assert.throws(() => changesUrl('javascript:alert(1)'), diagnostic('url'));
  assert.throws(() => changesUrl('https://user:secret@example.com/report.html'), diagnostic('url'));
});
