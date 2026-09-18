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

// The renderer output guard: the target must not alias the artifact through
// any symbolic-link or future-path route, and must be a .svg on both the
// authored and the resolved path. It describes the filesystem only at the
// moment it runs, so it is repeated wherever the destination could have
// changed underneath an asynchronous step.
function guardedOutputPath({ output, artifact, cwd }) {
  return resolveOutputPath({
    requestedOutput: output,
    defaultOutput: defaultSvgOutput(artifact),
    inputPaths: [artifact],
    inputDescription: 'the delivered artifact',
    cwd,
    requiredExtension: '.svg',
  }).outputPath;
}

// Commit the SVG through a staging directory this invocation created
// exclusively beside the target. Nothing is opened at a predictable path:
// mkdtemp names the directory, 'wx' refuses a path that already exists (a
// planted symbolic link included), and the rename is a same-filesystem
// commit. Cleanup removes that staging directory only; a stray
// "<output>.tmp-*" belongs to someone else and is left alone.
function commitSvg({ outputPath, svg, revalidate }) {
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true });
  const staging = fs.mkdtempSync(path.join(directory, '.archify-export-'));
  const candidate = path.join(staging, path.basename(outputPath));
  try {
    fs.writeFileSync(candidate, svg, { flag: 'wx' });
    revalidate();
    if (!fs.lstatSync(candidate).isFile()) throw new Error('The staged SVG is not a regular file.');
    // The rename resolves the target's parent path again at commit time. A
    // concurrent process that replaces an ancestor directory of the target
    // between the check above and this call is outside what this guard
    // covers: Node has no descriptor-relative rename, and the CLI accepts
    // unrestricted output paths, so that case can fail or land under the
    // replacement rather than being prevented here.
    fs.renameSync(candidate, outputPath);
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      // A stale staging directory must never turn a committed export into a failure.
    }
  }
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
  const outputPath = guardedOutputPath({ output, artifact, cwd });

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

  // Both sides of the export are checked again after the browser has run and
  // immediately before the staged file is committed: the input must still be
  // the bytes the receipt describes, and the destination must still be safe.
  const revalidate = () => {
    const afterBytes = fs.readFileSync(artifact);
    if (sha256(afterBytes) !== receipt.artifact.sha256 || afterBytes.byteLength !== receipt.artifact.bytes) {
      throw new Error('The delivered artifact changed while export svg was running.');
    }
    guardedOutputPath({ output, artifact, cwd });
  };

  let browser;
  try {
    browser = await browserFactory(resolvedChrome);
    // The artifact is only read back; nothing it references over HTTP(S) is
    // fetched while it is open.
    await browser.load({ artifactPath: artifact, blockNetwork: true, ...(theme === 'auto' ? {} : { theme }) });
    const serialized = await browser.evaluate(serializerExpression(theme === 'auto'));
    if (!serialized || typeof serialized.svgString !== 'string' || !serialized.svgString) {
      throw new Error('This artifact does not expose the viewer SVG serializer. Re-render it with a current Archify.');
    }

    revalidate();
    commitSvg({ outputPath, svg: `${serialized.svgString}\n`, revalidate });
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
