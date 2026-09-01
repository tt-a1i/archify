import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pdfGeometry, runPresentationEvidence } from '../bin/presentation-evidence.mjs';
import { presentationPdfOptions } from '../bin/visual-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'archify.mjs');
const fixture = path.join(here, 'fixtures', 'presentation-evidence.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-presentation-evidence-'));

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function copyFixture(name) {
  const target = path.join(tmp, name);
  fs.copyFileSync(fixture, target);
  return target;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function pngDimensions(file) {
  const png = fs.readFileSync(file);
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function sidecars(source) {
  const stem = source.replace(/\.html?$/i, '');
  return {
    full: `${stem}.presentation.3840x2160.png`,
    review: `${stem}.presentation.1600x900.png`,
    pdf: `${stem}.presentation.16x9.pdf`,
    receipt: `${stem}.presentation.json`,
  };
}

function fakeBrowser() {
  let viewport = { width: 0, height: 0 };
  return {
    async loadPresentation({ width, height }) {
      viewport = { width, height };
      return { visibleText: 'System Review Approved architecture label', scrollWidth: width, scrollHeight: height };
    },
    async capturePresentationPng(file) {
      const png = Buffer.alloc(24);
      png.set([137, 80, 78, 71, 13, 10, 26, 10]);
      png.writeUInt32BE(viewport.width, 16);
      png.writeUInt32BE(viewport.height, 20);
      fs.writeFileSync(file, png);
    },
    async printPresentationPdf(file) {
      fs.writeFileSync(file, '%PDF-1.7\n1 0 obj <</Type /Page /MediaBox [0 0 960 540] /StructTreeRoot 2 0 R /MarkInfo <</Marked true>>>> endobj\n%%EOF');
    },
    async close() {},
  };
}

function pdf(...objects) {
  return Buffer.from(`%PDF-1.7\n${objects.join('\n')}\n%%EOF`, 'latin1');
}

test('presentation PDF uses landscape paper dimensions without masking extra pages', () => {
  assert.deepEqual(presentationPdfOptions(), {
    landscape: false,
    displayHeaderFooter: false,
    printBackground: true,
    preferCSSPageSize: false,
    paperWidth: 13.3333333333,
    paperHeight: 7.5,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    generateTaggedPDF: true,
    generateDocumentOutline: false,
  });
});

test('zero-dependency PDF geometry accepts one real-shape landscape page', () => {
  assert.deepEqual(pdfGeometry(pdf(
    '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
    '2 0 obj <</Type /Pages /Count 1 /Kids [3 0 R]>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 960 540]>> endobj',
  )), {
    pageCount: 1,
    mediaBoxPoints: [0, 0, 960, 540],
    aspectRatio: '16:9',
    taggedStructure: false,
  });
});

test('zero-dependency PDF geometry rejects portrait, multipage, and ambiguous MediaBoxes', () => {
  assert.throws(() => pdfGeometry(pdf('1 0 obj <</Type /Page /MediaBox [0 0 540 960]>> endobj')), /expected 0 0 960 540/);
  assert.throws(() => pdfGeometry(pdf(
    '1 0 obj <</Type /Page /MediaBox [0 0 960 540]>> endobj',
    '2 0 obj <</Type /Page /MediaBox [0 0 960 540]>> endobj',
  )), /pages=2/);
  assert.throws(() => pdfGeometry(pdf(
    '1 0 obj <</Type /Page /MediaBox [0 0 960 540] /CropBox [0 0 960 540]>> endobj',
    '2 0 obj <</MediaBox [0 0 960 540]>> endobj',
  )), /mediaBoxes=2/);
});

test('help exposes the opt-in presentation evidence command and repeatable phrase gate', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /presentation-evidence <output\.html>/);
  assert.match(result.stdout, /--require-text <exact phrase>/);
  assert.doesNotMatch(result.stdout, /mark-pass/);
});

test('Chrome unavailable is a truthful skip and removes stale presentation payloads', () => {
  const source = copyFixture('unavailable.html');
  const outputs = sidecars(source);
  for (const file of Object.values(outputs)) fs.writeFileSync(file, 'stale');
  const before = sha256(source);
  const result = run(['presentation-evidence', source, '--json'], { ARCHIFY_CHROME: '' });
  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'skipped');
  assert.equal(receipt.evidenceKind, 'presentation-16x9');
  assert.equal(receipt.visualReview, 'pending');
  assert.equal(receipt.diagnostics[0].code, 'presentation/chrome-unavailable');
  assert.equal(sha256(source), before);
  assert.equal(fs.existsSync(outputs.full), false);
  assert.equal(fs.existsSync(outputs.review), false);
  assert.equal(fs.existsSync(outputs.pdf), false);
  assert.equal(fs.existsSync(outputs.receipt), true);
});

test('browser evidence seam creates an immutable, exact, artifact-bound 16:9 packet', async () => {
  const source = copyFixture('accepted.html');
  const outputs = sidecars(source);
  for (const [key, file] of Object.entries(outputs)) fs.writeFileSync(file, `prior-${key}`);
  const before = { hash: sha256(source), bytes: fs.statSync(source).size };
  const result = await runPresentationEvidence({
    artifactPath: source,
    requiredText: ['System Review', 'Approved architecture label'],
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(result.exitCode, 0);
  const { receipt } = result;
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.evidenceKind, 'presentation-16x9');
  assert.equal(receipt.visualReview, 'pending');
  assert.deepEqual(receipt.source, { path: source, sha256: before.hash, bytes: before.bytes });
  assert.deepEqual(pngDimensions(outputs.full), { width: 3840, height: 2160 });
  assert.deepEqual(pngDimensions(outputs.review), { width: 1600, height: 900 });
  assert.equal(receipt.outputs.fullPagePng.width, 3840);
  assert.equal(receipt.outputs.reviewPng.height, 900);
  assert.equal(receipt.outputs.pdf.pageCount, 1);
  assert.deepEqual(receipt.outputs.pdf.mediaBoxPoints, [0, 0, 960, 540]);
  assert.equal(receipt.outputs.pdf.aspectRatio, '16:9');
  assert.equal(receipt.textEvidence.searchableText, 'unverified');
  assert.equal(receipt.textEvidence.visibleText.requiredPhrases.every((entry) => entry.found), true);
  for (const [key, file] of Object.entries(outputs)) {
    assert.equal(fs.existsSync(file), true, key);
    assert.notEqual(fs.readFileSync(file, 'utf8'), `prior-${key}`);
    if (key !== 'receipt') {
      const outputReceipt = Object.values(receipt.outputs).find((entry) => entry.file === path.basename(file));
      assert.equal(outputReceipt.sha256, sha256(file));
      assert.equal(outputReceipt.bytes, fs.statSync(file).size);
    }
  }
  assert.deepEqual({ hash: sha256(source), bytes: fs.statSync(source).size }, before);
});

test('missing exact phrase fails before an accepted packet and clears stale payloads', async () => {
  const source = copyFixture('phrase-failure.html');
  const outputs = sidecars(source);
  for (const file of [outputs.full, outputs.review, outputs.pdf]) fs.writeFileSync(file, 'stale');
  const result = await runPresentationEvidence({
    artifactPath: source,
    requiredText: ['Missing exact phrase'],
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(result.exitCode, 1);
  const { receipt } = result;
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.diagnostics[0].code, 'presentation/required-text-missing');
  assert.equal(fs.existsSync(outputs.full), false);
  assert.equal(fs.existsSync(outputs.review), false);
  assert.equal(fs.existsSync(outputs.pdf), false);
});

for (const failAt of [1, 4, 8]) {
  test(`commit rename failure ${failAt} restores every byte of the prior complete packet`, async () => {
    const source = copyFixture(`atomic-failure-${failAt}.html`);
    const outputs = sidecars(source);
    for (const [key, file] of Object.entries(outputs)) fs.writeFileSync(file, `trusted-${key}-${failAt}`);
    const before = Object.fromEntries(Object.entries(outputs).map(([key, file]) => [key, sha256(file)]));
    let renameCount = 0;
    const result = await runPresentationEvidence({
      artifactPath: source,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
      commitRename(sourcePath, targetPath) {
        renameCount += 1;
        if (renameCount === failAt) throw new Error(`synthetic rename failure ${failAt}`);
        fs.renameSync(sourcePath, targetPath);
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.diagnostics[0].code, 'presentation/commit-failed');
    assert.deepEqual(
      Object.fromEntries(Object.entries(outputs).map(([key, file]) => [key, sha256(file)])),
      before,
    );
    assert.equal(fs.readFileSync(outputs.receipt, 'utf8'), `trusted-receipt-${failAt}`);
    assert.deepEqual(
      fs.readdirSync(path.dirname(source)).filter((name) => name.includes('.previous-') || name.includes('.archify-presentation-')),
      [],
    );
  });
}

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
