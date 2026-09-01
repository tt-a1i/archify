import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ChromeVisualBrowser, findChrome } from './visual-check.mjs';

const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });
const FULL = Object.freeze({ width: 3840, height: 2160 });
const REVIEW = Object.freeze({ width: 1600, height: 900 });

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeUnlink(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isFile()) fs.rmSync(file, { force: true });
  } catch {
    // Cleanup is best-effort and must not touch a non-file target.
  }
}

export function presentationSidecarPaths(artifactPath) {
  const artifact = path.resolve(artifactPath);
  const stem = artifact.replace(/\.html?$/i, '');
  return {
    full: `${stem}.presentation.3840x2160.png`,
    review: `${stem}.presentation.1600x900.png`,
    pdf: `${stem}.presentation.16x9.pdf`,
    receipt: `${stem}.presentation.json`,
  };
}

function cleanupPayload(outputs) {
  safeUnlink(outputs.full);
  safeUnlink(outputs.review);
  safeUnlink(outputs.pdf);
}

function atomicWrite(file, contents) {
  const candidate = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(candidate, contents, { flag: 'w' });
    fs.renameSync(candidate, file);
  } finally {
    safeUnlink(candidate);
  }
}

function diagnostic(code, message, evidence = {}, supportedFixes = []) {
  return {
    code,
    severity: code === 'presentation/chrome-unavailable' ? 'warning' : 'error',
    message,
    subject: {},
    evidence,
    supportedFixes,
  };
}

function outputRecord(file, extra = {}) {
  const bytes = fs.readFileSync(file);
  return {
    file: path.basename(file),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    ...extra,
  };
}

function pngDimensions(file) {
  const png = fs.readFileSync(file);
  if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path.basename(file)} is not a PNG.`);
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function pdfGeometry(pdf) {
  if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Chrome output is not a PDF.');
  const structural = pdf.toString('latin1');
  const pageCount = (structural.match(/\/Type\s*\/Page\b/g) || []).length;
  const boxes = [...structural.matchAll(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/g)]
    .map((match) => match.slice(1).map(Number));
  if (pageCount !== 1 || boxes.length !== 1) {
    throw new Error(`PDF geometry is not one unambiguous page (pages=${pageCount}, mediaBoxes=${boxes.length}).`);
  }
  const mediaBoxPoints = boxes[0].map((value) => Math.round(value * 1000) / 1000);
  const expected = [0, 0, 960, 540];
  if (!mediaBoxPoints.every((value, index) => Math.abs(value - expected[index]) <= 0.01)) {
    throw new Error(`PDF MediaBox is ${mediaBoxPoints.join(' ')}, expected 0 0 960 540 points.`);
  }
  return {
    pageCount,
    mediaBoxPoints: expected,
    aspectRatio: '16:9',
    taggedStructure: /\/StructTreeRoot\b/.test(structural) && /\/MarkInfo\b/.test(structural),
  };
}

function failureReceipt({ source, sourceBytes, chrome, status = 'fail', diagnostics }) {
  return {
    schemaVersion: 1,
    ok: false,
    command: 'presentation-evidence',
    evidenceKind: 'presentation-16x9',
    status,
    visualReview: 'pending',
    source: {
      path: source,
      sha256: sha256(sourceBytes),
      bytes: sourceBytes.byteLength,
    },
    chrome,
    outputs: {},
    diagnostics,
  };
}

function commitPacket(staged, outputs, renameFile) {
  const entries = [
    [staged.full, outputs.full],
    [staged.review, outputs.review],
    [staged.pdf, outputs.pdf],
    [staged.receipt, outputs.receipt],
  ];
  for (const [, target] of entries) {
    if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) {
      throw new Error(`Presentation sidecar target is not a regular file: ${path.basename(target)}`);
    }
  }
  const backups = [];
  const committed = [];
  try {
    for (const [, target] of entries) {
      if (!fs.existsSync(target)) continue;
      const backup = `${target}.previous-${process.pid}`;
      renameFile(target, backup);
      backups.push([backup, target]);
    }
    for (const [candidate, target] of entries) {
      renameFile(candidate, target);
      committed.push(target);
    }
    for (const [backup] of backups) safeUnlink(backup);
  } catch (error) {
    for (const target of committed.reverse()) safeUnlink(target);
    for (const [backup, target] of backups.reverse()) {
      try { fs.renameSync(backup, target); } catch { /* Report original commit failure. */ }
    }
    throw error;
  }
}

export async function runPresentationEvidence({
  artifactPath,
  requiredText = [],
  chromePath,
  resolveChrome = findChrome,
  browserFactory = async (resolved) => new ChromeVisualBrowser(resolved),
  commitRename = fs.renameSync,
} = {}) {
  if (!artifactPath) throw new Error('presentation-evidence requires one delivered HTML artifact.');
  const source = path.resolve(artifactPath);
  if (!/\.html?$/i.test(source)) throw new Error('presentation-evidence requires an .html artifact.');
  const sourceBytes = fs.readFileSync(source);
  const outputs = presentationSidecarPaths(source);
  const resolvedChrome = chromePath || resolveChrome();
  if (!resolvedChrome) {
    cleanupPayload(outputs);
    safeUnlink(outputs.receipt);
    const receipt = failureReceipt({
      source,
      sourceBytes,
      chrome: { status: 'unavailable', executable: null },
      status: 'skipped',
      diagnostics: [diagnostic(
        'presentation/chrome-unavailable',
        'Chrome or Chromium is unavailable.',
        { executable: null },
        ['set ARCHIFY_CHROME to a Chrome or Chromium executable and rerun presentation-evidence'],
      )],
    });
    atomicWrite(outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
    return { exitCode: EXIT.skipped, receipt };
  }

  const staging = fs.mkdtempSync(path.join(path.dirname(source), '.archify-presentation-'));
  const staged = {
    full: path.join(staging, path.basename(outputs.full)),
    review: path.join(staging, path.basename(outputs.review)),
    pdf: path.join(staging, path.basename(outputs.pdf)),
    receipt: path.join(staging, path.basename(outputs.receipt)),
  };
  let browser;
  let commitAttempted = false;
  try {
    browser = await browserFactory(resolvedChrome);
    const fullMetrics = await browser.loadPresentation({ artifactPath: source, ...FULL });
    const phraseEvidence = requiredText.map((phrase) => ({ phrase, found: fullMetrics.visibleText.includes(phrase) }));
    const missing = phraseEvidence.filter((entry) => !entry.found).map((entry) => entry.phrase);
    if (missing.length) {
      const error = new Error(`Required visible text is missing: ${missing.join(', ')}`);
      error.presentationCode = 'presentation/required-text-missing';
      error.presentationEvidence = { missing };
      throw error;
    }
    if (fullMetrics.scrollWidth > FULL.width || fullMetrics.scrollHeight > FULL.height) {
      throw new Error(`Source does not fit the exact ${FULL.width}x${FULL.height} full-page canvas.`);
    }
    await browser.capturePresentationPng(staged.full);
    await browser.printPresentationPdf(staged.pdf);
    const reviewMetrics = await browser.loadPresentation({ artifactPath: source, ...REVIEW });
    if (reviewMetrics.scrollWidth > REVIEW.width || reviewMetrics.scrollHeight > REVIEW.height) {
      throw new Error(`Source does not fit the exact ${REVIEW.width}x${REVIEW.height} review canvas.`);
    }
    await browser.capturePresentationPng(staged.review);

    const after = fs.readFileSync(source);
    if (sha256(after) !== sha256(sourceBytes) || after.byteLength !== sourceBytes.byteLength) {
      throw new Error('The delivered HTML changed while presentation evidence was running.');
    }
    const fullDimensions = pngDimensions(staged.full);
    const reviewDimensions = pngDimensions(staged.review);
    if (fullDimensions.width !== FULL.width || fullDimensions.height !== FULL.height) {
      throw new Error('Full-page PNG dimensions do not match 3840x2160.');
    }
    if (reviewDimensions.width !== REVIEW.width || reviewDimensions.height !== REVIEW.height) {
      throw new Error('Review PNG dimensions do not match 1600x900.');
    }
    const geometry = pdfGeometry(fs.readFileSync(staged.pdf));
    const receipt = {
      schemaVersion: 1,
      ok: true,
      command: 'presentation-evidence',
      evidenceKind: 'presentation-16x9',
      status: 'pass',
      visualReview: 'pending',
      source: { path: source, sha256: sha256(sourceBytes), bytes: sourceBytes.byteLength },
      chrome: { status: 'available', executable: resolvedChrome },
      outputs: {
        fullPagePng: outputRecord(staged.full, fullDimensions),
        reviewPng: outputRecord(staged.review, reviewDimensions),
        pdf: outputRecord(staged.pdf, geometry),
      },
      textEvidence: {
        visibleText: { method: 'DOM innerText after font and frame settling', requiredPhrases: phraseEvidence },
        pdfStructure: { tagged: geometry.taggedStructure },
        searchableText: 'unverified',
        limitation: 'The zero-dependency verifier proves visible DOM text and tagged PDF structure, but does not generically extract PDF glyph encodings; PDF text searchability is not claimed.',
      },
      diagnostics: [],
    };
    fs.writeFileSync(staged.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
    try {
      commitAttempted = true;
      commitPacket(staged, outputs, commitRename);
    } catch (cause) {
      const error = new Error(cause.message);
      error.presentationCode = 'presentation/commit-failed';
      throw error;
    }
    return { exitCode: EXIT.pass, receipt };
  } catch (error) {
    const receipt = failureReceipt({
      source,
      sourceBytes,
      chrome: { status: 'available', executable: resolvedChrome },
      diagnostics: [diagnostic(
        error.presentationCode || 'presentation/runtime-failed',
        error.message,
        error.presentationEvidence || { reason: error.message },
        ['resolve the reported presentation evidence failure and rerun the command'],
      )],
    });
    if (!commitAttempted) {
      cleanupPayload(outputs);
      safeUnlink(outputs.receipt);
      try { atomicWrite(outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`); } catch { /* stdout remains truthful. */ }
    }
    return { exitCode: EXIT.fail, receipt };
  } finally {
    if (browser) await browser.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
