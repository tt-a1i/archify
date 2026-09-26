import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
