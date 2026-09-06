import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ChromeVisualBrowser, findChrome } from './visual-check.mjs';
import { resolveOutputPath } from '../renderers/shared/output-path.mjs';

const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });
export const EXPORT_SVG_THEMES = Object.freeze(['auto', 'dark', 'light']);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function writeAtomic(file, contents) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, contents, { flag: 'w' });
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // A stale temporary must never block a completed export.
    }
  }
}

// Default beside the artifact, on the artifact's own stem, so an export always
// has an obvious home next to the HTML it came from.
export function defaultSvgOutput(artifactPath) {
  return `${path.resolve(artifactPath).replace(/\.html?$/i, '')}.svg`;
}

// The viewer already builds this document for its "Download SVG" menu item.
// Read it back as a value instead of triggering a browser download.
function serializerExpression(autoTheme) {
  return `(function () {
    if (!(window.Archify && Archify.exportMenu && typeof Archify.exportMenu.svgDocument === 'function')) return null;
    var document_ = Archify.exportMenu.svgDocument({ autoTheme: ${autoTheme ? 'true' : 'false'} });
    return {
      svgString: document_.svgString,
      width: document_.width,
      height: document_.height,
      canonicalStateClean: document_.canonicalStateClean === true
    };
  })()`;
}

function baseReceipt({ artifactPath, artifact, outputPath, theme, chrome }) {
  return {
    schemaVersion: 1,
    ok: false,
    command: 'export svg',
    status: 'fail',
    artifact: {
      path: artifactPath,
      sha256: sha256(artifact),
      bytes: artifact.byteLength,
    },
    output: { path: outputPath, sha256: null, bytes: 0 },
    theme,
    canonicalStateClean: false,
    chrome,
  };
}

export async function runExportSvg({
  artifactPath,
  output,
  theme = 'auto',
  chromePath,
  cwd = process.cwd(),
  resolveChrome = findChrome,
  browserFactory = async (resolvedChrome) => new ChromeVisualBrowser(resolvedChrome),
} = {}) {
  if (!artifactPath) throw new Error('export svg requires one delivered HTML artifact.');
  const artifact = path.resolve(cwd, artifactPath);
  if (!/\.html?$/i.test(artifact)) throw new Error('export svg requires an .html artifact.');
  if (!EXPORT_SVG_THEMES.includes(theme)) {
    throw new Error(`export svg theme must be one of ${EXPORT_SVG_THEMES.join(', ')}.`);
  }
  const artifactBytes = fs.readFileSync(artifact);

  // Reuse the renderer output guard so an export inherits the same
  // symbolic-link, alias, and extension protection a render already has.
  const { outputPath } = resolveOutputPath({
    requestedOutput: output,
    defaultOutput: defaultSvgOutput(artifact),
    inputPaths: [artifact],
    inputDescription: 'the delivered artifact',
    cwd,
    requiredExtension: '.svg',
  });

  const resolvedChrome = chromePath || resolveChrome();
  const receipt = baseReceipt({
    artifactPath: artifact,
    artifact: artifactBytes,
    outputPath,
    theme,
    chrome: resolvedChrome
      ? { status: 'available', executable: resolvedChrome }
      : { status: 'unavailable', executable: null },
  });

  if (!resolvedChrome) {
    receipt.status = 'skipped';
    receipt.error = 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.';
    return { exitCode: EXIT.skipped, receipt };
  }

  let browser;
  try {
    browser = await browserFactory(resolvedChrome);
    await browser.load({ artifactPath: artifact, ...(theme === 'auto' ? {} : { theme }) });
    const serialized = await browser.evaluate(serializerExpression(theme === 'auto'));
    if (!serialized || typeof serialized.svgString !== 'string' || !serialized.svgString) {
      throw new Error('This artifact does not expose the viewer SVG serializer. Re-render it with a current Archify.');
    }

    const afterBytes = fs.readFileSync(artifact);
    if (sha256(afterBytes) !== receipt.artifact.sha256 || afterBytes.byteLength !== receipt.artifact.bytes) {
      throw new Error('The delivered artifact changed while export svg was running.');
    }

    const svg = `${serialized.svgString}\n`;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    writeAtomic(outputPath, svg);
    const written = fs.readFileSync(outputPath);
    receipt.output.bytes = written.byteLength;
    receipt.output.sha256 = sha256(written);
    receipt.width = serialized.width;
    receipt.height = serialized.height;
    receipt.canonicalStateClean = serialized.canonicalStateClean === true;
    receipt.status = 'pass';
    receipt.ok = true;
    return { exitCode: EXIT.pass, receipt };
  } catch (error) {
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = error.message;
    return { exitCode: EXIT.fail, receipt };
  } finally {
    if (browser?.close) await browser.close();
  }
}
