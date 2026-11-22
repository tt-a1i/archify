import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');

test('finalize proves all four gates in real Chrome with bounded mixed-case sidecars and repeat delivery', {
  skip: !process.env.ARCHIFY_CHROME,
}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finalize-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, `${'long-'.repeat(46)}.HTML`);
  const captureSentinel = path.join(dir, 'unrelated.visual-check.light.png');
  fs.writeFileSync(captureSentinel, 'existing capture evidence');
  let evidence;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, [
      cli, 'finalize', 'architecture', path.join(skillRoot, 'examples/web-app.architecture.json'), output,
      '--quality', 'showcase', '--json',
    ], { cwd: skillRoot, encoding: 'utf8', env: process.env, timeout: 180000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.gates, { validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'pass' });
    assert.equal(receipt.visualReview, 'not-requested');
    if (evidence) assert.deepEqual(receipt.evidence, evidence);
    evidence = receipt.evidence;
    const browser = JSON.parse(fs.readFileSync(receipt.evidence.browserCheckReceipt));
    assert.equal(browser.command, 'browser-check');
    assert.equal(browser.containment.viewports.length, 4);
    assert.equal(browser.themeStates.viewports.length, 6);
    assert.equal(browser.captures.status, 'not-requested');
    assert.deepEqual(browser.captures.screenshots, []);
    assert.equal(browser.deliveryReceiptId, JSON.parse(fs.readFileSync(evidence.receipt)).stages.deliver.receipt.receiptId);
    assert.equal(fs.readFileSync(captureSentinel, 'utf8'), 'existing capture evidence');
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.png')), ['unrelated.visual-check.light.png']);
  }
});


function relationshipRoutes(html) {
  return [...html.matchAll(/<path\b[^>]*marker-end[^>]*>/g)].map(([raw]) => {
    const attrs = Object.fromEntries([...raw.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    if (!attrs['data-edge-from'] || !attrs['data-composition-points']) return null;
    return { from: attrs['data-edge-from'], to: attrs['data-edge-to'],
      points: attrs['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)), raw };
  }).filter(Boolean);
}

test('ERD finalize names co-located cardinality glyphs on authored routes until repaired', {
  skip: !process.env.ARCHIFY_CHROME,
}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-browser-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Duplicate relationship endpoints', output: 'erd.html', quality_profile: 'standard' },
    layout: { mode: 'grid', origin: [32, 40], gapY: 44, entityW: 240, headerH: 30, rowH: 20 },
    entities: [
      { id: 'parent', label: 'Parent', row: 0, col: 0 },
      { id: 'near', label: 'Near', row: 1, col: 0 },
      { id: 'far', label: 'Far', row: 2, col: 0 },
    ],
    relationships: [
      { id: 'near_parent', from: 'near', to: 'parent', fromSide: 'left', toSide: 'left',
        fromCardinality: 'many', toCardinality: 'one', via: [[8, 168], [8, 68]] },
      { id: 'far_parent', from: 'far', to: 'parent', fromSide: 'left', toSide: 'left',
        fromCardinality: 'many', toCardinality: 'one', via: [[8, 268], [8, 68]] },
    ],
  };
  function finalize() {
    const directory = fs.mkdtempSync(path.join(root, 'delivery-'));
    const input = path.join(directory, 'erd.json');
    const output = path.join(directory, 'erd.html');
    fs.writeFileSync(input, JSON.stringify(diagram));
    const result = spawnSync(process.execPath, [cli, 'finalize', 'erd', input, output, '--json', '--browser-check'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.gates['browser-check'], 'pass');
    return { output, summary, routes: relationshipRoutes(fs.readFileSync(output, 'utf8')) };
  }

  const original = finalize();
  const recommendation = original.summary.visualReviewRecommendation;
  const [port] = recommendation.affectedRoutes.coincidentCardinalityPorts;
  assert.equal(recommendation.signals.coincidentCardinalityPorts, 1);
  assert.equal(port.entityId, 'parent');
  assert.equal(port.side, 'left');
  assert.deepEqual(port.point, original.routes[0].points.at(-1));
  assert.deepEqual(port.ends.map(({ relationship, glyph, sideField }) => [relationship.id, glyph, sideField]),
    [['near_parent', 'one', 'toSide'], ['far_parent', 'one', 'toSide']]);
  assert.match(recommendation.repair, /fromSide or toSide/);
  const checker = spawnSync(process.execPath, [path.join(skillRoot, 'scripts/check-render-output.mjs'), original.output], { encoding: 'utf8' });
  assert.equal(checker.status, 0, checker.stderr);
  assert.deepEqual(JSON.parse(checker.stdout).composition.routeReview.coincidentCardinalityPorts, [port]);

  Object.assign(diagram.relationships[1], { fromSide: 'right', toSide: 'right', via: [[296, 268], [296, 68]] });
  const repaired = finalize();
  assert.equal(repaired.summary.visualReviewRecommendation?.signals?.coincidentCardinalityPorts, undefined);
  assert.deepEqual(repaired.routes[0], original.routes[0], 'an existing authored side stays put');
  assert.notDeepEqual(repaired.routes[0].points.at(-1), repaired.routes[1].points.at(-1));
});
