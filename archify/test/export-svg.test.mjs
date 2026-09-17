import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultSvgOutput, runExportSvg } from '../bin/export-svg.mjs';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { SaxesParser } from 'saxes';

import { assertFontCss, inspectDocuments } from './helpers/offline-fonts.mjs';
import { extractSvgs, parseXml } from './helpers/xml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const browserOptions = { skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.' };

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

function sha(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifact(name = 'diagram.html', directory = tmp) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, '<!doctype html><html><body>delivered artifact</body></html>');
  return file;
}

function stagingLeftBehind(directory) {
  return fs.readdirSync(directory).filter((name) => name.startsWith('.archify-export-'));
}

function render(input, output) {
  execFileSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), 'render', 'architecture', input, output], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
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
  assert.equal(result.receipt.artifact.sha256, sha(file));
  assert.equal(result.receipt.output.sha256, sha(output));
  assert.match(fs.readFileSync(output, 'utf8'), /^<svg xmlns=/);
  assert.equal(browser.calls[0].blockNetwork, true, 'the artifact is opened with HTTP(S) requests blocked');
  assert.equal(browser.calls.at(-1).kind, 'close');
  assert.deepEqual(stagingLeftBehind(tmp), []);
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
  assert.deepEqual(stagingLeftBehind(tmp), []);
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

test('export svg refuses an output path that is a symbolic link to the delivered artifact', async () => {
  const directory = fs.mkdtempSync(path.join(tmp, 'alias-'));
  const file = artifact('input.html', directory);
  const output = path.join(directory, 'alias.svg');
  fs.symlinkSync(file, output);
  const before = sha(file);

  await assert.rejects(
    runExportSvg({
      artifactPath: file,
      output,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    }),
    /Output must not replace the delivered artifact/,
  );
  assert.equal(sha(file), before);
  assert.equal(fs.readlinkSync(output), file);
});

test('export svg never writes through a pre-planted temporary beside the target', async () => {
  // The reported reproduction: a predictable "<output>.tmp-<pid>" symbolic
  // link pointing at the artifact, planted before the export runs. A plain
  // file at a similar name stands in for any other process's temporary.
  const directory = fs.mkdtempSync(path.join(tmp, 'planted-'));
  const file = artifact('input.html', directory);
  const output = path.join(directory, 'result.svg');
  const plantedLink = `${output}.tmp-${process.pid}`;
  fs.symlinkSync(file, plantedLink);
  const plantedFile = `${output}.tmp-stale`;
  fs.writeFileSync(plantedFile, "someone else's temporary");
  const before = sha(file);

  const result = await runExportSvg({
    artifactPath: file,
    output,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
  assert.equal(result.receipt.ok, true);
  assert.equal(sha(file), before, 'the delivered artifact must survive the export');
  assert.match(fs.readFileSync(output, 'utf8'), /^<svg xmlns=/);
  assert.equal(fs.lstatSync(plantedLink).isSymbolicLink(), true, 'a pre-existing temporary target is not ours to replace');
  assert.equal(fs.readlinkSync(plantedLink), file);
  assert.equal(fs.readFileSync(plantedFile, 'utf8'), "someone else's temporary");
  assert.deepEqual(stagingLeftBehind(directory), [], 'staging owned by this export is removed');
});

test('export svg re-checks the destination after the browser has run', async () => {
  // The guard passed before the browser started; while the page was loading
  // the output path became a symbolic link to the artifact. The export must
  // notice before committing anything and leave both files as they were.
  const directory = fs.mkdtempSync(path.join(tmp, 'raced-'));
  const file = artifact('input.html', directory);
  const output = path.join(directory, 'raced.svg');
  const before = sha(file);

  const result = await runExportSvg({
    artifactPath: file,
    output,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ onLoad: () => fs.symlinkSync(file, output) }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.match(result.receipt.error, /Output must not replace the delivered artifact/);
  assert.equal(sha(file), before);
  assert.equal(fs.readlinkSync(output), file, 'the planted link is reported, not replaced');
  assert.deepEqual(stagingLeftBehind(directory), []);
});

test('export svg fails when the artifact changes while the browser is running and writes nothing', async () => {
  const file = artifact('mutated.html');
  const output = path.join(tmp, 'mutated.svg');
  const result = await runExportSvg({
    artifactPath: file,
    output,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ onLoad: () => fs.appendFileSync(file, '<!-- edited during export -->') }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.match(result.receipt.error, /changed while export svg was running/);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(stagingLeftBehind(tmp), []);
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

test('archify export svg rejects bad arguments before a browser is involved', () => {
  const file = artifact('cli-guards.html');
  const cases = [
    [['export', 'svg', file, path.join(tmp, 'cli-guards.png')], /CLI output must target a \.svg file/],
    [['export', 'svg', file, file], /Output must not replace the delivered artifact/],
    [['export', 'svg', path.join(tmp, 'diagram.json')], /requires an \.html artifact/],
    [['export', 'png', file], /supported for svg only/],
    [['export', 'svg', file, '--theme', 'neon'], /Unknown theme "neon"/],
    [['export', 'svg', file, '--bogus'], /Unknown export option "--bogus"/],
  ];
  for (const [args, expected] of cases) {
    const result = cli(args, { ARCHIFY_CHROME: '' });
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, expected, args.join(' '));
  }
  assert.equal(fs.existsSync(defaultSvgOutput(file)), false);
});

test('archify export svg exits 2 and writes nothing when Chrome is unavailable', () => {
  const file = artifact('cli-no-chrome.html');
  const plain = cli(['export', 'svg', file], { ARCHIFY_CHROME: '' });
  assert.equal(plain.status, 2);
  assert.match(plain.stderr, /Chrome or Chromium is unavailable/);
  assert.equal(fs.existsSync(defaultSvgOutput(file)), false);

  const json = cli(['export', 'svg', file, '--json'], { ARCHIFY_CHROME: '' });
  assert.equal(json.status, 2);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.command, 'export svg');
  assert.equal(receipt.status, 'skipped');
  assert.equal(receipt.chrome.status, 'unavailable');
});

test('a real exported SVG carries the styles the inline SVG leaves in the host document', browserOptions, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-browser-'));
  const html = path.join(workspace, 'web-app.html');
  try {
    render(path.join(skillRoot, 'examples', 'web-app.architecture.json'), html);

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

test('a real export keeps non-ASCII text and the embedded offline fonts', browserOptions, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-text-'));
  try {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
    const sublabel = 'Ā Ѡ Ж 中文 ắ';
    source.meta.title = 'Fonts A Ā Ѡ Ж Ω ắ 中文';
    source.components.find((component) => component.id === 'api').sublabel = sublabel;
    const input = path.join(workspace, 'mixed.json');
    fs.writeFileSync(input, JSON.stringify(source));
    const html = path.join(workspace, 'mixed.html');
    render(input, html);

    const result = await runExportSvg({ artifactPath: html, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));

    const exported = fs.readFileSync(result.receipt.output.path).toString('utf8');
    assert.ok(exported.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'the standalone document must declare its encoding');
    assert.ok(exported.includes(sublabel), 'non-ASCII label text must survive serialization and the file write');
    assert.doesNotThrow(() => parseXml(exported));

    // The same font contract the Download SVG menu item satisfies: embedded
    // WOFF2 bytes, their license, and no external resource of any kind.
    const [document] = inspectDocuments(exported, 'exported SVG');
    assert.deepEqual(document.resources, [], 'a standalone SVG must not reach for the network');
    assertFontCss(document.styles.join('\n'), 'exported SVG');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('a real export does not let the artifact reach an HTTP endpoint', browserOptions, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-network-'));
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    response.statusCode = 204;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const html = path.join(workspace, 'web-app.html');
    render(path.join(skillRoot, 'examples', 'web-app.architecture.json'), html);
    // A delivered artifact never references the network; plant the reference
    // a crafted file would carry. The page's load event waits for the image,
    // so by the time load() returns the request has either arrived or been
    // refused.
    const probe = `http://127.0.0.1:${server.address().port}/probe`;
    fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('</body>', `<img src="${probe}" alt=""></body>`));

    // Control: an unguarded load reaches the listener, so a silent listener
    // below means the export blocked the request, not that nothing asked.
    const unguarded = new ChromeVisualBrowser(chromePath);
    try {
      await unguarded.load({ artifactPath: html });
    } finally {
      await unguarded.close();
    }
    assert.deepEqual(hits, ['/probe'], 'control: an unguarded page load must reach the listener');
    hits.length = 0;

    const result = await runExportSvg({ artifactPath: html, chromePath });
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt, null, 2));
    assert.deepEqual(hits, [], 'export must not let the artifact reach the network');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('archify export svg writes a themed SVG from the CLI and leaves the artifact untouched', browserOptions, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-svg-cli-'));
  try {
    const html = path.join(workspace, 'web-app.html');
    render(path.join(skillRoot, 'examples', 'web-app.architecture.json'), html);
    const before = sha(html);

    const output = path.join(workspace, 'web-app-dark.svg');
    const themed = cli(['export', 'svg', html, output, '--theme', 'dark', '--json'], { ARCHIFY_CHROME: chromePath });
    assert.equal(themed.status, 0, themed.stderr);
    const receipt = JSON.parse(themed.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.command, 'export svg');
    assert.equal(receipt.status, 'pass');
    assert.equal(receipt.theme, 'dark');
    assert.equal(receipt.output.path, output);
    assert.equal(receipt.artifact.sha256, before);
    assert.equal(receipt.output.sha256, sha(output));
    assert.equal(sha(html), before, 'the delivered artifact is only read');
    const exported = fs.readFileSync(output, 'utf8');
    assert.equal(rootNamespace(exported), 'http://www.w3.org/2000/svg');
    assert.match(exported, /<style>/);
    assert.doesNotMatch(exported, /prefers-color-scheme/, 'a requested theme locks the SVG to that theme');

    // Default output path, human-readable mode.
    const plain = cli(['export', 'svg', html], { ARCHIFY_CHROME: chromePath });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.trim(), defaultSvgOutput(html));
    assert.equal(fs.existsSync(defaultSvgOutput(html)), true);
    assert.equal(sha(html), before);
    assert.deepEqual(stagingLeftBehind(workspace), []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
