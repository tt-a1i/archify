import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultSvgOutput, runExportSvg } from '../bin/export-svg.mjs';
import { findChrome } from '../bin/visual-check.mjs';
import { SaxesParser } from 'saxes';

import { extractSvgs, parseXml } from './helpers/xml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

// An SVG file only renders as SVG when its root element resolves to the SVG
// namespace; an inline SVG inherits that from the host HTML parser instead.
function rootNamespace(source) {
  let uri = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', (tag) => {
    if (uri === null) uri = tag.uri;
  });
  parser.write(source).close();
  return uri;
}

function artifact(name = 'diagram.html') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, '<!doctype html><html><body>delivered artifact</body></html>');
  return file;
}

function fakeBrowser({ serialized, onLoad } = {}) {
  const calls = [];
  return {
    calls,
    async load(options) {
      calls.push({ kind: 'load', ...options });
      if (onLoad) onLoad(options);
    },
    async evaluate(expression) {
      calls.push({ kind: 'evaluate', expression });
      return serialized === undefined
        ? { svgString: '<svg xmlns="http://www.w3.org/2000/svg"><style>svg{}</style></svg>', width: 10, height: 5, canonicalStateClean: true }
        : serialized;
    },
    async close() {
      calls.push({ kind: 'close' });
    },
  };
}

test('export svg defaults beside the artifact on the artifact stem', () => {
  assert.equal(defaultSvgOutput('/tmp/diagrams/web-app.html'), '/tmp/diagrams/web-app.svg');
  assert.equal(defaultSvgOutput('/tmp/diagrams/web-app.HTM'), '/tmp/diagrams/web-app.svg');
});

test('export svg writes the standalone document and reports both digests', async () => {
  const file = artifact('written.html');
  const browser = fakeBrowser();
  const result = await runExportSvg({
    artifactPath: file,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  const output = defaultSvgOutput(file);
  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.status, 'pass');
  assert.equal(result.receipt.ok, true);
  assert.equal(result.receipt.output.path, output);
  assert.equal(result.receipt.theme, 'auto');
  assert.equal(result.receipt.canonicalStateClean, true);
  assert.equal(
    result.receipt.artifact.sha256,
    createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  );
  assert.equal(
    result.receipt.output.sha256,
    createHash('sha256').update(fs.readFileSync(output)).digest('hex'),
  );
  assert.match(fs.readFileSync(output, 'utf8'), /^<svg xmlns=/);
  assert.equal(browser.calls.at(-1).kind, 'close');
});

test('export svg leaves the theme to the SVG unless one is requested', async () => {
  const file = artifact('auto-theme.html');
  const auto = fakeBrowser();
  await runExportSvg({
    artifactPath: file,
    output: path.join(tmp, 'auto-theme.svg'),
    chromePath: '/fake/chrome',
    browserFactory: async () => auto,
  });
  assert.equal(auto.calls[0].theme, undefined);
  assert.match(auto.calls[1].expression, /autoTheme: true/);

  const locked = fakeBrowser();
  await runExportSvg({
    artifactPath: file,
    output: path.join(tmp, 'locked-theme.svg'),
    theme: 'dark',
    chromePath: '/fake/chrome',
    browserFactory: async () => locked,
  });
  assert.equal(locked.calls[0].theme, 'dark');
  assert.match(locked.calls[1].expression, /autoTheme: false/);
});

test('export svg skips without Chrome instead of writing a partial file', async () => {
  const file = artifact('no-chrome.html');
  const result = await runExportSvg({ artifactPath: file, resolveChrome: () => null });

  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.status, 'skipped');
  assert.equal(result.receipt.chrome.status, 'unavailable');
  assert.match(result.receipt.error, /ARCHIFY_CHROME/);
  assert.equal(fs.existsSync(defaultSvgOutput(file)), false);
});

test('export svg fails on an artifact without the viewer serializer', async () => {
  const file = artifact('legacy.html');
  const result = await runExportSvg({
    artifactPath: file,
    output: path.join(tmp, 'legacy.svg'),
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ serialized: null }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.match(result.receipt.error, /does not expose the viewer SVG serializer/);
  assert.equal(fs.existsSync(path.join(tmp, 'legacy.svg')), false);
});

test('export svg refuses to overwrite the delivered artifact or a non-svg target', async () => {
  const file = artifact('guarded.html');
  await assert.rejects(
    runExportSvg({
      artifactPath: file,
      output: file,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    }),
    /Output must not replace the delivered artifact/,
  );
  await assert.rejects(
    runExportSvg({
      artifactPath: file,
      output: path.join(tmp, 'guarded.png'),
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    }),
    /CLI output must target a \.svg file/,
  );
});

test('export svg rejects a non-HTML artifact and an unknown theme', async () => {
  await assert.rejects(
    runExportSvg({ artifactPath: path.join(tmp, 'diagram.json'), chromePath: '/fake/chrome' }),
    /requires an \.html artifact/,
  );
  await assert.rejects(
    runExportSvg({ artifactPath: artifact('theme.html'), theme: 'neon', chromePath: '/fake/chrome' }),
    /theme must be one of/,
  );
});

test('a real exported SVG carries the styles the inline SVG leaves in the host document', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-browser-'));
  const html = path.join(workspace, 'web-app.html');
  try {
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'render',
      'architecture',
      path.join(skillRoot, 'examples', 'web-app.architecture.json'),
      html,
    ], { cwd: skillRoot, encoding: 'utf8' });

    // The failing case: the inline SVG lifted straight out of the artifact.
    // It has no namespace and no styles, so it is not a standalone document.
    const inline = extractSvgs(fs.readFileSync(html, 'utf8')).direct[0];
    assert.ok(inline);
    assert.equal(/<style/.test(inline), false);
    assert.equal(rootNamespace(inline), '');

    // The passing case: the exported document stands on its own.
    const result = await runExportSvg({ artifactPath: html, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    assert.equal(result.receipt.canonicalStateClean, true);

    const exported = fs.readFileSync(result.receipt.output.path, 'utf8');
    assert.equal(rootNamespace(exported), 'http://www.w3.org/2000/svg');
    assert.match(exported, /<style>/);
    assert.match(exported, /prefers-color-scheme: light/);
    assert.doesNotThrow(() => parseXml(exported));
    assert.ok(exported.length > inline.length);

    // Every semantic class the inline SVG uses must resolve in the export.
    const classes = new Set();
    for (const [, list] of inline.matchAll(/class="([^"]+)"/g)) {
      for (const name of list.split(/\s+/)) if (/^[cta]-/.test(name)) classes.add(name);
    }
    assert.ok(classes.size > 0);
    const styles = exported.slice(exported.indexOf('<style>'), exported.indexOf('</style>'));
    for (const name of classes) assert.ok(styles.includes(`.${name}`), `exported SVG is missing .${name}`);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
